import { db } from './db';
import type {
  DayType, Equipment, Exercise, Mechanic, MuscleGroup, Split, TemplateExercise,
} from './schema';
import { REST } from './schema';

// Seed records use fixed IDs and an old timestamp. If you restore from the Sheet
// on a new phone, your edited versions (newer timestamps) win over the seeds.
const SEED_TS = '2000-01-01T00:00:00.000Z';
const base = (id: string) => ({ id, created_at: SEED_TS, updated_at: SEED_TS, deleted: 0 as const });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// name, muscle, mechanic, equipment, increment (kg)
type ExSeed = [string, MuscleGroup, Mechanic, Equipment, number?];
const EXERCISES: ExSeed[] = [
  // Chest
  ['Barbell Bench Press', 'chest', 'compound', 'barbell'],
  ['Incline Barbell Bench Press', 'chest', 'compound', 'barbell'],
  ['Dumbbell Bench Press', 'chest', 'compound', 'dumbbell'],
  ['Incline Dumbbell Press', 'chest', 'compound', 'dumbbell'],
  ['Machine Chest Press', 'chest', 'compound', 'machine', 7],
  ['Cable Fly', 'chest', 'isolation', 'cable'],
  ['Pec Deck', 'chest', 'isolation', 'machine', 7],
  ['Dips', 'chest', 'compound', 'bodyweight'],
  ['Push-up', 'chest', 'compound', 'bodyweight'],
  // Back
  ['Deadlift', 'back', 'compound', 'barbell'],
  ['Barbell Row', 'back', 'compound', 'barbell'],
  ['Pull-up', 'back', 'compound', 'bodyweight'],
  ['Chin-up', 'back', 'compound', 'bodyweight'],
  ['Lat Pulldown', 'back', 'compound', 'machine', 7],
  ['Seated Cable Row', 'back', 'compound', 'cable'],
  ['One-Arm Dumbbell Row', 'back', 'compound', 'dumbbell'],
  ['Chest-Supported Machine Row', 'back', 'compound', 'machine', 7],
  ['Straight-Arm Pulldown', 'back', 'isolation', 'cable'],
  ['Dumbbell Shrug', 'back', 'isolation', 'dumbbell'],
  // Shoulders
  ['Overhead Press', 'shoulders', 'compound', 'barbell'],
  ['Seated Dumbbell Shoulder Press', 'shoulders', 'compound', 'dumbbell'],
  ['Lateral Raise', 'shoulders', 'isolation', 'dumbbell'],
  ['Cable Lateral Raise', 'shoulders', 'isolation', 'cable'],
  ['Rear Delt Fly', 'shoulders', 'isolation', 'dumbbell'],
  ['Face Pull', 'shoulders', 'isolation', 'cable'],
  // Biceps
  ['Barbell Curl', 'biceps', 'isolation', 'barbell'],
  ['Dumbbell Curl', 'biceps', 'isolation', 'dumbbell'],
  ['Hammer Curl', 'biceps', 'isolation', 'dumbbell'],
  ['Incline Dumbbell Curl', 'biceps', 'isolation', 'dumbbell'],
  ['Cable Curl', 'biceps', 'isolation', 'cable'],
  ['Preacher Curl Machine', 'biceps', 'isolation', 'machine', 7],
  // Triceps
  ['Triceps Pushdown', 'triceps', 'isolation', 'cable'],
  ['Overhead Cable Triceps Extension', 'triceps', 'isolation', 'cable'],
  ['Skull Crusher', 'triceps', 'isolation', 'barbell'],
  ['Close-Grip Bench Press', 'triceps', 'compound', 'barbell'],
  // Legs
  ['Back Squat', 'quads', 'compound', 'barbell'],
  ['Front Squat', 'quads', 'compound', 'barbell'],
  ['Leg Press', 'quads', 'compound', 'machine', 5],
  ['Hack Squat', 'quads', 'compound', 'machine', 5],
  ['Bulgarian Split Squat', 'quads', 'compound', 'dumbbell'],
  ['Walking Lunge', 'quads', 'compound', 'dumbbell'],
  ['Leg Extension', 'quads', 'isolation', 'machine', 7],
  ['Romanian Deadlift', 'hamstrings', 'compound', 'barbell'],
  ['Lying Leg Curl', 'hamstrings', 'isolation', 'machine', 7],
  ['Seated Leg Curl', 'hamstrings', 'isolation', 'machine', 7],
  ['Hip Thrust', 'glutes', 'compound', 'barbell'],
  ['Standing Calf Raise', 'calves', 'isolation', 'machine', 7],
  ['Seated Calf Raise', 'calves', 'isolation', 'machine', 7],
  // Abs
  ['Cable Crunch', 'abs', 'isolation', 'cable'],
  ['Hanging Leg Raise', 'abs', 'isolation', 'bodyweight'],
];

const exId = (name: string) => `ex-${slug(name)}`;

