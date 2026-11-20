import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, patch, useLive } from '../db/db';
import type { Exercise, PrType, Workout, WorkoutExercise, WorkoutSet } from '../db/schema';
import {
  fmtClock, fmtKg, fmtRir, nextWeight, PR_LABEL, progressionHint, epley, round1, type Hint,
} from '../lib/logic';
import { settings, saveSetting } from '../state/settings';
import { now } from '../state/timer';
import { setWakeLock, wakeLockActive, wakeLockSupported } from '../state/device';
import {
  addExercise, addSet, completeSet, deleteSet, discardWorkout, finishWorkout, getActiveWorkout,
  incompleteSetCount, moveExercise, previousSession, removeExercise, swapExercise, uncompleteSet,
  updateSet, type PreviousSession,
} from '../state/workout';
import { TimerPanel } from '../components/timer';
import { IconCheck } from '../components/icons';
import { liftOfExercise, plateText, replay, WORK_REPS, type ProgramConfig } from '../lib/program';
import { programConfig } from '../state/program';
import { useTraining } from '../state/training';
import { ExercisePicker } from '../components/ExercisePicker';
import {
  confirmSheet, go, RirPicker, Sheet, Stepper, Toggle, toast,
} from '../components/ui';

export function WorkoutScreen() {
  const workout = useLive(async () => (await getActiveWorkout()) ?? null, []);
  useEffect(() => {
    if (workout === null) go('/');
  }, [workout]);
  if (!workout) return <div class="page" />;
  return <ActiveWorkout workout={workout} />;
}

