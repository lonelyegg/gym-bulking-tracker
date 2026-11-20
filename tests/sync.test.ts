import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getLocal, patch, put } from '../src/db/db';
import { ENTITIES } from '../src/db/schema';
import { seedIfEmpty } from '../src/db/seed';
import { saveSetting, settings } from '../src/state/settings';
import { backupFileName, buildBackup, importBackup, parseBackup, previewBackup } from '../src/sync/backup';
import {
  connect, disconnect, pullChanges, pushPending, queueAll, redownloadAll, syncConfig, syncNow, syncStatus,
} from '../src/sync/sync';
import { createFakeScript, type FakeScript } from './helpers/fakeScript';

const URL = 'https://script.google.com/macros/s/TEST/exec';
const TOKEN = 'secret-token';
let server: FakeScript;
let requests: { action: string }[];

beforeEach(async () => {
  await db.delete();
  await db.open();
  server = createFakeScript(TOKEN);
  requests = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    requests.push({ action: JSON.parse(init.body).action });
    return new Response(server.post(init.body));
  });
  syncConfig.value = { url: URL, token: TOKEN, auto: true };
  syncStatus.value = { state: 'idle', lastSyncAt: null, error: null };
});
afterEach(() => vi.unstubAllGlobals());

async function wipePhone() {
  await db.delete();
  await db.open();
}

