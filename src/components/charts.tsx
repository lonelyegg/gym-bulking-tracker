// Small SVG charts: one series each. 2px line + 10% area wash, hairline grid, round markers
// with a surface ring, 4px-rounded columns capped at 24px. Tap or drag to inspect a point.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { niceTicks } from '../lib/stats';

export interface ChartPoint { key: string; x: number; y: number }

const PAD = { top: 14, right: 14, bottom: 24, left: 40 };

function useWidth(fallback = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(200, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

interface BaseProps {
  points: ChartPoint[];
  height?: number;
  color: string;
  formatY: (v: number) => string;
  formatX: (x: number) => string;
  /** Tooltip content for the selected point. */
  tip: (p: ChartPoint) => ComponentChildren;
  /** Tapping the tooltip (e.g. open that workout). */
  onOpen?: (p: ChartPoint) => void;
  /** Accessible name, e.g. "Estimated 1RM, Barbell Bench Press". */
  label: string;
  /** Start the y axis at zero (columns always do). */
  zero?: boolean;
}

function Frame(props: {
  width: number; height: number; ticks: number[]; y: (v: number) => number;
  formatY: (v: number) => string; xLabels: { x: number; text: string; anchor: 'start' | 'middle' | 'end' }[];
  children: ComponentChildren;
}) {
  const { width, height, ticks, y, formatY } = props;
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} class="chart-grid" />
          <text x={PAD.left - 8} y={y(t)} class="chart-tick" text-anchor="end" dominant-baseline="middle">{formatY(t)}</text>
        </g>
      ))}
      {props.children}
      {props.xLabels.map((l, i) => (
        <text key={i} x={l.x} y={height - 6} class="chart-tick" text-anchor={l.anchor}>{l.text}</text>
      ))}
    </>
  );
}

function Tooltip(props: { x: number; width: number; onOpen?: () => void; children: ComponentChildren }) {
  const W = 168;
  const left = Math.min(Math.max(props.x - W / 2, 0), props.width - W);
  return (
    <div class={`chart-tip ${props.onOpen ? 'tap' : ''}`} style={{ left: `${left}px`, width: `${W}px` }}
      onClick={(e) => { e.stopPropagation(); props.onOpen?.(); }}
      role={props.onOpen ? 'button' : undefined}>
      {props.children}
      {props.onOpen && <span class="chart-tip-open">Open ›</span>}
    </div>
  );
}

/** Hidden table so every value is reachable without the tooltip (screen readers). */
function DataTable({ points, label, formatX, formatY }: Pick<BaseProps, 'points' | 'label' | 'formatX' | 'formatY'>) {
  return (
    <table class="sr-only">
      <caption>{label}</caption>
      <tbody>{points.map((p) => <tr key={p.key}><td>{formatX(p.x)}</td><td>{formatY(p.y)}</td></tr>)}</tbody>
    </table>
  );
}

function useSelection(count: number) {
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(null); }, [count]);
  return [sel, setSel] as const;
}

