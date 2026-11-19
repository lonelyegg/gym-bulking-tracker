import { describe, expect, it } from 'vitest';
import { canUseGrams, canUseServings, dayTotals, defaultAmount, mealNameFor, nutrientsFor, proteinTarget, rankFoods } from '../src/lib/nutrition';
import { bulkCheck, changeIsGood, DEFAULT_SITES, measurementTable, movingAverage, siteId, weekAverage } from '../src/lib/body';
import { addDays } from '../src/lib/stats';

const rice = { basis: 'per_100g' as const, serving_g: null, kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 };
const whey = { basis: 'per_serving' as const, serving_g: 30, kcal: 120, protein_g: 24, carbs_g: null, fat_g: null };
const egg = { basis: 'per_serving' as const, serving_g: null, kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 };

describe('nutrition', () => {
  it('grams and servings', () => {
    expect(nutrientsFor(rice, 250, 'g')).toEqual({ kcal: 325, protein_g: 6.8, carbs_g: 70, fat_g: 0.8 });
    expect(nutrientsFor(whey, 1.5, 'serving')).toEqual({ kcal: 180, protein_g: 36, carbs_g: null, fat_g: null });
    expect(nutrientsFor(whey, 45, 'g')).toMatchObject({ kcal: 180, protein_g: 36 }); // via serving size
    expect(nutrientsFor(egg, 100, 'g')).toBeNull(); // no serving size known
    expect(nutrientsFor(rice, 1, 'serving')).toBeNull();
    expect(nutrientsFor(rice, 0, 'g')).toBeNull();
    expect([canUseGrams(egg), canUseServings(egg), canUseGrams(whey), canUseServings(rice)]).toEqual([false, true, true, false]);
  });
  it('day totals ignore deleted entries; carbs only if any are known', () => {
    const t = dayTotals([
      { kcal: 300, protein_g: 20, carbs_g: null, fat_g: null, deleted: 0 },
      { kcal: 200, protein_g: 10.25, carbs_g: 30, fat_g: null, deleted: 0 },
      { kcal: 999, protein_g: 99, carbs_g: 99, fat_g: 9, deleted: 1 },
    ]);
    expect(t).toEqual({ kcal: 500, protein_g: 30.3, carbs_g: 30, fat_g: null });
  });
  it('meal names by time', () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 19, h, m);
    expect([at(7), at(12), at(15), at(19), at(23), at(2)].map(mealNameFor)).toEqual(['Breakfast', 'Lunch', 'Snack', 'Dinner', 'Snack', 'Snack']);
  });
  it('recent foods first, then by frequency, then name', () => {
    const foods = [{ id: 'a', name: 'Apple' }, { id: 'b', name: 'Bread' }, { id: 'c', name: 'Cheese' }, { id: 'd', name: 'Dates' }];
    const now = new Date('2026-11-19T12:00:00Z');
    const logs = [
      { food_id: 'c', created_at: '2026-11-19T08:00:00Z', deleted: 0 as const },
      { food_id: 'b', created_at: '2026-11-18T08:00:00Z', deleted: 0 as const },
      { food_id: 'd', created_at: '2026-11-10T08:00:00Z', deleted: 0 as const },
      { food_id: 'd', created_at: '2026-11-11T08:00:00Z', deleted: 0 as const },
      { food_id: 'a', created_at: '2026-11-19T09:00:00Z', deleted: 1 as const },
    ];
    const r = rankFoods(foods, logs, now, 2);
    expect(r.recent.map((f) => f.id)).toEqual(['c', 'b']);
    expect(r.others.map((f) => f.id)).toEqual(['d', 'a']);
  });
  it('default amount: last used, else serving or 100 g', () => {
    expect(defaultAmount(rice, { amount: 180, unit: 'g' })).toEqual({ amount: 180, unit: 'g' });
    expect(defaultAmount(rice, { amount: 2, unit: 'serving' })).toEqual({ amount: 100, unit: 'g' }); // invalid last
    expect(defaultAmount(whey)).toEqual({ amount: 1, unit: 'serving' });
    expect(proteinTarget(70, 1.8)).toBe(126);
    expect(proteinTarget(null, 1.8)).toBeNull();
  });
});

const series = (start: string, days: number, kg: (i: number) => number, every = 1) =>
  Array.from({ length: days }, (_, i) => i).filter((i) => i % every === 0).map((i) => ({ date: addDays(start, i), kg: kg(i) }));

describe('bodyweight', () => {
  it('7-day moving average', () => {
    const m = movingAverage([{ date: '2026-11-01', kg: 70 }, { date: '2026-11-03', kg: 72 }, { date: '2026-11-09', kg: 74 }]);
    expect(m.map((x) => x.avg)).toEqual([70, 71, 73]); // the 9th's window is the 3rd–9th
  });
  it('week average needs 3 weigh-ins', () => {
    expect(weekAverage([{ date: '2026-11-18', kg: 70 }, { date: '2026-11-19', kg: 71 }], '2026-11-19')).toBeNull();
  });
});

