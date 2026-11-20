// Workout operations: start, log sets, edit exercises, finish.
import { alive, db, hardDelete, nowIso, patch, put, softDelete } from '../db/db';
import type {
  Exercise, PrType, Workout, WorkoutExercise, WorkoutSet,
} from '../db/schema';
import {
  avgRest, detectPRs, epley, localDate, nextInRotation, nextWeekly, rotationIndexFor, scheduleMode, type NextUp, type SetLite,
} from '../lib/logic';
import { settings } from './settings';
import { startRest, stopRest, timer } from './timer';
import { setWakeLock, unlockAudio } from './device';

const WARMUP_REST_S = 60;

// ---------- Queries ----------

export async function getActiveWorkout(): Promise<Workout | undefined> {
  const list = await db.workouts.where('status').equals('active').toArray();
  return list.filter((w) => !w.deleted).sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
}

export async function doneWorkouts(): Promise<Workout[]> {
  const list = await db.workouts.where('status').equals('done').toArray();
  return list.filter((w) => !w.deleted).sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export interface PreviousSession {
  workoutId: string;
  date: string;
  working: WorkoutSet[];
  warmup: WorkoutSet[];
}

const isDoneSet = (s: WorkoutSet) => !s.deleted && s.completed_at && s.weight_kg != null && s.reps != null;

/**
 * The most recent finished session that included this exercise (from any day type), before `before`
 * (a workout's start time) when given, so a workout logged for a past day compares with what came before it.
 */
export async function previousSession(exerciseId: string, excludeWorkoutId?: string, before?: string): Promise<PreviousSession | null> {
  const sets = (await db.sets.where('exercise_id').equals(exerciseId).toArray()).filter(
    (s) => isDoneSet(s) && s.workout_id !== excludeWorkoutId,
  );
  if (!sets.length) return null;
  const workoutIds = [...new Set(sets.map((s) => s.workout_id))];
  const workouts = (await db.workouts.bulkGet(workoutIds)).filter(
    (w): w is Workout => alive(w) && w.status === 'done' && (!before || w.started_at < before),
  );
  if (!workouts.length) return null;
  const last = workouts.sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  const mine = sets.filter((s) => s.workout_id === last.id).sort((a, b) => a.set_number - b.set_number);
  return {
    workoutId: last.id,
    date: last.started_at,
    working: mine.filter((s) => !s.is_warmup),
    warmup: mine.filter((s) => s.is_warmup),
  };
}

/** All completed working sets for an exercise from finished workouts that started before `before`. */
async function priorWorkingSets(exerciseId: string, excludeWorkoutId: string, before?: string): Promise<SetLite[]> {
  const sets = (await db.sets.where('exercise_id').equals(exerciseId).toArray()).filter(
    (s) => isDoneSet(s) && !s.is_warmup && s.workout_id !== excludeWorkoutId,
  );
  if (!sets.length) return [];
  const ids = [...new Set(sets.map((s) => s.workout_id))];
  const ok = new Set(
    (await db.workouts.bulkGet(ids)).filter((w) => alive(w) && w!.status === 'done' && (!before || w!.started_at < before)).map((w) => w!.id),
  );
  return sets.filter((s) => ok.has(s.workout_id)).map((s) => ({ weight_kg: s.weight_kg!, reps: s.reps!, rir: s.rir }));
}

// ---------- Next workout ----------

export async function computeNextUp(): Promise<{ next: NextUp; splitId: string | null }> {
  const splitId = settings.value.active_split_id;
  const split = splitId ? await db.splits.get(splitId) : undefined;
  if (!alive(split)) return { next: { kind: 'empty' }, splitId: null };
  const done = await doneWorkouts();
  if (scheduleMode(split) === 'weekly') {
    // Fixed weekdays: what's due depends on the calendar, not on what you did last.
    const today = localDate();
    return { next: nextWeekly(split, today, done.some((w) => localDate(w.started_at) === today)), splitId: split.id };
  }
  const last = done.find((w) => w.split_id === split.id && w.rotation_index != null);
  const next = nextInRotation(
    split,
    last ? { rotation_index: last.rotation_index!, date: localDate(last.started_at) } : null,
    localDate(),
  );
  return { next, splitId: split.id };
}

// ---------- Start ----------

function buildSets(workoutId: string, weId: string, exerciseId: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    workout_id: workoutId,
    workout_exercise_id: weId,
    exercise_id: exerciseId,
    set_number: i + 1,
    is_warmup: 0 as const,
    weight_kg: null,
    reps: null,
    rir: null,
    completed_at: null,
    rest_before_s: null,
    rest_is_transition: 0 as const,
    pr_types: [] as PrType[],
    note: '',
  }));
}

