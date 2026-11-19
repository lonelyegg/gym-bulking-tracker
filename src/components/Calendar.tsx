// Month calendar.
//  - Training days show their day-type icon on its colour. Tap to open the workout.
//  - Upcoming days show your plan faintly (projected from your real history, so it reshuffles itself).
//  - Tap an empty day: today → start a workout; a past day → log it afterwards.
// Swipe or use the arrows to change month.
import { useRef, useState } from 'preact/hooks';
import { localDate } from '../lib/logic';
import { addMonths, monthGrid, type W } from '../lib/stats';
import { IconChevron, IconChevronLeft } from './icons';
import { StartSheet } from './StartSheet';
import { go, Sheet } from './ui';
import type { PlanCell } from './usePlan';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function MonthCalendar(props: {
  month: string;
  onMonth: (ym: string) => void;
  byDate: Map<string, W[]>;
  plan?: Map<string, PlanCell>;
  /** Earliest month you can go back to. */
  minMonth?: string;
  size?: 'compact' | 'large';
}) {
  const { month, byDate, plan } = props;
  const today = localDate();
  const thisMonth = today.slice(0, 7);
  const maxMonth = plan?.size ? addMonths(thisMonth, 1) : thisMonth;
  const [picking, setPicking] = useState<W[] | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const touch = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const canPrev = !props.minMonth || month > props.minMonth;
  const canNext = month < maxMonth;

  const tap = (date: string, list: W[] | undefined) => {
    if (list?.length === 1) go(`/w/${list[0].id}`);
    else if (list?.length) setPicking(list);
    else if (date <= today) setStartDate(date);
  };

  return (
    <div class={`cal ${props.size === 'large' ? 'cal-large' : ''}`}
      onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY, swiped: false }; }}
      onTouchEnd={(e) => {
        const s = touch.current;
        const t = e.changedTouches[0];
        if (!s) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dy) < 40) {
          s.swiped = true;
          if (dx < 0 && canNext) props.onMonth(addMonths(month, 1));
          if (dx > 0 && canPrev) props.onMonth(addMonths(month, -1));
        }
      }}>
      <div class="cal-head">
        <span class="cal-title">{monthLabel(month)}</span>
        {month !== thisMonth && <button class="cal-today" onClick={() => props.onMonth(thisMonth)}>Today</button>}
        <button class="icon-btn sm" aria-label="Previous month" disabled={!canPrev} onClick={() => props.onMonth(addMonths(month, -1))}><IconChevronLeft /></button>
        <button class="icon-btn sm" aria-label="Next month" disabled={!canNext} onClick={() => props.onMonth(addMonths(month, 1))}><IconChevron /></button>
      </div>
      <div class="cal-grid cal-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div class="cal-grid">
        {monthGrid(month).flat().map(({ date, inMonth }) => {
          const list = byDate.get(date);
          const w = list?.[0];
          const p = !w ? plan?.get(date) : undefined;
          const day = Number(date.slice(8));
          const future = date > today;
          const cls = ['cal-day', inMonth ? '' : 'out', date === today ? 'today' : '', future ? 'future' : '',
            w ? 'trained' : '', p ? `planned ${p.kind}` : ''].join(' ');
          const what = list ? list.map((x) => x.name).join(', ') : p ? `planned: ${p.kind === 'rest' ? 'rest day' : p.name}` : future ? '' : 'tap to log a workout';
          const style = w ? { '--c': w.color } : p?.kind === 'workout' ? { '--c': p.color } : undefined;
          return (
            <button key={date} class={cls} style={style} aria-label={`${date}${what ? `: ${what}` : ''}`}
              disabled={future && !list}
              onClick={() => { if (!touch.current?.swiped) tap(date, list); if (touch.current) touch.current.swiped = false; }}>
              <span class="cal-num">{day}</span>
              {w && <span class="cal-icon">{w.icon}</span>}
              {p?.kind === 'workout' && <span class="cal-icon">{p.icon}</span>}
              {p?.kind === 'rest' && <span class="cal-rest">rest</span>}
              {list && list.length > 1 && <span class="cal-more">{list.length}</span>}
            </button>
          );
        })}
      </div>
      {plan && plan.size > 0 && (
        <div class="cal-key">
          <span><i class="k-done" />Trained</span><span><i class="k-plan" />Planned</span><span><i class="k-today" />Today</span>
        </div>
      )}

      <Sheet open={!!picking} onClose={() => setPicking(null)} title="Which workout?">
        <div class="menu-list">
          {picking?.map((w) => (
            <button key={w.id} onClick={() => { setPicking(null); go(`/w/${w.id}`); }}>
              <span class="day-dot" style={{ background: w.color }}>{w.icon}</span>
              <span class="grow">{w.name}</span>
              <span class="muted small">{new Date(w.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <StartSheet open={!!startDate} date={startDate ?? undefined} onClose={() => setStartDate(null)} />
    </div>
  );
}
