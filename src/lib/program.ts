// StrongLifts-style 5×5 program, as described at lift5x5.app:
//   Workout A: Squat 5×5, Bench Press 5×5, Barbell Row 5×5
//   Workout B: Squat 5×5, Overhead Press 5×5, Deadlift 1×5
//   Alternate A/B every session, 3 days a week (the days are containers; the alternation is the program).
//   Hit every rep → add weight next time (+2.5 kg; deadlift +5 kg). Miss reps → same weight again.
//   Three misses in a row at the same weight → that lift drops 10%, rounded down to a loadable weight.
//   Back after more than a week off → all lifts 10% lighter.
// Weights are never stored: they're recomputed by replaying your 5×5 sessions, so editing or deleting
// a workout, syncing from another phone, or logging a missed session afterwards all stay consistent.
import type { S, W } from './stats';
import { addDays } from './stats';
import { daysBetween, localDate, weekdayIndex } from './logic';

export const PROGRAM_ID = 'sl5x5';
export type Lift = 'squat' | 'bench' | 'row' | 'ohp' | 'deadlift';
export type Day = 'A' | 'B';
export const LIFTS: Lift[] = ['squat', 'bench', 'row', 'ohp', 'deadlift'];

export const LIFT_NAME: Record<Lift, string> = {
  squat: 'Squat', bench: 'Bench Press', row: 'Barbell Row', ohp: 'Overhead Press', deadlift: 'Deadlift',
};
export const LIFT_SHORT: Record<Lift, string> = { squat: 'Squat', bench: 'Bench', row: 'Row', ohp: 'Press', deadlift: 'Deadlift' };
/** Exercise records the program uses (from the starter library). */
export const LIFT_EXERCISE: Record<Lift, string> = {
  squat: 'ex-back-squat', bench: 'ex-barbell-bench-press', row: 'ex-barbell-row', ohp: 'ex-overhead-press', deadlift: 'ex-deadlift',
};
export const DAY_LIFTS: Record<Day, Lift[]> = { A: ['squat', 'bench', 'row'], B: ['squat', 'ohp', 'deadlift'] };
export const WORK_SETS: Record<Lift, number> = { squat: 5, bench: 5, row: 5, ohp: 5, deadlift: 1 };
export const WORK_REPS = 5;
export const DAY_STYLE: Record<Day, { icon: string; color: string }> = {
  A: { icon: '🅰️', color: '#ff9f43' },
  B: { icon: '🅱️', color: '#4ea8de' },
};

export const liftOfExercise = (exerciseId: string): Lift | null =>
  (Object.keys(LIFT_EXERCISE) as Lift[]).find((l) => LIFT_EXERCISE[l] === exerciseId) ?? null;

export interface ProgramConfig {
  /** First working weight per lift. */
  start: Record<Lift, number>;
  /** Added after each successful session. */
  inc: Record<Lift, number>;
  bar: number;
  /** Plate sizes you can load (per side), kg. */
  plates: number[];
  /** Training weekdays, Monday = 0. */
  days: number[];
  deloadPct: number;
  /** Drop all lifts 10% when you come back after more than a week off. */
  breakDeload: boolean;
  warmups: boolean;
  /** Manual weight changes ("set squat to 60 kg") from a point in time. */
  adjustments: { lift: Lift; weight: number; at: string }[];
}

export const DEFAULT_PROGRAM: ProgramConfig = {
  start: { squat: 20, bench: 20, row: 30, ohp: 20, deadlift: 40 },
  inc: { squat: 2.5, bench: 2.5, row: 2.5, ohp: 2.5, deadlift: 5 },
  bar: 20,
  plates: [25, 20, 15, 10, 5, 2.5, 1.25],
  days: [0, 2, 4],
  deloadPct: 10,
  breakDeload: true,
  warmups: true,
  adjustments: [],
};

/** Fill in anything missing (older saved configs, partial edits). */
export function withDefaults(c: Partial<ProgramConfig> | null | undefined): ProgramConfig {
  const d = DEFAULT_PROGRAM;
  return {
    ...d, ...(c ?? {}),
    start: { ...d.start, ...(c?.start ?? {}) },
    inc: { ...d.inc, ...(c?.inc ?? {}) },
    plates: c?.plates?.length ? [...c.plates].sort((a, b) => b - a) : d.plates,
    days: c?.days?.length ? [...c.days].sort() : d.days,
    adjustments: c?.adjustments ?? [],
  };
}

// ---------- Loading the bar ----------

const EPS = 1e-6;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Smallest jump you can make: two of your smallest plate. */
export const stepOf = (c: Pick<ProgramConfig, 'plates'>) => 2 * Math.min(...c.plates);