/** Evening of a past local date, used as the start time of a workout logged afterwards. */
export function backfillStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 18, 0, 0).toISOString();
}

/**
 * Start a workout. With `at` (a past local date YYYY-MM-DD) it's logged afterwards for that day:
 * no timers, and you set its duration when you finish.
 */
export async function startWorkout(dayTypeId: string | null, opts: { suggestedIndex?: number; at?: string } = {}): Promise<string> {
  const existing = await getActiveWorkout();
  if (existing) return existing.id;

  const backfill = !!opts.at;
  const startedAt = opts.at ? backfillStart(opts.at) : nowIso();
  const dayType = dayTypeId ? await db.day_types.get(dayTypeId) : undefined;
  const splitId = settings.value.active_split_id;
  const split = splitId ? await db.splits.get(splitId) : undefined;
  let rotation_index: number | null = null;
  if (dayType && alive(split)) {
    let from = opts.suggestedIndex ?? 0;
    if (backfill) {
      // Which slot was due on that day: the one after the last counted workout before it.
      const prev = (await doneWorkouts()).find((w) => w.split_id === split.id && w.rotation_index != null && w.started_at < startedAt);
      from = prev ? (prev.rotation_index! + 1) % Math.max(1, split.rotation.length) : 0;
    }
    rotation_index = rotationIndexFor(split, dayType.id, from);
  }

  const workoutId = crypto.randomUUID();
  const workout: Omit<Workout, 'created_at' | 'updated_at' | 'deleted'> = {
    id: workoutId,
    day_type_id: dayType?.id ?? null,
    split_id: rotation_index != null && split ? split.id : null,
    rotation_index,
    name: dayType?.name ?? 'Workout',
    icon: dayType?.icon ?? '🏋️',
    color: dayType?.color ?? '#8b93a7',
    started_at: startedAt,
    ended_at: null,
    status: 'active',
    notes: '',
    backfill: backfill ? 1 : 0,
  };

  const wes: Omit<WorkoutExercise, 'created_at' | 'updated_at' | 'deleted'>[] = [];
  const sets: ReturnType<typeof buildSets> = [];
  if (dayType) {
    const tpl = (await db.template_exercises.where('day_type_id').equals(dayType.id).toArray())
      .filter((t) => !t.deleted)
      .sort((a, b) => a.position - b.position);
    tpl.forEach((t, i) => {
      const weId = crypto.randomUUID();
      wes.push({
        id: weId, workout_id: workoutId, exercise_id: t.exercise_id, position: i,
        target_sets: t.target_sets, rep_min: t.rep_min, rep_max: t.rep_max, target_rir: t.target_rir,
        rest_s: t.rest_s, transition_rest_s: dayType.transition_rest_s, note: '', skipped: 0, swapped_from_id: null,
      });
      sets.push(...buildSets(workoutId, weId, t.exercise_id, t.target_sets));
    });
  }

  await db.transaction('rw', db.workouts, db.workout_exercises, db.sets, db.outbox, async () => {
    await put('workouts', workout);
    if (wes.length) await put('workout_exercises', ...wes);
    if (sets.length) await put('sets', ...sets);
  });
  if (!backfill) {
    unlockAudio();
    if (settings.value.wake_lock) setWakeLock(true);
  }
  return workoutId;
}

// ---------- Exercises in a workout ----------

async function workoutExercises(workoutId: string) {
  return (await db.workout_exercises.where('workout_id').equals(workoutId).toArray())
    .filter((w) => !w.deleted)
    .sort((a, b) => a.position - b.position);
}