async function snapshot() {
  const out: Record<string, unknown[]> = {};
  for (const e of ENTITIES) {
    const rows = await db.table(e).toArray();
    out[e] = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

/** A finished workout with a couple of sets, written straight to the db. */
async function finishedWorkout(id = 'w1') {
  await put('workouts', {
    id, day_type_id: 'dt-push', split_id: 'split-ppl', rotation_index: 0, name: 'Push', icon: '🏋️', color: '#ef6c57',
    started_at: '2026-11-18T10:00:00.000Z', ended_at: '2026-11-18T11:00:00.000Z', status: 'done', notes: '',
  });
  await put('workout_exercises', {
    id: `${id}-we1`, workout_id: id, exercise_id: 'ex-barbell-bench-press', position: 0, target_sets: 2, rep_min: 6, rep_max: 10,
    target_rir: 2, rest_s: 150, transition_rest_s: null, note: '', skipped: 0, swapped_from_id: null,
  });
  await put('sets',
    { id: `${id}-s1`, workout_id: id, workout_exercise_id: `${id}-we1`, exercise_id: 'ex-barbell-bench-press', set_number: 1, is_warmup: 0,
      weight_kg: 60, reps: 10, rir: 2, completed_at: '2026-11-18T10:05:00.000Z', rest_before_s: null, rest_is_transition: 0, pr_types: ['e1rm', 'reps'], note: '' },
    { id: `${id}-s2`, workout_id: id, workout_exercise_id: `${id}-we1`, exercise_id: 'ex-barbell-bench-press', set_number: 2, is_warmup: 0,
      weight_kg: 62.5, reps: 8, rir: null, completed_at: '2026-11-18T10:08:00.000Z', rest_before_s: 180, rest_is_transition: 0, pr_types: [], note: 'felt heavy' },
  );
}

describe('push', () => {
  it('uploads the outbox, one tab per entity, and empties it', async () => {
    await seedIfEmpty();
    await finishedWorkout();
    expect(await db.outbox.count()).toBeGreaterThan(100);
    const pushed = await pushPending(syncConfig.value);
    expect(pushed).toBeGreaterThan(100);
    expect(await db.outbox.count()).toBe(0);
    expect(server.sheet('exercises')!.rows().length).toBeGreaterThan(40);
    const sets = server.sheet('sets')!.rows();
    expect(sets).toHaveLength(2);
    expect(sets[0].pr_types).toBe('["e1rm","reps"]');
    expect(sets[1].note).toBe('felt heavy');
    expect(server.sheet('splits')!.rows()[0].rotation).toMatch(/^\[/);
  });

  it('is idempotent: re-sending everything never duplicates rows', async () => {
    await seedIfEmpty();
    await finishedWorkout();
    await pushPending(syncConfig.value);
    const counts = () => Object.fromEntries([...server.sheets].map(([n, s]) => [n, s.rows().length]));
    const before = counts();
    await queueAll();
    await pushPending(syncConfig.value);
    await queueAll();
    await pushPending(syncConfig.value);
    expect(counts()).toEqual(before);
  });

  it('keeps the outbox when the request fails, and succeeds on retry', async () => {
    await finishedWorkout();
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    const res = await syncNow({ pull: false });
    expect(res.ok).toBe(false);
    expect(syncStatus.value.state).toMatch(/error|offline/);
    expect(await db.outbox.count()).toBe(4);
    vi.stubGlobal('fetch', real);
    const retry = await syncNow({ pull: false });
    expect(retry.ok).toBe(true);
    expect(await db.outbox.count()).toBe(0);
    expect(server.sheet('sets')!.rows()).toHaveLength(2);
  });

  it('does not send a record edited again while the request was in flight', async () => {
    await finishedWorkout();
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const reply = server.post(init.body);
      await patch('sets', 'w1-s1', { reps: 12 }); // edited during the request
      return new Response(reply);
    });
    await pushPending(syncConfig.value);
    const left = (await db.outbox.toArray()).map((e) => e.key);
    expect(left).toContain('sets:w1-s1');
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => new Response(server.post(init.body)));
    await pushPending(syncConfig.value);
    expect(server.sheet('sets')!.rows().find((r) => r.id === 'w1-s1')!.reps).toBe('12');
  });

  it('holds back a workout that is still in progress, then sends it on finish', async () => {
    await put('workouts', {
      id: 'live', day_type_id: null, split_id: null, rotation_index: null, name: 'Workout', icon: '🏋️', color: '#fff',
      started_at: '2026-11-19T10:00:00.000Z', ended_at: null, status: 'active', notes: '',
    });
    await put('sets', { id: 'live-s1', workout_id: 'live', workout_exercise_id: 'x', exercise_id: 'ex-deadlift', set_number: 1, is_warmup: 0,
      weight_kg: 100, reps: 5, rir: null, completed_at: null, rest_before_s: null, rest_is_transition: 0, pr_types: [], note: '' });
    expect(await pushPending(syncConfig.value)).toBe(0);
    expect(server.sheet('sets')).toBeUndefined();
    await patch('workouts', 'live', { status: 'done', ended_at: '2026-11-19T11:00:00.000Z' });
    expect(await pushPending(syncConfig.value)).toBe(2);
    expect(server.sheet('sets')!.rows()).toHaveLength(1);
  });

  it('drops outbox entries whose record no longer exists', async () => {
    await put('exercises', { id: 'tmp', name: 'Temp', muscle_group: 'chest', mechanic: 'compound', equipment: 'barbell', increment_kg: 2.5, default_rest_s: 120, notes: '' });
    await db.exercises.delete('tmp');
    expect(await pushPending(syncConfig.value)).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('pull / restore', () => {
  it('a new phone gets back exactly what the old one had', async () => {
    await seedIfEmpty();
    await finishedWorkout();
    await saveSetting('weekly_target', 5);
    await saveSetting('dumbbell_ladder', [2.5, 5, 7.5]);
    await put('foods', { id: 'f1', name: 'Rice', basis: 'per_100g', serving_g: null, serving_label: '', kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 });
    await syncNow();
    const before = await snapshot();

    await wipePhone(); // brand-new phone
    expect(await db.sets.count()).toBe(0);
    const res = await syncNow();
    expect(res.ok).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(settings.value.weekly_target).toBe(5);
    expect(settings.value.dumbbell_ladder).toEqual([2.5, 5, 7.5]);
  });

  it('incremental pulls only fetch what changed', async () => {
    await seedIfEmpty();
    await syncNow();
    server.call('push', { changes: { exercises: [{
      id: 'other-device', created_at: '2026-11-19T09:00:00.000Z', updated_at: '2026-11-19T09:00:00.000Z', deleted: 0,
      name: 'Cable Row', muscle_group: 'back', mechanic: 'compound', equipment: 'cable', increment_kg: 2.5, default_rest_s: 120, notes: '',
    }] } });
    const applied = await pullChanges(syncConfig.value);
    expect(applied).toBe(1);
    expect((await db.exercises.get('other-device'))!.name).toBe('Cable Row');
    expect(await pullChanges(syncConfig.value)).toBe(0);
  });

  it('newest write wins in both directions', async () => {
    await put('exercises', { id: 'e1', name: 'Local old', muscle_group: 'chest', mechanic: 'compound', equipment: 'barbell', increment_kg: 2.5, default_rest_s: 120, notes: '', created_at: '2026-01-01T00:00:00.000Z' });
    await syncNow();
    // Another device edits it later.
    const newer = { id: 'e1', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2999-01-01T00:00:00.000Z', deleted: 0, name: 'Other device', muscle_group: 'chest', mechanic: 'compound', equipment: 'barbell', increment_kg: 2.5, default_rest_s: 120, notes: '' };
    server.call('push', { changes: { exercises: [newer] } });
    // Our stale edit must not overwrite it.
    await db.exercises.update('e1', { name: 'Stale local', updated_at: '2026-06-01T00:00:00.000Z' });
    await db.outbox.put({ key: 'exercises:e1', entity: 'exercises', id: 'e1', queued_at: '2026-06-01T00:00:00.000Z' });
    await syncNow();
    expect((await db.exercises.get('e1'))!.name).toBe('Other device');
    expect(server.sheet('exercises')!.rows().find((r) => r.id === 'e1')!.name).toBe('Other device');
    expect(await db.outbox.count()).toBe(0);
    // And a genuinely newer local edit wins on the server.
    await patch('exercises', 'e1', { name: 'Mine, later' } as never);
    await db.exercises.update('e1', { updated_at: '3000-01-01T00:00:00.000Z' });
    await syncNow();
    expect(server.sheet('exercises')!.rows().find((r) => r.id === 'e1')!.name).toBe('Mine, later');
  });

  it('deletions sync as tombstones', async () => {
    await finishedWorkout();
    await syncNow();
    await patch('workouts', 'w1', { deleted: 1 });
    await syncNow();
    expect(server.sheet('workouts')!.rows()[0].deleted).toBe('1');
    await wipePhone();
    await syncNow();
    expect((await db.workouts.get('w1'))!.deleted).toBe(1);
  });

  it('a pull never overwrites a local edit that is newer and still waiting to upload', async () => {
    await put('exercises', { id: 'e2', name: 'v1', muscle_group: 'chest', mechanic: 'compound', equipment: 'barbell', increment_kg: 2.5, default_rest_s: 120, notes: '' });
    await syncNow();
    await patch('exercises', 'e2', { name: 'v2 (offline edit)' } as never);
    await pullChanges(syncConfig.value, true);
    expect((await db.exercises.get('e2'))!.name).toBe('v2 (offline edit)');
    expect(await db.outbox.get('exercises:e2')).toBeTruthy();
  });

  it('full re-download restores records deleted locally by accident', async () => {
    await finishedWorkout();
    await syncNow();
    await db.sets.clear();
    expect((await redownloadAll()).ok).toBe(true);
    expect(await db.sets.count()).toBe(2);
  });
});

describe('connection', () => {
  it('rejects a wrong token with a helpful message', async () => {
    const res = await connect(URL, 'nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/token/i);
  });

  it('rejects an out-of-date script', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, server_time: 'x' })));
    const res = await connect(URL, TOKEN);
    expect(res.error).toMatch(/out of date/i);
  });

  it('rejects a non-JSON reply (e.g. a Google sign-in page)', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Sign in</html>'));
    const res = await connect(URL, TOKEN);
    expect(res.error).toMatch(/Anyone/);
  });

  it('validates the URL', async () => {
    expect((await connect('http://example.com', TOKEN)).error).toMatch(/script\.google\.com/);
    expect((await connect('https://script.google.com/macros/s/X/dev', TOKEN)).error).toMatch(/exec/);
  });

  it('connect saves the config and runs the first sync', async () => {
    syncConfig.value = { url: '', token: '', auto: true };
    await seedIfEmpty();
    const res = await connect(URL, TOKEN);
    expect(res.ok).toBe(true);
    expect(syncConfig.value.url).toBe(URL);
    expect((await getLocal('sync_config', null as never) as { url: string }).url).toBe(URL);
    expect(server.sheet('exercises')!.rows().length).toBeGreaterThan(40);
    expect(syncStatus.value.state).toBe('idle');
    expect(requests.map((r) => r.action)).toEqual(['ping', 'push', 'pull']);
  });

  it('switching to a different Sheet re-sends everything', async () => {
    await seedIfEmpty();
    await syncNow();
    const second = createFakeScript(TOKEN);
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => new Response(second.post(init.body)));
    const res = await connect('https://script.google.com/macros/s/OTHER/exec', TOKEN);
    expect(res.ok).toBe(true);
    expect(second.sheet('exercises')!.rows().length).toBeGreaterThan(40);
  });

  it('disconnect clears the config', async () => {
    await disconnect();
    expect(syncConfig.value.url).toBe('');
    expect(syncStatus.value.state).toBe('off');
  });
});

