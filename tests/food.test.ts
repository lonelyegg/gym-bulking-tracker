import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, put, softDelete } from '../src/db/db';
import type { Food } from '../src/db/schema';
import { localDate } from '../src/lib/logic';
import { addDays } from '../src/lib/stats';
import { dayTotals } from '../src/lib/nutrition';
import {
  copyDay, finishMeal, logFood, logSavedMeal, mealsOn, saveMealAsTemplate, startMeal, updateLog,
} from '../src/state/food';
import { currentWeight, logMeasurements, logWeight } from '../src/state/body';

let rice: Food, whey: Food;
const today = localDate();

beforeEach(async () => {
  vi.useRealTimers();
  await db.delete();
  await db.open();
  [rice] = await put('foods', { name: 'Rice', basis: 'per_100g', serving_g: null, serving_label: '', kcal: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 });
  [whey] = await put('foods', { name: 'Whey', basis: 'per_serving', serving_g: 30, serving_label: 'scoop', kcal: 120, protein_g: 24, carbs_g: null, fat_g: null });
});

const logsOn = async (d: string) => (await db.food_logs.where('date').equals(d).toArray()).filter((l) => !l.deleted);

describe('food logging', () => {
  it('first food starts a meal; more food joins the open meal; nutrients are copied', async () => {
    await logFood(rice, 200, 'g', { date: today });
    await logFood(whey, 1, 'serving', { date: today });
    const meals = await mealsOn(today);
    expect(meals).toHaveLength(1);
    expect(meals[0].finished_at).toBeNull();
    const t = dayTotals(await logsOn(today));
    expect(t).toMatchObject({ kcal: 380, protein_g: 29.4 });
  });

  it('after finishing, or 2+ hours later, food starts a new meal', async () => {
    const l = await logFood(rice, 100, 'g', { date: today });
    await finishMeal((await db.meals.get(l.meal_id!))!);
    await logFood(whey, 1, 'serving', { date: today });
    expect(await mealsOn(today)).toHaveLength(2);
    const old = await startMeal(today, { at: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const l3 = await logFood(rice, 50, 'g', { date: today });
    expect(l3.meal_id).not.toBe(old.id);
  });

  it('food logged for a past day goes into a finished meal on that day', async () => {
    const d = addDays(today, -3);
    const l = await logFood(rice, 100, 'g', { date: d });
    const m = (await db.meals.get(l.meal_id!))!;
    expect(m.date).toBe(d);
    expect(m.finished_at).not.toBeNull();
    expect(m.started_at!.length).toBeGreaterThan(10);
  });

  it('saved meals: save from a meal, log in one go, skip deleted foods', async () => {
    const l = await logFood(rice, 250, 'g', { date: today });
    await logFood(whey, 2, 'serving', { date: today });
    const saved = await saveMealAsTemplate((await db.meals.get(l.meal_id!))!, 'Usual lunch');
    expect(saved.items).toEqual([{ food_id: rice.id, amount: 250, unit: 'g' }, { food_id: whey.id, amount: 2, unit: 'serving' }]);
    await softDelete('foods', [whey.id]);
    const d = addDays(today, 1);
    const r = await logSavedMeal(saved, d);
    expect(r.skipped).toBe(1);
    expect(r.meal.name).toBe('Usual lunch');
    expect(dayTotals(await logsOn(d)).kcal).toBe(325);
  });

  it('copy yesterday keeps clock times and numbers, finishes open meals', async () => {
    const y = addDays(today, -1);
    const m = await startMeal(y, { name: 'Breakfast', at: new Date(`${y}T07:30:00`).toISOString() });
    await logFood(rice, 100, 'g', { date: y, mealId: m.id });
    expect(await copyDay(y, today)).toBe(1);
    const [copy] = await mealsOn(today);
    expect(new Date(copy.started_at!).getHours()).toBe(7);
    expect(copy.date).toBe(today);
    expect(copy.finished_at).not.toBeNull();
    expect(dayTotals(await logsOn(today)).kcal).toBe(130);
    expect(await copyDay(addDays(today, -10), today)).toBe(0);
  });

  it('editing an entry recomputes from the food, or scales if the food was deleted', async () => {
    const l = await logFood(rice, 100, 'g', { date: today });
    await updateLog(l, rice, 300, 'g');
    expect((await db.food_logs.get(l.id))!.kcal).toBe(390);
    const l2 = await logFood(whey, 1, 'serving', { date: today });
    await updateLog(l2, undefined, 2, 'serving');
    expect((await db.food_logs.get(l2.id))).toMatchObject({ kcal: 240, protein_g: 48 });
  });

  it('rejects amounts that do not fit the food', async () => {
    await expect(logFood(rice, 1, 'serving', { date: today })).rejects.toThrow();
  });
});

describe('body logging', () => {
  it('one weigh-in per day: logging again updates it; sleep is kept unless changed', async () => {
    await logWeight(today, 70.2, 7.5);
    await logWeight(today, 70.6);
    const all = (await db.bodyweights.toArray()).filter((b) => !b.deleted);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: `bw-${today}`, weight_kg: 70.6, sleep_h: 7.5 });
    await logWeight(today, null, null);
    expect((await db.bodyweights.get(`bw-${today}`))!.deleted).toBe(1);
  });

  it('current weight = this week’s average with 3+ weigh-ins, else the latest', async () => {
    await logWeight(addDays(today, -20), 68);
    const w1 = (await db.bodyweights.toArray()).filter((b) => !b.deleted);
    expect(currentWeight(w1, today)).toBe(68);
    await logWeight(addDays(today, -2), 70);
    await logWeight(addDays(today, -1), 71);
    await logWeight(today, 72);
    expect(currentWeight((await db.bodyweights.toArray()).filter((b) => !b.deleted), today)).toBe(71);
  });

  it('measurements: one per site per day; clearing a value deletes it', async () => {
    await logMeasurements(today, { waist: 80, upper_arm: 34 });
    await logMeasurements(today, { waist: 80.5, upper_arm: null });
    const live = (await db.measurements.toArray()).filter((m) => !m.deleted);
    expect(live.map((m) => [m.site, m.value_cm])).toEqual([['waist', 80.5]]);
  });
});
