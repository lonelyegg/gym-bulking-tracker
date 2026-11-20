// Pure dashboard maths (no database, no DOM) so every number on the dashboard is unit-tested.
import type { Exercise, PrType, Split, Workout, WorkoutSet } from '../db/schema';
import { avgRest, epley, localDate, nextInRotation, scheduleMode, weekdayIndex } from './logic';
import { REST } from '../db/schema';
import { resolveMuscles, type Muscle, type MuscleMap } from './muscles';

export type W = Pick<Workout, 'id' | 'started_at' | 'ended_at' | 'day_type_id' | 'name' | 'icon' | 'color'>
  & Partial<Pick<Workout, 'split_id' | 'rotation_index' | 'backfill'>>;
/** A completed set with weight and reps filled in. */
export type S = Pick<WorkoutSet, 'id' | 'workout_id' | 'exercise_id' | 'set_number' | 'is_warmup' | 'rir' | 'completed_at' | 'rest_before_s' | 'rest_is_transition'>
  & { weight_kg: number; reps: number };

const byStart = (a: W, b: W) => a.started_at.localeCompare(b.started_at);

// ---------- Calendar dates ----------

const parseDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); };

export function addDays(date: string, n: number): string {
  const x = parseDate(date);
  x.setDate(x.getDate() + n);
  return localDate(x);
}

/** Monday of the week containing `date` (YYYY-MM-DD). */
export function weekOf(date: string): string {
  const x = parseDate(date);
  return addDays(date, -((x.getDay() + 6) % 7));
}

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const x = new Date(y, m - 1 + n, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
}

export interface CalendarCell { date: string; inMonth: boolean }

/** Weeks (Monday first) covering the month, with leading/trailing days from neighbouring months. */
export function monthGrid(ym: string): CalendarCell[][] {
  const first = `${ym}-01`;
  const start = weekOf(first);
  const [y, m] = ym.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (parseDate(first).getDay() + 6) % 7;
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const weeks: CalendarCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const week: CalendarCell[] = [];
    for (let c = 0; c < 7; c++) {
      const date = addDays(start, r * 7 + c);
      week.push({ date, inMonth: monthOf(date) === ym });
    }
    weeks.push(week);
  }
  return weeks;
}

/** Workouts grouped by local calendar date, earliest first within a day. */
export function workoutsByDate(workouts: W[]): Map<string, W[]> {
  const m = new Map<string, W[]>();
  for (const w of [...workouts].sort(byStart)) {
    const d = localDate(w.started_at);
    m.set(d, [...(m.get(d) ?? []), w]);
  }
  return m;
}

// ---------- Consistency ----------

export interface Streak { current: number; best: number; thisWeek: number }

/**
 * Weekly streak: consecutive weeks (Mon–Sun) where you hit your weekly target.
 * The current week only counts once the target is met, and an unfinished week never breaks the streak.
 */
export function weeklyStreak(workoutDates: string[], target: number, today: string): Streak {
  const counts = new Map<string, number>();
  for (const d of workoutDates) counts.set(weekOf(d), (counts.get(weekOf(d)) ?? 0) + 1);
  const thisWeek = weekOf(today);
  const hit = (w: string) => (counts.get(w) ?? 0) >= Math.max(1, target);

  let current = 0;
  let w = thisWeek;
  if (hit(w)) current++;
  w = addDays(w, -7);
  while (hit(w)) { current++; w = addDays(w, -7); }

  let best = 0;
  if (counts.size) {
    const first = [...counts.keys()].sort()[0];
    let run = 0;
    for (let x = first; x <= thisWeek; x = addDays(x, 7)) {
      if (hit(x)) { run++; best = Math.max(best, run); } else if (x !== thisWeek) run = 0;
    }
  }
  return { current, best: Math.max(best, current), thisWeek: counts.get(thisWeek) ?? 0 };
}

// ---------- Personal records ----------

export interface PrEvent {
  workoutId: string;
  exerciseId: string;
  date: string; // workout start (ISO)
  /** The headline record: est. 1RM beats heaviest weight beats rep record. */
  kind: PrType;
  kinds: PrType[];
  setId: string;
  weight: number;
  reps: number;
  /** The record value (kg for e1rm/weight, reps for reps). */
  value: number;
  /** The previous record it beat. */
  previous: number;
}

const wKey = (w: number) => w.toFixed(2);

/**
 * Replays your history in order and finds every record you set: one event per exercise per workout
 * (the best set). Same rules as the live PR toast: no records in the first session of an exercise,
 * warm-ups never count, and rep records need an earlier set at that exact weight.
 */
