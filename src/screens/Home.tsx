import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { db, getLocal, setLocal, useLive } from '../db/db';
import { fmtClock, fmtDuration, fmtKg, localDate, round1 } from '../lib/logic';
import { DAY_STYLE, LIFT_SHORT } from '../lib/program';
import { programActive, startProgramWorkout, useProgram } from '../state/program';
import {
  averageRest, e1rmSeries, liftOptions, muscleSets, prEvents, RANGES, restByExercise, restBySession, splitByRange,
  weeklyStreak, workoutsByDate, type Range,
} from '../lib/stats';
import { MUSCLES, resolveMuscles, type Muscle } from '../lib/muscles';
import { BodyMap } from '../components/BodyMap';
import { StartSheet } from '../components/StartSheet';
import { usePlan } from '../components/usePlan';
import { settings } from '../state/settings';
import { useTraining, type TrainingData } from '../state/training';
import { computeNextUp, getActiveWorkout, startWorkout } from '../state/workout';
import { MonthCalendar } from '../components/Calendar';
import { ColumnChart, LineChart } from '../components/charts';
import { IconGear, IconMoon, IconScale } from '../components/icons';
import { IconDumbbell, IconFlame, IconPlay, IconTimer, IconTrend, IconTrophy } from '../components/icons';
import { fmtDay, PrRow } from '../components/PrRow';
import { go, PageTitle, Section, Segmented } from '../components/ui';
import { isConfigured } from '../sync/sync';
import { SyncChip } from './SyncSettings';
import { MeasurementsCard, WeighInCard, weightSeries } from './Body';
import { PhotoCompareCard } from './Photos';
import { BulkCheckView, FoodBars, useBulkCheck } from '../components/nutrition';
import { WeightChart } from '../components/charts';
import { useBody } from '../state/body';
import { weekAverage } from '../lib/body';
import { historyMonth } from './History';

/** Calendar month on Home; kept while you open a workout and come back. */
const homeMonth = signal(localDate().slice(0, 7));

// Category colours for the card headers (text and icons only, never chart data).
const TONE = { consistency: 'var(--accent)', prs: 'var(--gold)', muscles: '#ff6b6d', strength: 'var(--orange)', rest: 'var(--violet)' };
// Chart series colours (single series each; contrast-checked against the card surface).
const CHART = { strength: '#45e3c8', rest: '#7c8cff' };

const remember = <T extends string>(key: string, fallback: T): T => {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
};
const store = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };

