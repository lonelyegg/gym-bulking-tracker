import { useState } from 'preact/hooks';
import { db, useLive } from '../db/db';
import type { Exercise } from '../db/schema';
import { REGIONS, regionOf, resolveMuscles, summaryLine, type Region } from '../lib/muscles';
import { Sheet } from './ui';
import { ExerciseForm } from '../screens/Plan';


export function ExercisePicker(props: { open: boolean; title?: string; onClose: () => void; onPick: (ex: Exercise) => void }) {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<Region | null>(null);
  const [creating, setCreating] = useState(false);
  const all = useLive(() => db.exercises.toArray(), []) ?? [];
  const list = all
    .filter((e) => !e.deleted)
    .filter((e) => !region || regionOf(resolveMuscles(e)) === region)
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pick = (e: Exercise) => { props.onPick(e); setQ(''); setRegion(null); props.onClose(); };

  return (
    <Sheet open={props.open} onClose={props.onClose} title={creating ? 'New exercise' : props.title ?? 'Choose exercise'}>
      {creating ? (
        <ExerciseForm initialName={q} onSaved={(ex) => { setCreating(false); pick(ex); }} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <input class="search" type="search" placeholder="Search exercises" value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          <div class="chips scroll-x">
            <button class={`chip ${!region ? 'on' : ''}`} onClick={() => setRegion(null)}>All</button>
            {REGIONS.map((r) => (
              <button key={r.id} class={`chip ${region === r.id ? 'on' : ''}`} onClick={() => setRegion(r.id)}>{r.label}</button>
            ))}
          </div>
          <div class="pick-list">
            {list.map((e) => (
              <button key={e.id} class="pick-item" onClick={() => pick(e)}>
                <span class="bold">{e.name}</span>
                <span class="muted small">{summaryLine(resolveMuscles(e))} · {e.equipment}</span>
              </button>
            ))}
            <button class="pick-item accent" onClick={() => setCreating(true)}>+ Create {q ? `“${q}”` : 'new exercise'}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
