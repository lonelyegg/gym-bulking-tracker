// StrongLifts 5×5: starting sessions and changing the program settings.
// Progress itself is recomputed from your logged sessions (see lib/program.ts).
import { useMemo } from 'preact/hooks';
import { db, nowIso, put } from '../db/db';
import type { PrType, Workout, WorkoutExercise, WorkoutSet } from '../db/schema';
import { localDate } from '../lib/logic';
import {
  DAY_STYLE, LIFT_EXERCISE, nextSession, PROGRAM_ID, replay, sessionPlan, withDefaults,
  type Day, type Lift, type ProgramConfig,
} from '../lib/program';
import { saveSetting, settings } from './settings';
import { loadTraining, useTraining } from './training';
import { backfillStart, getActiveWorkout } from './workout';
import { setWakeLock, unlockAudio } from './device';

export const programConfig = () => withDefaults(settings.value.program_sl5x5);
export const programActive = () => settings.value.active_program === PROGRAM_ID;

/** Live program state: config, replayed progress and the next session. */
export function useProgram() {
  const data = useTraining();
  const cfg = programConfig();
  return useMemo(() => {
    if (!data) return null;
    const state = replay(data.workouts, data.sets, cfg);
    return { cfg, state, next: nextSession(state, cfg, localDate()), data };
  }, [data, settings.value.program_sl5x5]);
}

export async function saveProgram(changes: Partial<ProgramConfig>) {
  await saveSetting('program_sl5x5', withDefaults({ ...programConfig(), ...changes }));
}

export async function activateProgram(on: boolean) {
  if (on && !settings.value.program_sl5x5) await saveSetting('program_sl5x5', withDefaults(null));
  await saveSetting('active_program', on ? PROGRAM_ID : null);
}

/** "Set squat to 60 kg from now on." */
export async function setLiftWeight(lift: Lift, weight: number) {
  const cfg = programConfig();
  await saveProgram({ adjustments: [...cfg.adjustments, { lift, weight, at: nowIso() }] });
}

/**
 * Start a 5×5 session: warm-ups and work sets pre-filled with the program's weights.
 * With `at` (a past local date) it's logged afterwards, with the weights you'd have had then.
 */
export async function startProgramWorkout(day: Day, opts: { at?: string } = {}): Promise<string> {
  const existing = await getActiveWorkout();
  if (existing) return existing.id;
  const backfill = !!opts.at;
  const startedAt = opts.at ? backfillStart(opts.at) : nowIso();
  const cfg = programConfig();
  const data = await loadTraining();
  const state = replay(data.workouts, data.sets, cfg, { before: startedAt });
  const plan = sessionPlan(state, cfg, day, opts.at ?? localDate());

  const workoutId = crypto.randomUUID();
  const workout: Omit<Workout, 'created_at' | 'updated_at' | 'deleted'> = {
    id: workoutId, day_type_id: null, split_id: null, rotation_index: null,
    name: `5×5 · Workout ${day}`, icon: DAY_STYLE[day].icon, color: DAY_STYLE[day].color,
    started_at: startedAt, ended_at: null, status: 'active', notes: '', backfill: backfill ? 1 : 0,
    program: PROGRAM_ID, program_day: day,
  };
  type New<T> = Omit<T, 'id' | 'created_at' | 'updated_at' | 'deleted'> & { id?: string };
  const wes: New<WorkoutExercise>[] = [];
  const sets: New<WorkoutSet>[] = [];
  for (const [i, p] of plan.lifts.entries()) {
    const weId = crypto.randomUUID();
    wes.push({
      id: weId, workout_id: workoutId, exercise_id: LIFT_EXERCISE[p.lift], position: i,
      target_sets: p.sets, rep_min: p.reps, rep_max: p.reps, target_rir: 0, rest_s: 180, transition_rest_s: 180,
      note: '', skipped: 0 as const, swapped_from_id: null,
    });
    const rows = [
      ...p.warmups.map((w) => ({ weight_kg: w.weight, reps: w.reps as number | null, is_warmup: 1 as const })),
      ...Array.from({ length: p.sets }, () => ({ weight_kg: p.weight, reps: null as number | null, is_warmup: 0 as const })),
    ];
    rows.forEach((r, k) => sets.push({
      workout_id: workoutId, workout_exercise_id: weId, exercise_id: LIFT_EXERCISE[p.lift], set_number: k + 1,
      is_warmup: r.is_warmup, weight_kg: r.weight_kg, reps: r.reps, rir: null, completed_at: null,
      rest_before_s: null, rest_is_transition: 0 as const, pr_types: [] as PrType[], note: '',
    }));
  }
  await db.transaction('rw', db.workouts, db.workout_exercises, db.sets, db.outbox, async () => {
    await put('workouts', workout);
    await put('workout_exercises', ...wes);
    await put('sets', ...sets);
  });
  if (!backfill) {
    unlockAudio();
    if (settings.value.wake_lock) setWakeLock(true);
  }
  return workoutId;
}