export async function addExercise(workoutId: string, ex: Exercise): Promise<void> {
  const list = await workoutExercises(workoutId);
  const w = await db.workouts.get(workoutId);
  const prev = await previousSession(ex.id, workoutId, w?.started_at);
  const count = prev?.working.length || 3;
  const weId = crypto.randomUUID();
  await db.transaction('rw', db.workout_exercises, db.sets, db.outbox, async () => {
    await put('workout_exercises', {
      id: weId, workout_id: workoutId, exercise_id: ex.id, position: (list.at(-1)?.position ?? -1) + 1,
      target_sets: count, rep_min: ex.mechanic === 'compound' ? 6 : 10, rep_max: ex.mechanic === 'compound' ? 10 : 15,
      target_rir: ex.mechanic === 'compound' ? 2 : 1, rest_s: ex.default_rest_s, transition_rest_s: null,
      note: '', skipped: 0, swapped_from_id: null,
    });
    await put('sets', ...buildSets(workoutId, weId, ex.id, count));
  });
}

export async function swapExercise(we: WorkoutExercise, ex: Exercise): Promise<void> {
  const sets = (await db.sets.where('workout_exercise_id').equals(we.id).toArray()).filter((s) => !s.deleted);
  await db.transaction('rw', db.workout_exercises, db.sets, db.outbox, async () => {
    await patch('workout_exercises', we.id, {
      exercise_id: ex.id, swapped_from_id: we.swapped_from_id ?? we.exercise_id, rest_s: ex.default_rest_s,
    });
    for (const s of sets) {
      await patch('sets', s.id, { exercise_id: ex.id, ...(s.completed_at ? {} : { weight_kg: null, reps: null }) });
    }
  });
}

