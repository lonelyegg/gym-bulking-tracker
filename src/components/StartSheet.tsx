// Pick what to train: used by the Today card and by tapping an empty day on the calendar.
// For a past day it logs the workout afterwards (no timers; you set the duration at the end).
import { alive, db, useLive } from '../db/db';
import type { DayType } from '../db/schema';
import { localDate } from '../lib/logic';
import { settings } from '../state/settings';
import { computeNextUp, getActiveWorkout, startWorkout } from '../state/workout';
import { go, Sheet } from './ui';
import { IconPlus } from './icons';
import { DAY_STYLE, LIFT_SHORT, sessionPlan, type Day } from '../lib/program';
import { fmtKg } from '../lib/logic';
import { programActive, startProgramWorkout, useProgram } from '../state/program';

function orderedDayTypes(all: DayType[], rotation: string[] | undefined): DayType[] {
  const inSplit = [...new Set(rotation ?? [])].map((id) => all.find((d) => d.id === id)).filter(alive);
  const others = all.filter((d) => !inSplit.includes(d)).sort((a, b) => a.name.localeCompare(b.name));
  return [...inSplit, ...others];
}

export function StartSheet(props: { open: boolean; onClose: () => void; date?: string }) {
  const active = useLive(async () => (await getActiveWorkout()) ?? null, []);
  const dayTypes = useLive(async () => (await db.day_types.toArray()).filter((d) => !d.deleted), []) ?? [];
  const split = useLive(async () => (settings.value.active_split_id ? db.splits.get(settings.value.active_split_id) : undefined), [settings.value.active_split_id]);
  const nextUp = useLive(computeNextUp, [settings.value.active_split_id]);
  const tplCounts = useLive(async () => {
    const m: Record<string, number> = {};
    for (const t of await db.template_exercises.toArray()) if (!t.deleted) m[t.day_type_id] = (m[t.day_type_id] ?? 0) + 1;
    return m;
  }, []) ?? {};

  const past = !!props.date && props.date < localDate();
  const next = nextUp?.next;
  const suggestedIndex = next && next.kind === 'workout' ? next.index : next && next.kind === 'rest' ? next.nextIndex : 0;
  const due = !past && next && !programActive() ? (next.kind === 'workout' ? next.dayTypeId : next.kind === 'rest' ? next.nextDayTypeId : null) : null;
  const dateLabel = props.date ? new Date(`${props.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  const program = useProgram();
  const showProgram = programActive() && !!program;
  const pickProgram = async (day: Day) => {
    await startProgramWorkout(day, past ? { at: props.date } : {});
    props.onClose();
    go('/workout');
  };

  const pick = async (id: string | null) => {
    await startWorkout(id, past ? { at: props.date } : { suggestedIndex });
    props.onClose();
    go('/workout');
  };

  return (
    <Sheet open={props.open} onClose={props.onClose} title={past ? `Log a workout for ${dateLabel}` : 'Start a workout'}>
      {active ? (
        <>
          <p class="muted">Finish or discard the workout in progress first.</p>
          <button class="btn primary block" onClick={() => { props.onClose(); go('/workout'); }}>Open current workout</button>
        </>
      ) : (
        <>
          {past && <p class="muted small">Logged afterwards: no rest timer, and you enter how long it took when you finish.</p>}
          {showProgram && (
            <div class="menu-list">
              {(['A', 'B'] as Day[]).map((day) => {
                const plan = sessionPlan(program!.state, program!.cfg, day, props.date ?? localDate());
                return (
                  <button key={day} onClick={() => pickProgram(day)}>
                    <span class="day-dot" style={{ background: DAY_STYLE[day].color }}>{DAY_STYLE[day].icon}</span>
                    <span class="grow">5×5 · Workout {day}{!past && program!.next.day === day && <span class="tag">Due</span>}
                      {!past && <span class="block muted small">{plan.lifts.map((l) => `${LIFT_SHORT[l.lift]} ${fmtKg(l.weight)}`).join(' · ')}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {showProgram && <div class="pick-group">Other workouts</div>}
          <div class="menu-list">
            {orderedDayTypes(dayTypes, split?.rotation).map((x) => (
              <button key={x.id} onClick={() => pick(x.id)}>
                <span class="day-dot" style={{ background: x.color }}>{x.icon}</span>
                <span class="grow">{x.name}{x.id === due && <span class="tag">Due</span>}</span>
                <span class="muted small">{tplCounts[x.id] ?? 0} exercises</span>
              </button>
            ))}
            <button onClick={() => pick(null)}>
              <span class="day-dot"><IconPlus size={17} /></span><span class="grow">Empty workout</span>
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