describe('bulk check', () => {
  const today = '2026-11-21';
  const base = { minPct: 0.25, maxPct: 0.5, kcalTarget: 2800, today };
  const intake = new Map(Array.from({ length: 21 }, (_, i) => [addDays(today, -i), 2600] as [string, number]));

  it('no data → tells you what is missing', () => {
    expect(bulkCheck({ ...base, weights: [], intake }).status).toBe('no-data');
    const two = [{ date: today, kg: 70 }, { date: addDays(today, -1), kg: 70 }];
    expect(bulkCheck({ ...base, weights: two, intake }).need).toMatch(/3 times/);
  });
  it('stalled weight → slow, suggests +150–250 kcal on top of average intake', () => {
    const w = series(addDays(today, -27), 28, () => 70);
    const r = bulkCheck({ ...base, weights: w, intake });
    expect(r.status).toBe('slow');
    expect(r.windowDays).toBe(21);
    expect(r.rateKgPerWeek).toBeCloseTo(0);
    expect(r.avgIntake).toBe(2600);
    expect(r.delta).toBe(250); // ~0.26 kg/wk short × 7700/7 ≈ 290 → capped at 250
    expect(r.suggestedTarget).toBe(2850);
  });
  it('on track inside 0.25–0.5 %/week', () => {
    const w = series(addDays(today, -27), 28, (i) => 70 + i * (0.25 / 7)); // 0.25 kg/wk ≈ 0.36 %
    const r = bulkCheck({ ...base, weights: w, intake });
    expect(r.status).toBe('on-track');
    expect(r.delta).toBeNull();
    expect(r.ratePct!).toBeGreaterThan(0.3);
  });
  it('gaining well above target → suggests less', () => {
    const w = series(addDays(today, -27), 28, (i) => 70 + i * (0.8 / 7)); // 0.8 kg/wk ≈ 1.1 %
    const r = bulkCheck({ ...base, weights: w, intake });
    expect(r.status).toBe('fast');
    expect(r.delta).toBe(-250);
    expect(r.suggestedTarget).toBe(2350);
  });
  it('slightly above target is flagged but no change suggested', () => {
    const w = series(addDays(today, -27), 28, (i) => 70 + i * (0.42 / 7)); // ≈ 0.6 %
    expect(bulkCheck({ ...base, weights: w, intake }).status).toBe('bit-fast');
  });
  it('falls back to a 2-week window, and to the kcal target without food logs', () => {
    const w = series(addDays(today, -20), 21, () => 70); // three weeks: not enough for the 21-day window
    const r = bulkCheck({ ...base, weights: w, intake: new Map() });
    expect(r.windowDays).toBe(14);
    expect(r.avgIntake).toBeNull();
    expect(r.suggestedTarget).toBe(3050); // 2800 + 250
  });
  it('the verdict matches the rounded rate shown (0.249% shows as 0.25% = on track)', () => {
    const w = series(addDays(today, -27), 28, (i) => 70 + i * ((0.002495 * 70) / 7));
    const r = bulkCheck({ ...base, weights: w, intake });
    expect(r.ratePct).toBe(0.25);
    expect(r.status).toBe('on-track');
  });
  it('a small shortfall suggests the smaller end (+150)', () => {
    const w = series(addDays(today, -27), 28, (i) => 70 + i * (0.16 / 7)); // ~0.23 %/wk, just under
    const r = bulkCheck({ ...base, weights: w, intake });
    expect(r.status).toBe('slow');
    expect(r.delta).toBe(150);
  });
});

describe('measurements', () => {
  it('latest, since start, last 30 days; waist growing is bad', () => {
    const e = [
      { date: '2026-09-01', site: 'upper_arm', value_cm: 33 },
      { date: '2026-10-10', site: 'upper_arm', value_cm: 34 },
      { date: '2026-11-15', site: 'upper_arm', value_cm: 34.6 },
      { date: '2026-11-15', site: 'waist', value_cm: 80 },
    ];
    const rows = measurementTable(e, DEFAULT_SITES, '2026-11-19');
    const arm = rows.find((r) => r.site.id === 'upper_arm')!;
    expect(arm).toMatchObject({ latest: 34.6, sinceStart: 1.6, last30: 0.6 });
    const waist = rows.find((r) => r.site.id === 'waist')!;
    expect(waist).toMatchObject({ latest: 80, sinceStart: null, last30: null });
    expect(changeIsGood(waist.site, 1)).toBe(false);
    expect(changeIsGood(arm.site, 1)).toBe(true);
    expect(rows.find((r) => r.site.id === 'thigh')!.latest).toBeNull();
    expect(siteId(' Neck (relaxed) ')).toBe('neck_relaxed');
  });
});
