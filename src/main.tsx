import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { seedIfEmpty } from './db/seed';
import { loadSettings } from './state/settings';
import { restoreTimer } from './state/timer';
import { requestPersistentStorage, setWakeLock } from './state/device';
import { getActiveWorkout } from './state/workout';
import { go } from './components/ui';
import './styles.css';

async function boot() {
  await seedIfEmpty();
  const s = await loadSettings();
  await restoreTimer();
  requestPersistentStorage();
  const active = await getActiveWorkout();
  if (active) {
    if (s.wake_lock) setWakeLock(true);
    // Open straight into the workout after a refresh or accidental close.
    if (!location.hash || location.hash === '#/' ) go('/workout');
  }
  render(<App />, document.getElementById('app')!);
}

registerSW({ immediate: true });
boot();