function ActiveWorkout({ workout }: { workout: Workout }) {
  const wid = workout.id;
  const wes = useLive(async () => (await db.workout_exercises.where('workout_id').equals(wid).toArray())
    .filter((w) => !w.deleted).sort((a, b) => a.position - b.position), [wid]) ?? [];
  const sets = useLive(async () => (await db.sets.where('workout_id').equals(wid).toArray()).filter((s) => !s.deleted), [wid]) ?? [];
  const exList = useLive(() => db.exercises.toArray(), []) ?? [];
  const exercises = new Map(exList.map((e) => [e.id, e]));
  const exKey = [...new Set(wes.map((w) => w.exercise_id))].sort().join(',');
  const prevs = useLive(async () => {
    const m: Record<string, PreviousSession | null> = {};
    for (const id of exKey.split(',').filter(Boolean)) m[id] = await previousSession(id, wid, workout.started_at);
    return m;
  }, [exKey, wid]) ?? {};

  const [picker, setPicker] = useState<null | { mode: 'add' } | { mode: 'swap'; we: WorkoutExercise }>(null);
  const [menu, setMenu] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [editing, setEditing] = useState<WorkoutSet | null>(null);
  const backfill = !!workout.backfill;
  const [durationMin, setDurationMin] = useState(60);
  // 5×5 program: progress before this session, for the per-lift hints.
  const isProgram = !!workout.program;
  const training = useTraining();
  const cfg = programConfig();
  const programState = useMemo(
    () => (isProgram && training ? replay(training.workouts, training.sets, cfg, { before: workout.started_at }) : null),
    [isProgram, training, workout.started_at, settings.value.program_sl5x5],
  );

  const elapsed = (now.value - Date.parse(workout.started_at)) / 1000;
  const done = sets.filter((s) => s.completed_at && !s.is_warmup).length;
  const total = sets.filter((s) => !s.is_warmup).length;

  const finish = async () => {
    const n = await incompleteSetCount(wid);
    if (n > 0 && !(await confirmSheet(`${n} set${n > 1 ? 's' : ''} not completed will be removed. Finish anyway?`, 'Finish'))) return;
    await finishWorkout(wid, { durationMin });
    go(`/w/${wid}`);
  };

  return (
    <div class="page workout-page">
      <header class="topbar workout-top">
        <button class="icon-btn" aria-label="Back to home" onClick={() => go('/')}>‹</button>
        <div class="topbar-title">
          <span class="day-dot" style={{ background: workout.color }}>{workout.icon}</span>
          <span>
            <span class="block bold">{workout.name}</span>
            <span class="block muted small">
              {backfill ? `Logging ${new Date(workout.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : fmtClock(elapsed)} · {done}/{total} sets
            </span>
          </span>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" aria-label="Workout menu" onClick={() => setMenu(true)}>⋯</button>
          <button class="btn primary sm" onClick={() => setFinishing(true)}>Finish</button>
        </div>
      </header>

      {!backfill && <TimerPanel />}

      {wes.map((we) => (
        <ExerciseCard
          key={we.id}
          we={we}
          exercise={exercises.get(we.exercise_id)}
          sets={sets.filter((s) => s.workout_exercise_id === we.id).sort((a, b) => a.set_number - b.set_number)}
          prev={prevs[we.exercise_id] ?? null}
          program={isProgram ? programInfo(we, sets, programState, cfg) : null}
          onEditSet={setEditing}
          onSwap={() => setPicker({ mode: 'swap', we })}
          isFirst={we === wes[0]}
          isLast={we === wes[wes.length - 1]}
        />
      ))}

      {!wes.length && <p class="empty">Empty workout. Add your first exercise.</p>}
      <button class="btn block add-ex" onClick={() => setPicker({ mode: 'add' })}>+ Add exercise</button>
      <div class="bottom-space" />

      <ExercisePicker
        open={!!picker}
        title={picker?.mode === 'swap' ? 'Swap for…' : 'Add exercise'}
        onClose={() => setPicker(null)}
        onPick={async (ex) => {
          if (picker?.mode === 'swap') {
            const hasDone = sets.some((s) => s.workout_exercise_id === picker.we.id && s.completed_at);
            if (hasDone && !(await confirmSheet('Completed sets will move to the new exercise. Swap?', 'Swap'))) return;
            await swapExercise(picker.we, ex);
          } else {
            await addExercise(wid, ex);
          }
        }}
      />

      {editing && (
        <SetEditor
          set={sets.find((s) => s.id === editing.id) ?? editing}
          exercise={exercises.get(editing.exercise_id)}
          defaults={rowDefaults(sets.filter((s) => s.workout_exercise_id === editing.workout_exercise_id).sort((a, b) => a.set_number - b.set_number), prevs[editing.exercise_id] ?? null,
            isProgram && liftOfExercise(editing.exercise_id) ? WORK_REPS : null).get(editing.id)}
          targetRir={wes.find((w) => w.id === editing.workout_exercise_id)?.target_rir ?? 2}
          noRir={isProgram && !!liftOfExercise(editing.exercise_id)}
          onClose={() => setEditing(null)}
        />
      )}

      <Sheet open={menu} onClose={() => setMenu(false)} title="Workout">
        {!backfill && <Toggle
          label="Keep screen on"
          hint={wakeLockSupported() ? (wakeLockActive.value ? 'Active — the timer stays reliable.' : 'Not active right now.') : 'Not supported in this browser.'}
          checked={settings.value.wake_lock}
          onChange={(v) => { saveSetting('wake_lock', v); setWakeLock(v); }}
        />}
        <button class="btn block danger mt" onClick={async () => {
          setMenu(false);
          if (await confirmSheet('Discard this workout? Everything logged in it will be deleted.', 'Discard', true)) {
            await discardWorkout(wid);
            go('/');
          }
        }}>Discard workout</button>
      </Sheet>

      <Sheet open={finishing} onClose={() => setFinishing(false)} title="Finish workout?">
        {backfill ? (
          <div class="form">
            <p class="muted">{done} working sets logged. How long did it take?</p>
            <Stepper value={durationMin} step={5} min={5} max={300} unit="min" onChange={setDurationMin} />
          </div>
        ) : <p class="muted">{done} working sets done in {fmtClock(elapsed)}.</p>}
        <div class="row gap">
          <button class="btn grow" onClick={() => setFinishing(false)}>Keep going</button>
          <button class="btn grow primary" onClick={() => { setFinishing(false); finish(); }}>Finish</button>
        </div>
      </Sheet>
    </div>
  );
}

// ---------- Defaults ("Previous" pre-fill) ----------

interface RowDefault { weight: number | null; reps: number | null; prevLabel: string | null }

/**
 * For each set row: what to pre-fill. The k-th working set uses last session's k-th
 * working set (warm-ups map to warm-ups). Extra rows copy the row above.
 */
function rowDefaults(sets: WorkoutSet[], prev: PreviousSession | null, fixedReps: number | null = null): Map<string, RowDefault> {
  const out = new Map<string, RowDefault>();
  let kW = 0;
  let kU = 0;
  let above: { weight: number | null; reps: number | null } = { weight: null, reps: null };
  for (const s of sets) {
    const list = s.is_warmup ? prev?.warmup : prev?.working;
    const k = s.is_warmup ? kU++ : kW++;
    const p = list?.[k] ?? null;
    const fallback = s.is_warmup ? null : list?.at(-1) ?? null;
    const src = p ?? fallback;
    const weight = s.weight_kg ?? src?.weight_kg ?? above.weight;
    // Program lifts: always pre-fill the prescribed reps (never last time's missed reps).
    const reps = s.reps ?? (fixedReps != null && !s.is_warmup ? fixedReps : src?.reps ?? above.reps);
    out.set(s.id, { weight, reps, prevLabel: p ? `${fmtKg(p.weight_kg)}×${p.reps}` : null });
    if (!s.is_warmup) above = { weight, reps };
  }
  return out;
}

// ---------- 5×5 program hints ----------

interface ProgramInfo { hint: string; plates: string | null }

function programInfo(we: WorkoutExercise, sets: WorkoutSet[], state: ReturnType<typeof replay> | null, cfg: ProgramConfig): ProgramInfo | null {
  const lift = liftOfExercise(we.exercise_id);
  if (!lift || !state) return null;
  const work = sets.filter((x) => x.workout_exercise_id === we.id && !x.is_warmup);
  const target = work[0]?.weight_kg ?? state.lifts[lift].weight;
  const st = state.lifts[lift];
  const total = we.target_sets * WORK_REPS;
  const next = Math.round((target + cfg.inc[lift]) * 100) / 100;
  const hint = st.fails > 0 && st.failWeight != null && Math.abs(st.failWeight - target) < 1e-6
    ? `Missed reps at ${fmtKg(target)} kg last time (${st.fails} of 3 before a 10% deload). Get all ${total} reps to move up.`
    : `Get all ${total} reps at ${fmtKg(target)} kg → ${fmtKg(next)} kg next time.`;
  return { hint, plates: plateText(target, cfg) };
}

// ---------- Exercise card ----------

function hintText(h: Hint, rmin: number, rmax: number): string {
  switch (h.kind) {
    case 'first': return `First time: pick a weight you can lift for ${rmin}–${rmax} reps.`;
    case 'add_weight': return `Hit ${rmax} reps on every set last time. Try ${fmtKg(h.to)} kg.`;
    case 'top_of_rack': return `Top of the rack at ${fmtKg(h.weight)} kg. Add reps or slow the tempo.`;
    case 'add_reps': return `Beat last time: add a rep at ${fmtKg(h.weight)} kg (last: ${h.lastReps.join(', ')}). Aim for ${h.repMax}.`;
    case 'bodyweight_reps': return `Beat last time: ${h.lastReps.join(', ')} reps. At ${h.repMax}+ on every set, add weight.`;
  }
}

function ExerciseCard(props: {
  we: WorkoutExercise;
  exercise: Exercise | undefined;
  sets: WorkoutSet[];
  prev: PreviousSession | null;
  program: ProgramInfo | null;
  onEditSet: (s: WorkoutSet) => void;
  onSwap: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { we, exercise, sets, prev, program } = props;
  const [menu, setMenu] = useState(false);
  const [targets, setTargets] = useState(false);
  const [showNote, setShowNote] = useState(!!we.note);
  const defaults = rowDefaults(sets, prev, program ? we.rep_max : null);
  const hint = exercise && !program
    ? progressionHint(
      (prev?.working ?? []).map((s) => ({ weight_kg: s.weight_kg!, reps: s.reps!, rir: s.rir })),
      we, exercise, settings.value.dumbbell_ladder,
    )
    : null;

  const applyWeight = async (w: number) => {
    for (const s of sets) if (!s.completed_at && !s.is_warmup) await updateSet(s, { weight_kg: w });
  };

  const tapComplete = async (s: WorkoutSet) => {
    if (s.completed_at) { await uncompleteSet(s); return; }
    const d = defaults.get(s.id);
    const weight = d?.weight ?? (exercise?.equipment === 'bodyweight' ? 0 : null);
    if (weight == null || d?.reps == null) { props.onEditSet(s); return; }
    const prs = await completeSet(s, { weight_kg: weight, reps: d.reps, rir: program ? null : s.rir ?? (s.is_warmup ? null : we.target_rir) });
    announcePRs(exercise, prs, weight, d.reps);
  };

  if (we.skipped) {
    return (
      <section class="card ex-card skipped">
        <div class="row between">
          <span class="muted"><s>{exercise?.name}</s> · skipped</span>
          <button class="btn sm" onClick={() => patch('workout_exercises', we.id, { skipped: 0 })}>Unskip</button>
        </div>
      </section>
    );
  }

  return (
    <section class={`card ex-card ${program ? 'no-rir' : ''}`}>
      <div class="ex-head">
        <button class="ex-title" onClick={() => setMenu(true)}>
          <span class="bold">{exercise?.name ?? 'Unknown exercise'}</span>
          <span class="muted small block">
            {program
              ? `${we.target_sets} × ${we.rep_max} · rest 3:00 (5:00 after a miss)`
              : `${we.target_sets} × ${we.rep_min}–${we.rep_max} @ RIR ${fmtRir(we.target_rir)} · rest ${fmtClock(we.rest_s)}`}
          </span>
        </button>
        <button class="icon-btn" aria-label="Exercise menu" onClick={() => setMenu(true)}>⋯</button>
      </div>

      {program && (
        <div class="hint program-hint">
          <span>{program.hint}{program.plates && <span class="block plates">Plates: {program.plates}</span>}</span>
        </div>
      )}
      {hint && (
        <div class="hint">
          <span>{hintText(hint, we.rep_min, we.rep_max)}</span>
          {hint.kind === 'add_weight' && sets.some((s) => !s.completed_at && !s.is_warmup && s.weight_kg !== hint.to) && (
            <button class="link" onClick={() => applyWeight(hint.to)}>Apply</button>
          )}
        </div>
      )}

      {showNote && (
        <textarea class="note" placeholder="Note (seat height, grip, how it felt…)" value={we.note}
          onChange={(e) => patch('workout_exercises', we.id, { note: (e.currentTarget as HTMLTextAreaElement).value })} />
      )}

      <div class="set-grid set-head">
        <span>Set</span><span>Previous</span><span>kg</span><span>Reps</span>{!program && <span>RIR</span>}<span />
      </div>
      {sets.map((s) => {
        const d = defaults.get(s.id)!;
        const done = !!s.completed_at;
        const label = s.is_warmup ? 'W' : String(sets.filter((x) => !x.is_warmup).indexOf(s) + 1);
        return (
          <div key={s.id} class={`set-grid set-row ${done ? 'done' : ''} ${s.is_warmup ? 'warm' : ''}`}>
            <button class="cell setno" onClick={() => props.onEditSet(s)}>{label}</button>
            <button class="cell prev" onClick={() => props.onEditSet(s)}>{d.prevLabel ?? '–'}</button>
            <button class={`cell val ${s.weight_kg == null ? 'ghost' : ''}`} onClick={() => props.onEditSet(s)}>{fmtKg(d.weight)}</button>
            <button class={`cell val ${s.reps == null ? 'ghost' : ''}`} onClick={() => props.onEditSet(s)}>{d.reps ?? '–'}</button>
            {!program && (
              <button class={`cell rir ${s.rir == null ? 'ghost' : ''}`} onClick={() => props.onEditSet(s)}>
                {s.is_warmup ? '' : fmtRir(s.rir ?? we.target_rir)}
              </button>
            )}
            <button class={`check ${done ? 'on' : ''}`} aria-label={done ? 'Mark not done' : 'Complete set'} onClick={() => tapComplete(s)}>
              <IconCheck size={20} />
            </button>
            {s.pr_types?.length > 0 && <span class="pr-badge">PR</span>}
          </div>
        );
      })}
      <button class="btn ghost block sm" onClick={() => addSet(we)}>+ Add set</button>

      <Sheet open={menu} onClose={() => setMenu(false)} title={exercise?.name}>
        <div class="menu-list">
          <button onClick={() => { setMenu(false); addSet(we, true); }}>Add warm-up set</button>
          <button onClick={() => { setMenu(false); setShowNote(true); }}>{we.note ? 'Edit note' : 'Add note'}</button>
          {exercise && <button onClick={() => { setMenu(false); go(`/exercise/${exercise.id}`); }}>History &amp; muscles</button>}
          <button onClick={() => { setMenu(false); setTargets(true); }}>Edit targets &amp; rest</button>
          <button onClick={() => { setMenu(false); props.onSwap(); }}>Swap exercise</button>
          {!props.isFirst && <button onClick={() => { setMenu(false); moveExercise(we, -1); }}>Move up</button>}
          {!props.isLast && <button onClick={() => { setMenu(false); moveExercise(we, 1); }}>Move down</button>}
          <button onClick={() => { setMenu(false); patch('workout_exercises', we.id, { skipped: 1 }); }}>Skip for today</button>
          <button class="danger-text" onClick={async () => {
            setMenu(false);
            if (await confirmSheet(`Remove ${exercise?.name} and its sets from this workout?`, 'Remove', true)) removeExercise(we, true);
          }}>Remove from workout</button>
        </div>
      </Sheet>

      <Sheet open={targets} onClose={() => setTargets(false)} title="Targets for today">
        <TargetsForm we={we} onDone={() => setTargets(false)} />
      </Sheet>
    </section>
  );
}

function announcePRs(ex: Exercise | undefined, prs: PrType[], w: number, r: number) {
  if (!prs.length) return;
  const what = prs.includes('e1rm')
    ? `${PR_LABEL.e1rm}: ${fmtKg(round1(epley(w, r)))} kg`
    : prs.includes('weight') ? `${PR_LABEL.weight}: ${fmtKg(w)} kg` : `${PR_LABEL.reps}: ${r} × ${fmtKg(w)} kg`;
  toast(`🏆 PR · ${ex?.name ?? ''} · ${what}`, 'pr', 4500);
}

function TargetsForm({ we, onDone }: { we: WorkoutExercise; onDone: () => void }) {
  const [v, setV] = useState({ rep_min: we.rep_min, rep_max: we.rep_max, target_rir: we.target_rir, rest_s: we.rest_s });
  return (
    <div class="form">
      <div class="pair">
        <div><span class="pair-label">Fewest reps</span><Stepper value={v.rep_min} min={1} max={100} onChange={(x) => setV({ ...v, rep_min: x, rep_max: Math.max(x, v.rep_max) })} /></div>
        <div><span class="pair-label">Most reps</span><Stepper value={v.rep_max} min={1} max={100} onChange={(x) => setV({ ...v, rep_max: x, rep_min: Math.min(x, v.rep_min) })} /></div>
      </div>
      <label>Target RIR</label>
      <RirPicker value={v.target_rir} onChange={(x) => setV({ ...v, target_rir: x })} />
      <label>Rest between sets ({fmtClock(v.rest_s)})</label>
      <Stepper value={v.rest_s} step={15} min={0} max={900} unit="s" onChange={(x) => setV({ ...v, rest_s: x })} />
      <button class="btn primary block mt" onClick={async () => { await patch('workout_exercises', we.id, v); onDone(); }}>Save</button>
    </div>
  );
}

// ---------- Set editor ----------

function SetEditor(props: {
  set: WorkoutSet;
  exercise: Exercise | undefined;
  defaults: RowDefault | undefined;
  targetRir: number;
  /** 5×5 program lifts don't use reps in reserve. */
  noRir?: boolean;
  onClose: () => void;
}) {
  const { set, exercise } = props;
  const [weight, setWeight] = useState<number | null>(props.defaults?.weight ?? (exercise?.equipment === 'bodyweight' ? 0 : null));
  const [reps, setReps] = useState<number | null>(props.defaults?.reps ?? null);
  const [rir, setRir] = useState<number | null>(props.noRir ? null : set.rir ?? (set.is_warmup ? null : props.targetRir));
  const [warm, setWarm] = useState(!!set.is_warmup);
  const ladder = settings.value.dumbbell_ladder;
  const isDb = exercise?.equipment === 'dumbbell';
  const inc = exercise?.increment_kg || 2.5;

  const incW = (cur: number | null) => setWeight(nextWeight(exercise?.equipment ?? 'barbell', cur ?? 0, inc, ladder) ?? cur);
  const decW = (cur: number | null) => {
    if (isDb) {
      const lower = [...ladder].sort((a, b) => b - a).find((w) => w < (cur ?? 0) - 1e-9);
      setWeight(lower ?? 0);
    } else setWeight(Math.max(0, round1((cur ?? 0) - inc)));
  };

  const save = async (complete: boolean) => {
    const values = { weight_kg: weight, reps, rir: warm || props.noRir ? null : rir, is_warmup: (warm ? 1 : 0) as 0 | 1 };
    if (complete && !set.completed_at) {
      if (weight == null || reps == null) { toast('Enter weight and reps first'); return; }
      await updateSet(set, { is_warmup: values.is_warmup });
      const prs = await completeSet({ ...set, is_warmup: values.is_warmup }, { weight_kg: weight, reps, rir: values.rir });
      announcePRs(exercise, prs, weight, reps);
    } else {
      const prs = await updateSet(set, values);
      if (set.completed_at && prs.length && !(set.pr_types?.length)) announcePRs(exercise, prs, weight ?? 0, reps ?? 0);
    }
    props.onClose();
  };

  return (
    <Sheet open onClose={props.onClose} title={`${exercise?.name ?? ''} · ${warm ? 'warm-up' : `set ${set.set_number}`}`}>
      <div class="form">
        <label>Weight {exercise?.equipment === 'bodyweight' && <span class="muted">(added kg, 0 = bodyweight)</span>}</label>
        <Stepper size="lg" value={weight} decimals unit="kg" onChange={setWeight} onInc={incW} onDec={decW} placeholder="0" />
        <label>Reps</label>
        <Stepper size="lg" value={reps} min={0} max={200} onChange={setReps} placeholder="0" />
        {!warm && !props.noRir && (<>
          <label>Reps in reserve</label>
          <RirPicker value={rir} onChange={setRir} target={props.targetRir} />
        </>)}
        <Toggle label="Warm-up set" hint="Not counted for PRs, volume or rest stats" checked={warm} onChange={setWarm} />
        <div class="row gap mt">
          <button class="btn danger-outline" onClick={async () => { await deleteSet(set, true); props.onClose(); }}>Delete</button>
          {set.completed_at
            ? <button class="btn grow primary" onClick={() => save(false)}>Save</button>
            : (<>
              <button class="btn grow" onClick={() => save(false)}>Save</button>
              <button class="btn grow primary" onClick={() => save(true)}><IconCheck size={18} /> Complete</button>
            </>)}
        </div>
      </div>
    </Sheet>
  );
}