export function prEvents(workouts: W[], sets: S[]): PrEvent[] {
  const setsByWorkout = new Map<string, S[]>();
  for (const s of sets) {
    if (s.is_warmup || s.reps <= 0) continue;
    setsByWorkout.set(s.workout_id, [...(setsByWorkout.get(s.workout_id) ?? []), s]);
  }
  const state = new Map<string, { maxW: number; maxE: number; repsAt: Map<string, number>; sessions: number }>();
  const events: PrEvent[] = [];

  for (const w of [...workouts].sort(byStart)) {
    const list = (setsByWorkout.get(w.id) ?? []).sort((a, b) => (a.completed_at ?? '').localeCompare(b.completed_at ?? '') || a.set_number - b.set_number);
    const startOf = new Map<string, { maxW: number; maxE: number }>();
    const best = new Map<string, Partial<Record<PrType, { set: S; value: number; previous: number }>>>();

    for (const s of list) {
      let st = state.get(s.exercise_id);
      if (!st) { st = { maxW: 0, maxE: 0, repsAt: new Map(), sessions: 0 }; state.set(s.exercise_id, st); }
      if (!startOf.has(s.exercise_id)) startOf.set(s.exercise_id, { maxW: st.maxW, maxE: st.maxE });
      const e = epley(s.weight_kg, s.reps);
      if (st.sessions > 0) {
        const b = best.get(s.exercise_id) ?? {};
        const before = startOf.get(s.exercise_id)!;
        if (s.weight_kg > 0 && s.weight_kg > st.maxW + 1e-9 && (!b.weight || s.weight_kg > b.weight.value)) {
          b.weight = { set: s, value: s.weight_kg, previous: before.maxW };
        }
        if (s.weight_kg > 0 && e > st.maxE + 1e-9 && (!b.e1rm || e > b.e1rm.value)) {
          b.e1rm = { set: s, value: e, previous: before.maxE };
        }
        const prevReps = st.repsAt.get(wKey(s.weight_kg));
        if (prevReps != null && s.reps > prevReps && (!b.reps || s.weight_kg >= b.reps.set.weight_kg)) {
          b.reps = { set: s, value: s.reps, previous: prevReps };
        }
        best.set(s.exercise_id, b);
      }
      st.maxW = Math.max(st.maxW, s.weight_kg);
      st.maxE = Math.max(st.maxE, e);
      st.repsAt.set(wKey(s.weight_kg), Math.max(st.repsAt.get(wKey(s.weight_kg)) ?? 0, s.reps));
    }
    for (const exId of startOf.keys()) state.get(exId)!.sessions++;

    for (const [exerciseId, b] of best) {
      const kinds = (['e1rm', 'weight', 'reps'] as PrType[]).filter((k) => b[k]);
      if (!kinds.length) continue;
      const head = b[kinds[0]]!;
      events.push({
        workoutId: w.id, exerciseId, date: w.started_at, kind: kinds[0], kinds, setId: head.set.id,
        weight: head.set.weight_kg, reps: head.set.reps, value: head.value, previous: head.previous,
      });
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Strength ----------

export interface SeriesPoint { workoutId: string; date: string; value: number; weight: number; reps: number }

/** Best estimated 1RM per workout for one exercise, oldest first. */
export function e1rmSeries(exerciseId: string, workouts: W[], sets: S[]): SeriesPoint[] {
  const best = new Map<string, S>();
  for (const s of sets) {
    if (s.exercise_id !== exerciseId || s.is_warmup || s.weight_kg <= 0 || s.reps <= 0) continue;
    const cur = best.get(s.workout_id);
    if (!cur || epley(s.weight_kg, s.reps) > epley(cur.weight_kg, cur.reps)) best.set(s.workout_id, s);
  }
  return [...workouts].sort(byStart)
    .filter((w) => best.has(w.id))
    .map((w) => { const s = best.get(w.id)!; return { workoutId: w.id, date: w.started_at, value: epley(s.weight_kg, s.reps), weight: s.weight_kg, reps: s.reps }; });
}

/** Lifts with weighted working sets, most-trained first (compounds win ties). */
export function liftOptions(sets: S[], exercises: Map<string, Pick<Exercise, 'mechanic' | 'name'>>): { exerciseId: string; sessions: number }[] {
  const sessions = new Map<string, Set<string>>();
  for (const s of sets) {
    if (s.is_warmup || s.weight_kg <= 0) continue;
    if (!sessions.has(s.exercise_id)) sessions.set(s.exercise_id, new Set());
    sessions.get(s.exercise_id)!.add(s.workout_id);
  }
  const rank = (id: string) => (exercises.get(id)?.mechanic === 'compound' ? 0 : 1);
  return [...sessions].map(([exerciseId, ws]) => ({ exerciseId, sessions: ws.size }))
    .sort((a, b) => b.sessions - a.sessions || rank(a.exerciseId) - rank(b.exerciseId)
      || (exercises.get(a.exerciseId)?.name ?? '').localeCompare(exercises.get(b.exerciseId)?.name ?? ''));
}

// ---------- Rest ----------

/** Working rest = rest before a working set, from the previous set of the same exercise. */
const workingRests = (sets: S[]) => sets.filter((s) => !s.is_warmup && !s.rest_is_transition).map((s) => s.rest_before_s);

export interface RestPoint { workoutId: string; date: string; value: number; name: string; icon: string }

/** Average working rest per workout, oldest first (workouts without rest data are skipped). */
export function restBySession(workouts: W[], sets: S[]): RestPoint[] {
  const by = new Map<string, S[]>();
  for (const s of sets) by.set(s.workout_id, [...(by.get(s.workout_id) ?? []), s]);
  const out: RestPoint[] = [];
  for (const w of [...workouts].sort(byStart)) {
    const v = avgRest(workingRests(by.get(w.id) ?? []));
    if (v != null) out.push({ workoutId: w.id, date: w.started_at, value: v, name: w.name, icon: w.icon });
  }
  return out;
}

export const averageRest = (sets: S[]) => avgRest(workingRests(sets));

export interface ExerciseRest { exerciseId: string; avg: number; previous: number | null; samples: number }

/** Average working rest per exercise in this period, compared with the period before. */
export function restByExercise(current: S[], previous: S[], limit = 5): ExerciseRest[] {
  const group = (list: S[]) => {
    const m = new Map<string, S[]>();
    for (const s of list) m.set(s.exercise_id, [...(m.get(s.exercise_id) ?? []), s]);
    return m;
  };
  const cur = group(current);
  const prev = group(previous);
  const out: ExerciseRest[] = [];
  for (const [exerciseId, list] of cur) {
    const avg = avgRest(workingRests(list));
    if (avg == null) continue;
    const samples = workingRests(list).filter((r) => r != null && r > 0 && r <= 600).length;
    out.push({ exerciseId, avg, previous: avgRest(workingRests(prev.get(exerciseId) ?? [])), samples });
  }
  return out.sort((a, b) => b.samples - a.samples).slice(0, limit);
}

// ---------- Ranges ----------

export type Range = '1M' | '3M' | '6M' | '1Y' | 'All';
export const RANGES: Range[] = ['1M', '3M', '6M', '1Y', 'All'];
const RANGE_DAYS: Record<Exclude<Range, 'All'>, number> = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 };

/** [start, end) of the range and of the equally long period before it. `All` has no start and no previous period. */
export function rangeBounds(range: Range, now = new Date()) {
  if (range === 'All') return { start: null as string | null, prevStart: null as string | null };
  const ms = RANGE_DAYS[range] * 86400000;
  return { start: new Date(now.getTime() - ms).toISOString(), prevStart: new Date(now.getTime() - 2 * ms).toISOString() };
}

export function splitByRange(workouts: W[], sets: S[], range: Range, now = new Date()) {
  const { start, prevStart } = rangeBounds(range, now);
  const inCur = new Set(workouts.filter((w) => !start || w.started_at >= start).map((w) => w.id));
  const inPrev = new Set(workouts.filter((w) => start && prevStart && w.started_at >= prevStart && w.started_at < start).map((w) => w.id));
  return {
    workouts: workouts.filter((w) => inCur.has(w.id)),
    sets: sets.filter((s) => inCur.has(s.workout_id)),
    prevSets: sets.filter((s) => inPrev.has(s.workout_id)),
  };
}

// ---------- Charts ----------

/** Round axis ticks: steps of 1, 2, 2.5 or 5 × 10^n. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max === min) { const pad = Math.abs(max) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// ---------- Muscles ----------

/**
 * Working sets per muscle over the last `days` days. A set counts fully for a main muscle and
 * half for a muscle that's also worked; minor muscles aren't counted.
 */
export function muscleSets(
  workouts: W[], sets: S[], exercises: Map<string, { muscles?: unknown; muscle_group?: string }>,
  days = 7, now = new Date(),
): MuscleMap {
  const from = new Date(now.getTime() - days * 86400000).toISOString();
  const inRange = new Set(workouts.filter((w) => w.started_at >= from && w.started_at <= now.toISOString()).map((w) => w.id));
  const out: MuscleMap = {};
  const cache = new Map<string, MuscleMap>();
  for (const s of sets) {
    if (s.is_warmup || !inRange.has(s.workout_id)) continue;
    let m = cache.get(s.exercise_id);
    if (!m) { m = resolveMuscles(exercises.get(s.exercise_id)); cache.set(s.exercise_id, m); }
    for (const [k, w] of Object.entries(m) as [Muscle, number][]) {
      if (w >= 0.5) out[k] = (out[k] ?? 0) + w;
    }
  }
  return out;
}

// ---------- Planned days ----------

export type Planned = { kind: 'workout'; dayTypeId: string; index: number } | { kind: 'rest' };

/**
 * Projects the rotation forward from `start` to `until` (inclusive), assuming you train on each
 * planned day. Recomputed from your real history every time, so a missed day, an extra workout
 * or a split change reshuffles the plan automatically.
 */
export function plannedDays(
  split: Pick<Split, 'rotation' | 'schedule'>, last: { rotation_index: number; date: string } | null, start: string, until: string,
): Map<string, Planned> {
  const out = new Map<string, Planned>();
  if (scheduleMode(split) === 'weekly') {
    // Fixed weekdays: each date simply gets its weekday's slot.
    if (!split.rotation.some((r) => r !== REST)) return out;
    for (let d = start, guard = 0; d <= until && guard < 400; d = addDays(d, 1), guard++) {
      const i = weekdayIndex(d);
      const id = split.rotation[i];
      out.set(d, !id || id === REST ? { kind: 'rest' } : { kind: 'workout', dayTypeId: id, index: i });
    }
    return out;
  }
  let cur = last;
  for (let d = start, guard = 0; d <= until && guard < 400; d = addDays(d, 1), guard++) {
    const r = nextInRotation(split, cur, d);
    if (r.kind === 'empty') break;
    if (r.kind === 'workout') {
      out.set(d, { kind: 'workout', dayTypeId: r.dayTypeId, index: r.index });
      cur = { rotation_index: r.index, date: d };
    } else out.set(d, { kind: 'rest' });
  }
  return out;
}

// ---------- One exercise ----------

export interface ExerciseSummary {
  sessions: { workout: W; sets: S[]; best: S | null }[]; // newest first
  bestE1rm: { value: number; set: S; date: string } | null;
  heaviest: { set: S; date: string } | null;
  /** Most reps at each weight, heaviest weights first. */
  repRecords: { weight: number; reps: number; date: string; workoutId: string }[];
  rest: RestPoint[];
}

export function exerciseSummary(exerciseId: string, workouts: W[], sets: S[]): ExerciseSummary {
  const mine = sets.filter((s) => s.exercise_id === exerciseId);
  const byW = new Map(workouts.map((w) => [w.id, w]));
  const grouped = new Map<string, S[]>();
  for (const s of mine) if (byW.has(s.workout_id)) grouped.set(s.workout_id, [...(grouped.get(s.workout_id) ?? []), s]);
  const sessions = [...grouped].map(([id, list]) => {
    const ordered = list.sort((a, b) => a.set_number - b.set_number);
    const working = ordered.filter((s) => !s.is_warmup && s.reps > 0);
    const best = working.reduce<S | null>((b, s) => (!b || epley(s.weight_kg, s.reps) > epley(b.weight_kg, b.reps) ? s : b), null);
    return { workout: byW.get(id)!, sets: ordered, best };
  }).sort((a, b) => b.workout.started_at.localeCompare(a.workout.started_at));

  let bestE1rm: ExerciseSummary['bestE1rm'] = null;
  let heaviest: ExerciseSummary['heaviest'] = null;
  const reps = new Map<string, { weight: number; reps: number; date: string; workoutId: string }>();
  for (const { workout, sets: list } of [...sessions].reverse()) {
    for (const s of list) {
      if (s.is_warmup || s.reps <= 0) continue;
      const e = epley(s.weight_kg, s.reps);
      if (s.weight_kg > 0 && (!bestE1rm || e > bestE1rm.value + 1e-9)) bestE1rm = { value: e, set: s, date: workout.started_at };
      if (!heaviest || s.weight_kg > heaviest.set.weight_kg + 1e-9) heaviest = { set: s, date: workout.started_at };
      const k = s.weight_kg.toFixed(2);
      const r = reps.get(k);
      if (!r || s.reps > r.reps) reps.set(k, { weight: s.weight_kg, reps: s.reps, date: workout.started_at, workoutId: workout.id });
    }
  }
  return {
    sessions, bestE1rm, heaviest,
    repRecords: [...reps.values()].sort((a, b) => b.weight - a.weight),
    rest: restBySession(workouts, mine),
  };
}
