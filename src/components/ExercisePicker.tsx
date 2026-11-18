import { useState } from 'preact/hooks';
import { db, useLive } from '../db/db';
import { MUSCLE_GROUPS, type Exercise, type MuscleGroup } from '../db/schema';
import { Sheet } from './ui';
import { ExerciseForm } from '../screens/Plan';

export const muscleLabel = (m: string) => m.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

export function ExercisePicker(props: { open: boolean; title?: string; onClose: () => void; onPick: (ex: Exercise) => void }) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const all = useLive(() => db.exercises.toArray(), []) ?? [];
  const list = all
    .filter((e) => !e.deleted)
    .filter((e) => !muscle || e.muscle_group === muscle)
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pick = (e: Exercise) => { props.onPick(e); setQ(''); setMuscle(null); props.onClose(); };

  return (
    <Sheet open={props.open} onClose={props.onClose} title={creating ? 'New exercise' : props.title ?? 'Choose exercise'}>
      {creating ? (
        <ExerciseForm initialName={q} onSaved={(ex) => { setCreating(false); pick(ex); }} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <input class="search" type="search" placeholder="Search exercises" value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          <div class="chips scroll-x">
            <button class={`chip ${!muscle ? 'on' : ''}`} onClick={() => setMuscle(null)}>All</button>
            {MUSCLE_GROUPS.map((m) => (
              <button key={m} class={`chip ${muscle === m ? 'on' : ''}`} onClick={() => setMuscle(m)}>{muscleLabel(m)}</button>
            ))}
          </div>
          <div class="pick-list">
            {list.map((e) => (
              <button key={e.id} class="pick-item" onClick={() => pick(e)}>
                <span class="bold">{e.name}</span>
                <span class="muted small">{muscleLabel(e.muscle_group)} · {e.mechanic} · {e.equipment}</span>
              </button>
            ))}
            <button class="pick-item accent" onClick={() => setCreating(true)}>+ Create {q ? `“${q}”` : 'new exercise'}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
