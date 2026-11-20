// Settings: an iOS-style index of grouped rows (each showing its current value) and one subpage per area.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { db, getLocal, useLive } from '../db/db';
import { fmtAgo, fmtClock } from '../lib/logic';
import { saveSetting, settings, type BeepMode } from '../state/settings';
import {
  audioSessionSupported, beep, isStandalone, notifPermission, requestNotifications, storagePersisted,
  unlockAudio, wakeLockSupported,
} from '../state/device';
import { isConfigured, syncStatus } from '../sync/sync';
import { go, Group, GroupRow, Header, Segmented, Stepper, Toggle, toast } from '../components/ui';
import { TargetsForm } from '../components/nutrition';
import {
  IconBell, IconCloud, IconDownload, IconDumbbell, IconFood, IconInfo, IconSmartphone, IconTimer,
} from '../components/icons';
import { BackupSection, SyncSection } from './SyncSettings';

const BEEP: [BeepMode, string][] = [['transient', 'Duck music'], ['ambient', 'Mix with music'], ['off', 'Off']];

export function SettingsScreen({ sub }: { sub?: string }) {
  if (sub === 'timer') return <SubPage title="Rest timer"><TimerSettings /></SubPage>;
  if (sub === 'alerts') return <SubPage title="Sounds & alerts"><AlertSettings /></SubPage>;
  if (sub === 'equipment') return <SubPage title="Equipment"><EquipmentSettings /></SubPage>;
  if (sub === 'nutrition') return <SubPage title="Nutrition targets"><section class="card"><TargetsForm /></section></SubPage>;
  if (sub === 'sync') return <SubPage title="Google Sheets sync"><SyncSection /></SubPage>;
  if (sub === 'backup') return <SubPage title="Backup file"><BackupSection /></SubPage>;
  return <SettingsIndex />;
}

function SubPage({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="page">
      <Header title={title} back="/settings" />
      {children}
      <div class="bottom-space" />
    </div>
  );
}

function SettingsIndex() {
  const s = settings.value;
  const standalone = isStandalone();
  const pending = useLive(() => db.outbox.count(), []) ?? 0;
  const lastBackup = useLive(() => getLocal<string>('last_backup_at', ''), []);
  const st = syncStatus.value;
  const syncValue = !isConfigured() ? 'Off'
    : st.state === 'error' ? 'Problem'
      : st.state === 'offline' ? 'Offline'
        : pending > 0 ? `${pending} waiting`
          : st.lastSyncAt ? fmtAgo(st.lastSyncAt) : 'On';
  const maxDb = s.dumbbell_ladder[s.dumbbell_ladder.length - 1];
  const kcal = s.kcal_target ? `${s.kcal_target.toLocaleString()} kcal` : 'Not set';

  return (
    <div class="page">
      <Header title="Settings" back="/" />

      {!standalone && (
        <div class="callout warn">
          <IconSmartphone size={20} />
          <span><b>Install the app.</b> In Safari tap Share, then <b>Add to Home Screen</b>. Notifications only work in the
            installed app, and it keeps its own storage.</span>
        </div>
      )}

      <Group title="Training">
        <GroupRow icon={<IconTimer size={18} />} color="var(--c-train)" label="Rest timer"
          value={`${fmtClock(s.compound_rest_s)} · ${fmtClock(s.isolation_rest_s)}`} onClick={() => go('/settings/timer')} />
        <GroupRow icon={<IconBell size={18} />} color="var(--c-food)" label="Sounds & alerts"
          value={BEEP.find(([m]) => m === s.beep_mode)?.[1]} onClick={() => go('/settings/alerts')} />
        <GroupRow icon={<IconDumbbell size={18} />} color="var(--c-rest)" label="Equipment"
          value={maxDb ? `Dumbbells to ${maxDb} kg` : undefined} onClick={() => go('/settings/equipment')} />
      </Group>

      <Group title="Nutrition">
        <GroupRow icon={<IconFood size={18} />} color="var(--c-food)" label="Targets & estimate"
          value={`${kcal} · ${s.protein_g_per_kg} g/kg`} onClick={() => go('/settings/nutrition')} />
      </Group>

      <Group title="Your data" footer={storagePersisted.value
        ? 'Stored on this phone and protected from automatic clearing.'
        : 'Stored on this phone. iOS may clear it if storage runs low: keep a backup.'}>
        <GroupRow icon={<IconCloud size={18} />} color="var(--c-body)" label="Google Sheets sync"
          value={<span class={!isConfigured() ? 'warn-text' : st.state === 'error' ? 'danger-text' : ''}>{syncValue}</span>}
          onClick={() => go('/settings/sync')} />
        <GroupRow icon={<IconDownload size={18} />} color="var(--c-photo)" label="Backup file"
          value={lastBackup ? fmtAgo(lastBackup) : 'Never'} onClick={() => go('/settings/backup')} />
      </Group>

      <p class="fine center-text mt">Gym Bulking Tracker · v{__APP_VERSION__}</p>
      <div class="bottom-space" />
    </div>
  );
}

