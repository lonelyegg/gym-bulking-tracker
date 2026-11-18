import { signal } from '@preact/signals';
import { db, useLive } from '../db/db';
import { fmtClock } from '../lib/logic';
import { adjustRest, justFired, remaining, stopRest, timer } from '../state/timer';
import { updateSet } from '../state/workout';
import { go, RirPicker } from './ui';

const compact = signal(false);

/** Big countdown shown at the top of the workout screen. Tap it to shrink/expand. */
export function TimerPanel() {
  const t = timer.value;
  const set = useLive(() => (t?.setId ? db.sets.get(t.setId) : Promise.resolve(undefined)), [t?.setId]);
  if (!t) return null;
  const rem = remaining.value;
  const over = rem <= 0;
  const pct = Math.min(100, Math.max(0, (1 - rem / t.duration) * 100));
  return (
    <section class={`timer-panel ${over ? 'over' : ''} ${justFired.value ? 'flash' : ''} ${compact.value ? 'compact' : ''}`}>
      <div class="timer-top" onClick={() => (compact.value = !compact.value)}>
        <div>
          <div class="timer-label">{over ? 'Rest over — go!' : 'Resting'}</div>
          <div class="timer-sub">{t.label}</div>
        </div>
        <div class="timer-clock">{over ? `+${fmtClock(-rem)}` : fmtClock(rem)}</div>
      </div>
      <div class="timer-bar"><div style={{ width: `${pct}%` }} /></div>
      {!compact.value && <div class="timer-actions">
        <button class="btn" onClick={() => adjustRest(-15)}>−15s</button>
        <button class="btn" onClick={stopRest}>{over ? 'Dismiss' : 'Skip'}</button>
        <button class="btn" onClick={() => adjustRest(15)}>+15s</button>
      </div>}
      {!compact.value && set && set.completed_at && !set.is_warmup && (
        <div class="timer-rir">
          <span class="muted small">Reps in reserve, last set</span>
          <RirPicker value={set.rir} onChange={(rir) => updateSet(set, { rir })} />
        </div>
      )}
    </section>
  );
}

/** Persistent mini-bar on other screens while a workout is active. */
export function MiniBar(props: { name: string; icon: string; color: string }) {
  const t = timer.value;
  const rem = remaining.value;
  return (
    <button class="minibar" style={{ borderColor: props.color }} onClick={() => go('/workout')}>
      <span class="minibar-icon" style={{ background: props.color }}>{props.icon}</span>
      <span class="grow left">
        <span class="block bold">{props.name}</span>
        <span class="block muted small">Workout in progress · tap to return</span>
      </span>
      {t && <span class={`minibar-clock ${rem <= 0 ? 'over' : ''}`}>{rem <= 0 ? `+${fmtClock(-rem)}` : fmtClock(rem)}</span>}
    </button>
  );
}
