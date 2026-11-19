import { useLive } from './db/db';
import { getActiveWorkout } from './state/workout';
import { ConfirmHost, go, PromptHost, route, Toasts } from './components/ui';
import { MiniBar } from './components/timer';
import { HomeScreen } from './screens/Home';
import { WorkoutScreen } from './screens/Workout';
import { HistoryScreen, PrsScreen, WorkoutDetailScreen } from './screens/History';
import { IconCalendar, IconDumbbell, IconFood, IconHome, IconScale } from './components/icons';
import { FoodScreen, FoodsScreen } from './screens/Food';
import { BodyScreen } from './screens/Body';
import {
  DayTypeEditorScreen, ExerciseEditScreen, ExercisesScreen, PlanScreen, SplitEditorScreen,
} from './screens/Plan';
import { SettingsScreen } from './screens/Settings';
import { ExerciseScreen } from './screens/Exercise';

function match(path: string) {
  const parts = path.split('/').filter(Boolean);
  const [a, b, c] = parts;
  if (!a) return { tab: 'home', el: <HomeScreen /> };
  if (a === 'workout') return { tab: 'workout', el: <WorkoutScreen /> };
  if (a === 'w' && b) return { tab: 'history', el: <WorkoutDetailScreen id={b} key={b} /> };
  if (a === 'history') return { tab: 'history', el: <HistoryScreen /> };
  if (a === 'prs') return { tab: 'home', el: <PrsScreen /> };
  if (a === 'exercise' && b) return { tab: 'plan', el: <ExerciseScreen id={b} key={b} /> };
  if (a === 'plan') {
    if (b === 'split' && c) return { tab: 'plan', el: <SplitEditorScreen id={c} key={c} /> };
    if (b === 'day' && c) return { tab: 'plan', el: <DayTypeEditorScreen id={c} key={c} /> };
    if (b === 'exercises') return { tab: 'plan', el: <ExercisesScreen /> };
    if (b === 'exercise' && c) return { tab: 'plan', el: <ExerciseEditScreen id={c} key={c} /> };
    return { tab: 'plan', el: <PlanScreen /> };
  }
  if (a === 'settings') return { tab: 'home', el: <SettingsScreen /> };
  if (a === 'food') return { tab: 'food', el: b === 'foods' ? <FoodsScreen /> : <FoodScreen /> };
  if (a === 'body') return { tab: 'body', el: <BodyScreen /> };
  return { tab: 'home', el: <HomeScreen /> };
}

const TABS = [
  { id: 'home', path: '/', Icon: IconHome, label: 'Home' },
  { id: 'food', path: '/food', Icon: IconFood, label: 'Food' },
  { id: 'body', path: '/body', Icon: IconScale, label: 'Body' },
  { id: 'history', path: '/history', Icon: IconCalendar, label: 'History' },
  { id: 'plan', path: '/plan', Icon: IconDumbbell, label: 'Plan' },
];

export function App() {
  const { tab, el } = match(route.value);
  const active = useLive(async () => (await getActiveWorkout()) ?? null, []);
  const inWorkout = tab === 'workout';
  return (
    <>
      <main class={inWorkout ? 'in-workout' : ''}>{el}</main>
      {!inWorkout && (
        <div class="bottom-dock">
          {active && <MiniBar name={active.name} icon={active.icon} color={active.color} />}
          <nav class="tabbar">
            {TABS.map((t) => (
              <button key={t.id} class={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => go(t.path)}>
                <t.Icon size={24} class="tab-icon" />
                <span class="tab-label">{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      <Toasts />
      <ConfirmHost />
      <PromptHost />
    </>
  );
}
