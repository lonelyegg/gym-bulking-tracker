// Shared food/body pieces: today's kcal + protein bars, the bulk check card, and the targets form.
import { useMemo } from 'preact/hooks';
import { useLive } from '../db/db';
import { bulkCheck, weekAverage } from '../lib/body';
import { localDate } from '../lib/logic';
import { dayTotals, proteinTarget, type Nutrients } from '../lib/nutrition';
import { saveSetting, settings } from '../state/settings';
import { currentWeight, useBody, weighIns } from '../state/body';
import { dailyIntake, useFoodDay } from '../state/food';
import { go, Stepper, toast } from './ui';

const n0 = (v: number) => Math.round(v).toLocaleString();

export function useTargets() {
  const body = useBody();
  const weight = body ? currentWeight(body.weights) : null;
  const s = settings.value;
  return { kcal: s.kcal_target, protein: proteinTarget(weight, s.protein_g_per_kg), weight };
}

function Bar(props: { label: string; value: number; target: number | null; unit: string; color: string }) {
  const pct = props.target ? Math.min(100, (props.value / props.target) * 100) : 0;
  const left = props.target != null ? props.target - props.value : null;
  return (
    <div class="nbar">
      <div class="nbar-top">
        <span class="nbar-label">{props.label}</span>
        <span class="num"><b>{n0(props.value)}</b>{props.target != null ? <span class="muted"> / {n0(props.target)} {props.unit}</span> : <span class="muted"> {props.unit}</span>}</span>
      </div>
      <div class="nbar-track"><div style={{ width: `${pct}%`, background: props.color }} /></div>
      <div class="nbar-sub muted small">
        {props.target == null ? 'No target yet'
          : left! > 0 ? `${n0(left!)} ${props.unit} to go` : `Target reached${left! < 0 ? ` (+${n0(-left!)})` : ''} ✓`}
      </div>
    </div>
  );
}

/** kcal and protein against today's targets. */
export function FoodBars({ date = localDate(), totals, compact }: { date?: string; totals?: Nutrients; compact?: boolean }) {
  const day = useFoodDay(date);
  const t = useTargets();
  const sum = totals ?? (day ? dayTotals(day.logs) : null);
  if (!sum) return <div class="nbars placeholder" />;
  return (
    <div class={`nbars ${compact ? 'compact' : ''}`}>
      <Bar label="Calories" value={sum.kcal} target={t.kcal} unit="kcal" color="var(--orange)" />
      <Bar label="Protein" value={sum.protein_g} target={t.protein} unit="g" color="var(--accent)" />
    </div>
  );
}

const STATUS = {
  'no-data': { icon: '○', label: 'Not enough data yet', tone: 'muted' },
  slow: { icon: '▲', label: 'Gaining too slowly', tone: 'warn' },
  'on-track': { icon: '✓', label: 'On track', tone: 'good' },
  'bit-fast': { icon: '!', label: 'A little fast', tone: 'warn' },
  fast: { icon: '▼', label: 'Gaining too fast', tone: 'bad' },
} as const;

export function useBulkCheck() {
  const body = useBody();
  const intake = useLive(dailyIntake, []);
  const s = settings.value;
  return useMemo(() => (body && intake ? bulkCheck({
    weights: weighIns(body.weights), intake, minPct: s.gain_rate_min_pct, maxPct: s.gain_rate_max_pct,
    kcalTarget: s.kcal_target, today: localDate(),
  }) : null), [body, intake, s.gain_rate_min_pct, s.gain_rate_max_pct, s.kcal_target]);
}

