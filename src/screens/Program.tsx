// StrongLifts 5×5: the program's own home. Sessions themselves are normal workouts, so they also
// show up in History, the calendar, PRs, strength charts and exercise pages.
import { useState } from 'preact/hooks';
import { fmtKg, localDate, WEEKDAYS } from '../lib/logic';
import {
  DAY_LIFTS, DAY_STYLE, DEFAULT_PROGRAM, LIFT_EXERCISE, LIFT_NAME, LIFT_SHORT, LIFTS, plateText, WORK_SETS,
  type Day, type Lift, type LiftState,
} from '../lib/program';
import { settings } from '../state/settings';
import { activateProgram, programActive, saveProgram, setLiftWeight, startProgramWorkout, useProgram } from '../state/program';
import { getActiveWorkout } from '../state/workout';
import { db, useLive } from '../db/db';
import { confirmSheet, go, Header, Sheet, Stepper, Toggle, toast } from '../components/ui';

const dayLabel = (date: string) => {
  const today = localDate();
  if (date === today) return 'Today';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};

function status(st: LiftState): { text: string; tone: string } {
  const last = st.history.filter((h) => h.result !== 'skipped').at(-1);
  if (!last) return { text: 'Not started', tone: 'muted' };
  if (last.result === 'success') return { text: '✓ Moving up', tone: 'good' };
  if (last.result === 'deload') return { text: `↓ Deloaded 10% (${st.deloads}×)`, tone: 'warn' };
  return { text: `✗ Missed · ${st.fails} of 3`, tone: 'bad' };
}

