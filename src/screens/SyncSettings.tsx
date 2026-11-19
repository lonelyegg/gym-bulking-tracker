import { useRef, useState } from 'preact/hooks';
import { db, getLocal, useLive } from '../db/db';
import { fmtAgo } from '../lib/logic';
import { exportBackup, importBackup, parseBackup, previewBackup } from '../sync/backup';
import {
  connect, disconnect, isConfigured, queueAll, redownloadAll, saveSyncConfig, syncConfig, syncNow, syncStatus,
} from '../sync/sync';
import { confirmSheet, go, Toggle, toast } from '../components/ui';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One-line status used in Settings and on Home. */
function statusLine(pending: number): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  const st = syncStatus.value;
  if (!isConfigured()) return { text: 'Not connected. Your data is only on this phone.', tone: 'warn' };
  if (st.state === 'syncing') return { text: 'Syncing…', tone: 'muted' };
  if (st.state === 'error') return { text: st.error ?? 'Sync failed.', tone: 'bad' };
  if (st.state === 'offline') return { text: `Offline. ${plural(pending, 'change')} will sync when you’re back online.`, tone: 'warn' };
  const synced = st.lastSyncAt ? `Synced ${fmtAgo(st.lastSyncAt)}` : 'Connected';
  return pending > 0 ? { text: `${synced} · ${plural(pending, 'change')} waiting`, tone: 'muted' } : { text: synced, tone: 'ok' };
}

/** Small status chip for the Home screen. */
export function SyncChip() {
  const pending = useLive(() => db.outbox.count(), []) ?? 0;
  const st = syncStatus.value;
  let label: string;
  let tone = 'muted';
  if (!isConfigured()) { label = '☁️ Not backed up'; tone = 'warn'; }
  else if (st.state === 'error') { label = '⚠️ Sync problem'; tone = 'bad'; }
  else if (st.state === 'syncing') label = '☁️ Syncing…';
  else if (st.state === 'offline') { label = `☁️ Offline${pending ? ` · ${pending}` : ''}`; tone = 'warn'; }
  else if (pending > 0) label = `☁️ ${pending} waiting`;
  else { label = '☁️ Synced'; tone = 'ok'; }
  return <button class={`sync-chip ${tone}`} onClick={() => go('/settings')}>{label}</button>;
}

export function SyncSection() {
  const cfg = syncConfig.value;
  const pending = useLive(() => db.outbox.count(), []) ?? 0;
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState(cfg.token);
  const [busy, setBusy] = useState(false);
  const line = statusLine(pending);
  const connected = isConfigured();

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; pushed?: number; pulled?: number }>, okText: string) => {
    setBusy(true);
    try {
      const r = await fn();
      toast(r.ok ? okText : r.error ?? 'Failed', 'info', r.ok ? 3000 : 6000);
      return r;
    } finally { setBusy(false); }
  };

  return (
    <>
      <h3 class="section-title">Google Sheets sync</h3>
      <section class="card form">
        <div class={`sync-line ${line.tone}`}>{line.text}</div>

        <label>Web app URL</label>
        <input class="input" type="url" inputMode="url" autocomplete="off" autocapitalize="off" spellcheck={false}
          placeholder="https://script.google.com/macros/s/…/exec" value={url}
          onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} />
        <label>Token</label>
        <input class="input" type="password" autocomplete="off" autocapitalize="off" spellcheck={false}
          placeholder="Paste the token from the Apps Script log" value={token}
          onInput={(e) => setToken((e.currentTarget as HTMLInputElement).value)} />

        <button class="btn primary block" disabled={busy || !url.trim() || !token.trim()}
          onClick={() => run(() => connect(url, token), 'Connected and synced ✓')}>
          {connected ? 'Save & test connection' : 'Connect'}
        </button>

        {connected && (<>
          <button class="btn block" disabled={busy} onClick={() => run(() => syncNow({ pull: true }), 'Synced ✓')}>
            {busy ? 'Working…' : 'Sync now'}
          </button>
          <Toggle label="Sync automatically" hint="On launch, when you return to the app, and shortly after you finish a workout. Never during a workout."
            checked={cfg.auto} onChange={(v) => saveSyncConfig({ ...cfg, auto: v })} />
          <details class="more">
            <summary>Advanced</summary>
            <button class="btn block" disabled={busy} onClick={async () => {
              if (!(await confirmSheet('Download every record from the Sheet again? Newer records on this phone are kept.', 'Download'))) return;
              run(() => redownloadAll(), 'Everything downloaded ✓');
            }}>Re-download everything from the Sheet</button>
            <button class="btn block" disabled={busy} onClick={async () => {
              if (!(await confirmSheet('Upload every record from this phone again? Safe to do: it never creates duplicates.', 'Upload'))) return;
              const n = await queueAll();
              run(() => syncNow({ pull: false }), `Uploaded ${n} records ✓`);
            }}>Re-upload everything to the Sheet</button>
            <button class="btn block danger-outline" disabled={busy} onClick={async () => {
              if (!(await confirmSheet('Disconnect from the Sheet? Your data stays on this phone and in the Sheet.', 'Disconnect', true))) return;
              await disconnect();
              setUrl(''); setToken('');
              toast('Disconnected');
            }}>Disconnect</button>
          </details>
        </>)}
        {!connected && <p class="muted small">Set up the Sheet first: see “Google Sheets sync” in the README (about 5 minutes).</p>}
      </section>
    </>
  );
}

export function BackupSection() {
  const last = useLive(() => getLocal<string>('last_backup_at', ''), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      if (await exportBackup()) toast('Backup saved ✓');
    } catch (e) {
      toast(`Couldn’t save the backup: ${e instanceof Error ? e.message : e}`, 'info', 6000);
    } finally { setBusy(false); }
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseBackup(await file.text());
      const p = previewBackup(parsed);
      if (!p.records) { toast('That backup has no data.'); return; }
      const when = parsed.exported_at ? new Date(parsed.exported_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'unknown date';
      const ok = await confirmSheet(
        `Import ${plural(p.records, 'record')} (${plural(p.workouts, 'workout')}) from a backup made ${when}? For each record the newest version wins, so nothing newer on this phone is lost.`,
        'Import');
      if (!ok) return;
      setBusy(true);
      const r = await importBackup(parsed);
      toast(`Imported ${plural(r.applied, 'record')} ✓`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', 'info', 6000);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <>
      <h3 class="section-title">Backup file</h3>
      <section class="card form">
        <p class="small muted">A copy of everything as one file. Last backup: {last ? fmtAgo(last) : 'never'}.
          On iPhone choose <b>Save to Files</b> in the share sheet.</p>
        <button class="btn block" disabled={busy} onClick={doExport}>Export backup</button>
        <button class="btn block" disabled={busy} onClick={() => fileInput.current?.click()}>Import backup…</button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden
          onChange={(e) => doImport((e.currentTarget as HTMLInputElement).files?.[0])} />
      </section>
    </>
  );
}
