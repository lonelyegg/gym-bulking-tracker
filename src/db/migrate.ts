// Brings older data up to date. Safe to run on every launch: it only changes what needs it.
import { db, outboxEntry, patch } from './db';
import type { Exercise } from './schema';
import { buildSeed } from './seed';
import { cleanMuscles, primaryMuscle, resolveMuscles } from '../lib/muscles';

const SEED_TS = '2000-01-01T00:00:00.000Z';

/**
 * v0.4 muscle model:
 *  - adds exercises that are new to the starter library (never re-adds ones you deleted)
 *  - fills in `muscles` on exercises saved before it existed
 */
export async function migrateMuscles(): Promise<{ added: number; updated: number }> {
  const seed = buildSeed().exercises;
  const seedById = new Map(seed.map((e) => [e.id, e]));
  const all = await db.exercises.toArray();
  const have = new Set(all.map((e) => e.id));

  const added = seed.filter((e) => !have.has(e.id));
  const untouched: Exercise[] = [];
  const edited: Exercise[] = [];
  for (const e of all) {
    if (Object.keys(cleanMuscles(e.muscles)).length) continue;
    if (e.updated_at === SEED_TS && seedById.has(e.id)) untouched.push(e);
    else edited.push(e);
  }
  if (!added.length && !untouched.length && !edited.length) return { added: 0, updated: 0 };

  await db.transaction('rw', db.exercises, db.outbox, async () => {
    // Starter records keep the seed timestamp, so anything you edited elsewhere still wins.
    const fresh = [...added, ...untouched.map((e) => ({ ...seedById.get(e.id)!, deleted: e.deleted }))];
    if (fresh.length) {
      await db.exercises.bulkPut(fresh);
      await db.outbox.bulkPut(fresh.map((e) => outboxEntry('exercises', e.id, SEED_TS)));
    }
  });
  // Exercises you created or edited: keep your settings, add muscles.
  for (const e of edited) {
    const muscles = seedById.get(e.id)?.muscles ?? resolveMuscles(e);
    await patch('exercises', e.id, { muscles, muscle_group: primaryMuscle(muscles) ?? e.muscle_group });
  }
  return { added: added.length, updated: untouched.length + edited.length };
}
