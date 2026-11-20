// Pure training logic: no database or DOM access, so it is easy to unit test.
import type { Equipment, Mechanic, PrType, Split } from '../db/schema';
import { REST } from '../db/schema';

/** Estimated one-rep max (Epley): weight × (1 + reps / 30). */
export const epley = (weight: number, reps: number) => (reps > 0 ? weight * (1 + reps / 30) : 0);

export const round1 = (n: number) => Math.round(n * 10) / 10;

export interface SetLite {
  weight_kg: number;
  reps: number;
  rir: number | null;
}

/** The next weight up for this exercise, or null if you're at the top of the dumbbell rack. */
export function nextWeight(equipment: Equipment, weight: number, incrementKg: number, dumbbellLadder: number[]): number | null {
  if (equipment === 'dumbbell') {
    const next = [...dumbbellLadder].sort((a, b) => a - b).find((w) => w > weight + 1e-9);
    return next ?? null;
  }
  return round1(weight + (incrementKg || 2.5));
}

export type Hint =
  | { kind: 'first' }
  | { kind: 'add_weight'; from: number; to: number }
  | { kind: 'top_of_rack'; weight: number }
  | { kind: 'add_reps'; weight: number; lastReps: number[]; repMax: number }
  | { kind: 'bodyweight_reps'; lastReps: number[]; repMax: number };

/**
 * Double progression. If every working set last time hit the top of the rep range
 * at or above the target RIR, add weight. Otherwise, add reps.
 */
export function progressionHint(
  lastWorkingSets: SetLite[],
  target: { rep_max: number; target_rir: number },
  ex: { equipment: Equipment; increment_kg: number; mechanic: Mechanic },
  dumbbellLadder: number[],
): Hint {
  if (!lastWorkingSets.length) return { kind: 'first' };
  const lastReps = lastWorkingSets.map((s) => s.reps);
  const top = Math.max(...lastWorkingSets.map((s) => s.weight_kg));
  const allHit = lastWorkingSets.every(
    (s) => s.reps >= target.rep_max && (s.rir == null || s.rir >= target.target_rir),
  );
  if (ex.equipment === 'bodyweight' && top === 0) {
    return { kind: 'bodyweight_reps', lastReps, repMax: target.rep_max };
  }
  if (allHit) {
    const to = nextWeight(ex.equipment, top, ex.increment_kg, dumbbellLadder);
    if (to == null) return { kind: 'top_of_rack', weight: top };
    return { kind: 'add_weight', from: top, to };
  }
  return { kind: 'add_reps', weight: top, lastReps, repMax: target.rep_max };
}

/**
 * Which records a new set breaks. `history` = earlier working sets of this exercise
 * (previous workouts plus earlier sets today). No PRs on the first session ever,
 * otherwise every set would be a "record".
 */
export function detectPRs(set: { weight_kg: number; reps: number }, history: SetLite[], hasPriorSession: boolean): PrType[] {
  if (!hasPriorSession || set.reps <= 0) return [];
  const out: PrType[] = [];
  const w = set.weight_kg;
  if (w > 0) {
    const maxW = Math.max(0, ...history.map((h) => h.weight_kg));
    if (w > maxW + 1e-9) out.push('weight');
    const maxE = Math.max(0, ...history.map((h) => epley(h.weight_kg, h.reps)));
    if (epley(w, set.reps) > maxE + 1e-9) out.push('e1rm');
  }
  const atWeight = history.filter((h) => Math.abs(h.weight_kg - w) < 1e-9);
  if (atWeight.length && set.reps > Math.max(...atWeight.map((h) => h.reps))) out.push('reps');
  return out;
}

export const PR_LABEL: Record<PrType, string> = {
  weight: 'Heaviest weight',
  e1rm: 'Best est. 1RM',
  reps: 'Most reps at this weight',
};

// ---------- Dates ----------

export const localDate = (d: Date | string | number = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Whole calendar days from a to b (local time). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Monday 00:00 of the week containing d, as a local date string. */
export function weekStart(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dow);
  return localDate(x);
}

// ---------- Rotation ----------

export type NextUp =
  | { kind: 'empty' } // split has no day types
  | { kind: 'workout'; index: number; dayTypeId: string; trainedToday: boolean; date?: string }
  | { kind: 'rest'; index: number; nextIndex: number; nextDayTypeId: string; date?: string };

