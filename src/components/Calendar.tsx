// Month calendar: each training day shows its day-type icon on its colour. Tap a day to open
// that workout (a picker appears if there were two). Swipe or use the arrows to change month.
import { useRef, useState } from 'preact/hooks';
import { localDate } from '../lib/logic';
import { addMonths, monthGrid, type W } from '../lib/stats';
import { IconChevron, IconChevronLeft } from './icons';
import { go, Sheet } from './ui';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function MonthCalendar(props: {
  month: string;
  onMonth: (ym: string) => void;
  byDate: Map<string, W[]>;
  /** Earliest month you can go back to. */
  minMonth?: string;
  size?: 'compact' | 'large';
}) {
  const { month, byDate } = props;
  const today = localDate();
  const thisMonth = today.slice(0, 7);
  const [picking, setPicking] = useState<W[] | null>(null);
  const touch = useRef<{ x: number; y: number; swiped: boolean } | null>(null);
  const canPrev = !props.minMonth || month > props.minMonth;
  const canNext = month < thisMonth;

  const open = (list: W[] | undefined) => {
    if (!list?.length) return;
    if (list.length === 1) go(`/w/${list[0].id}`);
    else setPicking(list);
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
          const day = Number(date.slice(8));
          const cls = ['cal-day', inMonth ? '' : 'out', date === today ? 'today' : '', date > today ? 'future' : '', w ? 'trained' : ''].join(' ');
          const label = `${date}${list ? `: ${list.map((x) => x.name).join(', ')}` : ''}`;
          return (
            <button key={date} class={cls} style={w ? { '--c': w.color } : undefined} aria-label={label}
              disabled={!w} onClick={() => { if (!touch.current?.swiped) open(list); if (touch.current) touch.current.swiped = false; }}>
              <span class="cal-num">{day}</span>
              {w && <span class="cal-icon">{w.icon}</span>}
              {list && list.length > 1 && <span class="cal-more">{list.length}</span>}
            </button>
          );
        })}
      </div>

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
    </div>
  );
}