const kg2 = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} kg`;

/** Bulk check: rate of gain vs target, average intake next to it, and what to change. */
export function BulkCheckView() {
  const r = useBulkCheck();
  if (!r) return null;
  const st = STATUS[r.status];
  return (
    <div class="bulk">
      <div class={`bulk-status ${st.tone}`}><span class="bulk-icon">{st.icon}</span>{st.label}</div>
      {r.status === 'no-data' ? <p class="small muted">{r.need}</p> : (
        <>
          <div class="bulk-grid">
            <div><div class="bulk-num">{kg2(r.rateKgPerWeek!)}</div><div class="muted small">per week ({r.ratePct! >= 0 ? '+' : ''}{r.ratePct!.toFixed(2)}%)</div></div>
            <div><div class="bulk-num">{r.targetKg![0].toFixed(2)}–{r.targetKg![1].toFixed(2)}</div><div class="muted small">target kg/week</div></div>
            <div><div class="bulk-num">{r.avgIntake != null ? n0(r.avgIntake) : '–'}</div><div class="muted small">avg kcal/day</div></div>
          </div>
          <p class="small muted">
            7-day average {r.startAvg!.toFixed(1)} → {r.endAvg!.toFixed(1)} kg over the last {r.windowDays / 7} weeks.
            {r.avgIntake != null && r.intakeDays < r.windowDays * 0.7 && ` Food logged on ${r.intakeDays} of ${r.windowDays} days, so the average may be off.`}
            {r.avgIntake == null && ' Log your food to see your average intake here.'}
          </p>
          {r.delta != null && (
            <div class="bulk-advice">
              <div>
                {r.delta > 0 ? 'Eat a little more: ' : 'Ease off a little: '}
                <b>{r.delta > 0 ? '+' : '−'}{Math.abs(r.delta)} kcal/day</b>
                {r.suggestedTarget != null && <> → about <b>{n0(r.suggestedTarget)} kcal</b></>}
              </div>
              {r.suggestedTarget != null && r.suggestedTarget !== settings.value.kcal_target && (
                <button class="btn sm primary" onClick={() => { saveSetting('kcal_target', r.suggestedTarget); toast(`Calorie target set to ${n0(r.suggestedTarget!)}`); }}>Set as target</button>
              )}
            </div>
          )}
          {r.status === 'on-track' && <p class="small">Keep eating about the same{r.avgIntake != null ? ` (~${n0(r.avgIntake)} kcal)` : ''}. Check again next week.</p>}
          {r.status === 'bit-fast' && <p class="small">Slightly above your target range. No change needed yet; check again next week.</p>}
        </>
      )}
    </div>
  );
}

/** Calorie target, protein per kg and target rate of gain. */
export function TargetsForm() {
  const body = useBody();
  const s = settings.value;
  const w = body ? currentWeight(body.weights) : null;
  const week = body ? weekAverage(weighIns(body.weights), localDate()) : null;
  const guess = w ? Math.round((w * 35) / 50) * 50 : null;
  return (
    <div class="form">
      <label>Daily calories target</label>
      <Stepper value={s.kcal_target} step={50} min={1000} max={6000} unit="kcal" placeholder={guess ? String(guess) : '2800'}
        onChange={(v) => saveSetting('kcal_target', v)}
        onInc={(c) => saveSetting('kcal_target', Math.min(6000, (c ?? guess ?? 2800) + 50))}
        onDec={(c) => saveSetting('kcal_target', Math.max(1000, (c ?? guess ?? 2800) - 50))} />
      <p class="muted small">
        {s.kcal_target == null && guess ? `Not sure? Start around ${guess.toLocaleString()} kcal (≈35 per kg) and let the bulk check adjust it. ` : ''}
        The bulk check suggests changes of 150–250 kcal once there's 2–3 weeks of data.
      </p>
      <label>Protein per kg of bodyweight</label>
      <Stepper value={s.protein_g_per_kg} step={0.1} min={0.8} max={3.5} decimals unit="g/kg" onChange={(v) => saveSetting('protein_g_per_kg', v)} />
      <p class="muted small">{w ? `= ${proteinTarget(w, s.protein_g_per_kg)} g a day at ${w.toFixed(1)} kg${week ? ' (this week’s average)' : ''}.` : 'Log your weight to turn this into grams.'}</p>
      <label>Target gain per week (% of bodyweight)</label>
      <div class="row gap">
        <Stepper value={s.gain_rate_min_pct} step={0.05} min={0} max={2} decimals unit="%" onChange={(v) => saveSetting('gain_rate_min_pct', Math.min(v, s.gain_rate_max_pct))} />
        <Stepper value={s.gain_rate_max_pct} step={0.05} min={0.05} max={2} decimals unit="%" onChange={(v) => saveSetting('gain_rate_max_pct', Math.max(v, s.gain_rate_min_pct))} />
      </div>
      <p class="muted small">{w ? `≈ ${((s.gain_rate_min_pct / 100) * w).toFixed(2)}–${((s.gain_rate_max_pct / 100) * w).toFixed(2)} kg a week. ` : ''}0.25–0.5% is a common lean-bulk range.</p>
      <button class="btn ghost block" onClick={() => go('/body')}>Go to bodyweight</button>
    </div>
  );
}
