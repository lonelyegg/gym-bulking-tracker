// Browser/device integrations: beep, wake lock, notifications, persistent storage.
import { signal } from '@preact/signals';
import { settings } from './settings';

// ---------- Beep (Web Audio) ----------

let ctx: AudioContext | null = null;
let unlocked = false;

interface AudioSessionLike { type: string }
const audioSession = (): AudioSessionLike | undefined =>
  (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;

export const audioSessionSupported = () => !!audioSession();

function applyAudioSession() {
  const s = audioSession();
  const mode = settings.value.beep_mode;
  if (s && mode !== 'off') {
    // 'transient': briefly lowers (ducks) Spotify while the beep plays.
    // 'ambient': mixes with Spotify at full volume, muted by the silent switch.
    try { s.type = mode; } catch { /* ignore */ }
  }
}

/**
 * Call from a tap (e.g. completing a set). iOS only allows audio to start
 * after a user gesture, so we unlock the audio context here.
 */
export function unlockAudio() {
  if (settings.value.beep_mode === 'off') return;
  try {
    applyAudioSession();
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    // Only needed once per app launch. Repeating it on every tap would briefly duck Spotify each time.
    if (!unlocked && ctx.state !== 'running') {
      ctx.resume().then(() => {
        if (ctx?.state !== 'running') return;
        unlocked = true;
        // Play a silent blip to fully unlock, then suspend so we don't hold the audio session (and duck music) during rest.
        playTones([{ f: 440, t: 0, d: 0.01, g: 0.0001 }]);
        suspendSoon(150);
      }).catch(() => {});
    } else if (ctx.state === 'running') {
      unlocked = true;
    }
  } catch { /* ignore */ }
}

let suspendTimer: number | undefined;
function suspendSoon(ms = 300) {
  clearTimeout(suspendTimer);
  suspendTimer = window.setTimeout(() => { ctx?.suspend().catch(() => {}); }, ms);
}

function playTones(tones: { f: number; t: number; d: number; g?: number }[]) {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const { f, t, d, g = 0.35 } of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0, t0 + t);
    gain.gain.linearRampToValueAtTime(g, t0 + t + 0.01);
    gain.gain.setValueAtTime(g, t0 + t + d - 0.03);
    gain.gain.linearRampToValueAtTime(0, t0 + t + d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + t);
    osc.stop(t0 + t + d + 0.02);
  }
}

/** Three short beeps. Returns false if audio isn't available (e.g. never unlocked). */
export async function beep(): Promise<boolean> {
  if (settings.value.beep_mode === 'off' || !ctx) return false;
  try {
    applyAudioSession();
    clearTimeout(suspendTimer);
    if (ctx.state !== 'running') await ctx.resume();
    if (ctx.state !== 'running') return false;
    playTones([
      { f: 880, t: 0, d: 0.15 },
      { f: 880, t: 0.25, d: 0.15 },
      { f: 1320, t: 0.5, d: 0.3 },
    ]);
    suspendSoon(1200);
    return true;
  } catch {
    return false;
  }
}

/** Vibration isn't supported on iPhone; this only does something on Android. */
export function vibrate(pattern: number[] = [200, 100, 200]) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

// ---------- Wake lock ----------

export const wakeLockActive = signal(false);
let sentinel: WakeLockSentinel | null = null;
let wantWakeLock = false;

export const wakeLockSupported = () => 'wakeLock' in navigator;

async function acquire() {
  if (!wantWakeLock || !wakeLockSupported() || document.visibilityState !== 'visible') return;
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    wakeLockActive.value = true;
    sentinel.addEventListener('release', () => { wakeLockActive.value = false; });
  } catch {
    wakeLockActive.value = false;
  }
}

/** Keep the screen on during a workout. The OS drops the lock when the app is hidden; we re-take it on return. */
export async function setWakeLock(on: boolean) {
  wantWakeLock = on;
  if (on) await acquire();
  else if (sentinel) {
    await sentinel.release().catch(() => {});
    sentinel = null;
    wakeLockActive.value = false;
  }
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire();
});

// ---------- Notifications ----------

export const notifPermission = signal<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
);

export async function requestNotifications() {
  if (typeof Notification === 'undefined') return;
  notifPermission.value = await Notification.requestPermission();
}

export async function notify(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag: 'rest-timer', icon: 'icon-192.png' } as NotificationOptions);
    else new Notification(title, { body });
  } catch { /* ignore */ }
}

// ---------- Misc ----------

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export const storagePersisted = signal<boolean | null>(null);

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    storagePersisted.value = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch { /* ignore */ }
}