export async function moveExercise(we: WorkoutExercise, dir: -1 | 1): Promise<void> {
  const list = await workoutExercises(we.workout_id);
  const i = list.findIndex((x) => x.id === we.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await db.transaction('rw', db.workout_exercises, db.outbox, async () => {
    for (let k = 0; k < list.length; k++) if (list[k].position !== k) await patch('workout_exercises', list[k].id, { position: k });
  });
}

export async function removeExercise(we: WorkoutExercise, workoutActive: boolean): Promise<void> {
  const sets = (await db.sets.where('workout_exercise_id').equals(we.id).toArray()).map((s) => s.id);
  if (workoutActive) {
    await hardDelete('sets', sets);
    await hardDelete('workout_exercises', [we.id]);
  } else {
    await softDelete('sets', sets);
    await softDelete('workout_exercises', [we.id]);
  }
}

// ---------- Sets ----------

export async function setsFor(weId: string) {
  return (await db.sets.where('workout_exercise_id').equals(weId).toArray())
    .filter((s) => !s.deleted)
    .sort((a, b) => a.set_number - b.set_number);
}

async function renumber(weId: string) {
  const sets = await setsFor(weId);
  for (let i = 0; i < sets.length; i++) if (sets[i].set_number !== i + 1) await patch('sets', sets[i].id, { set_number: i + 1 });
}

export async function addSet(we: WorkoutExercise, warmup = false): Promise<void> {
  const sets = await setsFor(we.id);
  const row = { ...buildSets(we.workout_id, we.id, we.exercise_id, 1)[0], is_warmup: (warmup ? 1 : 0) as 0 | 1 };
  if (warmup) {
    // Warm-ups go before the first working set.
    const firstWorking = sets.findIndex((s) => !s.is_warmup);
    const at = firstWorking < 0 ? sets.length : firstWorking;
    await db.transaction('rw', db.sets, db.outbox, async () => {
      for (const s of sets.slice(at)) await patch('sets', s.id, { set_number: s.set_number + 1 });
      await put('sets', { ...row, set_number: at + 1 });
    });
  } else {
    await put('sets', { ...row, set_number: sets.length + 1 });
  }
}

export async function deleteSet(set: WorkoutSet, workoutActive: boolean): Promise<void> {
  if (workoutActive) await hardDelete('sets', [set.id]);
  else await softDelete('sets', [set.id]);
  await renumber(set.workout_exercise_id);
}

export async function updateSet(set: WorkoutSet, changes: Partial<WorkoutSet>): Promise<PrType[]> {
  const next = { ...set, ...changes };
  if (next.completed_at && next.weight_kg != null && next.reps != null && !next.is_warmup) {
    changes.pr_types = await prsFor(next);
  } else if (next.is_warmup) {
    changes.pr_types = [];
  }
  await patch('sets', set.id, changes);
  return changes.pr_types ?? [];
}

async function prsFor(set: WorkoutSet): Promise<PrType[]> {
  const w = await db.workouts.get(set.workout_id);
  const prior = await priorWorkingSets(set.exercise_id, set.workout_id, w?.started_at);
  const today = (await db.sets.where('workout_id').equals(set.workout_id).toArray())
    .filter((s) => isDoneSet(s) && !s.is_warmup && s.exercise_id === set.exercise_id && s.id !== set.id
      && s.completed_at! < (set.completed_at ?? '9'))
    .map((s) => ({ weight_kg: s.weight_kg!, reps: s.reps!, rir: s.rir }));
  return detectPRs({ weight_kg: set.weight_kg!, reps: set.reps! }, [...prior, ...today], prior.length > 0);
}

/**
 * Complete a set with the given values. Records the actual rest since the previous
 * completed set, checks for PRs and starts the rest timer.
 */
export async function completeSet(
  set: WorkoutSet,
  values: { weight_kg: number; reps: number; rir: number | null },
): Promise<PrType[]> {
  const workout = await db.workouts.get(set.workout_id);
  const backfill = !!workout?.backfill;
  if (!backfill) unlockAudio();
  const all = (await db.sets.where('workout_id').equals(set.workout_id).toArray()).filter((s) => !s.deleted);
  const prevDone = all
    .filter((s) => s.completed_at && s.id !== set.id)
    .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0];
  // A workout logged afterwards has no real clock: keep sets in order, 2½ minutes apart, and record no rest.
  const completed_at = backfill
    ? new Date(Date.parse(prevDone?.completed_at ?? workout!.started_at) + 150_000).toISOString()
    : nowIso();
  const restFrom = backfill ? null : prevDone?.completed_at ?? null;
  const rest_before_s = restFrom ? Math.round((Date.parse(completed_at) - Date.parse(restFrom)) / 1000) : null;

  const pr_types = await updateSet(set, {
    ...values,
    completed_at,
    rest_before_s,
    rest_is_transition: !backfill && prevDone && prevDone.workout_exercise_id !== set.workout_exercise_id ? 1 : 0,
  });

  // Start the rest timer, unless the whole workout is done (or it's logged afterwards).
  if (workout?.status === 'active' && !backfill) {
    const wes = await workoutExercises(set.workout_id);
    const exNames = new Map((await db.exercises.bulkGet(wes.map((w) => w.exercise_id))).filter(Boolean).map((e) => [e!.id, e!.name]));
    const pending = (weId: string) => all.filter((s) => s.workout_exercise_id === weId && !s.completed_at && s.id !== set.id);
    const we = wes.find((w) => w.id === set.workout_exercise_id);
    const remainingHere = pending(set.workout_exercise_id).length;
    const nextWe = wes.find((w) => w.id !== set.workout_exercise_id && !w.skipped && pending(w.id).length > 0 && w.position > (we?.position ?? -1))
      ?? wes.find((w) => w.id !== set.workout_exercise_id && !w.skipped && pending(w.id).length > 0);
    // 5×5 program rest: 90 s after a warm-up, 3 min after a work set, 5 min after a missed set.
    const programRest = workout.program
      ? (set.is_warmup ? 90 : values.reps < (we?.rep_max ?? 5) ? 300 : 180)
      : null;
    if (we && remainingHere > 0) {
      const nextSet = pending(we.id).sort((a, b) => a.set_number - b.set_number)[0];
      const secs = programRest ?? (set.is_warmup ? Math.min(WARMUP_REST_S, we.rest_s) : we.rest_s);
      startRest(secs, { label: `${exNames.get(we.exercise_id) ?? ''} · set ${nextSet.set_number}`, workoutId: set.workout_id, setId: set.id });
    } else if (we && nextWe) {
      const secs = programRest ?? we.transition_rest_s ?? settings.value.transition_rest_s;
      startRest(secs, { label: `Next: ${exNames.get(nextWe.exercise_id) ?? ''}`, workoutId: set.workout_id, setId: set.id });
    } else {
      stopRest();
    }
  }
  return pr_types;
}

