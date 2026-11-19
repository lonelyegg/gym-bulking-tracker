import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { seedIfEmpty } from './db/seed';
import { migrateMuscles } from './db/migrate';
import { loadSettings } from './state/settings';
import { restoreTimer } from './state/timer';
import { requestPersistentStorage, setWakeLock } from './state/device';
import { getActiveWorkout } from './state/workout';
import { loadSyncConfig, startAutoSync } from './sync/sync';
import { go } from './components/ui';
import './styles.css';

async function boot() {
  await seedIfEmpty();
  await migrateMuscles().catch((e) => console.error('migration failed', e));
  const s = await loadSettings();
  await restoreTimer();
  await loadSyncConfig();
  requestPersistentStorage();
  const active = await getActiveWorkout();
  if (active) {
    if (s.wake_lock && !active.backfill) setWakeLock(true);
    // Open straight into the workout after a refresh or accidental close.
    if (!location.hash || location.hash === '#/' ) go('/workout');
  }
  render(<App />, document.getElementById('app')!);
  startAutoSync();
}

registerSW({ immediate: true });
boot();
