import { useState } from 'preact/hooks';
import { alive, db, patch, put, softDelete, useLive } from '../db/db';
import {
  EQUIPMENT, MUSCLE_GROUPS, REST,
  type DayType, type Equipment, type Exercise, type Mechanic, type MuscleGroup, type TemplateExercise,
} from '../db/schema';
import { fmtClock, fmtRir } from '../lib/logic';
import { saveSetting, settings } from '../state/settings';
import { ExercisePicker, muscleLabel } from '../components/ExercisePicker';
import {
  confirmSheet, DAY_COLORS, DAY_ICONS, go, Header, RirPicker, Sheet, Stepper, toast,
} from '../components/ui';

const liveDayTypes = async () => (await db.day_types.toArray()).filter((d) => !d.deleted).sort((a, b) => a.name.localeCompare(b.name));

// ---------- Plan overview ----------

export function PlanScreen() {
  const splits = useLive(async () => (await db.splits.toArray()).filter((s) => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)), []) ?? [];
  const dayTypes = useLive(liveDayTypes, []) ?? [];
  const activeId = settings.value.active_split_id;
  const dt = (id: string) => dayTypes.find((d) => d.id === id);

  const newSplit = async () => {
    const [s] = await put('splits', { name: 'My split', rotation: [] });
    go(`/plan/split/${s.id}`);
  };
  const newDay = async () => {
    const [d] = await put('day_types', { name: 'New day', icon: '🏋️', color: '#4ea8de', transition_rest_s: null });
    go(`/plan/day/${d.id}`);
  };

  return (
    <div class="page">
      <Header title="Plan" />
      <section class="card">
        <div class="row between center">
          <span class="bold">Sessions per week</span>
          <div class="w-50"><Stepper value={settings.value.weekly_target} min={1} max={14} onChange={(v) => saveSetting('weekly_target', v)} /></div>
        </div>
      </section>

      <h3 class="section-title">Splits</h3>
      {splits.map((s) => (
        <button key={s.id} class={`list-item ${s.id === activeId ? 'active-split' : ''}`} onClick={() => go(`/plan/split/${s.id}`)}>
          <span class="grow left">
            <span class="block bold">{s.name} {s.id === activeId && <span class="tag">Active</span>}</span>
            <span class="rotation-mini">
              {s.rotation.map((id, i) => id === REST
                ? <span key={i} class="rot-chip rest">😴</span>
                : <span key={i} class="rot-chip" style={{ background: dt(id)?.color }}>{dt(id)?.icon}</span>)}
            </span>
          </span>
          <span class="muted">›</span>
        </button>
      ))}
      <button class="btn ghost block" onClick={newSplit}>+ New split</button>

      <h3 class="section-title">Day types</h3>
      {dayTypes.map((d) => (
        <button key={d.id} class="list-item" onClick={() => go(`/plan/day/${d.id}`)}>
          <span class="day-dot" style={{ background: d.color }}>{d.icon}</span>
          <span class="grow left bold">{d.name}</span>
          <span class="muted">›</span>
        </button>
      ))}
      <button class="btn ghost block" onClick={newDay}>+ New day type</button>

      <h3 class="section-title">Library</h3>
      <button class="list-item" onClick={() => go('/plan/exercises')}>
        <span class="grow left bold">Exercise library</span><span class="muted">›</span>
      </button>
      <div class="bottom-space" />
    </div>
  );
}

// ---------- Split editor ----------

