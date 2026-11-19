// Muscle model. Each exercise lists the muscles it trains with a weight:
//   1    = main target       (counts as 1 set toward weekly volume)
//   0.5  = also worked       (counts as ½ set)
//   0.25 = minor/stabiliser  (shown faintly on the body map, not counted)

export type Muscle =
  | 'chest'
  | 'front_delts' | 'side_delts' | 'rear_delts'
  | 'lats' | 'upper_back' | 'traps' | 'lower_back'
  | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques'
  | 'quads' | 'hamstrings' | 'glutes' | 'adductors' | 'calves';

export type Region = 'chest' | 'back' | 'shoulders' | 'arms' | 'legs' | 'core';

export const REGIONS: { id: Region; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'back', label: 'Back' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'legs', label: 'Legs' },
  { id: 'core', label: 'Core' },
];

export const MUSCLES: { id: Muscle; label: string; region: Region }[] = [
  { id: 'chest', label: 'Chest', region: 'chest' },
  { id: 'lats', label: 'Lats', region: 'back' },
  { id: 'upper_back', label: 'Upper back', region: 'back' },
  { id: 'traps', label: 'Traps', region: 'back' },
  { id: 'lower_back', label: 'Lower back', region: 'back' },
  { id: 'front_delts', label: 'Front delts', region: 'shoulders' },
  { id: 'side_delts', label: 'Side delts', region: 'shoulders' },
  { id: 'rear_delts', label: 'Rear delts', region: 'shoulders' },
  { id: 'biceps', label: 'Biceps', region: 'arms' },
  { id: 'triceps', label: 'Triceps', region: 'arms' },
  { id: 'forearms', label: 'Forearms', region: 'arms' },
  { id: 'quads', label: 'Quads', region: 'legs' },
  { id: 'hamstrings', label: 'Hamstrings', region: 'legs' },
  { id: 'glutes', label: 'Glutes', region: 'legs' },
  { id: 'adductors', label: 'Adductors', region: 'legs' },
  { id: 'calves', label: 'Calves', region: 'legs' },
  { id: 'abs', label: 'Abs', region: 'core' },
  { id: 'obliques', label: 'Obliques', region: 'core' },
];

export const MUSCLE_IDS = MUSCLES.map((m) => m.id);
const META = new Map(MUSCLES.map((m) => [m.id, m]));
export const muscleLabel = (m: string) => META.get(m as Muscle)?.label ?? m.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const isMuscle = (m: unknown): m is Muscle => typeof m === 'string' && META.has(m as Muscle);

export type MuscleMap = Partial<Record<Muscle, number>>;

export const LEVELS = [
  { w: 1, label: 'Main' },
  { w: 0.5, label: 'Also' },
  { w: 0.25, label: 'Minor' },
] as const;

/** Before the muscle model, exercises had one broad group. Used only for records saved back then. */
const LEGACY: Record<string, MuscleMap> = {
  chest: { chest: 1 },
  back: { lats: 1, upper_back: 0.5 },
  shoulders: { side_delts: 1, front_delts: 0.5 },
  biceps: { biceps: 1 },
  triceps: { triceps: 1 },
  forearms: { forearms: 1 },
  quads: { quads: 1 },
  hamstrings: { hamstrings: 1 },
  glutes: { glutes: 1 },
  calves: { calves: 1 },
  abs: { abs: 1 },
  full_body: { quads: 0.5, glutes: 0.5, lats: 0.5, chest: 0.5 },
};

/** Keep known muscles and allowed weights only. */
export function cleanMuscles(raw: unknown): MuscleMap {
  const out: MuscleMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const w = Number(v);
    if (isMuscle(k) && w > 0) out[k] = w >= 0.75 ? 1 : w >= 0.375 ? 0.5 : 0.25;
  }
  return out;
}

/** Muscles for an exercise, whatever version of the app saved it. */
export function resolveMuscles(ex: { muscles?: unknown; muscle_group?: string } | undefined): MuscleMap {
  if (!ex) return {};
  const m = cleanMuscles(ex.muscles);
  if (Object.keys(m).length) return m;
  const g = ex.muscle_group ?? '';
  if (isMuscle(g)) return { [g]: 1 };
  return { ...(LEGACY[g] ?? {}) };
}

/** The muscle shown as the exercise's group: the first main muscle in body order. */
export function primaryMuscle(m: MuscleMap): Muscle | null {
  let best: Muscle | null = null;
  for (const id of MUSCLE_IDS) if ((m[id] ?? 0) > (best ? m[best]! : 0)) best = id;
  return best;
}

export function regionOf(m: MuscleMap): Region {
  const p = primaryMuscle(m);
  return p ? META.get(p)!.region : 'core';
}

/** "Lats, Upper back" — the main muscles, then the others, in body order. */
export function describeMuscles(m: MuscleMap) {
  const at = (w: number) => MUSCLE_IDS.filter((id) => m[id] === w).map(muscleLabel);
  return { main: at(1), also: at(0.5), minor: at(0.25) };
}

export const summaryLine = (m: MuscleMap) => {
  const d = describeMuscles(m);
  return [...d.main, ...d.also].join(' · ') || 'No muscles set';
};

// ---------- Colour ----------
// One-hue red ramp (validated: monotone lightness, visible steps, faintest step clears the card).
// Untrained muscles are neutral grey, not part of the ramp.
const BASE = '#3a3f4a';
const STOPS: [number, number[]][] = [
  [0.25, [0x7d, 0x3a, 0x42]], // minor
  [0.5, [0xb8, 0x42, 0x4a]], // also worked
  [1, [0xff, 0x4d, 0x4f]], // main
];
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Colour for an amount t in 0..1 (anything above 0 is at least the faintest red). */
export function heat(t: number): string {
  if (!(t > 0)) return BASE;
  const k = Math.min(1, t);
  if (k <= STOPS[0][0]) return hex(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (k <= t1) return hex(c0.map((v, j) => v + ((c1[j] - v) * (k - t0)) / (t1 - t0)));
  }
  return hex(STOPS[STOPS.length - 1][1]);
}
