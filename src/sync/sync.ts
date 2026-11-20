// Google Sheets sync through an Apps Script web app.
//
//  - Local-first: nothing in the app waits for this. It runs in the background.
//  - Push: records queued in the outbox are sent as idempotent upserts (keyed by id).
//  - Pull: rows changed on the server since the last pull are merged in, newest wins.
//  - Requests are text/plain POSTs, so the browser sends no CORS preflight.
import { signal } from '@preact/signals';
import { db, getLocal, onLocalChange, outboxEntry, setLocal } from '../db/db';
import { ENTITIES, type EntityName, type OutboxEntry } from '../db/schema';
import { loadSettings } from '../state/settings';
import { mergeRecords } from './merge';
import { fetchPhoto, syncPhotos } from './photos';
import { setRemotePhotoFetch } from '../state/photos';

// ---------- Config + status ----------

export interface SyncConfig { url: string; token: string; auto: boolean }

export const syncConfig = signal<SyncConfig>({ url: '', token: '', auto: true });
export const isConfigured = () => !!syncConfig.value.url && !!syncConfig.value.token;

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'offline';
export const syncStatus = signal<{ state: SyncState; lastSyncAt: string | null; error: string | null }>({
  state: 'off', lastSyncAt: null, error: null,
});

export class SyncError extends Error {
  constructor(public kind: 'auth' | 'network' | 'server' | 'config', message: string) {
    super(message);
  }
}

// Images that aren't on this phone yet are fetched from Drive when you view them.
setRemotePhotoFetch((photo) => (isConfigured() ? fetchPhoto(syncConfig.value, photo) : Promise.resolve(null)));

export async function loadSyncConfig() {
  const cfg = await getLocal<SyncConfig>('sync_config', { url: '', token: '', auto: true });
  const lastSyncAt = await getLocal<string | null>('last_sync_at', null);
  syncConfig.value = cfg;
  syncStatus.value = { state: cfg.url && cfg.token ? 'idle' : 'off', lastSyncAt, error: null };
}

export async function saveSyncConfig(cfg: SyncConfig) {
  syncConfig.value = cfg;
  await setLocal('sync_config', cfg);
  syncStatus.value = { ...syncStatus.value, state: cfg.url && cfg.token ? 'idle' : 'off', error: null };
}

