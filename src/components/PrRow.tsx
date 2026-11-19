import type { Exercise } from '../db/schema';
import { fmtKg, round1 } from '../lib/logic';
import type { PrEvent } from '../lib/stats';
import { IconTrophy } from './icons';
import { go } from './ui';

/** "Today", "Yesterday", "Mon", or "12 Nov". */
export function fmtDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function prSummary(e: PrEvent) {
  if (e.kind === 'reps') {
    const gain = e.value - e.previous;
    return { value: `${e.reps} reps`, what: e.weight > 0 ? `at ${fmtKg(e.weight)} kg` : 'bodyweight', delta: `+${gain} rep${gain === 1 ? '' : 's'}` };
  }
  const gain = round1(e.value - e.previous);
  return {
    value: `${fmtKg(round1(e.value))} kg`,
    what: e.kind === 'e1rm' ? `est. 1RM · ${fmtKg(e.weight)} × ${e.reps}` : 'heaviest weight',
    delta: `+${fmtKg(gain)} kg`,
  };
}

export function PrRow({ e, exercise }: { e: PrEvent; exercise: Exercise | undefined }) {
  const p = prSummary(e);
  return (
    <button class="pr-row" onClick={() => go(`/w/${e.workoutId}`)}>
      <span class="pr-icon"><IconTrophy size={18} /></span>
      <span class="grow left">
        <span class="block bold ellipsis">{exercise?.name ?? 'Exercise'}</span>
        <span class="block muted small ellipsis">{p.what}</span>
      </span>
      <span class="right">
        <span class="block bold num">{p.value}</span>
        <span class="block small"><span class="delta-up">▲ {p.delta.slice(1)}</span> · <span class="muted">{fmtDay(e.date)}</span></span>
      </span>
    </button>
  );
}