// exercise name, sets, rep_min, rep_max, target RIR
type TplSeed = [string, number, number, number, number];
interface DaySeed { key: string; name: string; icon: string; color: string; ex: TplSeed[] }

const DAYS: DaySeed[] = [
  { key: 'push', name: 'Push', icon: '🏋️', color: '#ef6c57', ex: [
    ['Barbell Bench Press', 3, 6, 10, 2], ['Incline Dumbbell Press', 3, 8, 12, 2],
    ['Seated Dumbbell Shoulder Press', 3, 8, 12, 2], ['Lateral Raise', 3, 12, 15, 1],
    ['Triceps Pushdown', 3, 10, 15, 1], ['Overhead Cable Triceps Extension', 2, 10, 15, 1]] },
  { key: 'pull', name: 'Pull', icon: '🧗', color: '#4ea8de', ex: [
    ['Lat Pulldown', 3, 8, 12, 2], ['Barbell Row', 3, 6, 10, 2], ['Seated Cable Row', 3, 10, 12, 2],
    ['Face Pull', 3, 12, 15, 1], ['Dumbbell Curl', 3, 8, 12, 1], ['Hammer Curl', 2, 10, 12, 1]] },
  { key: 'legs', name: 'Legs', icon: '🦵', color: '#7bd389', ex: [
    ['Back Squat', 3, 6, 10, 2], ['Romanian Deadlift', 3, 8, 10, 2], ['Leg Press', 3, 10, 12, 2],
    ['Lying Leg Curl', 3, 10, 12, 1], ['Leg Extension', 2, 12, 15, 1], ['Standing Calf Raise', 3, 10, 15, 1]] },

  { key: 'upper-a', name: 'Upper A', icon: '💪', color: '#f4a259', ex: [
    ['Barbell Bench Press', 3, 6, 10, 2], ['Barbell Row', 3, 6, 10, 2], ['Overhead Press', 3, 6, 10, 2],
    ['Lat Pulldown', 3, 8, 12, 2], ['Dumbbell Curl', 2, 10, 12, 1], ['Triceps Pushdown', 2, 10, 15, 1]] },
  { key: 'lower-a', name: 'Lower A', icon: '🦵', color: '#5fbfa0', ex: [
    ['Back Squat', 3, 6, 10, 2], ['Romanian Deadlift', 3, 8, 10, 2], ['Leg Extension', 2, 12, 15, 1],
    ['Lying Leg Curl', 3, 10, 12, 1], ['Standing Calf Raise', 3, 10, 15, 1]] },
  { key: 'upper-b', name: 'Upper B', icon: '💪', color: '#e5989b', ex: [
    ['Incline Dumbbell Press', 3, 8, 12, 2], ['Seated Cable Row', 3, 8, 12, 2], ['Seated Dumbbell Shoulder Press', 3, 8, 12, 2],
    ['Pull-up', 3, 6, 10, 2], ['Lateral Raise', 3, 12, 15, 1], ['Hammer Curl', 2, 10, 12, 1],
    ['Overhead Cable Triceps Extension', 2, 10, 15, 1]] },
  { key: 'lower-b', name: 'Lower B', icon: '🦿', color: '#8ecae6', ex: [
    ['Deadlift', 3, 4, 6, 2], ['Leg Press', 3, 10, 12, 2], ['Bulgarian Split Squat', 3, 8, 12, 2],
    ['Seated Leg Curl', 3, 10, 12, 1], ['Seated Calf Raise', 3, 12, 15, 1]] },

  { key: 'full-a', name: 'Full Body A', icon: '🔥', color: '#ffb703', ex: [
    ['Back Squat', 3, 6, 10, 2], ['Barbell Bench Press', 3, 6, 10, 2], ['Barbell Row', 3, 6, 10, 2],
    ['Lateral Raise', 2, 12, 15, 1], ['Dumbbell Curl', 2, 10, 12, 1]] },
  { key: 'full-b', name: 'Full Body B', icon: '⚡', color: '#fb8500', ex: [
    ['Romanian Deadlift', 3, 8, 10, 2], ['Overhead Press', 3, 6, 10, 2], ['Lat Pulldown', 3, 8, 12, 2],
    ['Leg Extension', 2, 12, 15, 1], ['Triceps Pushdown', 2, 10, 15, 1]] },
  { key: 'full-c', name: 'Full Body C', icon: '🌟', color: '#c77dff', ex: [
    ['Leg Press', 3, 10, 12, 2], ['Incline Dumbbell Press', 3, 8, 12, 2], ['Seated Cable Row', 3, 8, 12, 2],
    ['Lying Leg Curl', 2, 10, 12, 1], ['Hammer Curl', 2, 10, 12, 1]] },

  { key: 'chest', name: 'Chest Day', icon: '🛡️', color: '#ef476f', ex: [
    ['Barbell Bench Press', 4, 6, 10, 2], ['Incline Dumbbell Press', 3, 8, 12, 2],
    ['Machine Chest Press', 3, 8, 12, 1], ['Cable Fly', 3, 12, 15, 1], ['Dips', 2, 8, 12, 1]] },
  { key: 'back', name: 'Back Day', icon: '🦅', color: '#118ab2', ex: [
    ['Deadlift', 3, 4, 6, 2], ['Pull-up', 3, 6, 10, 2], ['Barbell Row', 3, 6, 10, 2],
    ['Lat Pulldown', 3, 8, 12, 1], ['Straight-Arm Pulldown', 2, 12, 15, 1]] },
  { key: 'leg-day', name: 'Leg Day', icon: '🦵', color: '#06d6a0', ex: [
    ['Back Squat', 4, 6, 10, 2], ['Romanian Deadlift', 3, 8, 10, 2], ['Leg Press', 3, 10, 12, 1],
    ['Leg Extension', 3, 12, 15, 1], ['Lying Leg Curl', 3, 10, 12, 1], ['Standing Calf Raise', 4, 10, 15, 1]] },
  { key: 'shoulders', name: 'Shoulder Day', icon: '🎯', color: '#ffd166', ex: [
    ['Overhead Press', 4, 6, 10, 2], ['Seated Dumbbell Shoulder Press', 3, 8, 12, 2], ['Lateral Raise', 4, 12, 15, 1],
    ['Cable Lateral Raise', 2, 12, 15, 1], ['Rear Delt Fly', 3, 12, 15, 1], ['Dumbbell Shrug', 3, 10, 15, 1]] },
  { key: 'arms', name: 'Arm Day', icon: '💪', color: '#9b5de5', ex: [
    ['Close-Grip Bench Press', 3, 6, 10, 2], ['Barbell Curl', 3, 8, 12, 1], ['Skull Crusher', 3, 8, 12, 1],
    ['Incline Dumbbell Curl', 3, 10, 12, 1], ['Triceps Pushdown', 3, 10, 15, 1], ['Hammer Curl', 3, 10, 12, 1]] },
];

