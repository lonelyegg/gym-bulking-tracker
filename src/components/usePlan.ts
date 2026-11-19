// The upcoming days of your active split, projected from what you've actually done.
import { db, useLive } from '../db/db';
import { localDate } from '../lib/logic';
import { addDays, addMonths, plannedDays, type W } from '../lib/stats';
import { settings } from '../state/settings';

export type PlanCell = { kind: 'workout'; name: string; icon: string; color: string } | { kind: 'rest' };

export function usePlan(workouts: W[] | undefined): Map<string, PlanCell> {
  const splitId = settings.value.active_split_id;
  const split = useLive(async () => (splitId ? (await db.splits.get(splitId)) ?? null : null), [splitId]);
  const dayTypes = useLive(() => db.day_types.toArray(), []);
  const out = new Map<string, PlanCell>();
  if (!workouts || !split || split.deleted || !dayTypes) return out;

  const today = localDate();
  const counted = [...workouts].reverse().find((w) => w.split_id === split.id && w.rotation_index != null);
  const last = counted ? { rotation_index: counted.rotation_index!, date: localDate(counted.started_at) } : null;
  // If you've already trained today, the plan starts tomorrow.
  const trainedToday = workouts.some((w) => localDate(w.started_at) === today);
  const start = trainedToday ? addDays(today, 1) : today;
  const until = addDays(`${addMonths(today.slice(0, 7), 2)}-01`, -1); // end of next month
  const byId = new Map(dayTypes.map((d) => [d.id, d]));
  for (const [date, p] of plannedDays(split, last, start, until)) {
    if (p.kind === 'rest') out.set(date, { kind: 'rest' });
    else {
      const d = byId.get(p.dayTypeId);
      if (d && !d.deleted) out.set(date, { kind: 'workout', name: d.name, icon: d.icon, color: d.color });
    }
  }
  return out;
}