export function LineChart(props: BaseProps) {
  const { points, height = 190, color } = props;
  const [ref, width] = useWidth();
  const [sel, setSel] = useSelection(points.length);
  if (!points.length) return null;

  const ys = points.map((p) => p.y);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const spread = hi - lo || Math.abs(hi) * 0.1 || 1;
  const ticks = niceTicks(props.zero ? 0 : Math.max(0, lo - spread * 0.25), hi + spread * 0.15, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x0 = points[0].x;
  const x1 = points[points.length - 1].x;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (v: number) => (x1 === x0 ? PAD.left + plotW / 2 : PAD.left + ((v - x0) / (x1 - x0)) * plotW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${x(x1).toFixed(1)},${PAD.top + plotH}L${x(x0).toFixed(1)},${PAD.top + plotH}Z`;
  const showMarkers = points.length <= 24;

  const pick = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(x(p.x) - px) < Math.abs(x(points[best].x) - px)) best = i; });
    setSel(best);
  };
  const sp = sel != null ? points[sel] : null;
  const xLabels = points.length > 1
    ? [{ x: x(x0), text: props.formatX(x0), anchor: 'start' as const }, { x: x(x1), text: props.formatX(x1), anchor: 'end' as const }]
    : [{ x: x(x0), text: props.formatX(x0), anchor: 'middle' as const }];

  return (
    <div class="chart" ref={ref} style={{ height: `${height}px` }}>
      <svg width={width} height={height} role="img" aria-label={props.label} tabIndex={0}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerMove={(e) => { if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX, e.currentTarget); }}
        onPointerLeave={(e) => {
          // Keep the tooltip while the mouse moves onto it (so it can be clicked).
          const to = e.relatedTarget as Node | null;
          if (e.pointerType === 'mouse' && !(to && ref.current?.contains(to))) setSel(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setSel(Math.min(points.length - 1, (sel ?? -1) + 1));
          if (e.key === 'ArrowLeft') setSel(Math.max(0, (sel ?? points.length) - 1));
          if (e.key === 'Enter' && sp) props.onOpen?.(sp);
        }}>
        <Frame width={width} height={height} ticks={ticks} y={y} formatY={props.formatY} xLabels={xLabels}>
          <path d={area} fill={color} fill-opacity="0.10" />
          <path d={line} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          {sp && <line x1={x(sp.x)} x2={x(sp.x)} y1={PAD.top} y2={PAD.top + plotH} class="chart-cross" />}
          {points.map((p, i) => (showMarkers || i === points.length - 1 || i === sel) && (
            <circle key={p.key} cx={x(p.x)} cy={y(p.y)} r={i === sel ? 6 : 4} fill={color} class="chart-dot" />
          ))}
        </Frame>
      </svg>
      {sp && <Tooltip x={x(sp.x)} width={width} onOpen={props.onOpen && (() => props.onOpen!(sp))}>{props.tip(sp)}</Tooltip>}
      <DataTable {...props} />
    </div>
  );
}

/** Columns, one per point, evenly spaced (e.g. one per session). */
export function ColumnChart(props: BaseProps) {
  const { points, height = 170, color } = props;
  const [ref, width] = useWidth();
  const [sel, setSel] = useSelection(points.length);
  if (!points.length) return null;

  const ticks = niceTicks(0, Math.max(...points.map((p) => p.y)), 4);
  const yMax = ticks[ticks.length - 1] || 1;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / points.length;
  const bw = Math.max(3, Math.min(24, slot - 2));
  const y = (v: number) => PAD.top + (1 - v / yMax) * plotH;
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const r = Math.min(4, bw / 2);
  const bar = (i: number, v: number) => {
    const x0 = cx(i) - bw / 2;
    const top = y(v);
    const base = PAD.top + plotH;
    const rr = Math.min(r, base - top);
    return `M${x0},${base}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${base}Z`;
  };
  const sp = sel != null ? points[sel] : null;
  const xLabels = points.length > 1
    ? [{ x: cx(0), text: props.formatX(points[0].x), anchor: 'start' as const }, { x: cx(points.length - 1), text: props.formatX(points[points.length - 1].x), anchor: 'end' as const }]
    : [{ x: cx(0), text: props.formatX(points[0].x), anchor: 'middle' as const }];

  return (
    <div class="chart" ref={ref} style={{ height: `${height}px` }}>
      <svg width={width} height={height} role="img" aria-label={props.label} tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setSel(Math.min(points.length - 1, (sel ?? -1) + 1));
          if (e.key === 'ArrowLeft') setSel(Math.max(0, (sel ?? points.length) - 1));
          if (e.key === 'Enter' && sp) props.onOpen?.(sp);
        }}>
        <Frame width={width} height={height} ticks={ticks} y={y} formatY={props.formatY} xLabels={xLabels}>
          {points.map((p, i) => (
            <g key={p.key}>
              <path d={bar(i, p.y)} fill={color} fill-opacity={sel == null || sel === i ? 1 : 0.45} />
              {/* The whole slot is the hit target, not just the painted bar. */}
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent"
                onPointerDown={() => setSel(i)}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setSel(i); }} />
            </g>
          ))}
        </Frame>
      </svg>
      {sp && <Tooltip x={cx(sel!)} width={width} onOpen={props.onOpen && (() => props.onOpen!(sp))}>{props.tip(sp)}</Tooltip>}
      <DataTable {...props} />
    </div>
  );
}