export function HomeScreen() {
  const data = useTraining();
  const lastBackup = useLive(() => getLocal<string>('last_backup_at', ''), []);
  const snoozeUntil = useLive(() => getLocal<string>('backup_nudge_until', ''), []);
  const [snoozed, setSnoozed] = useState(false);
  const needsBackup = !!data && lastBackup !== undefined && snoozeUntil !== undefined && !snoozed && !isConfigured()
    && data.workouts.length >= 3
    && (!lastBackup || Date.now() - Date.parse(lastBackup) > 14 * 86400000)
    && (!snoozeUntil || Date.now() > Date.parse(snoozeUntil));

  return (
    <div class="page">
      <PageTitle
        sub={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
        title="Today"
        right={<div class="row gap-sm"><SyncChip /><button class="icon-btn sm gear" aria-label="Settings" onClick={() => go('/settings')}><IconGear size={20} /></button></div>}
      />
      <TodayCard data={data} />

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

      {data && <Consistency data={data} />}
      {data && <RecentPrs data={data} />}
      {data && <MuscleVolume data={data} />}
      {data && <Trends data={data} />}
      <BodyweightCard />
      <HomeMeasurements />
      <PhotoCompareCard />
      <div class="bottom-space" />
    </div>
  );
}

// ---------- 1. Today ----------

function TodayCard({ data }: { data: TrainingData | undefined }) {
  const active = useLive(async () => (await getActiveWorkout()) ?? null, []);
  const nextUp = useLive(computeNextUp, [settings.value.active_split_id, data?.workouts.length]);
  const dayTypes = useLive(async () => (await db.day_types.toArray()).filter((d) => !d.deleted), []) ?? [];
  const tplCounts = useLive(async () => {
    const m: Record<string, number> = {};
    for (const t of await db.template_exercises.toArray()) if (!t.deleted) m[t.day_type_id] = (m[t.day_type_id] ?? 0) + 1;
    return m;
  }, []) ?? {};
  const [choose, setChoose] = useState(false);

  const start = async (dayTypeId: string | null, suggestedIndex?: number) => {
    await startWorkout(dayTypeId, { suggestedIndex });
    go('/workout');
  };

  if (active === undefined || nextUp === undefined) return <div class="today-card placeholder" />;

  if (active) {
    return (
      <div class="today-card" style={{ '--c': active.color }}>
        <div class="today-top">
          <span class="today-kicker live">{active.backfill ? '● Logging a past workout' : '● In progress'}</span>
        </div>
        <div class="today-main">
          <div class="today-icon">{active.icon}</div>
          <div class="grow">
            <div class="today-name">{active.name}</div>
            <div class="muted small">{active.backfill
              ? `For ${fmtDay(active.started_at)}`
              : `Started ${new Date(active.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}</div>
          </div>
        </div>
        <button class="btn primary block lg" onClick={() => go('/workout')}><IconPlay /> {active.backfill ? 'Continue logging' : 'Resume workout'}</button>
        <TodayFood />
      </div>
    );
  }

  if (programActive()) return <ProgramToday />;

  const next = nextUp.next;
  const dt = (id?: string) => dayTypes.find((d) => d.id === id);
  const isRest = next.kind === 'rest';
  const d = next.kind === 'workout' ? dt(next.dayTypeId) : next.kind === 'rest' ? dt(next.nextDayTypeId) : undefined;
  const idx = next.kind === 'workout' ? next.index : next.kind === 'rest' ? next.nextIndex : undefined;
  const last = d && data ? [...data.workouts].reverse().find((w) => w.day_type_id === d.id) : undefined;
  const when = next.kind !== 'empty' && next.date && next.date !== localDate() ? ` · ${fmtDay(next.date)}` : '';
  const kicker = next.kind === 'empty' ? 'No split selected'
    : isRest ? `Rest day · recover and eat`
      : next.trainedToday ? `Trained today ✓ · up next${when}` : 'Today’s workout';

  return (
    <div class="today-card" style={{ '--c': d?.color ?? '#8a919e' }}>
      <div class="today-top">
        <span class="today-kicker">{kicker}</span>
        <button class="today-change" onClick={() => setChoose(true)}>Change</button>
      </div>
      {d ? (
        <div class="today-main">
          <div class="today-icon">{isRest ? <IconMoon size={28} /> : d.icon}</div>
          <div class="grow">
            <div class="today-name">{isRest ? `Next: ${d.name}` : d.name}</div>
            {isRest && when && <div class="muted small">{when.slice(3)}</div>}
            <div class="muted small">
              {tplCounts[d.id] ?? 0} exercises
              {last && ` · last ${fmtDay(last.started_at)}`}
              {last?.ended_at && ` · ${fmtDuration(Date.parse(last.ended_at) - Date.parse(last.started_at))}`}
            </div>
          </div>
        </div>
      ) : (
        <div class="today-main"><div class="muted">Pick a split in Plan, or start an empty workout.</div></div>
      )}
      <button class={`btn block lg ${isRest ? '' : 'primary'}`} onClick={() => start(d?.id ?? null, idx)}>
        {!isRest && <IconPlay />}{isRest ? 'Train anyway' : d ? `Start ${d.name}` : 'Start empty workout'}
      </button>

      <TodayFood />
      <StartSheet open={choose} onClose={() => setChoose(false)} />
    </div>
  );
}

/** Today card when the 5×5 program is your plan. */
function ProgramToday() {
  const p = useProgram();
  const [choose, setChoose] = useState(false);
  if (!p) return <div class="today-card placeholder" />;
  const { next, state } = p;
  const today = localDate();
  const isToday = next.date === today;
  const style = DAY_STYLE[next.day];
  const kicker = isToday ? '5×5 · Today’s workout' : state.lastDate === today ? `Trained today ✓ · next ${fmtDay(next.date)}` : `Rest day · next ${fmtDay(next.date)}`;
  const start = async (day: 'A' | 'B') => { await startProgramWorkout(day); go('/workout'); };
  return (
    <div class="today-card" style={{ '--c': style.color }}>
      <div class="today-top">
        <span class="today-kicker">{kicker}</span>
        <button class="today-change" onClick={() => setChoose(true)}>Change</button>
      </div>
      <div class="today-main">
        <div class="today-icon">{style.icon}</div>
        <button class="grow left plain" onClick={() => go('/program')}>
          <div class="today-name">Workout {next.day}</div>
          <div class="muted small">{next.lifts.map((l) => `${LIFT_SHORT[l.lift]} ${fmtKg(l.weight)}`).join(' · ')} kg ›</div>
        </button>
      </div>
      {next.afterBreak && <p class="small warn-text">Back after a week off: weights are 10% lighter today.</p>}
      <button class={`btn block lg ${isToday ? 'primary' : ''}`} onClick={() => start(next.day)}>
        {isToday && <IconPlay />}{isToday ? `Start Workout ${next.day}` : 'Train anyway'}
      </button>
      <TodayFood />
      <StartSheet open={choose} onClose={() => setChoose(false)} />
    </div>
  );
}

function TodayFood() {
  return (
    <button class="today-food" onClick={() => go('/food')} aria-label="Today's food, open the food log">
      <FoodBars compact />
    </button>
  );
}

// ---------- 2. Consistency ----------

function Ring({ value, max }: { value: number; max: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / Math.max(1, max));
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--surface-3)" stroke-width="5" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"
        stroke-dasharray={`${c * pct} ${c}`} transform="rotate(-90 22 22)" />
    </svg>
  );
}

function Consistency({ data }: { data: TrainingData }) {
  const today = localDate();
  const month = homeMonth.value;
  const setMonth = (m: string) => { homeMonth.value = m; };
  const byDate = useMemo(() => workoutsByDate(data.workouts), [data]);
  const plan = usePlan(data.workouts);
  const dates = data.workouts.map((w) => localDate(w.started_at));
  const target = settings.value.weekly_target;
  const streak = weeklyStreak(dates, target, today);
  const inMonth = dates.filter((d) => d.startsWith(month)).length;
  const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: 'long' });

  return (
    <Section title="Consistency" icon={<IconFlame size={16} />} tone={TONE.consistency} more="History" onMore={() => { historyMonth.value = month; go('/history'); }}>
      <div class="tiles">
        <div class="tile">
          <div class="ring-wrap"><Ring value={streak.thisWeek} max={target} /></div>
          <div><div class="tile-value">{streak.thisWeek}<span class="tile-unit">/{target}</span></div><div class="tile-label">This week</div></div>
        </div>
        <div class="tile">
          <div><div class="tile-value">{streak.current}<span class="tile-unit"> wk{streak.current === 1 ? '' : 's'}</span></div>
            <div class="tile-label">Streak{streak.best > streak.current ? ` · best ${streak.best}` : ''}</div></div>
        </div>
        <div class="tile">
          <div><div class="tile-value">{inMonth}</div><div class="tile-label">In {monthName}</div></div>
        </div>
      </div>
      <MonthCalendar month={month} onMonth={setMonth} byDate={byDate} plan={plan} minMonth={dates[0]?.slice(0, 7) ?? today.slice(0, 7)} />
      <p class="fine">Faded days are your plan; it reshuffles if you skip or swap a day. Tap a day to open it, or a past empty day to log a missed workout. Streak = weeks in a row with {target}+ session{target === 1 ? '' : 's'}.</p>
    </Section>
  );
}

// ---------- 3. Recent PRs ----------

function RecentPrs({ data }: { data: TrainingData }) {
  const events = useMemo(() => prEvents(data.workouts, data.sets), [data]);
  return (
    <Section title="Recent PRs" icon={<IconTrophy size={16} />} tone={TONE.prs} more={events.length ? 'All' : undefined} onMore={events.length ? () => go('/prs') : undefined}>
      {events.length === 0
        ? <p class="empty-note">Records show up here from your second session of an exercise: heaviest weight, best estimated 1RM, or more reps at a weight.</p>
        : events.slice(0, 4).map((e) => <PrRow key={`${e.workoutId}-${e.exerciseId}`} e={e} exercise={data.exercises.get(e.exerciseId)} />)}
    </Section>
  );
}

// ---------- 3b. Muscles this week ----------

const WEEKLY_FULL = 10; // sets per week that show as full red

function MuscleVolume({ data }: { data: TrainingData }) {
  const sets = useMemo(() => muscleSets(data.workouts, data.sets, data.exercises), [data]);
  const [sel, setSel] = useState<Muscle | null>(null);
  const contributors = useMemo(() => {
    if (!sel) return [];
    const from = new Date(Date.now() - 7 * 86400000).toISOString();
    const recent = new Set(data.workouts.filter((w) => w.started_at >= from).map((w) => w.id));
    const names = new Map<string, number>();
    for (const s of data.sets) {
      if (s.is_warmup || !recent.has(s.workout_id)) continue;
      const w = resolveMuscles(data.exercises.get(s.exercise_id))[sel] ?? 0;
      if (w >= 0.5) names.set(s.exercise_id, (names.get(s.exercise_id) ?? 0) + 1);
    }
    return [...names].map(([id, n]) => `${data.exercises.get(id)?.name ?? 'Exercise'} ×${n}`);
  }, [sel, data]);
  const fmt = (n: number) => (Math.round(n * 2) / 2).toString();
  if (!data.workouts.length) return null;

  return (
    <Section title="Muscles · last 7 days" icon={<IconDumbbell size={16} />} tone={TONE.muscles}>
      <BodyMap values={sets} max={WEEKLY_FULL} label="Working sets per muscle in the last 7 days" onTap={(m) => setSel(sel === m ? null : m)} selected={sel} />
      <div class="bm-scale"><span>0</span><i /><span>{WEEKLY_FULL}+ sets</span></div>
      {sel && (
        <div class="muscle-pick">
          <b>{MUSCLES.find((m) => m.id === sel)?.label}: {fmt(sets[sel] ?? 0)} sets</b>
          <span class="muted small">{contributors.length ? contributors.join(' · ') : 'Not trained in the last 7 days.'}</span>
        </div>
      )}
      <div class="mv-grid">
        {MUSCLES.map((m) => {
          const v = sets[m.id] ?? 0;
          return (
            <button key={m.id} class={`mv-row ${sel === m.id ? 'sel' : ''}`} onClick={() => setSel(sel === m.id ? null : m.id)}>
              <span class={`grow left ${v ? '' : 'muted'}`}>{m.label}</span>
              <span class={`num ${v ? 'bold' : 'muted'}`}>{fmt(v)}</span>
            </button>
          );
        })}
      </div>
      <p class="fine">Sets for each muscle's main exercises count fully; muscles that are only partly worked count half. Many lifters aim for about 10–20 sets per muscle per week when building size.</p>
    </Section>
  );
}

// ---------- 4. Strength + rest trends ----------

function Trends({ data }: { data: TrainingData }) {
  const [range, setRange] = useState<Range>(() => remember<Range>('dash-range', '3M'));
  const slice = useMemo(() => splitByRange(data.workouts, data.sets, range), [data, range]);
  if (!data.workouts.length) return null;
  return (
    <>
      <div class="trends-head">
        <h2 class="trends-title">Trends</h2>
        <Segmented label="Time range" value={range} options={RANGES} onChange={(r) => { setRange(r); store('dash-range', r); }} />
      </div>
      <Strength data={data} slice={slice} range={range} />
      <Rest data={data} slice={slice} range={range} />
    </>
  );
}

const shortDate = (x: number) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const periodName: Record<Range, string> = { '1M': 'month', '3M': '3 months', '6M': '6 months', '1Y': 'year', All: '' };

type Slice = ReturnType<typeof splitByRange>;

function Strength({ data, slice, range }: { data: TrainingData; slice: Slice; range: Range }) {
  const lifts = useMemo(() => liftOptions(data.sets, data.exercises), [data]);
  const [chosen, setChosen] = useState<string>(() => remember<string>('dash-lift', ''));
  const lift = lifts.find((l) => l.exerciseId === chosen)?.exerciseId ?? lifts[0]?.exerciseId;
  const points = useMemo(() => (lift ? e1rmSeries(lift, slice.workouts, slice.sets) : []), [lift, slice]);
  const name = (id: string) => data.exercises.get(id)?.name ?? 'Exercise';

  if (!lifts.length) {
    return (
      <Section title="Strength" icon={<IconTrend size={16} />} tone={TONE.strength}>
        <p class="empty-note">Your estimated 1RM per lift appears here once you log weighted sets.</p>
      </Section>
    );
  }
  const latest = points[points.length - 1];
  const first = points[0];
  const gain = points.length > 1 ? round1(latest.value - first.value) : null;

  return (
    <Section title="Strength" icon={<IconTrend size={16} />} tone={TONE.strength}>
      <div class="chips scroll-x lift-chips">
        {lifts.map((l) => (
          <button key={l.exerciseId} class={`chip ${l.exerciseId === lift ? 'on' : ''}`}
            onClick={() => { setChosen(l.exerciseId); store('dash-lift', l.exerciseId); }}>{name(l.exerciseId)}</button>
        ))}
      </div>
      {latest ? (
        <>
          <div class="hero">
            <span class="hero-value">{fmtKg(round1(latest.value))}</span><span class="hero-unit">kg</span>
          </div>
          <div class="hero-sub">
            Est. 1RM · {name(lift!)}
            {gain != null && (
              <span class={gain > 0 ? 'delta-up' : gain < 0 ? 'delta-down' : 'muted'}>
                {' · '}{gain === 0 ? 'no change' : `${gain > 0 ? '▲' : '▼'} ${fmtKg(Math.abs(gain))} kg`} since {shortDate(Date.parse(first.date))}
              </span>
            )}
          </div>
          {points.length > 1 ? (
            <LineChart
              key={lift}
              label={`Estimated 1RM, ${name(lift!)}`}
              color={CHART.strength}
              points={points.map((p) => ({ key: p.workoutId, x: Date.parse(p.date), y: p.value }))}
              formatY={(v) => fmtKg(v)}
              formatX={shortDate}
              tip={(p) => {
                const s = points.find((q) => q.workoutId === p.key)!;
                return (<>
                  <div class="tip-value">{fmtKg(round1(s.value))} kg</div>
                  <div class="tip-sub">{fmtKg(s.weight)} × {s.reps} · {longDate(s.date)}</div>
                </>);
              }}
              onOpen={(p) => go(`/w/${p.key}`)}
            />
          ) : <p class="empty-note">One session in this period. The line appears after your next one.</p>}
        </>
      ) : <p class="empty-note">No {name(lift!)} sessions in the last {periodName[range]}. Try a longer range.</p>}
      <button class="card-link" onClick={() => go(`/exercise/${lift}`)}>{name(lift!)}: records, muscles &amp; history<span class="chev">›</span></button>
    </Section>
  );
}

function Rest({ data, slice, range }: { data: TrainingData; slice: Slice; range: Range }) {
  const sessions = useMemo(() => restBySession(slice.workouts, slice.sets).slice(-20), [slice]);
  const avg = averageRest(slice.sets);
  const prev = range === 'All' ? null : averageRest(slice.prevSets);
  const perExercise = useMemo(() => restByExercise(slice.sets, slice.prevSets), [slice]);
  const diff = avg != null && prev != null ? avg - prev : null;

  return (
    <Section title="Rest" icon={<IconTimer size={16} />} tone={TONE.rest}>
      {avg == null ? <p class="empty-note">Average rest between your sets shows here after a workout or two.</p> : (
        <>
          <div class="hero"><span class="hero-value">{fmtClock(avg)}</span><span class="hero-unit">avg</span></div>
          <div class="hero-sub">
            Working rest between sets
            {diff != null && Math.abs(diff) >= 1 && <span class="muted"> · {Math.abs(diff)}s {diff < 0 ? 'shorter' : 'longer'} than the {periodName[range]} before</span>}
          </div>
          {sessions.length > 1 && (
            <ColumnChart
              label="Average working rest per session"
              color={CHART.rest}
              points={sessions.map((s) => ({ key: s.workoutId, x: Date.parse(s.date), y: s.value / 60 }))}
              formatY={(v) => (v === 0 ? '0' : `${round1(v)}m`)}
              formatX={shortDate}
              tip={(p) => {
                const s = sessions.find((q) => q.workoutId === p.key)!;
                return (<>
                  <div class="tip-value">{fmtClock(s.value)}</div>
                  <div class="tip-sub">{s.icon} {s.name} · {longDate(s.date)}</div>
                </>);
              }}
              onOpen={(p) => go(`/w/${p.key}`)}
            />
          )}
          {perExercise.length > 0 && (
            <div class="rest-list">
              {perExercise.map((r) => {
                const d = r.previous != null ? r.avg - r.previous : null;
                return (
                  <div key={r.exerciseId} class="rest-row">
                    <span class="grow ellipsis">{data.exercises.get(r.exerciseId)?.name ?? 'Exercise'}</span>
                    {d != null && Math.abs(d) >= 5 && <span class="muted small">{d > 0 ? '▲' : '▼'} {Math.abs(d)}s</span>}
                    <span class="bold num">{fmtClock(r.avg)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ---------- 5. Bodyweight ----------

function BodyweightCard() {
  const body = useBody();
  const check = useBulkCheck();
  if (!body) return null;
  const pts = weightSeries(body, '3M');
  const today = localDate();
  const loggedToday = body.weights.some((w) => w.date === today && w.weight_kg != null);
  const avg = weekAverage(body.weights.filter((w) => w.weight_kg != null).map((w) => ({ date: w.date, kg: w.weight_kg! })), today, 1);
  return (
    <Section title="Bodyweight" icon={<IconScale size={16} />} tone="var(--blue)" more="Body" onMore={() => go('/body')}>
      {!loggedToday && <WeighInCard body={body} compact />}
      {pts.length > 0 && (<>
        <div class="hero"><span class="hero-value">{avg != null ? avg.toFixed(1) : pts[pts.length - 1].avg.toFixed(1)}</span><span class="hero-unit">kg · 7-day average</span></div>
        {check && check.status !== 'no-data' && (
          <div class="hero-sub">{check.rateKgPerWeek! >= 0 ? '+' : '−'}{Math.abs(check.rateKgPerWeek!).toFixed(2)} kg/week{check.avgIntake != null ? ` · eating ${check.avgIntake.toLocaleString()} kcal/day` : ''}</div>
        )}
        {pts.length > 1 && <WeightChart label="Bodyweight, last 3 months" color="#6fb1ff" height={150}
          points={pts.map((p) => ({ key: p.date, x: Date.parse(`${p.date}T12:00:00`), kg: p.kg, avg: p.avg }))}
          formatX={(x) => new Date(x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} />}
      </>)}
      <div class="bulk-wrap"><BulkCheckView /></div>
    </Section>
  );
}

// ---------- 6. Measurements ----------

function HomeMeasurements() {
  const body = useBody();
  if (!body) return null;
  return <div class="tap-wrap" onClick={() => go('/body')}><MeasurementsCard body={body} /></div>;
}