/** How a split is scheduled: fixed weekdays, or a cycle that continues from your last workout. */
export function scheduleMode(split: Pick<Split, 'rotation' | 'schedule'>): 'weekly' | 'cycle' {
  return split.schedule ?? (split.rotation.length === 7 ? 'weekly' : 'cycle');
}

/** Monday = 0 … Sunday = 6 for a local date. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/**
 * Weekly schedule: slot i is weekday i. Today's slot is due unless you've trained today;
 * otherwise the next weekday with a workout. Missed days are not carried over.
 */
export function nextWeekly(split: Pick<Split, 'rotation'>, today: string, trainedToday: boolean): NextUp {
  const rot = split.rotation;
  const wd = weekdayIndex(today);
  if (!trainedToday && rot[wd] && rot[wd] !== REST) return { kind: 'workout', index: wd, dayTypeId: rot[wd], trainedToday: false, date: today };
  for (let k = 1; k <= 7; k++) {
    const j = (wd + k) % 7;
    if (rot[j] && rot[j] !== REST) {
      const date = plusDays(today, k);
      return trainedToday
        ? { kind: 'workout', index: j, dayTypeId: rot[j], trainedToday: true, date }
        : { kind: 'rest', index: wd, nextIndex: j, nextDayTypeId: rot[j], date };
    }
  }
  return { kind: 'empty' };
}

/**
 * Next day in the rotation, based on the last finished workout that counted toward it.
 * Planned rest days use up calendar days: a rest day after yesterday's workout means
 * today is a rest day; once that day has passed, the next workout is up.
 */
export function nextInRotation(
  split: Pick<Split, 'rotation'>,
  last: { rotation_index: number; date: string } | null,
  today: string,
): NextUp {
  const rot = split.rotation;
  const n = rot.length;
  const firstWorkoutFrom = (i: number) => {
    for (let k = 0; k < n; k++) {
      const j = (i + k) % n;
      if (rot[j] !== REST) return j;
    }
    return -1;
  };
  if (firstWorkoutFrom(0) < 0) return { kind: 'empty' };
  if (!last || last.rotation_index >= n) {
    const i = firstWorkoutFrom(0);
    return { kind: 'workout', index: i, dayTypeId: rot[i], trainedToday: false };
  }
  const since = daysBetween(last.date, today);
  let i = (last.rotation_index + 1) % n;
  if (since <= 0) {
    // Already trained today; show what's next without consuming rest days.
    const j = firstWorkoutFrom(i);
    return { kind: 'workout', index: j, dayTypeId: rot[j], trainedToday: true };
  }
  let spareDays = since - 1; // days between the last workout and today
  for (let guard = 0; guard < n && rot[i] === REST; guard++) {
    if (spareDays > 0) {
      spareDays--;
      i = (i + 1) % n;
    } else {
      const j = firstWorkoutFrom(i);
      return { kind: 'rest', index: i, nextIndex: j, nextDayTypeId: rot[j] };
    }
  }
  return { kind: 'workout', index: i, dayTypeId: rot[i], trainedToday: false };
}

/** Which rotation slot a chosen day type fills, starting from the suggested slot. */
export function rotationIndexFor(split: Pick<Split, 'rotation'>, dayTypeId: string, fromIndex: number): number | null {
  const n = split.rotation.length;
  for (let k = 0; k < n; k++) {
    const j = (fromIndex + k) % n;
    if (split.rotation[j] === dayTypeId) return j;
  }
  return null;
}

// ---------- Rest ----------

/** Gaps longer than this (bathroom, chat, phone call) are left out of rest averages. */
export const REST_OUTLIER_S = 600;

export function avgRest(rests: (number | null | undefined)[]): number | null {
  const ok = rests.filter((r): r is number => r != null && r > 0 && r <= REST_OUTLIER_S);
  if (!ok.length) return null;
  return Math.round(ok.reduce((a, b) => a + b, 0) / ok.length);
}

// ---------- Formatting ----------

export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export const fmtKg = (n: number | null | undefined) => (n == null ? '–' : `${round1(n)}`.replace(/\.0$/, ''));

export const fmtRir = (r: number | null | undefined) => (r == null ? '–' : r >= 4 ? '4+' : String(r));

/** "just now", "5 min ago", "3 h ago", or a date. */
export function fmtAgo(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'never';
  const min = Math.floor((nowMs - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