export function validateUrl(url: string): string | null {
  if (!/^https:\/\/script\.google\.com\//.test(url)) return 'The URL should start with https://script.google.com/';
  if (!/\/exec(\?.*)?$/.test(url)) return 'Use the Web app URL that ends in /exec (not /dev).';
  return null;
}

// ---------- API ----------

const REQUEST_TIMEOUT_MS = 90_000; // Apps Script can take a while on a cold start
export const API_VERSION = 2;

interface ApiReply { ok: boolean; error?: string; server_time: string; [k: string]: unknown }

export async function callApi(
  cfg: { url: string; token: string },
  action: 'ping' | 'push' | 'pull' | 'photo_upload' | 'photo_get' | 'photo_delete',
  payload: object = {},
): Promise<ApiReply> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: cfg.token, action, ...payload }),
        redirect: 'follow',
        signal: ctl.signal,
      });
    } catch {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      throw new SyncError('network', offline
        ? 'You’re offline.'
        : 'Couldn’t reach Google. Check the URL, and that the web app is deployed with access set to “Anyone”.');
    }
    const text = await res.text();
    let body: ApiReply;
    try { body = JSON.parse(text); } catch {
      throw new SyncError('server', 'Unexpected reply from Google. Redeploy the web app with “Who has access: Anyone” and use its /exec URL.');
    }
    if (!body.ok) {
      if (body.error === 'unauthorized') throw new SyncError('auth', 'Wrong token. Copy it again from the Apps Script execution log.');
      throw new SyncError('server', body.error || 'The server reported an error.');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Push ----------

const BATCH = 250;

/**
 * Records of a workout that is still in progress are held back: they change on every tap,
 * and unfinished sets get deleted when you finish. They go up as soon as you finish.
 */
function isDeferred(entity: EntityName, row: { id: string; workout_id?: string }, activeIds: Set<string>) {
  if (entity === 'workouts') return activeIds.has(row.id);
  if (entity === 'workout_exercises' || entity === 'sets') return !!row.workout_id && activeIds.has(row.workout_id);
  return false;
}

async function collectBatch() {
  const entries = (await db.outbox.toArray()).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
  if (!entries.length) return null;
  const activeIds = new Set((await db.workouts.where('status').equals('active').primaryKeys()) as string[]);

  const byEntity = new Map<EntityName, OutboxEntry[]>();
  const orphans: string[] = [];
  for (const e of entries) {
    if (!ENTITIES.includes(e.entity)) { orphans.push(e.key); continue; }
    byEntity.set(e.entity, [...(byEntity.get(e.entity) ?? []), e]);
  }
  const records = new Map<string, { id: string; workout_id?: string } | undefined>();
  for (const [entity, list] of byEntity) {
    const rows = (await db.table(entity).bulkGet(list.map((e) => e.id))) as ({ id: string; workout_id?: string } | undefined)[];
    list.forEach((e, i) => records.set(e.key, rows[i]));
  }

  const changes: Record<string, unknown[]> = {};
  const sent: OutboxEntry[] = [];
  for (const e of entries) {
    if (!ENTITIES.includes(e.entity)) continue;
    const row = records.get(e.key);
    if (!row) { orphans.push(e.key); continue; }
    if (isDeferred(e.entity, row, activeIds)) continue;
    if (sent.length >= BATCH) break;
    (changes[e.entity] ??= []).push(row);
    sent.push(e);
  }
  if (orphans.length) await db.outbox.bulkDelete(orphans);
  return sent.length ? { changes, sent } : null;
}

/** Forget sent entries, unless the record was edited again while the request was in flight. */
async function clearSent(sent: OutboxEntry[]) {
  await db.transaction('rw', db.outbox, async () => {
    for (const e of sent) {
      const cur = await db.outbox.get(e.key);
      if (cur && cur.queued_at === e.queued_at && cur.rev === e.rev) await db.outbox.delete(e.key);
    }
  });
}

export async function pushPending(cfg: { url: string; token: string }): Promise<number> {
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const batch = await collectBatch();
    if (!batch) break;
    syncStatus.value = { ...syncStatus.value, state: 'syncing' };
    await callApi(cfg, 'push', { changes: batch.changes });
    await clearSent(batch.sent);
    total += batch.sent.length;
  }
  return total;
}

// ---------- Pull ----------

export async function pullChanges(cfg: { url: string; token: string }, full = false): Promise<number> {
  const since = full ? '' : await getLocal<string>('sync_cursor', '');
  syncStatus.value = { ...syncStatus.value, state: 'syncing' };
  const res = await callApi(cfg, 'pull', { since });
  const changes = (res.changes ?? {}) as Record<string, unknown[]>;
  let applied = 0;
  for (const entity of ENTITIES) {
    const rows = changes[entity];
    if (rows?.length) applied += (await mergeRecords(entity, rows, false)).applied;
  }
  if (changes.settings?.length) await loadSettings();
  await setLocal('sync_cursor', res.server_time);
  return applied;
}

// ---------- Orchestration ----------

export interface SyncResult { ok: boolean; pushed: number; pulled: number; error?: string }

let running: Promise<SyncResult> | null = null;
let failures = 0;
let nextAllowedAt = 0;

export function syncNow(opts: { pull?: boolean; full?: boolean } = {}): Promise<SyncResult> {
  if (running) return running;
  running = doSync(opts).finally(() => { running = null; });
  return running;
}