describe('apps script itself', () => {
  it('rejects requests without the token and unknown actions', () => {
    expect(server.call('pull', {}, 'wrong').error).toBe('unauthorized');
    expect(server.call('explode').error).toBe('unknown action');
    expect(JSON.parse(server.post('not json')).ok).toBe(false);
    expect(server.call('ping').api_version).toBe(3);
  });

  it('keeps columns it does not know about when a row is updated', async () => {
    await put('exercises', { id: 'e3', name: 'A', muscle_group: 'chest', mechanic: 'compound', equipment: 'barbell', increment_kg: 2.5, default_rest_s: 120, notes: '' });
    await syncNow();
    const sheet = server.sheet('exercises')!;
    sheet.grid[0].push('my_column');
    sheet.grid[1].push('keep me');
    await patch('exercises', 'e3', { name: 'B' } as never);
    await syncNow();
    expect(sheet.rows()[0].my_column).toBe('keep me');
    expect(sheet.rows()[0].name).toBe('B');
  });

  it('writes only changed rows', async () => {
    await seedIfEmpty();
    await syncNow();
    const sheet = server.sheet('exercises')!;
    const before = sheet.writes;
    await patch('exercises', 'ex-deadlift', { notes: 'x' } as never);
    await syncNow({ pull: false });
    expect(sheet.writes - before).toBe(1);
  });
});

