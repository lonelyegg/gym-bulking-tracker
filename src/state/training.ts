// Loads finished workouts + their completed sets once, live, for the dashboard and history.
import { db, useLive } from '../db/db';
import type { Exercise } from '../db/schema';
import type { S, W } from '../lib/stats';

export interface TrainingData {
  workouts: W[]; // finished, oldest first
  sets: S[]; // completed sets of those workouts
  exercises: Map<string, Exercise>; // includes deleted ones, so old workouts keep their names
}

export async function loadTraining(): Promise<TrainingData> {
  const workouts = (await db.workouts.where('status').equals('done').toArray())
    .filter((w) => !w.deleted)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const ids = new Set(workouts.map((w) => w.id));
  const sets = (await db.sets.toArray()).filter(
    (s) => !s.deleted && s.completed_at && ids.has(s.workout_id) && s.weight_kg != null && s.reps != null,
  ) as S[];
  const exercises = new Map((await db.exercises.toArray()).map((e) => [e.id, e]));
  return { workouts, sets, exercises };
}

export const useTraining = () => useLive(loadTraining, []);