function TimerSettings() {
  const s = settings.value;
  return (
    <>
      <section class="card form">
        <label class="split-label">Compound lifts <span class="num">{fmtClock(s.compound_rest_s)}</span></label>
        <Stepper value={s.compound_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('compound_rest_s', v)} />
        <label class="split-label">Isolation lifts <span class="num">{fmtClock(s.isolation_rest_s)}</span></label>
        <Stepper value={s.isolation_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('isolation_rest_s', v)} />
        <label class="split-label">After an exercise’s last set <span class="num">{fmtClock(s.transition_rest_s)}</span></label>
        <Stepper value={s.transition_rest_s} step={15} min={0} max={900} unit="s" onChange={(v) => saveSetting('transition_rest_s', v)} />
      </section>
      <p class="fine group-foot">Compound and isolation defaults apply to new exercises. Each exercise in a day can have its own rest (Plan → day).</p>
    </>
  );
}

function AlertSettings() {
  const s = settings.value;
  const standalone = isStandalone();
  const testBeep = () => {
    unlockAudio();
    setTimeout(async () => {
      const ok = await beep();
      if (!ok) toast(s.beep_mode === 'off' ? 'Beep is off' : 'Audio not available yet. Tap again.');
    }, 150);
  };
  return (
    <>
      <section class="card form">
        <label>Beep when rest ends</label>
        <Segmented label="Beep when rest ends" value={BEEP.find(([m]) => m === s.beep_mode)?.[1] ?? 'Duck music'}
          options={BEEP.map(([, l]) => l)} onChange={(l) => saveSetting('beep_mode', BEEP.find(([, x]) => x === l)![0])} />
        <p class="muted small">
          “Duck music” briefly lowers Spotify for the beep. “Mix with music” plays over it at full volume.
          {audioSessionSupported() ? ' ' : ' (Audio session control isn’t available in this browser.) '}
          With the ring/silent switch on silent, iPhone may mute the beep.
        </p>
        <button class="btn tinted block" onClick={testBeep}><IconBell /> Test beep</button>
      </section>

      <section class="card form">
        <Toggle label="Keep screen on during workouts" hint={wakeLockSupported() ? 'Recommended: on iPhone the timer can only beep while the screen is on and the app is open.' : 'Not supported here.'}
          checked={s.wake_lock} onChange={(v) => saveSetting('wake_lock', v)} />
        <Toggle label="Notify if the app is in the background" hint="Only fires if iOS hasn’t paused the app yet. Don’t rely on it."
          checked={s.notify_when_hidden} onChange={(v) => saveSetting('notify_when_hidden', v)} />
        {notifPermission.value === 'unsupported'
          ? <p class="muted small row gap-sm"><IconInfo size={14} /> Notifications aren’t available here{standalone ? '' : ': install the app first'}.</p>
          : notifPermission.value === 'granted'
            ? <p class="good small">Notifications allowed</p>
            : <button class="btn block" onClick={requestNotifications}>Allow notifications</button>}
      </section>
    </>
  );
}

function EquipmentSettings() {
  const s = settings.value;
  const [ladder, setLadder] = useState(s.dumbbell_ladder.join(', '));
  const saveLadder = () => {
    const nums = ladder.split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => x > 0).sort((a, b) => a - b);
    if (!nums.length) { toast('Enter at least one weight'); return; }
    saveSetting('dumbbell_ladder', [...new Set(nums)]);
    setLadder(nums.join(', '));
    toast('Dumbbell rack saved');
  };
  return (
    <>
      <section class="card form">
        <label>Dumbbell rack (kg)</label>
        <input class="input" inputMode="decimal" value={ladder} onInput={(e) => setLadder((e.currentTarget as HTMLInputElement).value)} onBlur={saveLadder} />
        <div class="chips ladder">{s.dumbbell_ladder.map((w) => <span key={w} class="tag">{w}</span>)}</div>
      </section>
      <p class="fine group-foot">Overload hints for dumbbell exercises suggest the next weight on this list. Machines and cables use each exercise’s weight jump (Plan → Exercise library).</p>
    </>
  );
}
