import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { db, useLive } from '../db/db';
import { fmtClock, fmtDuration, fmtKg, fmtRir, localDate, PR_LABEL } from '../lib/logic';
import { prEvents, workoutsByDate } from '../lib/stats';
import { useTraining } from '../state/training';
import { deleteWorkout, summarize } from '../state/workout';
import { MonthCalendar, monthLabel } from '../components/Calendar';
import { IconChevron } from '../components/icons';
import { fmtDay, PrRow } from '../components/PrRow';
import { confirmSheet, go, Header, PageTitle } from '../components/ui';

/** Kept across navigation, so coming back from a workout returns to the same month. */
export const historyMonth = signal(localDate().slice(0, 7));

export function HistoryScreen() {
  const data = useTraining();
  const month = historyMonth.value;
  const byDate = useMemo(() => (data ? workoutsByDate(data.workouts) : new Map()), [data]);
  const prCount = useMemo(() => {
    const m = new Map<string, number>();
    if (data) for (const e of prEvents(data.workouts, data.sets)) m.set(e.workoutId, (m.get(e.workoutId) ?? 0) + 1);
    return m;
  }, [data]);
  if (!data) return <div class="page" />;

  const list = data.workouts.filter((w) => localDate(w.started_at).startsWith(month)).reverse();
  const ids = new Set(list.map((w) => w.id));
  const working = data.sets.filter((x) => ids.has(x.workout_id) && !x.is_warmup);
  const perWorkout = new Map<string, { sets: number; volume: number }>();
  for (const x of working) {
    const v = perWorkout.get(x.workout_id) ?? { sets: 0, volume: 0 };
    v.sets++;
    v.volume += x.weight_kg * x.reps;
    perWorkout.set(x.workout_id, v);
  }
  const totalMs = list.reduce((a, w) => a + (w.ended_at ? Date.parse(w.ended_at) - Date.parse(w.started_at) : 0), 0);
  const volume = working.reduce((a, x) => a + x.weight_kg * x.reps, 0);
  const first = data.workouts[0] ? localDate(data.workouts[0].started_at).slice(0, 7) : month;

  return (
    <div class="page">
      <PageTitle title="History" />
      <section class="card">
        <MonthCalendar month={month} onMonth={(m) => (historyMonth.value = m)} byDate={byDate} minMonth={first < month ? first : month} size="large" />
      </section>

      <div class="stat-grid three">
        <div class="stat"><div class="stat-value">{list.length}</div><div class="muted small">Sessions</div></div>
        <div class="stat"><div class="stat-value">{totalMs ? fmtDuration(totalMs).replace(' min', 'm').replace(' h ', 'h ') : '–'}</div><div class="muted small">Time</div></div>
        <div class="stat"><div class="stat-value">{volume ? `${(volume / 1000).toFixed(volume >= 100000 ? 0 : 1)}k` : '–'}</div><div class="muted small">kg lifted</div></div>
      </div>

      <h3 class="section-title">{monthLabel(month)}</h3>
      {!list.length && <p class="empty">No workouts this month.</p>}
      {list.map((w) => {
        const st = perWorkout.get(w.id);
        const prs = prCount.get(w.id) ?? 0;
        return (
          <button key={w.id} class="list-item" onClick={() => go(`/w/${w.id}`)}>
            <span class="day-dot" style={{ background: w.color }}>{w.icon}</span>
            <span class="grow left">
              <span class="block bold">{w.name}</span>
              <span class="block muted small">
                {fmtDay(w.started_at)}
                {w.ended_at && ` · ${fmtDuration(Date.parse(w.ended_at) - Date.parse(w.started_at))}`}
                {` · ${st?.sets ?? 0} sets`}
                {st?.volume ? ` · ${Math.round(st.volume).toLocaleString()} kg` : ''}
              </span>
            </span>
            {prs > 0 && <span class="pr-pill">🏆 {prs}</span>}
            <IconChevron class="muted" />
          </button>
        );
      })}
    </div>
  );
}

