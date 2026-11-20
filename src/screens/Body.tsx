// Body: daily weigh-in (+ optional sleep), bulk check, 7-day average trend, measurements.
import { useMemo, useState } from 'preact/hooks';
import type { Bodyweight } from '../db/schema';
import { changeIsGood, measurementTable, movingAverage, siteId, weekAverage, type Site } from '../lib/body';
import { localDate } from '../lib/logic';
import { addDays, RANGES, rangeBounds, type Range } from '../lib/stats';
import { saveSetting, settings } from '../state/settings';
import { logMeasurements, logWeight, useBody, weighIns, type BodyData } from '../state/body';
import { WeightChart } from '../components/charts';
import { IconChevron, IconPlus, IconScale, IconTrend } from '../components/icons';
import { BulkCheckView } from '../components/nutrition';
import { PhotoCompareCard } from './Photos';
import { confirmSheet, PageTitle, promptSheet, Section, Segmented, Sheet, Stepper, toast } from '../components/ui';

const kg1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const shortDate = (x: number | string) => new Date(typeof x === 'string' ? `${x}T12:00:00` : x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function BodyScreen() {
  const body = useBody();
  if (!body) return <div class="page" />;
  return (
    <div class="page">
      <PageTitle title="Body" />
      <WeighInCard body={body} />
      <Section title="Bulk check" icon={<IconTrend size={16} />} tone="var(--accent)"><BulkCheckView /></Section>
      <WeightTrend body={body} />
      <MeasurementsCard body={body} full />
      <PhotoCompareCard />
      <RecentWeighIns body={body} />
      <div class="bottom-space" />
    </div>
  );
}

// ---------- Weigh-in ----------

export function WeighInCard({ body, compact }: { body: BodyData; compact?: boolean }) {
  const today = localDate();
  const todays = body.weights.find((w) => w.date === today);
  const last = [...body.weights].reverse().find((w) => w.weight_kg != null);
  const [editing, setEditing] = useState(false);
  const [kg, setKg] = useState<number | null>(todays?.weight_kg ?? last?.weight_kg ?? null);
  const [sleep, setSleep] = useState<number | null>(todays?.sleep_h ?? null);

  if (todays?.weight_kg != null && !editing) {
    return (
      <div class={compact ? 'weighin done compact' : 'card weighin done'}>
        <span class="grow">
          <span class="block muted small">Today’s weigh-in</span>
          <span class="block"><b class="big num">{kg1(todays.weight_kg)} kg</b>{todays.sleep_h != null && <span class="muted"> · slept {todays.sleep_h} h</span>}</span>
        </span>
        <button class="btn sm" onClick={() => { setKg(todays.weight_kg); setSleep(todays.sleep_h); setEditing(true); }}>Edit</button>
      </div>
    );
  }
  if (compact) {
    return (
      <div class="weighin compact">
        <div class="muted small">{todays ? 'Edit today’s weigh-in' : 'Log today’s weight'}</div>
        <div class="weighin-row">
          <Stepper value={kg} step={0.1} min={20} max={300} decimals unit="kg" placeholder="kg" onChange={setKg} />
          <button class="btn tinted" disabled={!kg} onClick={async () => {
            await logWeight(today, kg, undefined);
            setEditing(false);
            toast(`Logged ${kg1(kg!)} kg ✓`);
          }}>Save</button>
        </div>
      </div>
    );
  }
  return (
    <div class="card weighin">
      <div class="muted small">{todays ? 'Edit today’s weigh-in' : 'Log today’s weight'} (same time each morning is most consistent)</div>
      <Stepper size="lg" value={kg} step={0.1} min={20} max={300} decimals unit="kg" placeholder="kg" onChange={setKg} />
      <div class="muted small">Sleep last night (optional)</div>
      <Stepper value={sleep} step={0.5} min={0} max={16} decimals unit="h" placeholder="–" onChange={setSleep} />
      <button class="btn primary block" disabled={!kg} onClick={async () => {
        await logWeight(today, kg, sleep);
        setEditing(false);
        toast(`Logged ${kg1(kg!)} kg ✓`);
      }}>Save</button>
    </div>
  );
}

// ---------- Trend ----------

export function weightSeries(body: BodyData, range: Range) {
  const all = movingAverage(weighIns(body.weights));
  const { start } = rangeBounds(range);
  const from = start ? start.slice(0, 10) : '';
  return all.filter((p) => !from || p.date >= from);
}

function WeightTrend({ body }: { body: BodyData }) {
  const [range, setRange] = useState<Range>('3M');
  const pts = useMemo(() => weightSeries(body, range), [body, range]);
  const w = weighIns(body.weights);
  const today = localDate();
  const now = weekAverage(w, today, 1);
  const before = weekAverage(w, addDays(today, -28), 1);
  return (
    <Section title="Weight" icon={<IconScale size={16} />} tone="var(--blue)">
      <Segmented label="Time range" value={range} options={RANGES} onChange={setRange} />
      {!pts.length ? <p class="empty-note">Your weigh-ins and their 7-day average appear here.</p> : (<>
        <div class="hero"><span class="hero-value">{now != null ? kg1(now) : kg1(pts[pts.length - 1].avg)}</span><span class="hero-unit">kg · 7-day average</span></div>
        <div class="hero-sub">
          {now != null && before != null
            ? <span class={now - before > 0 ? 'delta-up' : now - before < 0 ? 'delta-down' : 'muted'}>{now - before > 0 ? '▲' : now - before < 0 ? '▼' : '='} {kg1(Math.abs(now - before))} kg vs 4 weeks ago</span>
            : 'Daily weight jumps around; the average shows the real trend.'}
        </div>
        <WeightChart label="Bodyweight with 7-day average" color="#6fb1ff"
          points={pts.map((p) => ({ key: p.date, x: Date.parse(`${p.date}T12:00:00`), kg: p.kg, avg: p.avg }))}
          formatX={(x) => shortDate(x)} />
      </>)}
    </Section>
  );
}

// ---------- Measurements ----------

export function MeasurementsCard({ body, full }: { body: BodyData; full?: boolean }) {
  const sites = settings.value.measurement_sites;
  const rows = measurementTable(body.measurements, sites, localDate());
  const [logging, setLogging] = useState(false);
  const any = rows.some((r) => r.latest != null);
  const lastDate = rows.map((r) => r.latestDate).filter(Boolean).sort().pop();
  const cell = (site: Site, v: number | null) => v == null ? <span class="muted">–</span>
    : <span class={v === 0 ? 'muted' : changeIsGood(site, v) ? 'delta-up' : 'delta-down'}>{v > 0 ? '+' : ''}{v.toFixed(1)}</span>;
  return (
    <section class="card dash-card">
      <div class="section-head"><span class="section-head-title" style={{ color: 'var(--violet)' }}>Measurements</span>
        {lastDate && <span class="muted small">last {shortDate(lastDate)}</span>}</div>
      {any ? (
        <table class="mtable">
          <thead><tr><th /><th>Now</th><th>Since start</th><th>30 days</th></tr></thead>
          <tbody>{rows.filter((r) => full || r.latest != null).map((r) => (
            <tr key={r.site.id}><td>{r.site.label}</td><td class="num">{r.latest != null ? `${r.latest.toFixed(1)}` : '–'}</td>
              <td class="num">{cell(r.site, r.sinceStart)}</td><td class="num">{cell(r.site, r.last30)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p class="empty-note">Measure every 2–4 weeks (cm). Arms, chest and thighs growing is often the first visible sign a bulk is working.</p>}
      {any && <p class="fine">cm. Green = the direction you want while bulking (waist up shows red).</p>}
      {full && <button class="btn block" onClick={() => setLogging(true)}>Log measurements</button>}
      {logging && <MeasureSheet body={body} onClose={() => setLogging(false)} />}
    </section>
  );
}

/** Typical starting points (cm), so the first entry is a few taps instead of typing. */
const TYPICAL: Record<string, number> = { waist: 80, chest: 100, shoulders: 115, upper_arm: 33, thigh: 55 };

function MeasureSheet({ body, onClose }: { body: BodyData; onClose: () => void }) {
  const today = localDate();
  const sites = settings.value.measurement_sites;
  const latest = (site: string) => body.measurements.filter((m) => m.site === site).sort((a, b) => b.date.localeCompare(a.date))[0];
  const [vals, setVals] = useState<Record<string, number | null>>(() => Object.fromEntries(sites.map((s) => {
    const l = latest(s.id);
    return [s.id, l && l.date === today ? l.value_cm : null];
  })));
  return (
    <Sheet open onClose={onClose} title="Measurements today (cm)">
      <div class="form">
        {sites.map((s) => (
          <div key={s.id}>
            <label class="mlabel">{s.label}{latest(s.id) && latest(s.id).date !== today ? <span class="muted"> · last {latest(s.id).value_cm} on {shortDate(latest(s.id).date)}</span> : null}</label>
            <Stepper value={vals[s.id]} step={0.5} min={0} max={300} decimals unit="cm" placeholder={latest(s.id) ? String(latest(s.id).value_cm) : '–'}
              onChange={(v) => setVals({ ...vals, [s.id]: v })}
              onInc={(c) => setVals({ ...vals, [s.id]: c == null ? latest(s.id)?.value_cm ?? TYPICAL[s.id] ?? 30 : Math.round((c + 0.5) * 10) / 10 })}
              onDec={(c) => setVals({ ...vals, [s.id]: c == null ? latest(s.id)?.value_cm ?? TYPICAL[s.id] ?? 30 : Math.max(0, Math.round((c - 0.5) * 10) / 10) })} />
          </div>
        ))}
        <button class="btn ghost block" onClick={async () => {
          const name = await promptSheet('New measurement', '', 'Add', 'e.g. Neck, Calf, Forearm');
          if (!name) return;
          const id = siteId(name);
          if (sites.some((x) => x.id === id)) { toast('You already track that.'); return; }
          await saveSetting('measurement_sites', [...sites, { id, label: name }]);
        }}><IconPlus size={16} /> Track another measurement</button>
        <button class="btn primary block" onClick={async () => {
          await logMeasurements(today, vals);
          toast('Measurements saved ✓');
          onClose();
        }}>Save</button>
      </div>
    </Sheet>
  );
}

// ---------- Recent ----------

function RecentWeighIns({ body }: { body: BodyData }) {
  const [edit, setEdit] = useState<Bodyweight | null>(null);
  const [more, setMore] = useState(false);
  const everything = [...body.weights].reverse();
  const recent = everything.slice(0, more ? 60 : 5);
  const sleeps = body.weights.filter((w) => w.sleep_h != null && w.date > addDays(localDate(), -7));
  if (!recent.length) return null;
  return (
    <>
      <h3 class="section-title">Recent entries{sleeps.length ? ` · avg sleep ${(sleeps.reduce((a, w) => a + w.sleep_h!, 0) / sleeps.length).toFixed(1)} h` : ''}</h3>
      <section class="group">
        {recent.map((w) => (
          <button key={w.id} class="group-row rec" onClick={() => setEdit(w)}>
            <span>{new Date(`${w.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span class="grow" />
            {w.sleep_h != null && <span class="muted small">{w.sleep_h} h sleep</span>}
            <span class="bold num">{w.weight_kg != null ? `${kg1(w.weight_kg)} kg` : '–'}</span>
            <IconChevron class="row-chev" />
          </button>
        ))}
      </section>
      {everything.length > 5 && <button class="btn ghost block sm" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show ${Math.min(everything.length, 60) - 5} more`}</button>}
      {edit && <EditWeighIn w={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function EditWeighIn({ w, onClose }: { w: Bodyweight; onClose: () => void }) {
  const [kg, setKg] = useState<number | null>(w.weight_kg);
  const [sleep, setSleep] = useState<number | null>(w.sleep_h);
  return (
    <Sheet open onClose={onClose} title={new Date(`${w.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}>
      <div class="form">
        <label>Weight</label>
        <Stepper value={kg} step={0.1} min={20} max={300} decimals unit="kg" onChange={setKg} />
        <label>Sleep</label>
        <Stepper value={sleep} step={0.5} min={0} max={16} decimals unit="h" placeholder="–" onChange={setSleep} />
        <div class="row gap mt">
          <button class="btn danger-outline" onClick={async () => {
            if (await confirmSheet('Delete this entry?', 'Delete', true)) { await logWeight(w.date, null, null); onClose(); }
          }}>Delete</button>
          <button class="btn grow primary" onClick={async () => { await logWeight(w.date, kg, sleep); onClose(); }}>Save</button>
        </div>
      </div>
    </Sheet>
  );
}

