import { useState } from 'preact/hooks';
import { db, useLive } from '../db/db';
import { fmtClock } from '../lib/logic';
import { saveSetting, settings, type BeepMode } from '../state/settings';
import {
  audioSessionSupported, beep, isStandalone, notifPermission, requestNotifications, storagePersisted,
  unlockAudio, wakeLockSupported,
} from '../state/device';
import { Header, Stepper, Toggle, toast } from '../components/ui';

export function SettingsScreen() {
  const s = settings.value;
  const [ladder, setLadder] = useState(s.dumbbell_ladder.join(', '));
  const pending = useLive(() => db.outbox.count(), []);
  const standalone = isStandalone();

  const saveLadder = () => {
    const nums = ladder.split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => x > 0).sort((a, b) => a - b);
    if (!nums.length) { toast('Enter at least one weight'); return; }
    saveSetting('dumbbell_ladder', [...new Set(nums)]);
    setLadder(nums.join(', '));
    toast('Dumbbell rack saved');
  };

  const testBeep = async () => {
    unlockAudio();
    setTimeout(async () => {
      const ok = await beep();
      if (!ok) toast(s.beep_mode === 'off' ? 'Beep is off' : 'Audio not available yet — tap again');
    }, 150);
  };

  return (
    <div class="page">
      <Header title="Settings" />

      {!standalone && (
        <section class="card warn-card">
          <div class="bold">Install the app for the best experience</div>
          <div class="small">In Safari: Share ⎋ → <b>Add to Home Screen</b>. Then open it from the home screen.
            Notifications only work in the installed app, and the installed app keeps its own storage.</div>
        </section>
      )}

      <h3 class="section-title">Rest timer</h3>
      <section class="card form">
        <label>Default rest — compound ({fmtClock(s.compound_rest_s)})</label>
        <Stepper value={s.compound_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('compound_rest_s', v)} />
        <label>Default rest — isolation ({fmtClock(s.isolation_rest_s)})</label>
        <Stepper value={s.isolation_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('isolation_rest_s', v)} />
        <label>After the last set of an exercise ({fmtClock(s.transition_rest_s)})</label>
        <Stepper value={s.transition_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('transition_rest_s', v)} />
        <p class="muted small">Compound/isolation defaults apply to new exercises. Each exercise in a day can have its own rest.</p>
      </section>

      <section class="card form">
        <label>Beep when rest ends</label>
        <div class="chips">
          {([['transient', 'Duck music'], ['ambient', 'Mix with music'], ['off', 'Off']] as [BeepMode, string][]).map(([m, l]) => (
            <button key={m} class={`chip ${s.beep_mode === m ? 'on' : ''}`} onClick={() => saveSetting('beep_mode', m)}>{l}</button>
          ))}
        </div>
        <p class="muted small">
          “Duck music” briefly lowers Spotify for the beep. “Mix with music” plays over it at full volume.
          {audioSessionSupported() ? ' ' : ' (Audio session control isn’t available in this browser.) '}
          With the ring/silent switch on silent, iPhone may mute the beep.
        </p>
        <button class="btn block" onClick={testBeep}>🔔 Test beep</button>

        <Toggle label="Keep screen on during workouts" hint={wakeLockSupported() ? 'Recommended: on iPhone the timer can only beep while the screen is on and the app is open.' : 'Not supported here.'}
          checked={s.wake_lock} onChange={(v) => saveSetting('wake_lock', v)} />
        <Toggle label="Notify if the app is in the background" hint="Only fires if iOS hasn’t paused the app yet. Don’t rely on it."
          checked={s.notify_when_hidden} onChange={(v) => saveSetting('notify_when_hidden', v)} />
        {notifPermission.value === 'unsupported'
          ? <p class="muted small">Notifications aren’t available here{standalone ? '' : ' — install the app first'}.</p>
          : notifPermission.value === 'granted'
            ? <p class="good small">✓ Notifications allowed</p>
            : <button class="btn block" onClick={requestNotifications}>Allow notifications</button>}
      </section>

      <h3 class="section-title">Equipment</h3>
      <section class="card form">
        <label>Dumbbell rack (kg)</label>
        <input class="input" inputMode="decimal" value={ladder} onInput={(e) => setLadder((e.currentTarget as HTMLInputElement).value)} onBlur={saveLadder} />
        <p class="muted small">Overload hints for dumbbell exercises suggest the next weight on this list. Machines and cables use each exercise’s weight jump (edit in Plan → Exercise library).</p>
      </section>

      <h3 class="section-title">Data</h3>
      <section class="card small">
        <div>Stored on this phone (IndexedDB). {storagePersisted.value ? 'Protected from automatic clearing ✓' : 'Persistence not granted yet.'}</div>
        <div class="muted">{pending ?? 0} changes waiting to sync. Google Sheets sync and JSON backup arrive in Phase 2.</div>
      </section>
      <p class="muted small center-text">Gym Bulking Tracker · v{__APP_VERSION__}</p>
      <div class="bottom-space" />
    </div>
  );
}
