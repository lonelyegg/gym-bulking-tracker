// Front and back body map. Each muscle is shaded by how much it's worked: grey → red.
import { heat, muscleLabel, type Muscle, type MuscleMap } from '../lib/muscles';
import { BACK, FRONT, HEAD, PAINT_ORDER, SILHOUETTE, type View } from './bodyPaths';

function Figure(props: { view: View; x: number; values: MuscleMap; max: number; onTap?: (m: Muscle) => void; selected?: Muscle | null }) {
  const shapes = props.view === 'front' ? FRONT : BACK;
  const half = (mirror: boolean) => (
    <g transform={mirror ? 'translate(100,0) scale(-1,1)' : undefined}>
      <path d={SILHOUETTE} class="bm-skin" />
      {PAINT_ORDER.map((m) => (shapes[m] ?? []).map((d, i) => {
        const v = props.values[m] ?? 0;
        return (
          <path key={`${m}-${i}`} d={d} fill={heat(v / props.max)}
            class={`bm-muscle ${props.selected === m ? 'sel' : ''} ${props.onTap ? 'tap' : ''}`}
            onClick={props.onTap ? () => props.onTap!(m) : undefined}>
            <title>{muscleLabel(m)}{v ? ` · ${Math.round(v * 10) / 10}` : ''}</title>
          </path>
        );
      }))}
    </g>
  );
  return (
    <g transform={`translate(${props.x},0) translate(50,0) scale(1.12,1) translate(-50,0)`}>
      {half(false)}
      {half(true)}
      <ellipse {...HEAD} class="bm-skin" />
      <text x="50" y="219" class="bm-caption" text-anchor="middle" transform="translate(50,0) scale(0.893,1) translate(-50,0)">{props.view === 'front' ? 'Front' : 'Back'}</text>
    </g>
  );
}

/**
 * @param values per-muscle amount (exercise weights 0.25–1, or weekly sets)
 * @param max    the amount that shows full red (1 for exercise weights, e.g. 10 for weekly sets)
 */
export function BodyMap(props: { values: MuscleMap; max?: number; label: string; onTap?: (m: Muscle) => void; selected?: Muscle | null }) {
  const max = props.max ?? 1;
  return (
    <svg class="bodymap" viewBox="-4 0 226 224" role="img" aria-label={props.label}>
      <Figure view="front" x={0} values={props.values} max={max} onTap={props.onTap} selected={props.selected} />
      <Figure view="back" x={118} values={props.values} max={max} onTap={props.onTap} selected={props.selected} />
    </svg>
  );
}

/** Legend for exercise maps: what the three shades mean. */
export function MuscleLegend() {
  return (
    <div class="bm-legend">
      {[[1, 'Main'], [0.5, 'Also worked'], [0.25, 'Minor']].map(([w, l]) => (
        <span key={l as string}><i style={{ background: heat(w as number) }} />{l}</span>
      ))}
    </div>
  );
}