export function roundDownLoadable(w: number, c: Pick<ProgramConfig, 'bar' | 'plates'>): number {
  const step = stepOf(c);
  return r2(Math.max(c.bar, c.bar + Math.floor((w - c.bar + EPS) / step) * step));
}
export function roundNearestLoadable(w: number, c: Pick<ProgramConfig, 'bar' | 'plates'>): number {
  const step = stepOf(c);
  return r2(Math.max(c.bar, c.bar + Math.round((w - c.bar) / step) * step));
}

/** Plates for one side of the bar, heaviest first. `exact` is false if the weight can't be built. */
export function platesPerSide(w: number, c: Pick<ProgramConfig, 'bar' | 'plates'>): { plates: number[]; exact: boolean } {
  let left = (w - c.bar) / 2;
  const out: number[] = [];
  if (left < -EPS) return { plates: [], exact: false };
  for (const p of [...c.plates].sort((a, b) => b - a)) {
    while (left >= p - EPS) { out.push(p); left -= p; }
  }
  return { plates: out, exact: Math.abs(left) < 1e-3 };
}

export const plateText = (w: number, c: Pick<ProgramConfig, 'bar' | 'plates'>) => {
  if (w <= c.bar + EPS) return 'Empty bar';
  const p = platesPerSide(w, c);
  return `${p.plates.join(' + ')} per side${p.exact ? '' : ' (closest)'}`;
};

/** Warm-ups before the work sets: empty bar, then ~65% × 5 and ~85% × 3, rounded to loadable weights. */
export function warmupSets(work: number, lift: Lift, c: Pick<ProgramConfig, 'bar' | 'plates'>): { weight: number; reps: number }[] {
  if (work <= c.bar + EPS) return [];
  const out = [{ weight: c.bar, reps: lift === 'deadlift' ? 5 : 10 }];
  for (const [f, reps] of [[0.65, 5], [0.85, 3]] as const) {
    const w = roundNearestLoadable(work * f, c);
    if (w > out[out.length - 1].weight + EPS && w < work - EPS) out.push({ weight: w, reps });
  }
  return out;
}

// ---------- Replaying your sessions ----------

export type Result = 'success' | 'fail' | 'deload' | 'skipped';
export interface LiftEntry {
  workoutId: string;
  date: string;
  day: Day;
  weight: number | null;
  reps: number[];
  result: Result;
  /** Weight for the next session after this one. */
  next: number;
  /** Misses in a row at this weight after this session. */
  fails: number;
}
export interface LiftState {
  weight: number;
  fails: number;
  failWeight: number | null;
  deloads: number;
  history: LiftEntry[];
}
export interface ProgramState {
  lifts: Record<Lift, LiftState>;
  lastDay: Day | null;
  lastDate: string | null; // local date of the last 5×5 session
  sessions: number;
  breaks: { date: string }[];
}

type PW = W & { program?: string | null; program_day?: string | null };

