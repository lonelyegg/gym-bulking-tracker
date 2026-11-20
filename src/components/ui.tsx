import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconCheck, IconChevron, IconChevronLeft, IconClose, IconTrophy } from './icons';

// ---------- Router (hash based: works on GitHub Pages without rewrites) ----------

export const route = signal(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => {
  route.value = location.hash.slice(1) || '/';
  window.scrollTo(0, 0);
});
export const go = (path: string) => { location.hash = path; };
export const back = (fallback = '/') => {
  if (history.length > 1) history.back();
  else go(fallback);
};

// ---------- Toasts ----------

interface Toast { id: number; text: string; kind: 'info' | 'pr' }
export const toasts = signal<Toast[]>([]);
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3000) {
  const t = { id: ++toastId, text, kind };
  toasts.value = [...toasts.value, t].slice(-2); // at most two on screen
  setTimeout(() => { toasts.value = toasts.value.filter((x) => x.id !== t.id); }, ms);
}

export function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => {
        const done = t.text.endsWith(' ✓');
        const pr = t.text.startsWith('🏆');
        const text = t.text.replace(/ ✓$/, '').replace(/^🏆\s*/, '');
        return (
          <div key={t.id} class={`toast ${t.kind}`} role="status">
            {pr ? <IconTrophy size={18} /> : done ? <IconCheck size={18} class="toast-ok" /> : null}
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Bottom sheet ----------

export function Sheet(props: { open: boolean; onClose: () => void; title?: ComponentChildren; children: ComponentChildren }) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  useEffect(() => {
    if (!props.open) return;
    setClosing(false);
    document.body.classList.add('noscroll');
    return () => document.body.classList.remove('noscroll');
  }, [props.open]);
  if (!props.open) return null;
  /** Slide down, then tell the parent. */
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => props.onClose(), 180);
  };
  // Drag the grip or title bar down to dismiss.
  const onStart = (e: TouchEvent) => { drag.current = { y: e.touches[0].clientY, dy: 0 }; };
  const onMove = (e: TouchEvent) => {
    const d = drag.current;
    if (!d || !sheet.current) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y);
    sheet.current.style.transform = `translateY(${d.dy}px)`;
    sheet.current.style.transition = 'none';
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!sheet.current || !d) return;
    sheet.current.style.transition = 'transform .2s ease';
    if (d.dy > 90) { sheet.current.style.transform = 'translateY(100%)'; setTimeout(() => props.onClose(), 180); } else sheet.current.style.transform = '';
  };
  return (
    <div class={`sheet-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div class="sheet" ref={sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}>
          <div class="sheet-grip" />
          {props.title != null && (
            <div class="sheet-head">
              <div class="sheet-title">{props.title}</div>
              <button class="sheet-close" aria-label="Close" onClick={close}><IconClose size={16} /></button>
            </div>
          )}
        </div>
        {props.children}
      </div>
    </div>
  );
}

/** Promise-based confirm dialog rendered as a sheet. */
const confirmState = signal<{ text: string; ok: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
export function confirmSheet(text: string, ok = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => { confirmState.value = { text, ok, danger, resolve }; });
}
export function ConfirmHost() {
  const c = confirmState.value;
  const close = (v: boolean) => { c?.resolve(v); confirmState.value = null; };
  return (
    <Sheet open={!!c} onClose={() => close(false)}>
      <p class="confirm-text">{c?.text}</p>
      <div class="row gap">
        <button class="btn grow" onClick={() => close(false)}>Cancel</button>
        <button class={`btn grow ${c?.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>{c?.ok}</button>
      </div>
    </Sheet>
  );
}

// ---------- Inputs ----------

/** Big −/+ stepper with an editable number in the middle (numeric keypad on phones). */
export function Stepper(props: {
  value: number | null;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: boolean;
  unit?: string;
  placeholder?: string;
  /** Custom step logic (e.g. dumbbell rack). Receives the number currently shown. */
  onDec?: (current: number | null) => void;
  onInc?: (current: number | null) => void;
  /** 'lg' for the big, thumb-friendly version (logging sets, weigh-ins). */
  size?: 'md' | 'lg';
}) {
  const { value, onChange, step = 1, min = 0, max = 9999, decimals = false } = props;
  const [text, setText] = useState(value == null ? '' : String(value));
  // Sync the text when the value changes from outside (e.g. +/− or a reset), not on mount.
  const lastValue = useRef(value);
  // Layout effect: runs right after the render, so it can never overwrite something you're typing.
  useLayoutEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    setText(value == null ? '' : String(value));
  }, [value]);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  /** What's on screen right now, even if the input hasn't been committed yet. */
  const current = (): number | null => {
    const v = parseFloat(text.replace(',', '.'));
    return Number.isNaN(v) ? value : v;
  };
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(v)) onChange(clamp(v));
    else setText(value == null ? '' : String(value));
  };
  return (
    <div class={`stepper ${props.size === 'lg' ? 'lg' : ''}`}>
      <button class="step-btn" aria-label="Decrease" onClick={() => (props.onDec ? props.onDec(current()) : onChange(clamp((current() ?? 0) - step)))}>−</button>
      <div class="step-value">
        <input
          type="text"
          inputMode={decimals ? 'decimal' : 'numeric'}
          value={text}
          placeholder={props.placeholder}
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
          onBlur={(e) => commit((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
        {props.unit && <span class="step-unit">{props.unit}</span>}
      </div>
      <button class="step-btn" aria-label="Increase" onClick={() => (props.onInc ? props.onInc(current()) : onChange(clamp((current() ?? 0) + step)))}>+</button>
    </div>
  );
}

export function RirPicker(props: { value: number | null; onChange: (v: number) => void; target?: number }) {
  return (
    <div class="rir-picker">
      {[0, 1, 2, 3, 4].map((r) => (
        <button
          key={r}
          class={`rir-btn ${props.value === r ? 'on' : ''} ${props.target === r ? 'target' : ''}`}
          onClick={() => props.onChange(r)}
        >{r === 4 ? '4+' : r}</button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label class="toggle-row">
      <span class="grow">
        <span class="toggle-label">{props.label}</span>
        {props.hint && <span class="muted small block">{props.hint}</span>}
      </span>
      <input type="checkbox" class="toggle" checked={props.checked} onChange={(e) => props.onChange((e.currentTarget as HTMLInputElement).checked)} />
    </label>
  );
}

export function Header(props: { title: ComponentChildren; back?: boolean | string; right?: ComponentChildren }) {
  return (
    <header class="topbar">
      {props.back ? (
        <button class="icon-btn" aria-label="Back" onClick={() => (typeof props.back === 'string' ? go(props.back) : back())}><IconChevronLeft size={24} /></button>
      ) : <span class="icon-btn-spacer" />}
      <div class="topbar-title">{props.title}</div>
      <div class="topbar-right">{props.right}</div>
    </header>
  );
}

export const DAY_ICONS = ['🏋️', '💪', '🦵', '🦿', '🧗', '🔥', '⚡', '🌟', '🛡️', '🦅', '🎯', '🍑', '🦍', '🐂', '🚀', '🏃', '🧘', '🥇', '❤️', '🔱'];
export const DAY_COLORS = ['#ef6c57', '#f4a259', '#ffd166', '#7bd389', '#06d6a0', '#5fbfa0', '#4ea8de', '#118ab2', '#8ecae6', '#9b5de5', '#c77dff', '#e5989b', '#ef476f', '#fb8500', '#8b93a7'];

/** Large iOS-style page title for the main tabs. */
export function PageTitle(props: { title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren }) {
  return (
    <header class="page-title">
      <div class="grow">
        {props.sub && <div class="page-sub">{props.sub}</div>}
        <h1>{props.title}</h1>
      </div>
      {props.right}
    </header>
  );
}

/** Dashboard card with a coloured category header, like the Health app. Tapping the header opens more. */
export function Section(props: {
  title: string; icon?: ComponentChildren; tone?: string; more?: string; onMore?: () => void; children: ComponentChildren;
}) {
  const head = (
    <>
      <span class="section-head-title" style={{ color: props.tone }}>{props.icon}{props.title}</span>
      {props.onMore && <span class="section-head-more">{props.more ?? ''}<IconChevron size={16} class="chev" /></span>}
    </>
  );
  return (
    <section class="card dash-card">
      {props.onMore
        ? <button class="section-head" onClick={props.onMore}>{head}</button>
        : <div class="section-head">{head}</div>}
      {props.children}
    </section>
  );
}

export function Segmented<T extends string>(props: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={o} role="radio" aria-checked={props.value === o} class={props.value === o ? 'on' : ''} onClick={() => props.onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

/** Promise-based text prompt rendered as a sheet (resolves null if cancelled). */
const promptState = signal<{ title: string; value: string; ok: string; placeholder?: string; resolve: (v: string | null) => void } | null>(null);
export function promptSheet(title: string, value = '', ok = 'Save', placeholder?: string): Promise<string | null> {
  return new Promise((resolve) => { promptState.value = { title, value, ok, placeholder, resolve }; });
}
export function PromptHost() {
  const p = promptState.value;
  const [text, setText] = useState('');
  useEffect(() => { if (p) setText(p.value); }, [p]);
  const close = (v: string | null) => { p?.resolve(v); promptState.value = null; };
  return (
    <Sheet open={!!p} onClose={() => close(null)} title={p?.title}>
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) close(text.trim()); }}>
        <input class="input" value={text} placeholder={p?.placeholder} autoFocus
          onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)} />
        <div class="row gap mt">
          <button type="button" class="btn grow" onClick={() => close(null)}>Cancel</button>
          <button type="submit" class="btn grow primary" disabled={!text.trim()}>{p?.ok}</button>
        </div>
      </form>
    </Sheet>
  );
}

/** Settings-style grouped list. */
export function Group(props: { children: ComponentChildren; title?: string; footer?: ComponentChildren }) {
  return (
    <>
      {props.title && <h3 class="section-title">{props.title}</h3>}
      <div class="group">{props.children}</div>
      {props.footer && <p class="fine group-foot">{props.footer}</p>}
    </>
  );
}

export function GroupRow(props: {
  icon?: ComponentChildren; color?: string; label: ComponentChildren; sub?: ComponentChildren;
  value?: ComponentChildren; onClick?: () => void; right?: ComponentChildren; danger?: boolean;
}) {
  const inner = (
    <>
      {props.icon && <span class="row-icon" style={props.color ? { background: props.color } : undefined}>{props.icon}</span>}
      <span class="row-label">
        <span class={`block ${props.danger ? 'danger-text' : ''}`}>{props.label}</span>
        {props.sub && <span class="block muted small">{props.sub}</span>}
      </span>
      {props.value != null && <span class="row-value">{props.value}</span>}
      {props.right}
      {props.onClick && !props.right && <IconChevron class="row-chev" />}
    </>
  );
  return props.onClick
    ? <button class="group-row" onClick={props.onClick}>{inner}</button>
    : <div class="group-row">{inner}</div>;
}

export function EmptyState(props: { icon: ComponentChildren; title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty-state">
      {props.icon}
      <b>{props.title}</b>
      {props.children && <span class="small">{props.children}</span>}
      {props.action}
    </div>
  );
}