async function doSync(opts: { pull?: boolean; full?: boolean }): Promise<SyncResult> {
  const { pull = true, full = false } = opts;
  if (!isConfigured()) return { ok: false, pushed: 0, pulled: 0, error: 'Sync isn’t set up.' };
  const cfg = syncConfig.value;
  try {
    let pushed = await pushPending(cfg);
    const pulled = pull ? await pullChanges(cfg, full) : 0;
    // Photos: upload new ones to Drive, then send their Drive ids.
    const photos = await syncPhotos(cfg);
    if (photos.uploaded || photos.trashed) pushed += await pushPending(cfg);
    failures = 0;
    nextAllowedAt = 0;
    if (pull || pushed) {
      const lastSyncAt = new Date().toISOString();
      await setLocal('last_sync_at', lastSyncAt);
      syncStatus.value = { state: 'idle', lastSyncAt, error: null };
    } else if (syncStatus.value.state === 'syncing') {
      syncStatus.value = { ...syncStatus.value, state: 'idle' };
    }
    return { ok: true, pushed, pulled };
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError('server', e instanceof Error ? e.message : String(e));
    failures++;
    nextAllowedAt = Date.now() + Math.min(30_000 * 2 ** (failures - 1), 15 * 60_000);
    const offline = err.kind === 'network' && typeof navigator !== 'undefined' && navigator.onLine === false;
    syncStatus.value = { ...syncStatus.value, state: offline ? 'offline' : 'error', error: err.message };
    return { ok: false, pushed: 0, pulled: 0, error: err.message };
  }
}

/** Test the connection, save it, then sync everything. */
export async function connect(url: string, token: string): Promise<SyncResult> {
  url = url.trim();
  token = token.trim();
  const bad = validateUrl(url);
  if (bad) return { ok: false, pushed: 0, pulled: 0, error: bad };
  if (!token) return { ok: false, pushed: 0, pulled: 0, error: 'Paste your token.' };
  try {
    const res = await callApi({ url, token }, 'ping');
    if (Number(res.api_version ?? 1) < API_VERSION) {
      return { ok: false, pushed: 0, pulled: 0, error: 'Your Apps Script is out of date. Paste the latest Code.gs, then Deploy → Manage deployments → Edit → New version.' };
    }
  } catch (e) {
    return { ok: false, pushed: 0, pulled: 0, error: e instanceof Error ? e.message : String(e) };
  }
  const previous = syncConfig.value.url;
  await saveSyncConfig({ url, token, auto: syncConfig.value.auto });
  if (previous && previous !== url) {
    // A different Sheet: send it everything and read everything back.
    await queueAll();
    await setLocal('sync_cursor', '');
  }
  failures = 0;
  nextAllowedAt = 0;
  return syncNow({ pull: true });
}

export async function disconnect() {
  await saveSyncConfig({ url: '', token: '', auto: true });
  await setLocal('sync_cursor', '');
  syncStatus.value = { state: 'off', lastSyncAt: syncStatus.value.lastSyncAt, error: null };
}

/** Queue every record for upload (e.g. after clearing or replacing the Sheet). */
export async function queueAll(): Promise<number> {
  const ts = new Date().toISOString();
  let n = 0;
  for (const entity of ENTITIES) {
    const ids = (await db.table(entity).toCollection().primaryKeys()) as string[];
    await db.outbox.bulkPut(ids.map((id) => outboxEntry(entity, id, ts)));
    n += ids.length;
  }
  return n;
}

export async function redownloadAll(): Promise<SyncResult> {
  await setLocal('sync_cursor', '');
  return syncNow({ pull: true, full: true });
}

// ---------- Automatic sync ----------

let lastAutoAt = 0;

async function auto(pull: boolean, force = false) {
  if (!isConfigured() || !syncConfig.value.auto) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (Date.now() < nextAllowedAt && !force) return;
  if (pull && !force && Date.now() - lastAutoAt < 30_000) return;
  // Never use the network in the middle of a set.
  if ((await db.workouts.where('status').equals('active').count()) > 0) return;
  if (pull) lastAutoAt = Date.now();
  await syncNow({ pull });
}

/** Sync on launch, on return to the app, when back online, every 5 minutes, and shortly after changes. */
export function startAutoSync() {
  let timer: number | undefined;
  onLocalChange(() => {
    clearTimeout(timer);
    timer = window.setTimeout(() => auto(false), 8000);
  });
  window.addEventListener('online', () => auto(true, true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') auto(true);
  });
  setInterval(() => { if (document.visibilityState === 'visible') auto(true); }, 5 * 60_000);
  auto(true);
}
