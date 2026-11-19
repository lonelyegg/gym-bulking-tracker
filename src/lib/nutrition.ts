// Pure food maths: nutrients for an amount, day totals, meal names, ordering foods for quick logging.
import type { Food, FoodLog } from '../db/schema';

export interface Nutrients { kcal: number; protein_g: number; carbs_g: number | null; fat_g: number | null }

export const canUseServings = (f: Pick<Food, 'basis' | 'serving_g'>) => f.basis === 'per_serving' || !!f.serving_g;
export const canUseGrams = (f: Pick<Food, 'basis' | 'serving_g'>) => f.basis === 'per_100g' || !!f.serving_g;

/** How many "nutrition units" (per 100 g or per serving) an amount is. null if the unit doesn't fit the food. */
function factor(f: Pick<Food, 'basis' | 'serving_g'>, amount: number, unit: 'g' | 'serving'): number | null {
  if (f.basis === 'per_100g') {
    if (unit === 'g') return amount / 100;
    return f.serving_g ? (amount * f.serving_g) / 100 : null;
  }
  if (unit === 'serving') return amount;
  return f.serving_g ? amount / f.serving_g : null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function nutrientsFor(f: Pick<Food, 'basis' | 'serving_g' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>, amount: number, unit: 'g' | 'serving'): Nutrients | null {
  const k = factor(f, amount, unit);
  if (k == null || !(amount > 0)) return null;
  return {
    kcal: Math.round(f.kcal * k),
    protein_g: r1(f.protein_g * k),
    carbs_g: f.carbs_g == null ? null : r1(f.carbs_g * k),
    fat_g: f.fat_g == null ? null : r1(f.fat_g * k),
  };
}

export function dayTotals(logs: Pick<FoodLog, 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'deleted'>[]): Nutrients {
  const live = logs.filter((l) => !l.deleted);
  const sum = (k: 'carbs_g' | 'fat_g') => (live.some((l) => l[k] != null) ? r1(live.reduce((a, l) => a + (l[k] ?? 0), 0)) : null);
  return {
    kcal: Math.round(live.reduce((a, l) => a + l.kcal, 0)),
    protein_g: r1(live.reduce((a, l) => a + l.protein_g, 0)),
    carbs_g: sum('carbs_g'),
    fat_g: sum('fat_g'),
  };
}

/** Default meal name from the time it started. */
export function mealNameFor(d: Date): string {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4.5 && h < 10.5) return 'Breakfast';
  if (h >= 11.5 && h < 14.5) return 'Lunch';
  if (h >= 17.5 && h < 21.5) return 'Dinner';
  return 'Snack';
}

/** Recent foods first (last logged), then the rest by how often you log them, then by name. */
export function rankFoods<F extends Pick<Food, 'id' | 'name'>>(
  foods: F[], logs: Pick<FoodLog, 'food_id' | 'created_at' | 'deleted'>[], now = new Date(), recentCount = 6,
): { recent: F[]; others: F[] } {
  const live = logs.filter((l) => !l.deleted).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(foods.map((f) => [f.id, f]));
  const recentIds: string[] = [];
  for (const l of live) {
    if (recentIds.length >= recentCount) break;
    if (byId.has(l.food_id) && !recentIds.includes(l.food_id)) recentIds.push(l.food_id);
  }
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const freq = new Map<string, number>();
  for (const l of live) if (l.created_at >= since) freq.set(l.food_id, (freq.get(l.food_id) ?? 0) + 1);
  const others = foods.filter((f) => !recentIds.includes(f.id))
    .sort((a, b) => (freq.get(b.id) ?? 0) - (freq.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  return { recent: recentIds.map((id) => byId.get(id)!), others };
}

/** Last amount you logged of this food, or a sensible default. */
export function defaultAmount(f: Pick<Food, 'basis' | 'serving_g'>, last?: Pick<FoodLog, 'amount' | 'unit'>): { amount: number; unit: 'g' | 'serving' } {
  if (last && (last.unit === 'g' ? canUseGrams(f) : canUseServings(f))) return { amount: last.amount, unit: last.unit };
  if (f.basis === 'per_serving') return { amount: 1, unit: 'serving' };
  return { amount: f.serving_g ?? 100, unit: 'g' };
}

export const proteinTarget = (weightKg: number | null, gPerKg: number) => (weightKg ? Math.round(weightKg * gPerKg) : null);
