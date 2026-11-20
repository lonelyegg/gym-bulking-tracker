import { signal } from '@preact/signals';
import { db, put } from '../db/db';
import { DEFAULT_SITES, type Site } from '../lib/body';
import type { ProgramConfig } from '../lib/program';

export type BeepMode = 'transient' | 'ambient' | 'off';

export interface Settings {
  active_split_id: string | null;
  weekly_target: number;
  /** Rest after the last set of an exercise (moving to the next one). */
  transition_rest_s: number;
  compound_rest_s: number;
  isolation_rest_s: number;
  /** Available dumbbell weights, ascending. */
  dumbbell_ladder: number[];
  wake_lock: boolean;
  beep_mode: BeepMode;
  notify_when_hidden: boolean;
  // Phase 4
  protein_g_per_kg: number;
  kcal_target: number | null;
  gain_rate_min_pct: number;
  gain_rate_max_pct: number;
  /** Body measurements you track (defaults + your custom ones). */
  measurement_sites: Site[];
  // For the calorie estimate
  height_cm: number | null;
  birth_year: number | null;
  sex: 'male' | 'female' | null;
  physical_job: boolean;
  /** A program that replaces the active split on Home and the calendar (e.g. 'sl5x5'). */
  active_program: string | null;
  program_sl5x5: Partial<ProgramConfig> | null;
}

export const DEFAULT_SETTINGS: Settings = {
  active_split_id: null,
  weekly_target: 4,
  transition_rest_s: 180,
  compound_rest_s: 150,
  isolation_rest_s: 90,
  dumbbell_ladder: [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25],
  wake_lock: true,
  beep_mode: 'transient',
  notify_when_hidden: true,
  protein_g_per_kg: 1.8,
  kcal_target: null,
  gain_rate_min_pct: 0.25,
  gain_rate_max_pct: 0.5,
  measurement_sites: DEFAULT_SITES,
  height_cm: null,
  birth_year: null,
  sex: null,
  physical_job: false,
  active_program: null,
  program_sl5x5: null,
};

export const settings = signal<Settings>({ ...DEFAULT_SETTINGS });

export async function loadSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!r.deleted && r.id in s) (s as unknown as Record<string, unknown>)[r.id] = r.value;
  }
  settings.value = s;
  return s;
}

/** Each setting is its own row (id = key), so changing one never clobbers another during sync. */
export async function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  settings.value = { ...settings.value, [key]: value };
  const existing = await db.settings.get(key);
  await put('settings', { id: key, value, created_at: existing?.created_at });
}
