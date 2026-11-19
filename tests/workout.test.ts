import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stopRest } from '../src/state/timer';
import { db, put } from '../src/db/db';
import { seedIfEmpty } from '../src/db/seed';
import { migrateMuscles } from '../src/db/migrate';
import { loadSettings } from '../src/state/settings';
import {
  backfillStart, completeSet, finishWorkout, getActiveWorkout, previousSession, setsFor, startWorkout,
} from '../src/state/workout';
import { resolveMuscles } from '../src/lib/muscles';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedIfEmpty();
  await loadSettings();
});

async function logWorkout(dayType: string, at: string | undefined, weight: number, reps: number, minutes = 50) {
  const id = await startWorkout(dayType, at ? { at } : {});
  const wes = (await db.workout_exercises.where('workout_id').equals(id).toArray()).sort((a, b) => a.position - b.position);
  const sets = await setsFor(wes[0].id);
  const prs = [];
  for (const s of sets) prs.push(await completeSet(s, { weight_kg: weight, reps, rir: 2 }));
  await finishWorkout(id, { durationMin: minutes });
  return { id, prs, exerciseId: wes[0].exercise_id };
}

describe('logging a past workout', () => {
  it('uses the chosen day, keeps sets in order, records no rest, and sets the duration', async () => {
    const { id } = await logWorkout('dt-push', '2026-11-10', 60, 10, 45);
    const w = (await db.workouts.get(id))!;
    expect(w.backfill).toBe(1);
    expect(w.status).toBe('done');
    expect(w.started_at).toBe(backfillStart('2026-11-10'));
    expect(Date.parse(w.ended_at!) - Date.parse(w.started_at)).toBe(45 * 60000);
    const sets = (await db.sets.where('workout_id').equals(id).toArray()).sort((a, b) => a.completed_at!.localeCompare(b.completed_at!));
    expect(sets.map((s) => s.rest_before_s)).toEqual([null, null, null]);
    expect(sets.every((s) => s.completed_at! > w.started_at)).toBe(true);
    expect(await getActiveWorkout()).toBeUndefined();
  });

  it('PRs and "previous" compare only with workouts before that day', async () => {
    await logWorkout('dt-push', '2026-11-12', 80, 10); // a strong later session
    const early = await logWorkout('dt-push', '2026-11-05', 60, 10); // first session by date
    expect(early.prs.flat()).toEqual([]); // nothing before it: no records
    const between = await logWorkout('dt-push', '2026-11-08', 62.5, 10); // beats Nov 5, not Nov 12
    expect(between.prs[0]).toEqual(expect.arrayContaining(['weight', 'e1rm']));
    const w = (await db.workouts.get(between.id))!;
    const prev = await previousSession(between.exerciseId, 'none', w.started_at);
    expect(prev?.working[0].weight_kg).toBe(60); // Nov 5, not Nov 12
  });

  it('a live workout still gets real timestamps and rest', async () => {
    vi.stubGlobal('window', globalThis); // the rest timer uses window timers
    const id = await startWorkout('dt-push');
    const we = (await db.workout_exercises.where('workout_id').equals(id).toArray()).sort((a, b) => a.position - b.position)[0];
    const [s1, s2] = await setsFor(we.id);
    await completeSet(s1, { weight_kg: 60, reps: 10, rir: 2 });
    await completeSet(s2, { weight_kg: 60, reps: 10, rir: 2 });
    const after = await setsFor(we.id);
    expect(after[1].rest_before_s).not.toBeNull();
    expect((await db.workouts.get(id))!.backfill).toBe(0);
    stopRest();
    vi.unstubAllGlobals();
  });
});

describe('muscle migration', () => {
  it('fills muscles on old records, adds new starter exercises, keeps edits, never resurrects deletions', async () => {
    // Simulate a phone from before the muscle model.
    const bench = (await db.exercises.get('ex-barbell-bench-press'))!;
    await db.exercises.put({ ...bench, muscles: undefined, muscle_group: 'chest' });
    const dl = (await db.exercises.get('ex-deadlift'))!;
    await db.exercises.put({ ...dl, muscles: undefined, muscle_group: 'back', increment_kg: 5, updated_at: '2026-10-01T00:00:00.000Z' }); // edited
    await db.exercises.delete('ex-front-raise'); // didn't exist back then
    const shrug = (await db.exercises.get('ex-barbell-shrug'))!;
    await db.exercises.put({ ...shrug, deleted: 1, updated_at: '2026-10-02T00:00:00.000Z' }); // deleted by you
    await put('exercises', { id: 'mine', name: 'My Row', muscle_group: 'back', mechanic: 'compound', equipment: 'cable', increment_kg: 2.5, default_rest_s: 120, notes: '' });

    const r = await migrateMuscles();
    expect(r.added).toBe(1);
    expect((await db.exercises.get('ex-front-raise'))!.muscles).toEqual({ front_delts: 1, side_delts: 0.25 });
    expect((await db.exercises.get('ex-barbell-bench-press'))!.muscles).toEqual({ chest: 1, front_delts: 0.5, triceps: 0.5 });
    const dl2 = (await db.exercises.get('ex-deadlift'))!;
    expect(dl2.increment_kg).toBe(5); // your edit kept
    expect(resolveMuscles(dl2).lower_back).toBe(1);
    expect(dl2.muscle_group).toBe('lower_back');
    expect((await db.exercises.get('ex-barbell-shrug'))!.deleted).toBe(1);
    expect((await db.exercises.get('mine'))!.muscles).toEqual({ lats: 1, upper_back: 0.5 });
    expect(await db.outbox.get('exercises:ex-front-raise')).toBeTruthy(); // will sync up

    expect(await migrateMuscles()).toEqual({ added: 0, updated: 0 }); // idempotent
  });

  it('every starter exercise has a main muscle', async () => {
    for (const e of await db.exercises.toArray()) {
      expect(Object.values(resolveMuscles(e))).toContain(1);
    }
  });
});
