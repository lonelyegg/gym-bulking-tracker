// Bodyweight, sleep and measurements. One weigh-in per day (id = bw-YYYY-MM-DD), one value per
// site per day, so logging again the same day simply updates it (and sync never duplicates).
import { db, put, softDelete, useLive } from '../db/db';
import type { Bodyweight, Measurement } from '../db/schema';
import { weekAverage, type WeighIn } from '../lib/body';
import { localDate } from '../lib/logic';

export const bwId = (date: string) => `bw-${date}`;
export const measurementId = (date: string, site: string) => `m-${date}-${site}`;

export async function logWeight(date: string, weight_kg: number | null, sleep_h?: number | null) {
  const cur = await db.bodyweights.get(bwId(date));
  const next = {
    id: bwId(date), date, created_at: cur?.created_at,
    weight_kg: weight_kg ?? null,
    sleep_h: sleep_h === undefined ? cur?.sleep_h ?? null : sleep_h,
  };
  if (next.weight_kg == null && next.sleep_h == null) {
    if (cur && !cur.deleted) await softDelete('bodyweights', [cur.id]);
    return;
  }
  await put('bodyweights', next);
}

export async function logMeasurements(date: string, values: Record<string, number | null>) {
  for (const [site, v] of Object.entries(values)) {
    const id = measurementId(date, site);
    const cur = await db.measurements.get(id);
    if (v == null || !(v > 0)) {
      if (cur && !cur.deleted) await softDelete('measurements', [id]);
    } else if (!cur || cur.deleted || cur.value_cm !== v) {
      await put('measurements', { id, date, site, value_cm: v, created_at: cur?.created_at });
    }
  }
}

export interface BodyData { weights: Bodyweight[]; measurements: Measurement[] }

export const useBody = () => useLive(async (): Promise<BodyData> => ({
  weights: (await db.bodyweights.toArray()).filter((b) => !b.deleted).sort((a, b) => a.date.localeCompare(b.date)),
  measurements: (await db.measurements.toArray()).filter((m) => !m.deleted),
}), []);

export const weighIns = (weights: Bodyweight[]): WeighIn[] =>
  weights.filter((w) => w.weight_kg != null && w.weight_kg > 0).map((w) => ({ date: w.date, kg: w.weight_kg! }));

/** Best current bodyweight: this week's average if you weighed in 3+ times, else your latest weigh-in. */
export function currentWeight(weights: Bodyweight[], today = localDate()): number | null {
  const w = weighIns(weights);
  if (!w.length) return null;
  return weekAverage(w, today) ?? w[w.length - 1].kg;
}
