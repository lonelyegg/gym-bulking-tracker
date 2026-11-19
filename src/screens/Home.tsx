import { useState } from 'preact/hooks';
import { alive, db, getLocal, setLocal, useLive } from '../db/db';
import type { DayType } from '../db/schema';
import { fmtDuration, localDate, weekStart } from '../lib/logic';
import { settings } from '../state/settings';
import { computeNextUp, doneWorkouts, getActiveWorkout, startWorkout } from '../state/workout';
import { go, Sheet } from '../components/ui';
import { isConfigured } from '../sync/sync';
import { SyncChip } from './SyncSettings';

export function HomeScreen() {
  const active = useLive(async () => (await getActiveWorkout()) ?? null, []);
  const nextUp = useLive(computeNextUp, [settings.value.active_split_id]);
  const dayTypes = useLive(async () => (await db.day_types.toArray()).filter((d) => !d.deleted), []) ?? [];
  const split = useLive(async () => (settings.value.active_split_id ? db.splits.get(settings.value.active_split_id) : undefined), [settings.value.active_split_id]);
  const workouts = useLive(doneWorkouts, []) ?? [];
  const tplCounts = useLive(async () => {
    const m: Record<string, number> = {};
    for (const t of await db.template_exercises.toArray()) if (!t.deleted) m[t.day_type_id] = (m[t.day_type_id] ?? 0) + 1;
    return m;
  }, []) ?? {};
  const [choose, setChoose] = useState(false);
  const lastBackup = useLive(() => getLocal<string>('last_backup_at', ''), []);
  const snoozeUntil = useLive(() => getLocal<string>('backup_nudge_until', ''), []);
  const [snoozed, setSnoozed] = useState(false);
  const needsBackup = lastBackup !== undefined && snoozeUntil !== undefined && !snoozed && !isConfigured()
    && workouts.length >= 3
    && (!lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 86400000)
    && (!snoozeUntil || Date.now() > Date.parse(snoozeUntil));

  const dt = (id?: string) => dayTypes.find((d) => d.id === id);
  const start = async (dayTypeId: string | null, suggestedIndex?: number) => {
    await startWorkout(dayTypeId, { suggestedIndex });
    go('/workout');
  };

  const ws = weekStart();
  const thisWeek = workouts.filter((w) => localDate(w.started_at) >= ws).length;
  const target = settings.value.weekly_target;
  const last = workouts[0];

  const next = nextUp?.next;
  let card;
  if (active === undefined || nextUp === undefined) {
    card = <div class="today-card placeholder" />;
  } else if (active) {
    card = (
      <div class="today-card" style={{ '--c': active.color }}>
        <div class="today-icon">{active.icon}</div>
        <div class="grow">
          <div class="muted small">In progress</div>
          <div class="today-name">{active.name}</div>
        </div>
        <button class="btn primary lg" onClick={() => go('/workout')}>Resume</button>
      </div>
    );
  } else if (next?.kind === 'workout' || next?.kind === 'rest') {
    const isRest = next.kind === 'rest';
    const d = dt(next.kind === 'workout' ? next.dayTypeId : next.nextDayTypeId);
    const idx = next.kind === 'workout' ? next.index : next.nextIndex;
    card = (
      <div class="today-card" style={{ '--c': d?.color ?? '#8b93a7' }}>
        <div class="today-icon">{isRest ? '😴' : d?.icon}</div>
        <div class="grow">
          <div class="muted small">
            {isRest ? 'Rest day — recover and eat' : next.kind === 'workout' && next.trainedToday ? 'Trained today ✓ · next up' : 'Today'}
          </div>
          <div class="today-name">{isRest ? `Next: ${d?.name ?? ''}` : d?.name}</div>
          <div class="muted small">{tplCounts[d?.id ?? ''] ?? 0} exercises · {split?.name}</div>
        </div>
        <button class={`btn lg ${isRest ? '' : 'primary'}`} onClick={() => start(d?.id ?? null, idx)}>
          {isRest ? 'Train anyway' : 'Start'}
        </button>
      </div>
    );
  } else {
    card = (
      <div class="today-card">
        <div class="grow">
          <div class="today-name">No split selected</div>
          <div class="muted small">Pick one in Plan, or start an empty workout.</div>
        </div>
        <button class="btn primary lg" onClick={() => start(null)}>Start</button>
      </div>
    );
  }

  return (
    <div class="page">
      <header class="home-head">
        <div class="row between">
          <div class="muted small">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <SyncChip />
        </div>
        <h1>Let's grow 💪</h1>
      </header>

      {card}
      {!active && <button class="btn ghost block" onClick={() => setChoose(true)}>Choose a different workout</button>}

      {needsBackup && (
        <section class="card warn-card">
          <div class="bold">Back up your training log</div>
          <div class="small">It only exists on this phone. Connect your Google Sheet, or export a backup file.</div>
          <div class="row gap mt">
            <button class="btn sm primary" onClick={() => go('/settings')}>Set up backup</button>
            <button class="btn sm ghost" onClick={async () => {
              setSnoozed(true);
              await setLocal('backup_nudge_until', new Date(Date.now() + 7 * 86400000).toISOString());
            }}>Not now</button>
          </div>
        </section>
      )}

      <section class="card">
        <div class="row between">
          <span class="bold">This week</span>
          <span class={thisWeek >= target ? 'good bold' : 'bold'}>{thisWeek} / {target} sessions</span>
        </div>
        <div class="week-dots">
          {Array.from({ length: Math.max(target, thisWeek) }, (_, i) => (
            <span key={i} class={`week-dot ${i < thisWeek ? 'on' : ''}`} />
          ))}
        </div>
      </section>

      {last && (
        <section class="card tap" onClick={() => go(`/w/${last.id}`)}>
          <div class="muted small">Last workout</div>
          <div class="row gap center">
            <span class="day-dot" style={{ background: last.color }}>{last.icon}</span>
            <span class="grow">
              <span class="block bold">{last.name}</span>
              <span class="block muted small">
                {new Date(last.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                {last.ended_at && ` · ${fmtDuration(Date.parse(last.ended_at) - Date.parse(last.started_at))}`}
              </span>
            </span>
            <span class="muted">›</span>
          </div>
        </section>
      )}

      <p class="muted small center-text">The dashboard (calendar, PRs, strength charts) arrives in Phase 3.</p>

      <Sheet open={choose} onClose={() => setChoose(false)} title="Start a workout">
        <div class="menu-list">
          {orderedDayTypes(dayTypes, split?.rotation).map((d) => (
            <button key={d.id} onClick={() => { setChoose(false); start(d.id, next && next.kind !== 'empty' ? next.index : 0); }}>
              <span class="day-dot" style={{ background: d.color }}>{d.icon}</span> {d.name}
              <span class="muted small"> · {tplCounts[d.id] ?? 0} exercises</span>
            </button>
          ))}
          <button onClick={() => { setChoose(false); start(null); }}>➕ Empty workout</button>
        </div>
      </Sheet>
    </div>
  );
}

/** Day types in the active split first, then the rest alphabetically. */
function orderedDayTypes(all: DayType[], rotation: string[] | undefined): DayType[] {
  const inSplit = [...new Set(rotation ?? [])].map((id) => all.find((d) => d.id === id)).filter(alive);
  const others = all.filter((d) => !inSplit.includes(d)).sort((a, b) => a.name.localeCompare(b.name));
  return [...inSplit, ...others];
}
