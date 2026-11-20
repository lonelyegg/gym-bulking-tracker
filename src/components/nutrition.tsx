// Shared food/body pieces: today's kcal + protein bars, the bulk check card, and the targets form.
import { useMemo } from 'preact/hooks';
import { useLive } from '../db/db';
import { bulkCheck, estimateCalories, weekAverage } from '../lib/body';
import { withDefaults } from '../lib/program';
import { localDate } from '../lib/logic';
import { dayTotals, proteinTarget, type Nutrients } from '../lib/nutrition';
import { saveSetting, settings } from '../state/settings';
import { currentWeight, useBody, weighIns } from '../state/body';
import { dailyIntake, useFoodDay } from '../state/food';
import { Segmented, Stepper, Toggle, toast } from './ui';

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
  const age = s.birth_year ? new Date().getFullYear() - s.birth_year : null;
  // Training sessions per week: the program's days if it's your plan, else your weekly target.
  const sessions = s.active_program ? withDefaults(s.program_sl5x5).days.length : s.weekly_target;
  const est = w && s.height_cm && age && s.sex
    ? estimateCalories({ weightKg: w, heightCm: s.height_cm, age, sex: s.sex, sessionsPerWeek: sessions, physicalJob: s.physical_job })
    : null;
  const missing = [!w && 'your weight (Body tab)', !s.height_cm && 'height', !age && 'birth year', !s.sex && 'sex'].filter(Boolean);
  const guess = est?.bulk ?? null;
  return (
    <div class="form">
      <div class="form-head">About you</div>
      <div class="pair">
        <div><span class="pair-label">Height</span><Stepper value={s.height_cm} step={1} min={100} max={230} unit="cm" placeholder="–"
          onChange={(v) => saveSetting('height_cm', v)} onInc={(c) => saveSetting('height_cm', (c ?? 170) + 1)} onDec={(c) => saveSetting('height_cm', (c ?? 170) - 1)} /></div>
        <div><span class="pair-label">Year born</span><Stepper value={s.birth_year} step={1} min={1930} max={new Date().getFullYear() - 10} placeholder="–"
          onChange={(v) => saveSetting('birth_year', v)} onInc={(c) => saveSetting('birth_year', (c ?? 2000) + 1)} onDec={(c) => saveSetting('birth_year', (c ?? 2000) - 1)} /></div>
      </div>
      <label>Sex (for the formula)</label>
      <Segmented label="Sex (for the formula)" value={s.sex === 'male' ? 'Male' : s.sex === 'female' ? 'Female' : ''} options={['Male', 'Female']}
        onChange={(v) => saveSetting('sex', v === 'Male' ? 'male' : 'female')} />
      <Toggle label="Physical job" hint="On your feet or lifting most of the day" checked={s.physical_job} onChange={(v) => saveSetting('physical_job', v)} />
      {est ? (<>
        <div class="estimate">
          <span class="grow"><span class="block muted small">Maintenance ≈ {est.maintenance.toLocaleString()} kcal</span>
            <b class="block">Lean bulk ≈ {est.bulk.toLocaleString()} kcal</b></span>
          {s.kcal_target !== est.bulk
            ? <button class="btn sm primary" onClick={() => { saveSetting('kcal_target', est.bulk); toast(`Calorie target set to ${est.bulk.toLocaleString()}`); }}>Use</button>
            : <span class="tag">In use</span>}
        </div>
        <details class="more"><summary>How it’s calculated</summary>
          <p class="muted small">Mifflin–St Jeor: {est.bmr.toLocaleString()} kcal at rest × {est.factor} for {sessions} session{sessions === 1 ? '' : 's'} a week{s.physical_job ? ' and a physical job' : ''}, plus 250 for a lean bulk. It’s a starting point: the bulk check corrects it from your real weight trend after 2–3 weeks.</p>
        </details>
      </>) : <p class="muted small">Add {missing.join(', ')} to get a calorie estimate.</p>}

      <div class="form-head">Daily targets</div>
      <label>Calories</label>
      <Stepper value={s.kcal_target} step={50} min={1000} max={6000} unit="kcal" placeholder={guess ? String(guess) : '2800'}
        onChange={(v) => saveSetting('kcal_target', v)}
        onInc={(c) => saveSetting('kcal_target', Math.min(6000, (c ?? guess ?? 2800) + 50))}
        onDec={(c) => saveSetting('kcal_target', Math.max(1000, (c ?? guess ?? 2800) - 50))} />
      <p class="muted small">
        {s.kcal_target == null && guess ? `Not sure? Start with the estimate above (${guess.toLocaleString()} kcal). ` : ''}
        The bulk check suggests changes of 150–250 kcal once there's 2–3 weeks of data.
      </p>
      <label>Protein per kg of bodyweight</label>
      <Stepper value={s.protein_g_per_kg} step={0.1} min={0.8} max={3.5} decimals unit="g/kg" onChange={(v) => saveSetting('protein_g_per_kg', v)} />
      <p class="muted small">{w ? `= ${proteinTarget(w, s.protein_g_per_kg)} g a day at ${w.toFixed(1)} kg${week ? ' (this week’s average)' : ''}.` : 'Log your weight to turn this into grams.'}</p>
      <div class="form-head">Weight gain per week</div>
      <div class="pair">
        <div><span class="pair-label">Lowest</span><Stepper value={s.gain_rate_min_pct} step={0.05} min={0} max={2} decimals unit="%" onChange={(v) => saveSetting('gain_rate_min_pct', Math.min(v, s.gain_rate_max_pct))} /></div>
        <div><span class="pair-label">Highest</span><Stepper value={s.gain_rate_max_pct} step={0.05} min={0.05} max={2} decimals unit="%" onChange={(v) => saveSetting('gain_rate_max_pct', Math.max(v, s.gain_rate_min_pct))} /></div>
      </div>
      <p class="muted small">{w ? `≈ ${((s.gain_rate_min_pct / 100) * w).toFixed(2)}–${((s.gain_rate_max_pct / 100) * w).toFixed(2)} kg a week. ` : ''}0.25–0.5% is a common lean-bulk range.</p>
    </div>
  );
}