export function ProgramScreen() {
  const p = useProgram();
  const active = programActive();
  const split = useLive(async () => (settings.value.active_split_id ? db.splits.get(settings.value.active_split_id) : undefined), [settings.value.active_split_id]);
  const [editLift, setEditLift] = useState<Lift | null>(null);
  if (!p) return <div class="page" />;
  const { cfg, state, next, data } = p;
  // Past best est. 1RM per lift (from any workout), as a reference for starting weights.
  const best = (() => {
    const out: Partial<Record<Lift, number>> = {};
    for (const l of LIFTS) {
      const v = Math.max(0, ...data.sets.filter((x) => x.exercise_id === LIFT_EXERCISE[l] && !x.is_warmup && x.weight_kg > 0).map((x) => x.weight_kg * (1 + x.reps / 30)));
      if (v > 0) out[l] = Math.round(v * 10) / 10;
    }
    return Object.keys(out).length ? out : null;
  })();

  const start = async (day: Day) => {
    if (await getActiveWorkout()) { go('/workout'); return; }
    await startProgramWorkout(day);
    go('/workout');
  };

  return (
    <div class="page">
      <Header title="StrongLifts 5×5" back="/plan" />

      {!active ? (
        <section class="card program-intro">
          <div class="bold big">Two workouts, five lifts, three days a week.</div>
          <p class="small muted">Workout A: Squat 5×5, Bench Press 5×5, Barbell Row 5×5. Workout B: Squat 5×5, Overhead Press 5×5, Deadlift 1×5.
            You alternate A and B every session. Hit every rep and the weight goes up next time; miss and you repeat it; miss three times in a row and that lift drops 10%.</p>
          <div class="bold small mt">Starting weights</div>
          <p class="small muted">New to these lifts? Keep the empty bar. If you’ve lifted before, use a weight you could do for about 10 reps{best ? ' (your past bests are shown for reference)' : ''}.</p>
          {LIFTS.map((l) => (
            <div key={l} class="row gap setting-row">
              <span class="grow small">{LIFT_NAME[l]}{best?.[l] ? <span class="block muted">best est. 1RM {fmtKg(best[l]!)} kg</span> : null}</span>
              <div class="w-55"><Stepper value={cfg.start[l]} step={2 * Math.min(...cfg.plates)} min={cfg.bar} max={400} decimals unit="kg"
                onChange={(v) => saveProgram({ start: { ...cfg.start, [l]: v } })} /></div>
            </div>
          ))}
          <p class="small muted">Starting it replaces {split && !split.deleted ? `“${split.name}”` : 'your split'} on Home and the calendar. Your splits stay saved and you can switch back any time.</p>
          <button class="btn primary block lg" onClick={async () => { await activateProgram(true); toast('5×5 is now your active plan'); }}>Start this program</button>
        </section>
      ) : (
        <p class="good small center-text">✓ Your active plan · shown on Home and the calendar</p>
      )}

      <section class="card next-card" style={{ '--c': DAY_STYLE[next.day].color }}>
        <div class="row between">
          <span class="today-kicker">Next · {dayLabel(next.date)}</span>
          <span class="day-dot" style={{ background: DAY_STYLE[next.day].color }}>{DAY_STYLE[next.day].icon}</span>
        </div>
        <div class="today-name">Workout {next.day}</div>
        {next.afterBreak && <p class="small warn-text">It’s been over a week since your last session, so weights are 10% lighter (you’ll be back up within a couple of weeks).</p>}
        {next.lifts.map((l) => (
          <div key={l.lift} class="plan-lift">
            <span class="grow">
              <span class="block bold">{LIFT_NAME[l.lift]}</span>
              <span class="block muted small">{plateText(l.weight, cfg)}{l.warmups.length ? ` · ${l.warmups.length} warm-up${l.warmups.length > 1 ? 's' : ''}` : ''}</span>
            </span>
            <span class="right"><span class="block bold num">{fmtKg(l.weight)} kg</span><span class="block muted small">{l.sets}×{l.reps}{l.fails ? ` · miss ${l.fails}/3` : ''}</span></span>
          </div>
        ))}
        <button class="btn primary block lg" onClick={() => start(next.day)}>Start Workout {next.day}{next.date !== localDate() ? ' now' : ''}</button>
        <button class="btn ghost block sm" onClick={() => start(next.day === 'A' ? 'B' : 'A')}>Do Workout {next.day === 'A' ? 'B' : 'A'} instead</button>
      </section>

      <h3 class="section-title">Your lifts</h3>
      <section class="card">
        {LIFTS.map((lift) => {
          const st = state.lifts[lift];
          const s = status(st);
          return (
            <div key={lift} class="lift-row">
              <button class="grow left plain" onClick={() => go(`/exercise/${LIFT_EXERCISE[lift]}`)}>
                <span class="block bold">{LIFT_NAME[lift]} <span class="muted small">{WORK_SETS[lift]}×5 · +{fmtKg(cfg.inc[lift])} kg</span></span>
                <span class={`block small ${s.tone}-text`}>{s.text}</span>
              </button>
              <button class="lift-weight" onClick={() => setEditLift(lift)} aria-label={`Change ${LIFT_NAME[lift]} weight`}>
                <span class="bold num">{fmtKg(st.weight)}</span><span class="muted small"> kg ✎</span>
              </button>
            </div>
          );
        })}
        <p class="fine">Weights are worked out from your logged 5×5 sessions, so editing or deleting a session updates them. Tap a weight to change it from now on.</p>
      </section>

      <h3 class="section-title">Schedule</h3>
      <section class="card">
        <div class="day-chips">
          {WEEKDAYS.map((wd, i) => {
            const on = cfg.days.includes(i);
            return (
              <button key={wd} class={`chip ${on ? 'on' : ''}`} onClick={() => {
                const days = on ? cfg.days.filter((d) => d !== i) : [...cfg.days, i];
                if (!days.length) { toast('Pick at least one day'); return; }
                saveProgram({ days: days.sort() });
              }}>{wd}</button>
            );
          })}
        </div>
        <p class="fine">Usually 3 days with a rest day between (Mon/Wed/Fri or Tue/Thu/Sat). A and B alternate every session, not every week: Mon A, Wed B, Fri A, then Mon B. Missed a session? Just carry on with the next one.</p>
      </section>

      <ProgramSettings />

      <h3 class="section-title">Sessions · {state.sessions}</h3>
      {state.sessions === 0 && <p class="empty">Your 5×5 sessions will be listed here.</p>}
      <SessionList />

      <details class="card more">
        <summary>How the program works</summary>
        <ul class="small rules">
          <li><b>Start light.</b> Empty bar (20 kg) for squat, bench and overhead press, 30 kg rows, 40 kg deadlifts. If you’ve lifted before, start with a weight you could do for about 10 reps.</li>
          <li><b>Every rep, every set.</b> 5/5/5/5/5 at the target weight (deadlift: one set of 5) means +2.5 kg next time (+5 kg deadlift). 5/5/5/5/4 is a miss: same weight next time.</li>
          <li><b>Three misses in a row</b> at the same weight: that lift drops 10%, rounded down to what you can load, and you work back up. Only that lift.</li>
          <li><b>Rest</b>: 1:30 after warm-ups, 3:00 after a work set (tap “felt easy” for 1:30), 5:00 after a missed set.</li>
          <li><b>Warm-ups</b>: empty bar, then about 65% × 5 and 85% × 3, rounded to your plates.</li>
          <li><b>More than a week off</b>: come back 10% lighter on everything.</li>
        </ul>
        <p class="fine">Based on lift5x5.app’s description of the StrongLifts-style 5×5.</p>
      </details>

      {active && (
        <button class="btn ghost block danger-text" onClick={async () => {
          if (await confirmSheet('Stop using 5×5 as your plan? Your sessions and progress stay; Home goes back to your split.', 'Stop', true)) await activateProgram(false);
        }}>Stop program</button>
      )}
      <div class="bottom-space" />

      {editLift && <LiftWeightSheet lift={editLift} current={state.lifts[editLift].weight} onClose={() => setEditLift(null)} />}
    </div>
  );
}