/** Every record, newest first, grouped by month. */
export function PrsScreen() {
  const data = useTraining();
  const events = useMemo(() => (data ? prEvents(data.workouts, data.sets) : []), [data]);
  if (!data) return <div class="page" />;
  const byMonth = new Map<string, typeof events>();
  for (const e of events) {
    const k = localDate(e.date).slice(0, 7);
    byMonth.set(k, [...(byMonth.get(k) ?? []), e]);
  }
  return (
    <div class="page">
      <Header title="Personal records" back="/" />
      {!events.length && <p class="empty">No records yet. They start from your second session of an exercise.</p>}
      {[...byMonth].map(([m, list]) => (
        <section key={m}>
          <h3 class="section-title">{monthLabel(m)} · {list.length}</h3>
          <section class="card dash-card">
            {list.map((e) => <PrRow key={`${e.workoutId}-${e.exerciseId}`} e={e} exercise={data.exercises.get(e.exerciseId)} />)}
          </section>
        </section>
      ))}
      <div class="bottom-space" />
    </div>
  );
}

/** Finish summary, also used for viewing past workouts. */
export function WorkoutDetailScreen({ id }: { id: string }) {
  const w = useLive(() => db.workouts.get(id), [id]);
  const s = useLive(() => summarize(id), [id]);
  if (!w || !s) return <div class="page" />;
  return (
    <div class="page">
      <Header title={w.name} back />
      <section class="summary-hero" style={{ '--c': w.color }}>
        <div class="today-icon">{w.icon}</div>
        <div>
          <div class="bold big">{w.status === 'done' ? 'Workout complete' : 'In progress'}</div>
          <div class="muted small">{new Date(w.started_at).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </section>
      <div class="stat-grid">
        <Stat label="Duration" value={fmtDuration(s.durationMs)} />
        <Stat label="Working sets" value={String(s.sets)} />
        <Stat label="Volume" value={`${Math.round(s.volume).toLocaleString()} kg`} />
        <Stat label="Avg rest" value={s.avgRest != null ? fmtClock(s.avgRest) : '–'} />
      </div>

      {s.prs.length > 0 && (
        <section class="card pr-card">
          <div class="bold">🏆 {s.prs.length} personal record{s.prs.length > 1 ? 's' : ''}</div>
          {s.prs.map(({ exercise, set }) => (
            <div key={set.id} class="small">
              {exercise}: {fmtKg(set.weight_kg)} kg × {set.reps} · <span class="muted">{set.pr_types.map((p) => PR_LABEL[p]).join(', ')}</span>
            </div>
          ))}
        </section>
      )}

      {s.perExercise.filter((p) => p.sets.length > 0 || w.status !== 'done').map((p) => (
        <section key={p.we.id} class="card">
          <div class="row between">
            <span class="bold">{p.exercise?.name}</span>
            {p.avgRest != null && <span class="muted small">avg rest {fmtClock(p.avgRest)}</span>}
          </div>
          {p.we.note && <div class="muted small">📝 {p.we.note}</div>}
          {p.sets.length === 0 && <div class="muted small">No sets logged{p.we.skipped ? ' (skipped)' : ''}</div>}
          {p.sets.map((set) => (
            <div key={set.id} class="summary-set">
              <span class="setno-sm">{set.is_warmup ? 'W' : set.set_number - p.sets.filter((x) => x.is_warmup).length}</span>
              <span class="grow">{fmtKg(set.weight_kg)} kg × {set.reps}{!set.is_warmup && <span class="muted"> @ RIR {fmtRir(set.rir)}</span>}</span>
              {set.rest_before_s != null && !set.rest_is_transition && <span class="muted small">{fmtClock(set.rest_before_s)}</span>}
              {set.pr_types?.length > 0 && <span class="pr-badge static">PR</span>}
            </div>
          ))}
        </section>
      ))}

      {w.status === 'done' && s.perExercise.some((p) => !p.sets.length) && (
        <p class="muted small">Not done: {s.perExercise.filter((p) => !p.sets.length).map((p) => p.exercise?.name).join(', ')}</p>
      )}
      <button class="btn primary block" onClick={() => go('/')}>Done</button>
      {w.status === 'done' && (
        <button class="btn ghost block danger-text" onClick={async () => {
          if (await confirmSheet('Delete this workout permanently?', 'Delete', true)) {
            await deleteWorkout(id);
            go('/history');
          }
        }}>Delete workout</button>
      )}
      <div class="bottom-space" />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="stat">
      <div class="stat-value">{value}</div>
      <div class="muted small">{label}</div>
    </div>
  );
}