const R = REST;
const dt = (k: string) => `dt-${k}`;
const SPLITS: { key: string; name: string; rotation: string[] }[] = [
  { key: 'ppl', name: 'Push / Pull / Legs', rotation: [dt('push'), dt('pull'), dt('legs'), R] },
  { key: 'upper-lower', name: 'Upper / Lower', rotation: [dt('upper-a'), dt('lower-a'), R, dt('upper-b'), dt('lower-b'), R, R] },
  { key: 'full-body', name: 'Full Body', rotation: [dt('full-a'), R, dt('full-b'), R, dt('full-c'), R, R] },
  { key: 'bro', name: 'Bro Split', rotation: [dt('chest'), dt('back'), dt('leg-day'), dt('shoulders'), dt('arms'), R, R] },
];

export function buildSeed(compoundRest = 150, isolationRest = 90) {
  const exercises: Exercise[] = EXERCISES.map(([name, muscle_group, mechanic, equipment, inc]) => ({
    ...base(exId(name)),
    name, muscle_group, mechanic, equipment,
    increment_kg: inc ?? 2.5,
    default_rest_s: mechanic === 'compound' ? compoundRest : isolationRest,
    notes: '',
  }));
  const byId = new Map(exercises.map((e) => [e.id, e]));

  const day_types: DayType[] = [];
  const template_exercises: TemplateExercise[] = [];
  for (const d of DAYS) {
    day_types.push({ ...base(dt(d.key)), name: d.name, icon: d.icon, color: d.color, transition_rest_s: null });
    d.ex.forEach(([name, sets, rmin, rmax, rir], i) => {
      const ex = byId.get(exId(name));
      if (!ex) throw new Error(`Seed: unknown exercise ${name}`);
      template_exercises.push({
        ...base(`te-${d.key}-${i + 1}`),
        day_type_id: dt(d.key), exercise_id: ex.id, position: i,
        target_sets: sets, rep_min: rmin, rep_max: rmax, target_rir: rir, rest_s: ex.default_rest_s,
      });
    });
  }
  const splits: Split[] = SPLITS.map((s) => ({ ...base(`split-${s.key}`), name: s.name, rotation: s.rotation }));
  return { exercises, day_types, template_exercises, splits };
}

/** Fill an empty database with the starter library and preset splits. */
export async function seedIfEmpty(): Promise<boolean> {
  if ((await db.exercises.count()) > 0) return false;
  const seed = buildSeed();
  const tables = ['exercises', 'day_types', 'template_exercises', 'splits'] as const;
  await db.transaction('rw', [...tables.map((t) => db.table(t)), db.settings, db.outbox], async () => {
    for (const t of tables) {
      const rows = seed[t];
      await db.table(t).bulkPut(rows);
      await db.outbox.bulkPut(rows.map((r) => ({ key: `${t}:${r.id}`, entity: t, id: r.id, queued_at: SEED_TS })));
    }
    await db.settings.put({ ...base('active_split_id'), value: 'split-ppl' });
    await db.outbox.put({ key: 'settings:active_split_id', entity: 'settings', id: 'active_split_id', queued_at: SEED_TS });
  });
  return true;
}
