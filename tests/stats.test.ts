import { describe, expect, it } from 'vitest';
import {
  addMonths, e1rmSeries, liftOptions, monthGrid, niceTicks, prEvents, rangeBounds, restByExercise, restBySession,
  splitByRange, weekOf, weeklyStreak, workoutsByDate, type S, type W,
} from '../src/lib/stats';

const w = (id: string, day: string, name = 'Push'): W => ({
  id, started_at: `${day}T10:00:00.000Z`, ended_at: `${day}T11:00:00.000Z`, day_type_id: null, name, icon: '🏋️', color: '#f00',
});
let n = 0;
const s = (workout_id: string, exercise_id: string, weight_kg: number, reps: number, extra: Partial<S> = {}): S => ({
  id: `s${++n}`, workout_id, exercise_id, set_number: n, is_warmup: 0, rir: 2,
  completed_at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
  rest_before_s: null, rest_is_transition: 0, weight_kg, reps, ...extra,
});

describe('calendar', () => {
  it('weekOf returns Monday', () => {
    expect(weekOf('2026-11-19')).toBe('2026-11-16'); // Thursday
    expect(weekOf('2026-11-16')).toBe('2026-11-16'); // Monday
    expect(weekOf('2026-11-22')).toBe('2026-11-16'); // Sunday
    expect(weekOf('2027-01-01')).toBe('2026-12-28'); // across years
  });
  it('monthGrid covers the month in Monday-first weeks', () => {
    const g = monthGrid('2026-11'); // 1 Nov 2026 is a Sunday
    expect(g[0][0]).toEqual({ date: '2026-10-26', inMonth: false });
    expect(g[0][6]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(30);
    expect(g).toHaveLength(6);
    expect(monthGrid('2027-02')).toHaveLength(4); // Feb 2027 starts on a Monday, 28 days
  });
  it('addMonths wraps years', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('groups workouts by local date', () => {
    const m = workoutsByDate([w('b', '2026-11-18'), w('a', '2026-11-18'), w('c', '2026-11-19')]);
    expect(m.get('2026-11-18')).toHaveLength(2);
  });
});

describe('weeklyStreak', () => {
  const today = '2026-11-19'; // Thu, week of 16 Nov
  it('counts consecutive weeks that hit the target; an unfinished week does not break it', () => {
    const dates = ['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11', '2026-11-17'];
    expect(weeklyStreak(dates, 2, today)).toEqual({ current: 2, best: 2, thisWeek: 1 });
  });
  it('counts this week once the target is met', () => {
    const dates = ['2026-11-09', '2026-11-11', '2026-11-16', '2026-11-18'];
    expect(weeklyStreak(dates, 2, today).current).toBe(2);
  });
  it('a missed week resets it, best remembers', () => {
    const dates = ['2026-10-05', '2026-10-12', '2026-10-19', /* gap */ '2026-11-09'];
    expect(weeklyStreak(dates, 1, today)).toEqual({ current: 1, best: 3, thisWeek: 0 });
  });
  it('empty history', () => {
    expect(weeklyStreak([], 4, today)).toEqual({ current: 0, best: 0, thisWeek: 0 });
  });
});

describe('prEvents', () => {
  it('no records in the first session, then one event per exercise per workout with deltas', () => {
    const ws = [w('w1', '2026-11-01'), w('w2', '2026-11-03'), w('w3', '2026-11-05')];
    const sets = [
      s('w1', 'bench', 60, 10), s('w1', 'bench', 60, 9),
      s('w2', 'bench', 60, 11), s('w2', 'bench', 62.5, 8), // reps PR then weight+e1rm PR
      s('w3', 'bench', 60, 10), // nothing
    ];
    const ev = prEvents(ws, sets);
    expect(ev).toHaveLength(1);
    // 60×11 (e1RM 82.0) is the best est. 1RM; 62.5×8 (79.2) is a heaviest-weight record in the same session.
    expect(ev[0]).toMatchObject({ workoutId: 'w2', kind: 'e1rm', weight: 60, reps: 11 });
    expect(ev[0].kinds).toEqual(['e1rm', 'weight', 'reps']);
    expect(ev[0].value).toBeCloseTo(82);
    expect(ev[0].previous).toBeCloseTo(80);
  });
  it('picks the best est. 1RM set and measures the delta from before the workout', () => {
    const ws = [w('w1', '2026-11-01'), w('w2', '2026-11-03')];
    const sets = [s('w1', 'sq', 100, 5), s('w2', 'sq', 100, 6), s('w2', 'sq', 100, 8)];
    const [e] = prEvents(ws, sets);
    expect(e.reps).toBe(8);
    expect(e.value - e.previous).toBeCloseTo(100 * 8 / 30 - 100 * 5 / 30);
  });
  it('ignores warm-ups and bodyweight-only e1rm, but keeps bodyweight rep records', () => {
    const ws = [w('w1', '2026-11-01'), w('w2', '2026-11-03')];
    const sets = [s('w1', 'pullup', 0, 8), s('w1', 'bench', 20, 15, { is_warmup: 1 }), s('w2', 'pullup', 0, 10), s('w2', 'bench', 100, 1, { is_warmup: 1 })];
    const ev = prEvents(ws, sets);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ exerciseId: 'pullup', kind: 'reps', value: 10, previous: 8 });
  });
  it('newest first', () => {
    const ws = [w('w1', '2026-11-01'), w('w2', '2026-11-03'), w('w3', '2026-11-05')];
    const sets = [s('w1', 'a', 10, 5), s('w2', 'a', 12.5, 5), s('w3', 'a', 15, 5)];
    expect(prEvents(ws, sets).map((e) => e.workoutId)).toEqual(['w3', 'w2']);
  });
});

