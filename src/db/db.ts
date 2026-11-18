import Dexie, { liveQuery, type Table } from 'dexie';
import { useEffect, useState } from 'preact/hooks';
import type {
  Base, EntityMap, EntityName, LocalKV, OutboxEntry,
} from './schema';

export class GymDB extends Dexie {
  exercises!: Table<EntityMap['exercises'], string>;
  day_types!: Table<EntityMap['day_types'], string>;
  template_exercises!: Table<EntityMap['template_exercises'], string>;
  splits!: Table<EntityMap['splits'], string>;
  workouts!: Table<EntityMap['workouts'], string>;
  workout_exercises!: Table<EntityMap['workout_exercises'], string>;
  sets!: Table<EntityMap['sets'], string>;
  bodyweights!: Table<EntityMap['bodyweights'], string>;
  measurements!: Table<EntityMap['measurements'], string>;
  photos!: Table<EntityMap['photos'], string>;
  foods!: Table<EntityMap['foods'], string>;
  saved_meals!: Table<EntityMap['saved_meals'], string>;
  meals!: Table<EntityMap['meals'], string>;
  food_logs!: Table<EntityMap['food_logs'], string>;
  settings!: Table<EntityMap['settings'], string>;
  outbox!: Table<OutboxEntry, string>;
  local!: Table<LocalKV, string>;

  constructor(name = 'gym-bulking-tracker') {
    super(name);
    this.version(1).stores({
      exercises: 'id, name, muscle_group',
      day_types: 'id',
      template_exercises: 'id, day_type_id, exercise_id',
      splits: 'id',
      workouts: 'id, status, started_at, day_type_id',
      workout_exercises: 'id, workout_id, exercise_id',
      sets: 'id, workout_id, workout_exercise_id, exercise_id, completed_at',
      bodyweights: 'id, date',
      measurements: 'id, date, site',
      photos: 'id, date',
      foods: 'id, name',
      saved_meals: 'id',
      meals: 'id, date',
      food_logs: 'id, date, meal_id, food_id',
      settings: 'id',
      outbox: 'key',
      local: 'key',
    });
  }

  table_<E extends EntityName>(name: E): Table<EntityMap[E], string> {
    return this.table(name) as Table<EntityMap[E], string>;
  }
}

export const db = new GymDB();

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

type NewRecord<T extends Base> = Omit<T, 'id' | 'created_at' | 'updated_at' | 'deleted'> & Partial<Base>;

/** Insert or update records: stamps timestamps and queues them for sync. */
export async function put<E extends EntityName>(entity: E, ...records: NewRecord<EntityMap[E]>[]): Promise<EntityMap[E][]> {
  const ts = nowIso();
  const full = records.map((r) => ({
    ...r,
    id: r.id ?? uuid(),
    created_at: r.created_at ?? ts,
    updated_at: ts,
    deleted: r.deleted ?? 0,
  })) as EntityMap[E][];
  await db.transaction('rw', db.table(entity), db.outbox, async () => {
    await db.table(entity).bulkPut(full);
    await db.outbox.bulkPut(full.map((r) => ({ key: `${entity}:${r.id}`, entity, id: r.id, queued_at: ts })));
  });
  return full;
}

/** Merge a partial change into an existing record. */
export async function patch<E extends EntityName>(entity: E, id: string, changes: Partial<EntityMap[E]>): Promise<void> {
  await db.transaction('rw', db.table(entity), db.outbox, async () => {
    const cur = (await db.table(entity).get(id)) as EntityMap[E] | undefined;
    if (!cur) return;
    const ts = nowIso();
    await db.table(entity).put({ ...cur, ...changes, updated_at: ts });
    await db.outbox.put({ key: `${entity}:${id}`, entity, id, queued_at: ts });
  });
}

/** Mark records deleted (kept as tombstones so the deletion syncs). */
export async function softDelete(entity: EntityName, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction('rw', db.table(entity), db.outbox, async () => {
    const ts = nowIso();
    for (const id of ids) {
      const cur = await db.table(entity).get(id);
      if (!cur) continue;
      await db.table(entity).put({ ...cur, deleted: 1, updated_at: ts });
      await db.outbox.put({ key: `${entity}:${id}`, entity, id, queued_at: ts });
    }
  });
}

/** Remove records that were never synced (e.g. parts of an active workout). */
export async function hardDelete(entity: EntityName, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction('rw', db.table(entity), db.outbox, async () => {
    await db.table(entity).bulkDelete(ids);
    await db.outbox.bulkDelete(ids.map((id) => `${entity}:${id}`));
  });
}

export const alive = <T extends Base>(r: T | undefined): r is T => !!r && !r.deleted;

/** Subscribe a component to a Dexie query; re-renders when the underlying data changes. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: (e) => console.error(e) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const row = await db.local.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setLocal(key: string, value: unknown): Promise<void> {
  await db.local.put({ key, value });
}
