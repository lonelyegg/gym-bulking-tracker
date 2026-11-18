import { db, useLive } from '../db/db';
import { fmtClock, fmtDuration, fmtKg, fmtRir, PR_LABEL } from '../lib/logic';
import { deleteWorkout, doneWorkouts, summarize } from '../state/workout';
import { confirmSheet, go, Header } from '../components/ui';

export function HistoryScreen() {
  const workouts = useLive(doneWorkouts, []);
  const stats = useLive(async () => {
    const m: Record<string, { sets: number; prs: number }> = {};
    for (const s of await db.sets.toArray()) {
      if (s.deleted || !s.completed_at || s.is_warmup) continue;
      const x = (m[s.workout_id] ??= { sets: 0, prs: 0 });
      x.sets++;
      if (s.pr_types?.length) x.prs++;
    }
    return m;
  }, []) ?? {};

  if (!workouts) return <div class="page" />;
  const byMonth = new Map<string, typeof workouts>();
  for (const w of workouts) {
    const k = new Date(w.started_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    byMonth.set(k, [...(byMonth.get(k) ?? []), w]);
  }
  return (
    <div class="page">
      <Header title="History" />
      {!workouts.length && <p class="empty">No finished workouts yet.</p>}
      {[...byMonth].map(([month, list]) => (
        <section key={month}>
          <h3 class="section-title">{month}</h3>
          {list.map((w) => (
            <button key={w.id} class="list-item" onClick={() => go(`/w/${w.id}`)}>
              <span class="day-dot" style={{ background: w.color }}>{w.icon}</span>
              <span class="grow left">
                <span class="block bold">{w.name}</span>
                <span class="block muted small">
                  {new Date(w.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                  {w.ended_at && ` · ${fmtDuration(Date.parse(w.ended_at) - Date.parse(w.started_at))}`}
                  {` · ${stats[w.id]?.sets ?? 0} sets`}
                </span>
              </span>
              {(stats[w.id]?.prs ?? 0) > 0 && <span class="pr-pill">🏆 {stats[w.id].prs}</span>}
            </button>
          ))}
        </section>
      ))}
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
      <Header title={w.name} back="/" />
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