describe('strength + rest', () => {
  const ws = [w('w1', '2026-11-01'), w('w2', '2026-11-03')];
  const sets = [
    s('w1', 'bench', 60, 10), s('w1', 'bench', 62.5, 6, { rest_before_s: 120 }),
    s('w1', 'curl', 10, 12, { rest_before_s: 300, rest_is_transition: 1 }), s('w1', 'curl', 10, 12, { rest_before_s: 60 }),
    s('w2', 'bench', 65, 5, { rest_before_s: 180 }), s('w2', 'bench', 65, 5, { rest_before_s: 2000 }),
  ];
  it('e1rm series takes the best set per workout', () => {
    const pts = e1rmSeries('bench', ws, sets);
    expect(pts.map((p) => p.workoutId)).toEqual(['w1', 'w2']);
    expect(pts[0].value).toBeCloseTo(80); // 60×10 = 80 beats 62.5×6 = 75
    expect(pts[1]).toMatchObject({ weight: 65, reps: 5 });
  });
  it('lift options: most sessions first, compounds win ties', () => {
    const ex = new Map([['bench', { mechanic: 'compound' as const, name: 'Bench' }], ['curl', { mechanic: 'isolation' as const, name: 'Curl' }]]);
    expect(liftOptions(sets, ex).map((l) => l.exerciseId)).toEqual(['bench', 'curl']);
  });
  it('rest per session ignores transitions and outliers', () => {
    const r = restBySession(ws, sets);
    expect(r.map((x) => x.value)).toEqual([90, 180]); // w1: (120+60)/2, w2: 180 (2000 ignored)
  });
  it('rest per exercise compares with the previous period', () => {
    const r = restByExercise(sets.filter((x) => x.workout_id === 'w2'), sets.filter((x) => x.workout_id === 'w1'));
    expect(r).toEqual([{ exerciseId: 'bench', avg: 180, previous: 120, samples: 1 }]);
  });
});

describe('ranges + ticks', () => {
  it('splits current and previous periods', () => {
    const now = new Date('2026-11-19T12:00:00Z');
    const ws = [w('old', '2026-09-01'), w('prev', '2026-10-10'), w('cur', '2026-11-10')];
    const sets = [s('old', 'a', 1, 1), s('prev', 'a', 1, 1), s('cur', 'a', 1, 1)];
    const r = splitByRange(ws, sets, '1M', now);
    expect(r.workouts.map((x) => x.id)).toEqual(['cur']);
    expect(r.prevSets.map((x) => x.workout_id)).toEqual(['prev']);
    expect(splitByRange(ws, sets, 'All', now).workouts).toHaveLength(3);
    expect(rangeBounds('All').start).toBeNull();
  });
  it('nice ticks', () => {
    expect(niceTicks(0, 100)).toEqual([0, 50, 100]);
    expect(niceTicks(71, 93)).toEqual([70, 80, 90, 100]);
    expect(niceTicks(80, 80).length).toBeGreaterThan(1);
  });
});