/** Most common weight among the work sets (heaviest wins a tie). */
function workWeight(sets: S[]): number {
  const count = new Map<number, number>();
  for (const s of sets) count.set(s.weight_kg, (count.get(s.weight_kg) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

export function replay(workouts: PW[], sets: S[], cfgIn: Partial<ProgramConfig> | null, opts: { before?: string } = {}): ProgramState {
  const cfg = withDefaults(cfgIn);
  const lifts = Object.fromEntries(LIFTS.map((l) => [l, { weight: cfg.start[l], fails: 0, failWeight: null, deloads: 0, history: [] }])) as unknown as Record<Lift, LiftState>;
  const state: ProgramState = { lifts, lastDay: null, lastDate: null, sessions: 0, breaks: [] };
  const sessions = workouts
    .filter((w) => w.program === PROGRAM_ID && (w.program_day === 'A' || w.program_day === 'B') && (!opts.before || w.started_at < opts.before))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const adjustments = cfg.adjustments.filter((a) => !opts.before || a.at < opts.before).sort((a, b) => a.at.localeCompare(b.at));
  const byWorkout = new Map<string, S[]>();
  for (const s of sets) byWorkout.set(s.workout_id, [...(byWorkout.get(s.workout_id) ?? []), s]);

  let ai = 0;
  const applyAdjustments = (until: string) => {
    while (ai < adjustments.length && adjustments[ai].at <= until) {
      const a = adjustments[ai++];
      lifts[a.lift] = { ...lifts[a.lift], weight: a.weight, fails: 0, failWeight: null };
    }
  };

  for (const w of sessions) {
    applyAdjustments(w.started_at);
    const date = localDate(w.started_at);
    if (cfg.breakDeload && state.lastDate && daysBetween(state.lastDate, date) > 7) {
      for (const l of LIFTS) lifts[l] = { ...lifts[l], weight: roundDownLoadable(lifts[l].weight * (1 - cfg.deloadPct / 100), cfg), fails: 0, failWeight: null };
      state.breaks.push({ date });
    }
    const day = w.program_day as Day;
    for (const lift of DAY_LIFTS[day]) {
      const st = lifts[lift];
      const work = (byWorkout.get(w.id) ?? []).filter((s) => s.exercise_id === LIFT_EXERCISE[lift] && !s.is_warmup)
        .sort((a, b) => a.set_number - b.set_number);
      if (!work.length) {
        st.history.push({ workoutId: w.id, date: w.started_at, day, weight: null, reps: [], result: 'skipped', next: st.weight, fails: st.fails });
        continue;
      }
      const ww = workWeight(work);
      const good = work.filter((s) => s.weight_kg >= ww - EPS && s.reps >= WORK_REPS).length;
      let result: Result;
      if (good >= WORK_SETS[lift]) {
        st.weight = roundNearestLoadable(ww + cfg.inc[lift], cfg);
        st.fails = 0;
        st.failWeight = null;
        result = 'success';
      } else {
        st.fails = st.failWeight != null && Math.abs(st.failWeight - ww) < EPS ? st.fails + 1 : 1;
        st.failWeight = ww;
        if (st.fails >= 3) {
          st.weight = roundDownLoadable(ww * (1 - cfg.deloadPct / 100), cfg);
          st.fails = 0;
          st.failWeight = null;
          st.deloads++;
          result = 'deload';
        } else {
          st.weight = ww;
          result = 'fail';
        }
      }
      st.history.push({ workoutId: w.id, date: w.started_at, day, weight: ww, reps: work.map((s) => s.reps), result, next: st.weight, fails: st.fails });
    }
    state.lastDay = day;
    state.lastDate = date;
    state.sessions++;
  }
  applyAdjustments(opts.before ?? '9999');
  return state;
}

// ---------- What's next ----------

export interface PlannedLift { lift: Lift; weight: number; sets: number; reps: number; warmups: { weight: number; reps: number }[]; fails: number }
export interface NextSession {
  day: Day;
  date: string; // next training day (today if today is one and you haven't done a 5×5 session today)
  lifts: PlannedLift[];
  /** True if weights were reduced because it's been more than a week since your last session. */
  afterBreak: boolean;
}

/** Weights for a given day, as they'd be if you trained on `onDate`. */
export function sessionPlan(state: ProgramState, cfgIn: Partial<ProgramConfig> | null, day: Day, onDate: string): { lifts: PlannedLift[]; afterBreak: boolean } {
  const cfg = withDefaults(cfgIn);
  const afterBreak = cfg.breakDeload && !!state.lastDate && daysBetween(state.lastDate, onDate) > 7;
  const lifts = DAY_LIFTS[day].map((lift) => {
    const st = state.lifts[lift];
    const weight = afterBreak ? roundDownLoadable(st.weight * (1 - cfg.deloadPct / 100), cfg) : st.weight;
    return { lift, weight, sets: WORK_SETS[lift], reps: WORK_REPS, warmups: cfg.warmups ? warmupSets(weight, lift, cfg) : [], fails: afterBreak ? 0 : st.fails };
  });
  return { lifts, afterBreak };
}

export function nextSession(state: ProgramState, cfgIn: Partial<ProgramConfig> | null, today: string): NextSession {
  const cfg = withDefaults(cfgIn);
  const day: Day = state.lastDay === 'A' ? 'B' : 'A';
  const doneToday = state.lastDate === today;
  let date = doneToday ? addDays(today, 1) : today;
  for (let k = 0; k < 7 && !cfg.days.includes(weekdayIndex(date)); k++) date = addDays(date, 1);
  return { day, date, ...sessionPlan(state, cfg, day, date) };
}

/** Upcoming training days with their workout letter (A/B alternate across the dates). */
export function plannedSessions(state: ProgramState, cfgIn: Partial<ProgramConfig> | null, today: string, until: string): Map<string, Day> {
  const cfg = withDefaults(cfgIn);
  const out = new Map<string, Day>();
  let day: Day = state.lastDay === 'A' ? 'B' : 'A';
  for (let d = state.lastDate === today ? addDays(today, 1) : today; d <= until; d = addDays(d, 1)) {
    if (!cfg.days.includes(weekdayIndex(d))) continue;
    out.set(d, day);
    day = day === 'A' ? 'B' : 'A';
  }
  return out;
}
