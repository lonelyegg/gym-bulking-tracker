import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRAM, LIFT_EXERCISE, nextSession, plannedSessions, plateText, platesPerSide, replay, roundDownLoadable,
  sessionPlan, warmupSets, withDefaults, type Day, type Lift,
} from '../src/lib/program';
import type { S, W } from '../src/lib/stats';

const cfg = DEFAULT_PROGRAM;
let n = 0;
/** A 5×5 session on a local date with reps per lift (default: all 5s at the given weight). */
function session(date: string, day: Day, lifts: Partial<Record<Lift, { w: number; reps?: number[] }>>) {
  const id = `w-${date}-${day}`;
  const w: W & { program: string; program_day: string } = {
    id, started_at: new Date(`${date}T18:00:00`).toISOString(), ended_at: null, day_type_id: null, name: `5×5 ${day}`, icon: '', color: '',
    program: 'sl5x5', program_day: day,
  };
  const sets: S[] = [];
  for (const [lift, v] of Object.entries(lifts) as [Lift, { w: number; reps?: number[] }][]) {
    const reps = v.reps ?? (lift === 'deadlift' ? [5] : [5, 5, 5, 5, 5]);
    reps.forEach((r, i) => sets.push({
      id: `${id}-${lift}-${i}`, workout_id: id, exercise_id: LIFT_EXERCISE[lift], set_number: i + 1, is_warmup: 0, rir: null,
      completed_at: w.started_at, rest_before_s: null, rest_is_transition: 0, weight_kg: v.w, reps: r,
    }));
    // a warm-up that must be ignored
    sets.push({ id: `${id}-${lift}-wu${++n}`, workout_id: id, exercise_id: LIFT_EXERCISE[lift], set_number: 0, is_warmup: 1, rir: null, completed_at: w.started_at, rest_before_s: null, rest_is_transition: 0, weight_kg: 20, reps: 2 });
  }
  return { w, sets };
}
function run(list: ReturnType<typeof session>[], c: Partial<typeof cfg> = cfg, before?: string) {
  return replay(list.map((x) => x.w), list.flatMap((x) => x.sets), c, { before });
}

describe('loading the bar', () => {
  it('plates per side and rounding', () => {
    expect(platesPerSide(62.5, cfg)).toEqual({ plates: [20, 1.25], exact: true });
    expect(platesPerSide(100, cfg).plates).toEqual([25, 15]);
    expect(plateText(20, cfg)).toBe('Empty bar');
    expect(plateText(41, cfg)).toMatch(/closest/);
    expect(roundDownLoadable(72 * 0.9, cfg)).toBe(62.5); // 64.8 → 62.5
    expect(roundDownLoadable(80 * 0.9, cfg)).toBe(70); // 72 isn't loadable with 1.25 kg plates
    expect(roundDownLoadable(21, cfg)).toBe(20);
  });
  it('warm-ups: bar, ~65 % × 5, ~85 % × 3, only lighter than the work weight', () => {
    expect(warmupSets(60, 'squat', cfg)).toEqual([{ weight: 20, reps: 10 }, { weight: 40, reps: 5 }, { weight: 50, reps: 3 }]);
    expect(warmupSets(30, 'row', cfg)).toEqual([{ weight: 20, reps: 10 }, { weight: 25, reps: 3 }]);
    expect(warmupSets(40, 'deadlift', cfg)).toEqual([{ weight: 20, reps: 5 }, { weight: 25, reps: 5 }, { weight: 35, reps: 3 }]);
    expect(warmupSets(20, 'bench', cfg)).toEqual([]);
  });
});