describe('backup', () => {
  it('exports everything and imports it into an empty phone', async () => {
    await seedIfEmpty();
    await finishedWorkout();
    await saveSetting('weekly_target', 6);
    const file = await buildBackup();
    const text = JSON.stringify(file);
    expect(text).not.toContain(TOKEN);
    const before = await snapshot();
    await wipePhone();
    const parsed = parseBackup(text);
    expect(previewBackup(parsed).workouts).toBe(1);
    const res = await importBackup(parsed);
    expect(res.applied).toBeGreaterThan(100);
    expect(await snapshot()).toEqual(before);
    expect(settings.value.weekly_target).toBe(6);
    expect(await db.outbox.count()).toBeGreaterThan(100); // imported data will sync up
  });

  it('merge keeps newer local records and takes newer file records', async () => {
    await finishedWorkout();
    const file = await buildBackup();
    await db.sets.update('w1-s1', { reps: 99, updated_at: '2999-01-01T00:00:00.000Z' });
    const stale = file.data.sets!.find((s) => s.id === 'w1-s2')!;
    stale.note = 'from backup';
    stale.updated_at = '2999-01-01T00:00:00.000Z';
    await importBackup(file);
    expect((await db.sets.get('w1-s1'))!.reps).toBe(99);
    expect((await db.sets.get('w1-s2'))!.note).toBe('from backup');
  });

  it('skips a workout that was in progress when the backup was made', async () => {
    await put('workouts', { id: 'live', day_type_id: null, split_id: null, rotation_index: null, name: 'Live', icon: '', color: '', started_at: '2026-11-19T10:00:00.000Z', ended_at: null, status: 'active', notes: '' });
    await put('sets', { id: 'live-s', workout_id: 'live', workout_exercise_id: 'x', exercise_id: 'e', set_number: 1, is_warmup: 0, weight_kg: 1, reps: 1, rir: null, completed_at: null, rest_before_s: null, rest_is_transition: 0, pr_types: [], note: '' });
    const file = await buildBackup();
    await wipePhone();
    await importBackup(file);
    expect(await db.workouts.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/doesn’t look like/);
    expect(() => parseBackup(JSON.stringify({ format: 'gym-bulking-tracker-backup', version: 99, data: {} }))).toThrow(/newer version/);
  });

  it('ignores junk rows instead of failing', async () => {
    const file = parseBackup(JSON.stringify({ format: 'gym-bulking-tracker-backup', version: 1, exported_at: 'x', data: { exercises: [null, 5, { id: 'no-timestamp' }], bogus: [{ id: 1 }] } }));
    expect(previewBackup(file).records).toBe(0);
    expect((await importBackup(file)).applied).toBe(0);
  });

  it('names the file by local date', () => {
    expect(backupFileName(new Date(2026, 10, 19))).toBe('gym-bulking-tracker-2026-11-19.json');
  });
});