export function SplitEditorScreen({ id }: { id: string }) {
  const split = useLive(() => db.splits.get(id), [id]);
  const dayTypes = useLive(liveDayTypes, []) ?? [];
  const [adding, setAdding] = useState(false);
  if (!split) return <div class="page" />;
  const isActive = settings.value.active_split_id === id;
  const setRot = (rotation: string[]) => patch('splits', id, { rotation });
  const move = (i: number, d: number) => {
    const r = [...split.rotation];
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    setRot(r);
  };

  return (
    <div class="page">
      <Header title="Edit split" back="/plan" />
      <div class="form">
        <label>Name</label>
        <input class="input" value={split.name} onChange={(e) => patch('splits', id, { name: (e.currentTarget as HTMLInputElement).value })} />
      </div>
      {isActive
        ? <p class="good small">✓ This is your active split.</p>
        : <button class="btn primary block" onClick={() => saveSetting('active_split_id', id)}>Make this my active split</button>}

      <h3 class="section-title">Rotation</h3>
      <p class="muted small">Repeats in order. Rest days count as calendar days off.</p>
      {split.rotation.map((entry, i) => {
        const d = dayTypes.find((x) => x.id === entry);
        return (
          <div key={i} class="list-item static">
            <span class="muted small w-20">{i + 1}</span>
            {entry === REST
              ? <><span class="day-dot rest">😴</span><span class="grow">Rest day</span></>
              : <><span class="day-dot" style={{ background: d?.color }}>{d?.icon}</span><span class="grow">{d?.name ?? 'Deleted day'}</span></>}
            <button class="icon-btn sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
            <button class="icon-btn sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
            <button class="icon-btn sm" aria-label="Remove" onClick={() => setRot(split.rotation.filter((_, k) => k !== i))}>✕</button>
          </div>
        );
      })}
      <button class="btn ghost block" onClick={() => setAdding(true)}>+ Add day</button>

      <button class="btn ghost block danger-text mt" onClick={async () => {
        if (!(await confirmSheet(`Delete split “${split.name}”? Day types are kept.`, 'Delete', true))) return;
        await softDelete('splits', [id]);
        if (isActive) await saveSetting('active_split_id', null);
        go('/plan');
      }}>Delete split</button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add to rotation">
        <div class="menu-list">
          <button onClick={() => { setRot([...split.rotation, REST]); setAdding(false); }}>😴 Rest day</button>
          {dayTypes.map((d) => (
            <button key={d.id} onClick={() => { setRot([...split.rotation, d.id]); setAdding(false); }}>
              <span class="day-dot" style={{ background: d.color }}>{d.icon}</span> {d.name}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

// ---------- Day type editor ----------

export function DayTypeEditorScreen({ id }: { id: string }) {
  const day = useLive(() => db.day_types.get(id), [id]);
  const tpl = useLive(async () => (await db.template_exercises.where('day_type_id').equals(id).toArray())
    .filter((t) => !t.deleted).sort((a, b) => a.position - b.position), [id]) ?? [];
  const exercises = useLive(() => db.exercises.toArray(), []) ?? [];
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<TemplateExercise | null>(null);
  if (!day) return <div class="page" />;
  const exName = (eid: string) => exercises.find((e) => e.id === eid)?.name ?? 'Unknown';

  const add = async (ex: Exercise) => {
    await put('template_exercises', {
      day_type_id: id, exercise_id: ex.id, position: (tpl.at(-1)?.position ?? -1) + 1,
      target_sets: 3, rep_min: ex.mechanic === 'compound' ? 6 : 10, rep_max: ex.mechanic === 'compound' ? 10 : 15,
      target_rir: ex.mechanic === 'compound' ? 2 : 1, rest_s: ex.default_rest_s,
    });
  };
  const move = async (i: number, d: number) => {
    const list = [...tpl];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) if (list[k].position !== k) await patch('template_exercises', list[k].id, { position: k });
  };

  return (
    <div class="page">
      <Header title="Edit day" back="/plan" />
      <div class="form">
        <label>Name</label>
        <input class="input" value={day.name} onChange={(e) => patch('day_types', id, { name: (e.currentTarget as HTMLInputElement).value })} />
        <label>Icon</label>
        <div class="icon-grid">
          {DAY_ICONS.map((ic) => (
            <button key={ic} class={`icon-pick ${day.icon === ic ? 'on' : ''}`} onClick={() => patch('day_types', id, { icon: ic })}>{ic}</button>
          ))}
        </div>
        <label>Colour</label>
        <div class="icon-grid">
          {DAY_COLORS.map((c) => (
            <button key={c} aria-label={c} class={`color-pick ${day.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => patch('day_types', id, { color: c })} />
          ))}
        </div>
        <label>Rest after the last set of an exercise</label>
        <Stepper
          value={day.transition_rest_s ?? settings.value.transition_rest_s}
          step={15} min={0} max={900} unit="s"
          onChange={(v) => patch('day_types', id, { transition_rest_s: v })}
        />
        <span class="muted small">{day.transition_rest_s == null ? 'Using the default from Settings.' : fmtClock(day.transition_rest_s)}</span>
      </div>

      <h3 class="section-title">Exercises</h3>
      {tpl.map((t, i) => (
        <div key={t.id} class="list-item static">
          <button class="grow left plain" onClick={() => setEditing(t)}>
            <span class="block bold">{exName(t.exercise_id)}</span>
            <span class="block muted small">{t.target_sets} × {t.rep_min}–{t.rep_max} @ RIR {fmtRir(t.target_rir)} · rest {fmtClock(t.rest_s)}</span>
          </button>
          <button class="icon-btn sm" aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
          <button class="icon-btn sm" aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
        </div>
      ))}
      <button class="btn ghost block" onClick={() => setPicking(true)}>+ Add exercise</button>

      <button class="btn ghost block danger-text mt" onClick={async () => {
        const used = (await db.splits.toArray()).filter((s) => !s.deleted && s.rotation.includes(id));
        if (used.length) { toast(`Used in: ${used.map((s) => s.name).join(', ')}. Remove it there first.`); return; }
        if (!(await confirmSheet(`Delete “${day.name}”?`, 'Delete', true))) return;
        await softDelete('template_exercises', tpl.map((t) => t.id));
        await softDelete('day_types', [id]);
        go('/plan');
      }}>Delete day type</button>
      <div class="bottom-space" />

      <ExercisePicker open={picking} onClose={() => setPicking(false)} onPick={add} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing ? exName(editing.exercise_id) : ''}>
        {editing && <TemplateForm t={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function TemplateForm({ t, onDone }: { t: TemplateExercise; onDone: () => void }) {
  const [v, setV] = useState({ target_sets: t.target_sets, rep_min: t.rep_min, rep_max: t.rep_max, target_rir: t.target_rir, rest_s: t.rest_s });
  return (
    <div class="form">
      <label>Sets</label>
      <Stepper value={v.target_sets} min={1} max={10} onChange={(x) => setV({ ...v, target_sets: x })} />
      <label>Rep range (min – max)</label>
      <div class="row gap">
        <Stepper value={v.rep_min} min={1} max={100} onChange={(x) => setV({ ...v, rep_min: x, rep_max: Math.max(x, v.rep_max) })} />
        <Stepper value={v.rep_max} min={1} max={100} onChange={(x) => setV({ ...v, rep_max: x, rep_min: Math.min(x, v.rep_min) })} />
      </div>
      <label>Target reps in reserve</label>
      <RirPicker value={v.target_rir} onChange={(x) => setV({ ...v, target_rir: x })} />
      <label>Rest between sets ({fmtClock(v.rest_s)})</label>
      <Stepper value={v.rest_s} step={15} min={0} max={900} unit="s" onChange={(x) => setV({ ...v, rest_s: x })} />
      <div class="row gap mt">
        <button class="btn danger-outline" onClick={async () => { await softDelete('template_exercises', [t.id]); onDone(); }}>Remove</button>
        <button class="btn grow primary" onClick={async () => { await patch('template_exercises', t.id, v); onDone(); }}>Save</button>
      </div>
    </div>
  );
}

// ---------- Exercise library ----------

export function ExercisesScreen() {
  const [q, setQ] = useState('');
  const all = useLive(() => db.exercises.toArray(), []) ?? [];
  const list = all.filter((e) => !e.deleted && (!q || e.name.toLowerCase().includes(q.toLowerCase())));
  const groups = MUSCLE_GROUPS.map((m) => [m, list.filter((e) => e.muscle_group === m).sort((a, b) => a.name.localeCompare(b.name))] as const)
    .filter(([, l]) => l.length);
  return (
    <div class="page">
      <Header title="Exercises" back="/plan" right={<button class="btn sm primary" onClick={() => go('/plan/exercise/new')}>New</button>} />
      <input class="search" type="search" placeholder="Search" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      {groups.map(([m, l]) => (
        <section key={m}>
          <h3 class="section-title">{muscleLabel(m)}</h3>
          {l.map((e) => (
            <button key={e.id} class="list-item" onClick={() => go(`/plan/exercise/${e.id}`)}>
              <span class="grow left">
                <span class="block bold">{e.name}</span>
                <span class="block muted small">{e.mechanic} · {e.equipment} · +{e.equipment === 'dumbbell' ? 'rack' : `${e.increment_kg} kg`} · rest {fmtClock(e.default_rest_s)}</span>
              </span>
              <span class="muted">›</span>
            </button>
          ))}
        </section>
      ))}
      <div class="bottom-space" />
    </div>
  );
}

export function ExerciseEditScreen({ id }: { id: string }) {
  const ex = useLive(async () => (id === 'new' ? null : (await db.exercises.get(id)) ?? null), [id]);
  if (ex === undefined) return <div class="page" />;
  return (
    <div class="page">
      <Header title={ex ? 'Edit exercise' : 'New exercise'} back="/plan/exercises" />
      <ExerciseForm existing={ex ?? undefined} onSaved={() => go('/plan/exercises')} onCancel={() => go('/plan/exercises')} />
      {alive(ex ?? undefined) && (
        <button class="btn ghost block danger-text mt" onClick={async () => {
          if (await confirmSheet(`Delete ${ex!.name}? Past workouts keep their sets.`, 'Delete', true)) {
            await softDelete('exercises', [ex!.id]);
            go('/plan/exercises');
          }
        }}>Delete exercise</button>
      )}
    </div>
  );
}

export function ExerciseForm(props: { existing?: Exercise; initialName?: string; onSaved: (e: Exercise) => void; onCancel: () => void }) {
  const e = props.existing;
  const [name, setName] = useState(e?.name ?? props.initialName ?? '');
  const [muscle, setMuscle] = useState<MuscleGroup>(e?.muscle_group ?? 'chest');
  const [mechanic, setMechanic] = useState<Mechanic>(e?.mechanic ?? 'compound');
  const [equipment, setEquipment] = useState<Equipment>(e?.equipment ?? 'barbell');
  const [inc, setInc] = useState(e?.increment_kg ?? 2.5);
  const [rest, setRest] = useState<number | null>(e?.default_rest_s ?? null);
  const restVal = rest ?? (mechanic === 'compound' ? settings.value.compound_rest_s : settings.value.isolation_rest_s);

  const pickEquipment = (q: Equipment) => {
    setEquipment(q);
    if (!e) setInc(q === 'machine' ? 7 : 2.5);
  };

  const save = async () => {
    if (!name.trim()) { toast('Give it a name'); return; }
    const [saved] = await put('exercises', {
      ...(e ?? {}),
      name: name.trim(), muscle_group: muscle, mechanic, equipment, increment_kg: inc,
      default_rest_s: restVal, notes: e?.notes ?? '',
    } as Exercise);
    props.onSaved(saved);
  };

  return (
    <div class="form">
      <label>Name</label>
      <input class="input" value={name} onInput={(ev) => setName((ev.currentTarget as HTMLInputElement).value)} />
      <label>Muscle group</label>
      <div class="chips wrap">
        {MUSCLE_GROUPS.map((m) => <button key={m} class={`chip ${muscle === m ? 'on' : ''}`} onClick={() => setMuscle(m)}>{muscleLabel(m)}</button>)}
      </div>
      <label>Type</label>
      <div class="chips">
        {(['compound', 'isolation'] as Mechanic[]).map((m) => <button key={m} class={`chip ${mechanic === m ? 'on' : ''}`} onClick={() => setMechanic(m)}>{m}</button>)}
      </div>
      <label>Equipment</label>
      <div class="chips wrap">
        {EQUIPMENT.map((q) => <button key={q} class={`chip ${equipment === q ? 'on' : ''}`} onClick={() => pickEquipment(q)}>{q}</button>)}
      </div>
      {equipment === 'dumbbell'
        ? <p class="muted small">Weight jumps follow your dumbbell rack (Settings).</p>
        : (<>
          <label>Weight jump (kg)</label>
          <Stepper value={inc} step={0.5} min={0.5} max={50} decimals unit="kg" onChange={setInc} />
        </>)}
      <label>Default rest ({fmtClock(restVal)})</label>
      <Stepper value={restVal} step={15} min={0} max={900} unit="s" onChange={setRest} />
      <div class="row gap mt">
        <button class="btn grow" onClick={props.onCancel}>Cancel</button>
        <button class="btn grow primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

export type { DayType };