describe('progression', () => {
  it('starts at the guide weights and alternates A/B from A', () => {
    const s = run([]);
    expect(Object.fromEntries(Object.entries(s.lifts).map(([k, v]) => [k, v.weight]))).toEqual({ squat: 20, bench: 20, row: 30, ohp: 20, deadlift: 40 });
    const nx = nextSession(s, cfg, '2026-11-23'); // Monday
    expect(nx.day).toBe('A');
    expect(nx.lifts.map((l) => [l.lift, l.weight, l.sets])).toEqual([['squat', 20, 5], ['bench', 20, 5], ['row', 30, 5]]);
  });
  it('success adds 2.5 kg (deadlift 5 kg); next day alternates', () => {
    const s = run([
      session('2026-11-23', 'A', { squat: { w: 20 }, bench: { w: 20 }, row: { w: 30 } }),
      session('2026-11-25', 'B', { squat: { w: 22.5 }, ohp: { w: 20 }, deadlift: { w: 40 } }),
    ]);
    expect(s.lifts.squat.weight).toBe(25);
    expect(s.lifts.bench.weight).toBe(22.5);
    expect(s.lifts.deadlift.weight).toBe(45);
    expect(s.lastDay).toBe('B');
    expect(nextSession(s, cfg, '2026-11-26').day).toBe('A');
  });
  it('a miss repeats the weight; three misses in a row deload 10 %, rounded down', () => {
    const miss = { w: 80, reps: [5, 5, 5, 5, 4] };
    const s = run([
      session('2026-11-02', 'A', { squat: miss }),
      session('2026-11-04', 'B', { squat: miss }),
      session('2026-11-06', 'A', { squat: miss }),
    ]);
    const h = s.lifts.squat.history.map((e) => [e.result, e.next, e.fails]);
    expect(h).toEqual([['fail', 80, 1], ['fail', 80, 2], ['deload', 70, 0]]); // 72 → 70 (loadable)
    expect(s.lifts.squat.deloads).toBe(1);
  });
  it('a success in between resets the miss count', () => {
    const s = run([
      session('2026-11-02', 'A', { squat: { w: 80, reps: [5, 5, 5, 5, 3] } }),
      session('2026-11-04', 'B', { squat: { w: 80 } }),
      session('2026-11-06', 'A', { squat: { w: 82.5, reps: [5, 5, 4, 4, 4] } }),
      session('2026-11-09', 'B', { squat: { w: 82.5, reps: [5, 5, 4, 4, 4] } }),
    ]);
    expect(s.lifts.squat.fails).toBe(2);
    expect(s.lifts.squat.weight).toBe(82.5);
  });
  it('fewer than 5 work sets is a miss; a skipped lift changes nothing', () => {
    const s = run([
      session('2026-11-02', 'A', { squat: { w: 60, reps: [5, 5, 5] }, bench: { w: 40 } }), // row skipped
    ]);
    expect(s.lifts.squat.history[0].result).toBe('fail');
    expect(s.lifts.row.history[0].result).toBe('skipped');
    expect(s.lifts.row.weight).toBe(30);
  });
  it('the weight you actually used counts (e.g. you went lighter)', () => {
    const s = run([session('2026-11-02', 'A', { bench: { w: 30 } })]);
    expect(s.lifts.bench.weight).toBe(32.5);
  });
  it('more than a week off: all lifts 10 % lighter', () => {
    const s = run([
      session('2026-11-02', 'A', { squat: { w: 60 } }), // → 62.5
      session('2026-11-16', 'B', { squat: { w: 55 } }), // 14 days later: 62.5 → 55 expected, then +2.5
    ]);
    expect(s.breaks).toEqual([{ date: '2026-11-16' }]);
    expect(s.lifts.squat.weight).toBe(57.5);
    const preview = sessionPlan(run([session('2026-11-02', 'A', { squat: { w: 60 } })]), cfg, 'B', '2026-11-12');
    expect(preview.afterBreak).toBe(true);
    expect(preview.lifts[0].weight).toBe(55);
  });
  it('manual adjustments override from that moment', () => {
    const c = withDefaults({ adjustments: [{ lift: 'squat', weight: 60, at: new Date('2026-11-03T12:00:00').toISOString() }] });
    const s = run([session('2026-11-02', 'A', { squat: { w: 20 } }), session('2026-11-04', 'B', { squat: { w: 60 } })], c);
    expect(s.lifts.squat.weight).toBe(62.5);
    expect(run([], c).lifts.squat.weight).toBe(60);
  });
  it('replay before a date ignores later sessions (logging a missed day)', () => {
    const list = [session('2026-11-02', 'A', { squat: { w: 20 } }), session('2026-11-06', 'A', { squat: { w: 22.5 } })];
    expect(run(list, cfg, new Date('2026-11-04T00:00:00').toISOString()).lifts.squat.weight).toBe(22.5);
  });
});

describe('schedule', () => {
  it('next session waits for a training day and skips today if already done', () => {
    const s = run([session('2026-11-20', 'A', { squat: { w: 20 } })]); // Friday
    expect(nextSession(s, cfg, '2026-11-20')).toMatchObject({ day: 'B', date: '2026-11-23' });
    expect(nextSession(run([]), cfg, '2026-11-21').date).toBe('2026-11-23'); // Saturday → Monday
  });
  it('A/B alternate across the week: Mon A, Wed B, Fri A, next Mon B', () => {
    const p = plannedSessions(run([]), cfg, '2026-11-23', '2026-11-30');
    expect([...p]).toEqual([['2026-11-23', 'A'], ['2026-11-25', 'B'], ['2026-11-27', 'A'], ['2026-11-30', 'B']]);
  });
  it('custom days (Tue/Thu/Sat)', () => {
    const p = plannedSessions(run([]), withDefaults({ days: [1, 3, 5] }), '2026-11-23', '2026-11-28');
    expect([...p.keys()]).toEqual(['2026-11-24', '2026-11-26', '2026-11-28']);
  });
});
