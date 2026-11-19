// One exercise: muscles worked (body map), records, estimated-1RM trend, rest and full history.
import { useMemo, useState } from 'preact/hooks';
import { fmtClock, fmtKg, round1 } from '../lib/logic';
import { describeMuscles, resolveMuscles } from '../lib/muscles';
import { e1rmSeries, exerciseSummary, RANGES, rangeBounds, type Range } from '../lib/stats';
import { useTraining } from '../state/training';
import { BodyMap, MuscleLegend } from '../components/BodyMap';
import { ColumnChart, LineChart } from '../components/charts';
import { fmtDay } from '../components/PrRow';
import { go, Header, Segmented } from '../components/ui';

const shortDate = (x: number) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export function ExerciseScreen({ id }: { id: string }) {
  const data = useTraining();
  const [range, setRange] = useState<Range>('All');
  const [showAll, setShowAll] = useState(false);
  const ex = data?.exercises.get(id);
  const summary = useMemo(() => (data ? exerciseSummary(id, data.workouts, data.sets) : null), [data, id]);
  const points = useMemo(() => {
    if (!data) return [];
    const { start } = rangeBounds(range);
    return e1rmSeries(id, data.workouts.filter((w) => !start || w.started_at >= start), data.sets);
  }, [data, id, range]);

  if (!data || !summary) return <div class="page" />;
  if (!ex) return <div class="page"><Header title="Exercise" back /><p class="empty">This exercise no longer exists.</p></div>;

  const muscles = resolveMuscles(ex);
  const d = describeMuscles(muscles);
  const { sessions, bestE1rm, heaviest, repRecords, rest } = summary;
  const weighted = sessions.some((s) => s.sets.some((x) => !x.is_warmup && x.weight_kg > 0));
  const avgRecentRest = rest.length ? Math.round(rest.slice(-5).reduce((a, r) => a + r.value, 0) / Math.min(5, rest.length)) : null;

  return (
    <div class="page">
      <Header title={ex.name} back right={<button class="btn sm" onClick={() => go(`/plan/exercise/${id}`)}>Edit</button>} />

      <section class="card">
        <BodyMap values={muscles} label={`Muscles worked by ${ex.name}`} />
        <MuscleLegend />
        <div class="muscle-lines">
          {d.main.length > 0 && <div><span class="ml-key main" />Main: {d.main.join(', ')}</div>}
          {d.also.length > 0 && <div><span class="ml-key also" />Also: {d.also.join(', ')}</div>}
          {d.minor.length > 0 && <div><span class="ml-key minor" />Minor: {d.minor.join(', ')}</div>}
        </div>
        <div class="muted small center-text">{ex.mechanic} · {ex.equipment}{ex.equipment !== 'dumbbell' ? ` · +${ex.increment_kg} kg steps` : ' · dumbbell rack'}</div>
      </section>

      {!sessions.length ? <p class="empty">Not logged yet. Your records and trend appear after your first session.</p> : (<>
        <div class="stat-grid three">
          <div class="stat"><div class="stat-value">{bestE1rm ? `${fmtKg(round1(bestE1rm.value))}` : '–'}</div><div class="muted small">Best est. 1RM{bestE1rm ? ' kg' : ''}</div></div>
          <div class="stat"><div class="stat-value">{heaviest ? `${fmtKg(heaviest.set.weight_kg)}` : '–'}</div><div class="muted small">Heaviest{heaviest ? ` · ${heaviest.set.reps} reps` : ''}</div></div>
          <div class="stat"><div class="stat-value">{sessions.length}</div><div class="muted small">Sessions · last {fmtDay(sessions[0].workout.started_at)}</div></div>
        </div>

        {weighted && (
          <section class="card dash-card">
            <div class="section-head"><span class="section-head-title" style={{ color: 'var(--orange)' }}>Estimated 1RM</span></div>
            <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
            {points.length > 1 ? (
              <LineChart
                label={`Estimated 1RM, ${ex.name}`}
                color="#45e3c8"
                points={points.map((p) => ({ key: p.workoutId, x: Date.parse(p.date), y: p.value }))}
                formatY={(v) => fmtKg(v)}
                formatX={shortDate}
                tip={(p) => {
                  const s = points.find((q) => q.workoutId === p.key)!;
                  return (<><div class="tip-value">{fmtKg(round1(s.value))} kg</div><div class="tip-sub">{fmtKg(s.weight)} × {s.reps} · {shortDate(Date.parse(s.date))}</div></>);
                }}
                onOpen={(p) => go(`/w/${p.key}`)}
              />
            ) : <p class="empty-note">{points.length ? 'One session in this range. The line appears after the next one.' : 'No sessions in this range.'}</p>}
          </section>
        )}

        <section class="card dash-card">
          <div class="section-head"><span class="section-head-title" style={{ color: 'var(--gold)' }}>Rep records</span><span class="muted small">most reps at each weight</span></div>
          {repRecords.slice(0, 8).map((r) => (
            <button key={r.weight} class="rec-row" onClick={() => go(`/w/${r.workoutId}`)}>
              <span class="bold num">{r.weight > 0 ? `${fmtKg(r.weight)} kg` : 'Bodyweight'}</span>
              <span class="grow" />
              <span class="num">{r.reps} reps</span>
              <span class="muted small rec-date">{fmtDay(r.date)}</span>
            </button>
          ))}
        </section>

        {rest.length > 1 && (
          <section class="card dash-card">
            <div class="section-head"><span class="section-head-title" style={{ color: 'var(--violet)' }}>Rest between sets</span>
              {avgRecentRest != null && <span class="muted small">last 5 sessions: {fmtClock(avgRecentRest)}</span>}</div>
            <ColumnChart
              label={`Average rest between sets, ${ex.name}`}
              color="#7c8cff"
              points={rest.slice(-20).map((r) => ({ key: r.workoutId, x: Date.parse(r.date), y: r.value / 60 }))}
              formatY={(v) => (v === 0 ? '0' : `${round1(v)}m`)}
              formatX={shortDate}
              tip={(p) => { const r = rest.find((q) => q.workoutId === p.key)!; return (<><div class="tip-value">{fmtClock(r.value)}</div><div class="tip-sub">{shortDate(Date.parse(r.date))}</div></>); }}
              onOpen={(p) => go(`/w/${p.key}`)}
            />
          </section>
        )}

        <h3 class="section-title">History</h3>
        {(showAll ? sessions : sessions.slice(0, 8)).map(({ workout, sets, best }) => (
          <button key={workout.id} class="list-item" onClick={() => go(`/w/${workout.id}`)}>
            <span class="day-dot" style={{ background: workout.color }}>{workout.icon}</span>
            <span class="grow left">
              <span class="block bold">{longDate(workout.started_at)}</span>
              <span class="block muted small ellipsis">
                {sets.filter((x) => !x.is_warmup).map((x) => `${fmtKg(x.weight_kg)}×${x.reps}`).join('  ·  ')}
              </span>
            </span>
            {best && best.weight_kg > 0 && <span class="right"><span class="block small num">{fmtKg(round1(best.weight_kg * (1 + best.reps / 30)))} kg</span><span class="block muted small">est. 1RM</span></span>}
          </button>
        ))}
        {!showAll && sessions.length > 8 && <button class="btn ghost block" onClick={() => setShowAll(true)}>Show all {sessions.length} sessions</button>}
      </>)}

      {ex.notes && <section class="card small"><div class="muted">Notes</div>{ex.notes}</section>}
      <div class="bottom-space" />
    </div>
  );
}