import { savePhoto } from '../src/state/photos';
import { fetchPhoto, photoNote } from '../src/sync/photos';

describe('progress photo backup', () => {
  const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, n, n, n, 0xff, 0xd9]).buffer;
  const shot = (pose: 'front' | 'side' | 'back', n: number) => ({ pose, full: jpeg(n), thumb: jpeg(n + 1), width: 1200, height: 1600, mime: 'image/jpeg' });

  it('uploads new photos to the Drive folder once, then syncs their Drive ids', async () => {
    const p1 = await savePhoto('2026-11-20', shot('front', 1));
    await savePhoto('2026-11-20', shot('side', 2));
    expect((await syncNow()).ok).toBe(true);
    const live = server.drive.files;
    expect(live.size).toBe(2);
    expect([...live.values()].some((f) => f.name.includes(p1.id))).toBe(true);
    const local = (await db.photos.get(p1.id))!;
    expect(local.drive_file_id).toMatch(/^file/);
    expect(server.sheet('photos')!.rows().find((r) => r.id === p1.id)!.drive_file_id).toBe(local.drive_file_id);
    // Retrying (e.g. after a timeout) doesn't duplicate
    await db.photos.update(p1.id, { drive_file_id: null });
    await syncNow();
    expect(server.drive.files.size).toBe(2);
  });

  it('a new phone gets photo records from the Sheet and images from Drive', async () => {
    const p = await savePhoto('2026-11-20', shot('back', 7));
    await syncNow();
    await wipePhone();
    await syncNow();
    const restored = (await db.photos.get(p.id))!;
    expect(restored.drive_file_id).toBeTruthy();
    expect(await db.photo_blobs.get(p.id)).toBeUndefined(); // fetched lazily when viewed
    const buf = await fetchPhoto(syncConfig.value, restored);
    expect(new Uint8Array(buf!)).toEqual(new Uint8Array(jpeg(7)));
  });

  it('retaking a pose the same day replaces it; deleted photos go to the Drive bin', async () => {
    await savePhoto('2026-11-20', shot('front', 1));
    await syncNow();
    await savePhoto('2026-11-20', shot('front', 3));
    await syncNow();
    const files = [...server.drive.files.values()];
    expect(files.filter((f) => !f.trashed)).toHaveLength(1);
    expect(files.filter((f) => f.trashed)).toHaveLength(1);
    expect((await db.photos.toArray()).filter((p) => !p.deleted)).toHaveLength(1);
  });

  it('an older script without photo support: data still syncs, with a note to update', async () => {
    const old = createFakeScript(TOKEN);
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      if (String(body.action).startsWith('photo_')) return new Response(JSON.stringify({ ok: false, error: 'unknown action' }));
      return new Response(old.post(init.body));
    });
    await savePhoto('2026-11-20', shot('front', 1));
    const r = await syncNow();
    expect(r.ok).toBe(true);
    expect(old.sheet('photos')!.rows()).toHaveLength(1);
    expect(photoNote.value).toMatch(/Apps Script/);
  });

  it('the script only serves files from its own photo folder', async () => {
    server.call('ping');
    const other = server.drive.DriveApp.createFolder('Private').createFile({ bytes: [1, 2, 3], mime: 'text/plain', name: 'secret.txt' });
    const res = server.call('photo_get', { file_id: other.getId() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a progress photo/);
  });
});
