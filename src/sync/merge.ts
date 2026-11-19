// Merging records that come from outside (the Google Sheet or a backup file).
// Rule: for each id, the copy with the newest `updated_at` wins.
import { db, nowIso, outboxEntry } from '../db/db';
import type { EntityName, OutboxEntry } from '../db/schema';

export type RawRow = Record<string, unknown>;

/** Fields stored as arrays/objects. In the Sheet they are JSON text. */
export const JSON_FIELDS: Partial<Record<EntityName, string[]>> = {
  exercises: ['muscles'],
  splits: ['rotation'],
  sets: ['pr_types'],
  saved_meals: ['items'],
  settings: ['value'],
};

/** Text fields that are '' locally; an empty Sheet cell comes back as null. */
const TEXT_FIELDS = ['note', 'notes', 'serving_label'];

/** Clean up a row from outside. Returns null if it isn't a usable record. */
export function normalizeRow(entity: EntityName, raw: unknown): RawRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row: RawRow = { ...(raw as RawRow) };
  if (typeof row.id !== 'string' || !row.id) return null;
  if (typeof row.updated_at !== 'string' || !row.updated_at) return null;
  if (typeof row.created_at !== 'string' || !row.created_at) row.created_at = row.updated_at;
  row.deleted = Number(row.deleted) ? 1 : 0;

  for (const f of JSON_FIELDS[entity] ?? []) {
    const v = row[f];
    if (typeof v === 'string') {
      try { row[f] = JSON.parse(v); } catch { /* keep the text */ }
    }
    if (row[f] == null && entity !== 'settings') row[f] = f === 'muscles' ? {} : [];
  }
  for (const f of TEXT_FIELDS) if (f in row && row[f] == null) row[f] = '';
  return row;
}

export interface MergeResult { applied: number; skipped: number }

/**
 * Apply outside rows to the local database.
 * @param queue true for imports: applied rows are queued so they sync up to the Sheet.
 *              false for pulls: the Sheet already has them.
 */
export async function mergeRecords(entity: EntityName, rows: unknown[], queue: boolean): Promise<MergeResult> {
  const clean = rows.map((r) => normalizeRow(entity, r)).filter((r): r is RawRow => r !== null);
  const skippedInvalid = rows.length - clean.length;
  if (!clean.length) return { applied: 0, skipped: skippedInvalid };

  const table = db.table(entity);
  let applied = 0;
  await db.transaction('rw', table, db.outbox, async () => {
    const locals = (await table.bulkGet(clean.map((r) => r.id as string))) as ({ updated_at: string } | undefined)[];
    const toPut: RawRow[] = [];
    const ts = nowIso();
    const queued: OutboxEntry[] = [];
    const unqueue: string[] = [];
    clean.forEach((r, i) => {
      const local = locals[i];
      if (local && local.updated_at >= (r.updated_at as string)) return; // ours is as new or newer
      toPut.push(r);
      const key = `${entity}:${r.id}`;
      if (queue) queued.push(outboxEntry(entity, r.id as string, ts));
      else unqueue.push(key); // any pending local edit of it is older than this, so it would lose anyway
    });
    if (toPut.length) await table.bulkPut(toPut);
    if (queued.length) await db.outbox.bulkPut(queued);
    if (unqueue.length) await db.outbox.bulkDelete(unqueue);
    applied = toPut.length;
  });
  return { applied, skipped: clean.length - applied + skippedInvalid };
}