function LiftWeightSheet({ lift, current, onClose }: { lift: Lift; current: number; onClose: () => void }) {
  const p = useProgram();
  const [w, setW] = useState<number | null>(current);
  const step = p ? 2 * Math.min(...p.cfg.plates) : 2.5;
  return (
    <Sheet open onClose={onClose} title={`${LIFT_NAME[lift]} weight`}>
      <div class="form">
        <p class="muted small">Use this to start heavier, or after time off. Your next {LIFT_NAME[lift].toLowerCase()} will use this weight, then the program carries on from there.</p>
        <Stepper value={w} step={step} min={p?.cfg.bar ?? 20} max={500} decimals unit="kg" onChange={setW} />
        <button class="btn primary block" disabled={!w} onClick={async () => { await setLiftWeight(lift, w!); toast(`${LIFT_NAME[lift]}: ${fmtKg(w!)} kg from now on`); onClose(); }}>Save</button>
      </div>
    </Sheet>
  );
}

function ProgramSettings() {
  const cfg = useProgram()?.cfg ?? DEFAULT_PROGRAM;
  const [plates, setPlates] = useState(cfg.plates.join(', '));
  return (
    <details class="card more">
      <summary>Program settings</summary>
      <div class="form">
        <label>Weight added after a successful session</label>
        {LIFTS.map((l) => (
          <div key={l} class="row gap setting-row">
            <span class="grow small">{LIFT_NAME[l]}</span>
            <div class="w-55"><Stepper value={cfg.inc[l]} step={0.5} min={0.5} max={20} decimals unit="kg" onChange={(v) => saveProgram({ inc: { ...cfg.inc, [l]: v } })} /></div>
          </div>
        ))}
        <p class="muted small">Overhead press stalls first; with 1.25 kg plates you can use +1.25 kg instead of 2.5.</p>
        <label>Bar weight</label>
        <Stepper value={cfg.bar} step={2.5} min={5} max={30} decimals unit="kg" onChange={(v) => saveProgram({ bar: v })} />
        <label>Plates you can load (kg, per side)</label>
        <input class="input" inputMode="decimal" value={plates} onInput={(e) => setPlates((e.currentTarget as HTMLInputElement).value)}
          onBlur={() => {
            const list = [...new Set(plates.split(/[,\s]+/).map(Number).filter((x) => x > 0))].sort((a, b) => b - a);
            if (!list.length) { toast('Enter at least one plate'); return; }
            saveProgram({ plates: list });
            setPlates(list.join(', '));
          }} />
        <label>Deload after three misses</label>
        <Stepper value={cfg.deloadPct} step={5} min={5} max={30} unit="%" onChange={(v) => saveProgram({ deloadPct: v })} />
        <Toggle label="Warm-up sets" hint="Added automatically before each lift" checked={cfg.warmups} onChange={(v) => saveProgram({ warmups: v })} />
        <Toggle label="Lighter after a week off" hint="10% off everything when it's been more than 7 days" checked={cfg.breakDeload} onChange={(v) => saveProgram({ breakDeload: v })} />
      </div>
    </details>
  );
}

function SessionList() {
  const p = useProgram();
  if (!p) return null;
  const { state, data } = p;
  const byWorkout = new Map<string, { lift: Lift; weight: number | null; result: string; reps: number[] }[]>();
  for (const lift of LIFTS) {
    for (const h of state.lifts[lift].history) {
      byWorkout.set(h.workoutId, [...(byWorkout.get(h.workoutId) ?? []), { lift, weight: h.weight, result: h.result, reps: h.reps }]);
    }
  }
  const sessions = data.workouts.filter((w) => byWorkout.has(w.id)).reverse().slice(0, 12);
  return (
    <>
      {sessions.map((w) => {
        const day = (w as { program_day?: string }).program_day as Day;
        const rows = (byWorkout.get(w.id) ?? []).sort((a, b) => DAY_LIFTS[day].indexOf(a.lift) - DAY_LIFTS[day].indexOf(b.lift));
        return (
          <button key={w.id} class="list-item" onClick={() => go(`/w/${w.id}`)}>
            <span class="day-dot" style={{ background: w.color }}>{w.icon}</span>
            <span class="grow left">
              <span class="block bold">{new Date(w.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span class="block small session-lifts">
                {rows.map((r) => (
                  <span key={r.lift} class={r.result === 'success' ? 'good-text' : r.result === 'skipped' ? 'muted' : r.result === 'deload' ? 'warn-text' : 'bad-text'}>
                    {LIFT_SHORT[r.lift]} {r.weight != null ? fmtKg(r.weight) : '–'}{r.result === 'success' ? ' ✓' : r.result === 'skipped' ? ' (skipped)' : ' ✗'}
                  </span>
                ))}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}
