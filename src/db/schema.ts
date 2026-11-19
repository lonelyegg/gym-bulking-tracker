// Data model. Every synced record extends Base.
// Timestamps are ISO strings in UTC. Calendar dates are local 'YYYY-MM-DD'.

export interface Base {
  id: string;
  created_at: string;
  updated_at: string;
  deleted: 0 | 1;
}

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs' | 'full_body';

export const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs', 'full_body',
];

export type Mechanic = 'compound' | 'isolation';
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other';
export const EQUIPMENT: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];

export interface Exercise extends Base {
  name: string;
  muscle_group: MuscleGroup;
  mechanic: Mechanic;
  equipment: Equipment;
  /** Weight jump for the overload hint. Dumbbells use the dumbbell ladder in settings instead. */
  increment_kg: number;
  default_rest_s: number;
  notes: string;
}

export interface DayType extends Base {
  name: string;
  icon: string; // emoji
  color: string; // hex
  /** Rest after the last set of an exercise. null = settings default. */
  transition_rest_s: number | null;
}

export interface TemplateExercise extends Base {
  day_type_id: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  rep_min: number;
  rep_max: number;
  target_rir: number;
  rest_s: number;
}

/** A rotation entry is a day_type id, or REST for a planned rest day. */
export const REST = 'rest';

export interface Split extends Base {
  name: string;
  rotation: string[];
}

export type WorkoutStatus = 'active' | 'done';

export interface Workout extends Base {
  day_type_id: string | null;
  split_id: string | null;
  /** Position in the split's rotation this workout counts as. null = doesn't advance the rotation. */
  rotation_index: number | null;
  name: string;
  icon: string;
  color: string;
  started_at: string;
  ended_at: string | null;
  status: WorkoutStatus;
  notes: string;
}

export interface WorkoutExercise extends Base {
  workout_id: string;
  exercise_id: string;
  position: number;
  target_sets: number;
  rep_min: number;
  rep_max: number;
  target_rir: number;
  rest_s: number;
  transition_rest_s: number | null;
  note: string;
  skipped: 0 | 1;
  swapped_from_id: string | null;
}

export type PrType = 'weight' | 'e1rm' | 'reps';

export interface WorkoutSet extends Base {
  workout_id: string;
  workout_exercise_id: string;
  exercise_id: string;
  set_number: number;
  is_warmup: 0 | 1;
  weight_kg: number | null;
  reps: number | null;
  /** 0–4, where 4 means "4 or more". */
  rir: number | null;
  completed_at: string | null;
  /** Seconds since the previous completed set in this workout (any exercise). */
  rest_before_s: number | null;
  /** 1 if the previous completed set was a different exercise (moving between exercises). */
  rest_is_transition: 0 | 1;
  pr_types: PrType[];
  note: string;
}

// ---- Phases 4–5 (tables exist now so the schema is stable) ----

export interface Bodyweight extends Base {
  date: string;
  weight_kg: number | null;
  sleep_h: number | null;
}

export interface Measurement extends Base {
  date: string;
  site: string;
  value_cm: number;
}

export interface Photo extends Base {
  date: string;
  pose: 'front' | 'side' | 'back';
  drive_file_id: string | null;
  width: number;
  height: number;
}

export interface Food extends Base {
  name: string;
  basis: 'per_100g' | 'per_serving';
  serving_g: number | null;
  serving_label: string;
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
}

/** A reusable meal ("usual breakfast"). */
export interface SavedMeal extends Base {
  name: string;
  items: { food_id: string; amount: number; unit: 'g' | 'serving' }[];
}

/** An actual eating occasion with start and finish times. */
export interface Meal extends Base {
  date: string;
  name: string;
  started_at: string | null;
  finished_at: string | null;
  saved_meal_id: string | null;
}

export interface FoodLog extends Base {
  date: string;
  meal_id: string | null;
  food_id: string;
  amount: number;
  unit: 'g' | 'serving';
  // Copied from the food at log time so later edits don't rewrite history.
  kcal: number;
  protein_g: number;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface SettingRow extends Base {
  value: unknown;
}

export interface EntityMap {
  exercises: Exercise;
  day_types: DayType;
  template_exercises: TemplateExercise;
  splits: Split;
  workouts: Workout;
  workout_exercises: WorkoutExercise;
  sets: WorkoutSet;
  bodyweights: Bodyweight;
  measurements: Measurement;
  photos: Photo;
  foods: Food;
  saved_meals: SavedMeal;
  meals: Meal;
  food_logs: FoodLog;
  settings: SettingRow;
}

export type EntityName = keyof EntityMap;

export const ENTITIES: EntityName[] = [
  'exercises', 'day_types', 'template_exercises', 'splits', 'workouts',
  'workout_exercises', 'sets', 'bodyweights', 'measurements', 'photos',
  'foods', 'saved_meals', 'meals', 'food_logs', 'settings',
];

/** Local-only: which records changed and still need pushing (used by sync in Phase 2). */
export interface OutboxEntry {
  key: string; // `${entity}:${id}`
  entity: EntityName;
  id: string;
  queued_at: string;
  /** Random per write. Lets sync tell that a record changed again while it was being uploaded. */
  rev?: string;
}

/** Local-only key/value store (timer state, sync URL + token, ...). */
export interface LocalKV {
  key: string;
  value: unknown;
}
