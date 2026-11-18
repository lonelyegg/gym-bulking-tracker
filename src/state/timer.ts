// Rest timer. Stores an absolute end time, so it stays correct after the screen
// locks or the app goes to the background (JS may be paused, but the clock isn't).
import { computed, signal } from '@preact/signals';
import { getLocal, setLocal } from '../db/db';
import { beep, notify, vibrate } from './device';
import { settings } from './settings';

export interface TimerState {
  endsAt: number; // epoch ms
  duration: number; // seconds, for the progress ring
  label: string; // e.g. "Next: Incline Dumbbell Press"
  workoutId: string;
  /** The set that started this rest; the quick RIR picker edits it. */
  setId: string | null;
  fired: boolean;
}

export const timer = signal<TimerState | null>(null);
export const now = signal(Date.now());
/** True for a few seconds after rest ends, to flash the UI. */
export const justFired = signal(false);

export const remaining = computed(() => (timer.value ? (timer.value.endsAt - now.value) / 1000 : 0));

let tickHandle: number | undefined;
let fireHandle: number | undefined;

function persist() {
  setLocal('timer', timer.value);
}

function schedule() {
  clearInterval(tickHandle);
  clearTimeout(fireHandle);
  const t = timer.value;
  if (!t) return;
  now.value = Date.now();
  tickHandle = window.setInterval(() => {
    now.value = Date.now();
    check();
  }, 250);
  if (!t.fired) fireHandle = window.setTimeout(check, Math.max(0, t.endsAt - Date.now()) + 5);
}

async function check() {
  const t = timer.value;
  if (!t || t.fired || Date.now() < t.endsAt) return;
  const lateBy = Date.now() - t.endsAt;
  timer.value = { ...t, fired: true };
  persist();
  // If the app was frozen (screen locked) and we're far past the end, don't beep late.
  if (lateBy > 5000) return;
  justFired.value = true;
  setTimeout(() => (justFired.value = false), 4000);
  await beep();
  vibrate();
  if (document.visibilityState === 'hidden' && settings.value.notify_when_hidden) {
    notify('Rest over', t.label || 'Time for your next set');
  }
}

export function startRest(seconds: number, opts: { label: string; workoutId: string; setId: string | null }) {
  timer.value = {
    endsAt: Date.now() + seconds * 1000,
    duration: seconds,
    label: opts.label,
    workoutId: opts.workoutId,
    setId: opts.setId,
    fired: false,
  };
  persist();
  schedule();
}

export function adjustRest(deltaSeconds: number) {
  const t = timer.value;
  if (!t) return;
  const base = Math.max(t.endsAt, t.fired ? Date.now() : t.endsAt);
  const endsAt = Math.max(Date.now(), base + deltaSeconds * 1000);
  timer.value = { ...t, endsAt, duration: Math.max(t.duration + deltaSeconds, 1), fired: endsAt <= Date.now() };
  persist();
  schedule();
}

export function stopRest() {
  timer.value = null;
  justFired.value = false;
  clearInterval(tickHandle);
  clearTimeout(fireHandle);
  persist();
}

export async function restoreTimer() {
  const t = await getLocal<TimerState | null>('timer', null);
  if (t) {
    timer.value = t;
    schedule();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer.value) {
    now.value = Date.now();
    schedule();
    check();
  }
});
