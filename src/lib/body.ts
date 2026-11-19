// Pure bodyweight / measurement / bulk-check maths.
import { addDays } from './stats';

export interface WeighIn { date: string; kg: number }

/** For each weigh-in: the average of all weigh-ins in the 7 calendar days ending that day. */
export function movingAverage(entries: WeighIn[]): { date: string; kg: number; avg: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e) => {
    const from = addDays(e.date, -6);
    const win = sorted.filter((x) => x.date >= from && x.date <= e.date);
    return { date: e.date, kg: e.kg, avg: win.reduce((a, x) => a + x.kg, 0) / win.length };
  });
}

/** Average of weigh-ins in the 7 days ending `end`, if there are at least `min` of them. */
export function weekAverage(entries: WeighIn[], end: string, min = 3): number | null {
  const from = addDays(end, -6);
  const win = entries.filter((x) => x.date >= from && x.date <= end);
  return win.length >= min ? win.reduce((a, x) => a + x.kg, 0) / win.length : null;
}

export type BulkStatus = 'no-data' | 'slow' | 'on-track' | 'bit-fast' | 'fast';

export interface BulkCheck {
  status: BulkStatus;
  /** What's missing when status is no-data. */
  need?: string;
  windowDays: number;
  startAvg: number | null;
  endAvg: number | null;
  rateKgPerWeek: number | null;
  ratePct: number | null;
  targetKg: [number, number] | null;
  avgIntake: number | null;
  intakeDays: number;
  /** Signed kcal/day change to suggest (±150–250), or null. */
  delta: number | null;
  /** New daily target = average intake (or current target) + delta, rounded to 50. */
  suggestedTarget: number | null;
}

const round50 = (n: number) => Math.round(n / 50) * 50;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const KCAL_PER_KG = 7700;

/**
 * Compares your 7-day average weight now with 2–3 weeks ago against your target rate of gain
 * (% of bodyweight per week), and shows average intake over the same weeks.
 */
export function bulkCheck(opts: {
  weights: WeighIn[];
  intake: Map<string, number>; // date -> kcal logged that day
  minPct: number;
  maxPct: number;
  kcalTarget: number | null;
  today: string;
}): BulkCheck {
  const { weights, intake, minPct, maxPct, kcalTarget, today } = opts;
  const empty = (need: string): BulkCheck => ({
    status: 'no-data', need, windowDays: 0, startAvg: null, endAvg: null, rateKgPerWeek: null, ratePct: null,
    targetKg: null, avgIntake: null, intakeDays: 0, delta: null, suggestedTarget: null,
  });
  const recent = weights.filter((w) => w.date <= today && w.date > addDays(today, -7)).sort((a, b) => b.date.localeCompare(a.date));
  if (!recent.length) return empty('Weigh in this week (3+ times) to check your rate of gain.');
  const end = recent[0].date;
  const endAvg = weekAverage(weights, end);
  if (endAvg == null) return empty(`Weigh in at least 3 times this week (${recent.length} so far).`);

  let windowDays = 0;
  let startAvg: number | null = null;
  for (const w of [21, 14]) {
    const s = weekAverage(weights, addDays(end, -w));
    if (s != null) { windowDays = w; startAvg = s; break; }
  }
  if (startAvg == null) return empty('Keep weighing in 3+ times a week. The check starts once there are two weeks of data.');

  const weeks = windowDays / 7;
  const rateKgPerWeek = (endAvg - startAvg) / weeks;
  // Rounded to what's displayed (2 decimals), so the verdict always matches the number you see.
  const ratePct = Math.round((rateKgPerWeek / startAvg) * 100 * 100) / 100;
  const targetKg: [number, number] = [(minPct / 100) * startAvg, (maxPct / 100) * startAvg];

  let kcal = 0;
  let intakeDays = 0;
  for (let d = addDays(end, -windowDays + 1); d <= end; d = addDays(d, 1)) {
    const v = intake.get(d) ?? 0;
    if (v > 0) { kcal += v; intakeDays++; }
  }
  const avgIntake = intakeDays ? Math.round(kcal / intakeDays) : null;

  let status: BulkStatus = 'on-track';
  if (ratePct < minPct) status = 'slow';
  else if (ratePct > maxPct * 1.5) status = 'fast';
  else if (ratePct > maxPct) status = 'bit-fast';

  let delta: number | null = null;
  if (status === 'slow' || status === 'fast') {
    // Energy needed to move to the middle of the target range, kept to the ±150–250 kcal guideline.
    const mid = ((minPct + maxPct) / 2 / 100) * startAvg;
    const raw = ((mid - rateKgPerWeek) * KCAL_PER_KG) / 7;
    delta = status === 'slow' ? clamp(round50(raw), 150, 250) : -clamp(round50(-raw), 150, 250);
  }
  const base = avgIntake ?? kcalTarget;
  return {
    status, windowDays, startAvg, endAvg, rateKgPerWeek, ratePct, targetKg, avgIntake, intakeDays, delta,
    suggestedTarget: delta != null && base != null ? round50(base + delta) : null,
  };
}

// ---------- Measurements ----------

export interface Site { id: string; label: string; lowerIsBetter?: boolean }

export const DEFAULT_SITES: Site[] = [
  { id: 'waist', label: 'Waist', lowerIsBetter: true },
  { id: 'chest', label: 'Chest' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'upper_arm', label: 'Upper arm' },
  { id: 'thigh', label: 'Thigh' },
];

export interface MeasurementRow {
  site: Site;
  latest: number | null;
  latestDate: string | null;
  sinceStart: number | null;
  last30: number | null;
}

/** Latest value per site, change since your first entry, and change vs your entry from ~30+ days ago. */
export function measurementTable(entries: { date: string; site: string; value_cm: number }[], sites: Site[], today: string): MeasurementRow[] {
  const cutoff = addDays(today, -30);
  return sites.map((site) => {
    const list = entries.filter((e) => e.site === site.id).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return { site, latest: null, latestDate: null, sinceStart: null, last30: null };
    const first = list[0];
    const last = list[list.length - 1];
    const base30 = [...list].reverse().find((e) => e.date <= cutoff);
    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      site,
      latest: last.value_cm,
      latestDate: last.date,
      sinceStart: list.length > 1 ? r(last.value_cm - first.value_cm) : null,
      last30: base30 && base30 !== last ? r(last.value_cm - base30.value_cm) : null,
    };
  });
}

/** Whether a change is good for this site while bulking (waist growing is not). */
export const changeIsGood = (site: Site, change: number) => (site.lowerIsBetter ? change < 0 : change > 0);

export const siteId = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || 'custom';