export async function uncompleteSet(set: WorkoutSet): Promise<void> {
  await patch('sets', set.id, { completed_at: null, rest_before_s: null, rest_is_transition: 0, pr_types: [] });
  if (timer.value?.setId === set.id) stopRest();
}

// ---------- Finish ----------

export interface Summary {
  durationMs: number;
  sets: number;
  volume: number;
  prs: { exercise: string; set: WorkoutSet }[];
  avgRest: number | null;
  perExercise: { we: WorkoutExercise; exercise: Exercise | undefined; sets: WorkoutSet[]; avgRest: number | null; bestE1rm: number }[];
}

export async function summarize(workoutId: string): Promise<Summary | null> {
  const w = await db.workouts.get(workoutId);
  if (!w) return null;
  const wes = await workoutExercises(workoutId);
  const all = (await db.sets.where('workout_id').equals(workoutId).toArray()).filter(isDoneSet);
  const exercises = new Map((await db.exercises.bulkGet(wes.map((x) => x.exercise_id))).filter(Boolean).map((e) => [e!.id, e!]));
  const working = all.filter((s) => !s.is_warmup);
  const perExercise = wes.map((we) => {
    const sets = all.filter((s) => s.workout_exercise_id === we.id).sort((a, b) => a.set_number - b.set_number);
    const ws = sets.filter((s) => !s.is_warmup);
    return {
      we,
      exercise: exercises.get(we.exercise_id),
      sets,
      avgRest: avgRest(ws.filter((s) => !s.rest_is_transition).map((s) => s.rest_before_s)),
      bestE1rm: Math.max(0, ...ws.map((s) => epley(s.weight_kg!, s.reps!))),
    };
  });
  return {
    durationMs: Date.parse(w.ended_at ?? nowIso()) - Date.parse(w.started_at),
    sets: working.length,
    volume: working.reduce((a, s) => a + s.weight_kg! * s.reps!, 0),
    prs: working.filter((s) => s.pr_types?.length).map((s) => ({ exercise: exercises.get(s.exercise_id)?.name ?? '', set: s })),
    avgRest: avgRest(working.filter((s) => !s.rest_is_transition).map((s) => s.rest_before_s)),
    perExercise,
  };
}

export async function incompleteSetCount(workoutId: string): Promise<number> {
  return (await db.sets.where('workout_id').equals(workoutId).toArray()).filter((s) => !s.deleted && !s.completed_at).length;
}

/** Finish: drop sets that were never completed and close the workout. `durationMin` is for workouts logged afterwards. */
export async function finishWorkout(workoutId: string, opts: { durationMin?: number } = {}): Promise<void> {
  const w = await db.workouts.get(workoutId);
  const sets = (await db.sets.where('workout_id').equals(workoutId).toArray()).filter((s) => !s.completed_at);
  await hardDelete('sets', sets.map((s) => s.id));
  for (const we of await workoutExercises(workoutId)) await renumber(we.id);
  const ended_at = w?.backfill
    ? new Date(Date.parse(w.started_at) + Math.max(1, opts.durationMin ?? 60) * 60_000).toISOString()
    : nowIso();
  await patch('workouts', workoutId, { status: 'done', ended_at });
  stopRest();
  setWakeLock(false);
}

/** Throw away an active workout entirely (it was never synced). */
export async function discardWorkout(workoutId: string): Promise<void> {
  const sets = await db.sets.where('workout_id').equals(workoutId).primaryKeys();
  const wes = await db.workout_exercises.where('workout_id').equals(workoutId).primaryKeys();
  await hardDelete('sets', sets);
  await hardDelete('workout_exercises', wes);
  await hardDelete('workouts', [workoutId]);
  stopRest();
  setWakeLock(false);
}

/** Delete a finished workout (kept as tombstones so the deletion syncs). */
export async function deleteWorkout(workoutId: string): Promise<void> {
  await softDelete('sets', await db.sets.where('workout_id').equals(workoutId).primaryKeys());
  await softDelete('workout_exercises', await db.workout_exercises.where('workout_id').equals(workoutId).primaryKeys());
  await softDelete('workouts', [workoutId]);
}
