// Manual JSON backup: export everything to a file, import (merge) from a file.
import { db, getLocal, setLocal } from '../db/db';
import { ENTITIES, type EntityName } from '../db/schema';
import { localDate } from '../lib/logic';
import { loadSettings } from '../state/settings';
import { mergeRecords, normalizeRow } from './merge';

export const BACKUP_FORMAT = 'gym-bulking-tracker-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  data: Partial<Record<EntityName, Record<string, unknown>[]>>;
}

/** Everything synced, including deleted records. The sync URL and token are never included. */
export async function buildBackup(): Promise<BackupFile> {
  const data: BackupFile['data'] = {};
  for (const entity of ENTITIES) {
    const rows = (await db.table(entity).toArray()) as Record<string, unknown>[];
    if (rows.length) data[entity] = rows;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exported_at: new Date().toISOString(), data };
}

export const backupFileName = (d = new Date()) => `gym-bulking-tracker-${localDate(d)}.json`;

export function parseBackup(text: string): BackupFile {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch { throw new Error('That file isn’t valid JSON.'); }
  const f = obj as Partial<BackupFile> | null;
  if (!f || f.format !== BACKUP_FORMAT || typeof f.data !== 'object' || !f.data) {
    throw new Error('That doesn’t look like a Gym Bulking Tracker backup.');
  }
  if (typeof f.version === 'number' && f.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app first.');
  }
  return f as BackupFile;
}

/** Counts of usable records per table (workouts still in progress are skipped). */
export function previewBackup(file: BackupFile) {
  const rows = usableRows(file);
  const perEntity: Partial<Record<EntityName, number>> = {};
  let records = 0;
  for (const entity of ENTITIES) {
    const n = rows[entity]?.length ?? 0;
    if (n) { perEntity[entity] = n; records += n; }
  }
  const finished = rows.workouts?.filter((w) => !w.deleted && w.status === 'done').length ?? 0;
  return { records, perEntity, workouts: finished, exportedAt: file.exported_at };
}

function usableRows(file: BackupFile) {
  const out: Partial<Record<EntityName, Record<string, unknown>[]>> = {};
  const raw = file.data as Record<string, unknown[]>;
  for (const entity of ENTITIES) {
    const list = raw[entity];
    if (!Array.isArray(list)) continue;
    out[entity] = list.map((r) => normalizeRow(entity, r)).filter((r): r is Record<string, unknown> => r !== null);
  }
  // A workout that was in progress when the backup was made is incomplete; leave it out.
  const activeIds = new Set((out.workouts ?? []).filter((w) => w.status === 'active').map((w) => w.id as string));
  if (activeIds.size) {
    out.workouts = out.workouts!.filter((w) => !activeIds.has(w.id as string));
    for (const e of ['workout_exercises', 'sets'] as const) {
      if (out[e]) out[e] = out[e]!.filter((r) => !activeIds.has(r.workout_id as string));
    }
  }
  return out;
}

/** Merge a backup into this phone: for each record the newest copy wins. Imported changes then sync up. */
export async function importBackup(file: BackupFile) {
  const rows = usableRows(file);
  let applied = 0;
  let skipped = 0;
  for (const entity of ENTITIES) {
    const list = rows[entity];
    if (!list?.length) continue;
    const r = await mergeRecords(entity, list, true);
    applied += r.applied;
    skipped += r.skipped;
  }
  await loadSettings();
  return { applied, skipped };
}

/**
 * Save the backup file. On iPhone this opens the share sheet (choose "Save to Files");
 * elsewhere it downloads. Returns false if you cancelled.
 */
export async function exportBackup(): Promise<boolean> {
  const backup = await buildBackup();
  const name = backupFileName();
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await setLocal('last_backup_at', new Date().toISOString());
  return true;
}

export const lastBackupAt = () => getLocal<string>('last_backup_at', '');
