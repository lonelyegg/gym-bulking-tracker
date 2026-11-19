// Food logging. A meal is one eating occasion with a start and finish time; food_logs are its items,
// with nutrients copied at log time so editing a food later never rewrites what you ate.
import { db, nowIso, patch, put, softDelete, useLive } from '../db/db';
import type { Food, FoodLog, Meal, SavedMeal, SavedMealItem } from '../db/schema';
import { localDate } from '../lib/logic';
import { mealNameFor, nutrientsFor } from '../lib/nutrition';

const TWO_HOURS = 2 * 3600_000;

/** Items in the order you logged them. */
const byLogged = (a: FoodLog, b: FoodLog) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
/** Distinct, ordered creation times for items logged in one go. */
const stamp = (i: number) => new Date(Date.now() + i).toISOString();

/** The same clock time on another local date. */
export function onDate(iso: string, date: string): string {
  const t = new Date(iso);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds()).toISOString();
}

/** "Now" for a day you're viewing: the current time if it's today, otherwise the current clock time on that day. */
export const momentOn = (date: string) => (date === localDate() ? nowIso() : onDate(nowIso(), date));

export async function mealsOn(date: string): Promise<Meal[]> {
  return (await db.meals.where('date').equals(date).toArray()).filter((m) => !m.deleted)
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
}

/** A meal you're still eating (started in the last 2 hours, not finished). New food goes there. */
async function openMeal(date: string): Promise<Meal | undefined> {
  const now = Date.now();
  return (await mealsOn(date)).reverse().find((m) => !m.finished_at && m.started_at && now - Date.parse(m.started_at) < TWO_HOURS);
}

export async function startMeal(date: string, opts: { name?: string; at?: string; finished?: boolean; savedMealId?: string | null } = {}): Promise<Meal> {
  const at = opts.at ?? momentOn(date);
  const [m] = await put('meals', {
    date, name: opts.name ?? mealNameFor(new Date(at)), started_at: at,
    // Logged for a past day: assume a 20-minute meal (you can edit the times).
    finished_at: opts.finished ? new Date(Date.parse(at) + 20 * 60000).toISOString() : null,
    saved_meal_id: opts.savedMealId ?? null,
  });
  return m;
}

export async function logFood(food: Food, amount: number, unit: 'g' | 'serving', opts: { date: string; mealId?: string }): Promise<FoodLog> {
  const n = nutrientsFor(food, amount, unit);
  if (!n) throw new Error('That amount doesn’t work for this food.');
  const past = opts.date < localDate();
  const mealId = opts.mealId ?? (await openMeal(opts.date))?.id ?? (await startMeal(opts.date, { finished: past })).id;
  // Always after the meal's last item, so items keep the order you logged them.
  const lastAt = (await db.food_logs.where('meal_id').equals(mealId).toArray()).reduce((m, l) => (l.created_at > m ? l.created_at : m), '');
  const now = nowIso();
  const created_at = lastAt && lastAt >= now ? new Date(Date.parse(lastAt) + 1).toISOString() : now;
  const [log] = await put('food_logs', { date: opts.date, meal_id: mealId, food_id: food.id, name: food.name, amount, unit, ...n, created_at });
  return log;
}

export interface QuickEntry { name: string; kcal: number; protein_g: number; carbs_g: number | null; fat_g: number | null }

/** A one-time entry: just a name and its numbers, not saved in My foods. */
export async function quickAdd(entry: QuickEntry, opts: { date: string; mealId?: string }): Promise<FoodLog> {
  const past = opts.date < localDate();
  const mealId = opts.mealId ?? (await openMeal(opts.date))?.id ?? (await startMeal(opts.date, { finished: past })).id;
  const lastAt = (await db.food_logs.where('meal_id').equals(mealId).toArray()).reduce((m, l) => (l.created_at > m ? l.created_at : m), '');
  const now = nowIso();
  const [log] = await put('food_logs', {
    date: opts.date, meal_id: mealId, food_id: null, name: entry.name.trim() || 'Quick add', amount: 1, unit: 'serving',
    kcal: Math.round(entry.kcal), protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g,
    created_at: lastAt && lastAt >= now ? new Date(Date.parse(lastAt) + 1).toISOString() : now,
  });
  return log;
}

export const updateQuick = (log: FoodLog, entry: QuickEntry) =>
  patch('food_logs', log.id, { name: entry.name.trim() || 'Quick add', kcal: Math.round(entry.kcal), protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g });

export async function updateLog(log: FoodLog, food: Food | undefined, amount: number, unit: 'g' | 'serving') {
  const n = food ? nutrientsFor(food, amount, unit) : null;
  if (n) return patch('food_logs', log.id, { amount, unit, ...n });
  // The food was deleted: scale what was recorded.
  const k = log.unit === unit && log.amount ? amount / log.amount : 1;
  const sc = (v: number | null) => (v == null ? null : Math.round(v * k * 10) / 10);
  return patch('food_logs', log.id, { amount, unit, kcal: Math.round(log.kcal * k), protein_g: sc(log.protein_g)!, carbs_g: sc(log.carbs_g), fat_g: sc(log.fat_g) });
}

