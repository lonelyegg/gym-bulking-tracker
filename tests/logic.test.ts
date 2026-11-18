import { describe, expect, it } from 'vitest';
import {
  avgRest, daysBetween, detectPRs, epley, nextInRotation, nextWeight, progressionHint, rotationIndexFor,
} from '../src/lib/logic';
import { buildSeed } from '../src/db/seed';

const LADDER = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25];

describe('epley', () => {
  it('matches the formula', () => {
    expect(epley(100, 10)).toBeCloseTo(133.33, 1);
    expect(epley(100, 0)).toBe(0);
  });
});

describe('nextWeight', () => {
  it('uses the dumbbell ladder', () => {
    expect(nextWeight('dumbbell', 12.5, 2.5, LADDER)).toBe(15);
    expect(nextWeight('dumbbell', 25, 2.5, LADDER)).toBeNull();
  });
  it('uses the exercise increment otherwise', () => {
    expect(nextWeight('machine', 49, 7, LADDER)).toBe(56);
    expect(nextWeight('barbell', 60, 2.5, LADDER)).toBe(62.5);
  });
});

describe('progressionHint', () => {
  const tgt = { rep_max: 12, target_rir: 2 };
  const bb = { equipment: 'barbell' as const, increment_kg: 2.5, mechanic: 'compound' as const };
  it('suggests weight when all sets hit the top at target RIR', () => {
    const h = progressionHint([{ weight_kg: 60, reps: 12, rir: 2 }, { weight_kg: 60, reps: 12, rir: 3 }], tgt, bb, LADDER);
    expect(h).toEqual({ kind: 'add_weight', from: 60, to: 62.5 });
  });
  it('suggests reps when a set fell short or RIR was below target', () => {
    expect(progressionHint([{ weight_kg: 60, reps: 12, rir: 2 }, { weight_kg: 60, reps: 10, rir: 2 }], tgt, bb, LADDER).kind).toBe('add_reps');
    expect(progressionHint([{ weight_kg: 60, reps: 12, rir: 1 }], tgt, bb, LADDER).kind).toBe('add_reps');
  });
  it('handles the top of the dumbbell rack', () => {
    const db = { equipment: 'dumbbell' as const, increment_kg: 2.5, mechanic: 'isolation' as const };
    expect(progressionHint([{ weight_kg: 25, reps: 12, rir: 2 }], tgt, db, LADDER).kind).toBe('top_of_rack');
  });
  it('first time', () => {
    expect(progressionHint([], tgt, bb, LADDER).kind).toBe('first');
  });
});

describe('detectPRs', () => {
  const hist = [{ weight_kg: 60, reps: 10, rir: 2 }, { weight_kg: 70, reps: 5, rir: 1 }];
  it('no PRs on the first session', () => {
    expect(detectPRs({ weight_kg: 100, reps: 10 }, [], false)).toEqual([]);
  });
  it('detects weight, e1rm and reps PRs', () => {
    expect(detectPRs({ weight_kg: 72.5, reps: 5 }, hist, true)).toEqual(['weight', 'e1rm']);
    expect(detectPRs({ weight_kg: 60, reps: 11 }, hist, true)).toEqual(['e1rm', 'reps']); // 82.0 > 81.7
    expect(detectPRs({ weight_kg: 60, reps: 10 }, hist, true)).toEqual([]);
  });
  it('bodyweight exercises only get rep PRs', () => {
    expect(detectPRs({ weight_kg: 0, reps: 9 }, [{ weight_kg: 0, reps: 8, rir: 1 }], true)).toEqual(['reps']);
  });
});

describe('rotation', () => {
  const split = { rotation: ['push', 'pull', 'legs', 'rest'] };
  it('starts at the first workout', () => {
    expect(nextInRotation(split, null, '2026-11-18')).toMatchObject({ kind: 'workout', dayTypeId: 'push' });
  });
  it('advances after a workout', () => {
    expect(nextInRotation(split, { rotation_index: 0, date: '2026-11-17' }, '2026-11-18')).toMatchObject({ kind: 'workout', dayTypeId: 'pull' });
  });
  it('rest day the day after legs, push the day after that', () => {
    expect(nextInRotation(split, { rotation_index: 2, date: '2026-11-17' }, '2026-11-18')).toMatchObject({ kind: 'rest', nextDayTypeId: 'push' });
    expect(nextInRotation(split, { rotation_index: 2, date: '2026-11-17' }, '2026-11-19')).toMatchObject({ kind: 'workout', dayTypeId: 'push' });
  });
  it('trained today', () => {
    expect(nextInRotation(split, { rotation_index: 2, date: '2026-11-18' }, '2026-11-18')).toMatchObject({ kind: 'workout', dayTypeId: 'push', trainedToday: true });
  });
  it('two rest days in a row', () => {
    const ul = { rotation: ['u', 'l', 'rest', 'rest'] };
    expect(nextInRotation(ul, { rotation_index: 1, date: '2026-11-16' }, '2026-11-17').kind).toBe('rest');
    expect(nextInRotation(ul, { rotation_index: 1, date: '2026-11-16' }, '2026-11-18').kind).toBe('rest');
    expect(nextInRotation(ul, { rotation_index: 1, date: '2026-11-16' }, '2026-11-19')).toMatchObject({ kind: 'workout', dayTypeId: 'u' });
  });
  it('finds the slot for a chosen day', () => {
    expect(rotationIndexFor(split, 'legs', 1)).toBe(2);
    expect(rotationIndexFor(split, 'push', 1)).toBe(0);
    expect(rotationIndexFor(split, 'arms', 1)).toBeNull();
  });
  it('daysBetween crosses months', () => {
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('rest + seed', () => {
  it('avgRest ignores outliers', () => {
    expect(avgRest([90, 110, null, 2000])).toBe(100);
  });
  it('seed builds without unknown exercises', () => {
    const s = buildSeed();
    expect(s.exercises.length).toBeGreaterThan(40);
    expect(s.splits.length).toBe(4);
    for (const sp of s.splits) for (const id of sp.rotation) {
      if (id !== 'rest') expect(s.day_types.some((d) => d.id === id)).toBe(true);
    }
  });
});
