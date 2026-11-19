// Pick the muscles an exercise trains. Tap a muscle (on the list or the body) to cycle:
// off → Main → Also worked → Minor → off.
import { heat, MUSCLES, REGIONS, type Muscle, type MuscleMap } from '../lib/muscles';
import { BodyMap, MuscleLegend } from './BodyMap';

const NEXT: Record<string, number> = { '0': 1, '1': 0.5, '0.5': 0.25, '0.25': 0 };
const LEVEL: Record<string, string> = { '1': 'Main', '0.5': 'Also', '0.25': 'Minor' };

export function MuscleEditor({ value, onChange }: { value: MuscleMap; onChange: (m: MuscleMap) => void }) {
  const cycle = (m: Muscle) => {
    const next = NEXT[String(value[m] ?? 0)] ?? 0;
    const out = { ...value };
    if (next) out[m] = next; else delete out[m];
    onChange(out);
  };
  return (
    <div class="muscle-editor">
      <BodyMap values={value} label="Muscles this exercise trains" onTap={cycle} />
      <MuscleLegend />
      <p class="fine center-text">Tap a muscle to cycle Main → Also worked → Minor → off.</p>
      {REGIONS.map((r) => (
        <div key={r.id} class="me-region">
          <div class="me-region-label">{r.label}</div>
          <div class="chips wrap">
            {MUSCLES.filter((m) => m.region === r.id).map((m) => {
              const w = value[m.id] ?? 0;
              return (
                <button key={m.id} type="button" class={`chip me-chip ${w ? 'set' : ''}`} onClick={() => cycle(m.id)}
                  style={w ? { background: heat(w), borderColor: heat(w) } : undefined} aria-label={`${m.label}: ${LEVEL[String(w)] ?? 'off'}`}>
                  {m.label}{w ? <span class="me-level">{LEVEL[String(w)]}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