export const deleteLog = (log: FoodLog) => softDelete('food_logs', [log.id]);

export const finishMeal = (meal: Meal, at = nowIso()) => patch('meals', meal.id, { finished_at: at });

export async function setMealTimes(meal: Meal, started: string | null, finished: string | null) {
  await patch('meals', meal.id, { started_at: started, finished_at: finished });
}

export async function deleteMeal(meal: Meal) {
  const logs = (await db.food_logs.where('meal_id').equals(meal.id).toArray()).filter((l) => !l.deleted);
  await softDelete('food_logs', logs.map((l) => l.id));
  await softDelete('meals', [meal.id]);
}

/** Log a saved meal in one tap: starts it now (tap Finish when you're done). */
export async function logSavedMeal(saved: SavedMeal, date: string): Promise<{ meal: Meal; skipped: number }> {
  const past = date < localDate();
  const meal = await startMeal(date, { name: saved.name, finished: past, savedMealId: saved.id });
  let skipped = 0;
  for (const [i, item] of saved.items.entries()) {
    if (!item.food_id) {
      // One-time item saved with its own numbers.
      if (item.kcal == null) { skipped++; continue; }
      await put('food_logs', {
        date, meal_id: meal.id, food_id: null, name: item.name || 'Quick add', amount: item.amount, unit: item.unit,
        kcal: item.kcal, protein_g: item.protein_g ?? 0, carbs_g: item.carbs_g ?? null, fat_g: item.fat_g ?? null, created_at: stamp(i),
      });
      continue;
    }
    const food = await db.foods.get(item.food_id);
    if (!food || food.deleted) { skipped++; continue; }
    const n = nutrientsFor(food, item.amount, item.unit);
    if (!n) { skipped++; continue; }
    await put('food_logs', { date, meal_id: meal.id, food_id: food.id, name: food.name, amount: item.amount, unit: item.unit, ...n, created_at: stamp(i) });
  }
  return { meal, skipped };
}

export async function saveMealAsTemplate(meal: Meal, name: string): Promise<SavedMeal> {
  const logs = (await db.food_logs.where('meal_id').equals(meal.id).toArray()).filter((l) => !l.deleted).sort(byLogged);
  const items: SavedMealItem[] = logs.map((l) => (l.food_id
    ? { food_id: l.food_id, amount: l.amount, unit: l.unit }
    : { food_id: null, amount: l.amount, unit: l.unit, name: l.name, kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g }));
  const [s] = await put('saved_meals', { name, items });
  return s;
}

/** Copy every meal of one day to another, at the same clock times. */
export async function copyDay(from: string, to: string): Promise<number> {
  const meals = await mealsOn(from);
  let n = 0;
  for (const m of meals) {
    const logs = (await db.food_logs.where('meal_id').equals(m.id).toArray()).filter((l) => !l.deleted).sort(byLogged);
    if (!logs.length) continue;
    const started = m.started_at ? onDate(m.started_at, to) : momentOn(to);
    const finished = m.finished_at ? onDate(m.finished_at, to) : new Date(Date.parse(started) + 20 * 60000).toISOString();
    const [copy] = await put('meals', { date: to, name: m.name, started_at: started, finished_at: finished, saved_meal_id: m.saved_meal_id });
    await put('food_logs', ...logs.map((l, i) => ({
      date: to, meal_id: copy.id, food_id: l.food_id, name: l.name, amount: l.amount, unit: l.unit,
      kcal: l.kcal, protein_g: l.protein_g, carbs_g: l.carbs_g, fat_g: l.fat_g, created_at: stamp(i),
    })));
    n++;
  }
  return n;
}

export interface FoodDay { meals: Meal[]; logs: FoodLog[] }

export const useFoodDay = (date: string) => useLive(async (): Promise<FoodDay> => ({
  meals: await mealsOn(date),
  logs: (await db.food_logs.where('date').equals(date).toArray()).filter((l) => !l.deleted).sort(byLogged),
}), [date]);

export const useFoods = () => useLive(async () => (await db.foods.toArray()).filter((f) => !f.deleted).sort((a, b) => a.name.localeCompare(b.name)), []);
export const useSavedMeals = () => useLive(async () => (await db.saved_meals.toArray()).filter((m) => !m.deleted).sort((a, b) => a.name.localeCompare(b.name)), []);

/** Total kcal per day, for the bulk check. */
export async function dailyIntake(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (const l of await db.food_logs.toArray()) if (!l.deleted) m.set(l.date, (m.get(l.date) ?? 0) + l.kcal);
  return m;
}
