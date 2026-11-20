// Food log: today's kcal + protein against targets, meals with start/finish times, one-tap saved
// meals and "copy yesterday", and a My Foods library. A regular meal is 2 taps (+1 to finish).
import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { db, put, softDelete, useLive } from '../db/db';
import type { Food, FoodLog, Meal } from '../db/schema';
import { localDate } from '../lib/logic';
import {
  canUseGrams, canUseServings, dayTotals, defaultAmount, fromRestaurant, groupByRestaurant, matchesSearch, nutrientsFor, rankFoods, restaurants,
} from '../lib/nutrition';
import { addDays } from '../lib/stats';
import {
  copyDay, deleteLog, deleteMeal, finishMeal, logFood, logSavedMeal, quickAdd, saveMealAsTemplate, setMealTimes,
  updateLog, updateQuick, useFoodDay, useFoods, useSavedMeals, type QuickEntry,
} from '../state/food';
import { FoodBars, TargetsForm } from '../components/nutrition';
import { IconChevron, IconChevronLeft, IconPlus } from '../components/icons';
import { confirmSheet, go, Header, PageTitle, promptSheet, Segmented, Sheet, Stepper, Toggle, toast } from '../components/ui';

/** The day you're looking at (kept while you navigate away and back). */
export const foodDate = signal(localDate());

const r0 = (n: number) => Math.round(n).toLocaleString();
const r1 = (n: number) => (Math.round(n * 10) / 10).toString();
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '–');

function dayLabel(date: string) {
  const today = localDate();
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export const amountText = (f: Pick<Food, 'serving_label'> | undefined, amount: number, unit: 'g' | 'serving') =>
  unit === 'g' ? `${r1(amount)} g` : `${r1(amount)} × ${f?.serving_label || 'serving'}`;

export function FoodScreen() {
  const date = foodDate.value;
  const today = localDate();
  const day = useFoodDay(date);
  const foods = useFoods() ?? [];
  const saved = useSavedMeals() ?? [];
  const foodById = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  const [adding, setAdding] = useState<{ mealId?: string } | null>(null);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [targets, setTargets] = useState(false);
  const [manageSaved, setManageSaved] = useState(false);
  const [times, setTimes] = useState<Meal | null>(null);

  const totals = day ? dayTotals(day.logs) : null;
  const prev = addDays(date, -1);

  const copyPrevious = async () => {
    const has = (await db.meals.where('date').equals(prev).toArray()).some((m) => !m.deleted);
    if (!has) { toast(`Nothing logged ${date === today ? 'yesterday' : 'the day before'}.`); return; }
    if (day?.logs.length && !(await confirmSheet(`Add everything from ${dayLabel(prev).toLowerCase()} to ${dayLabel(date).toLowerCase()}? What's already here stays.`, 'Copy'))) return;
    const n = await copyDay(prev, date);
    toast(`Copied ${n} meal${n === 1 ? '' : 's'} ✓`);
  };

  return (
    <div class="page">
      <PageTitle title="Food" right={<button class="btn sm" onClick={() => setTargets(true)}>Targets</button>} />
      <div class="date-nav">
        <button class="icon-btn sm" aria-label="Previous day" onClick={() => (foodDate.value = prev)}><IconChevronLeft /></button>
        <button class="date-nav-label" onClick={() => (foodDate.value = today)}>{dayLabel(date)}</button>
        <button class="icon-btn sm" aria-label="Next day" disabled={date >= today} onClick={() => (foodDate.value = addDays(date, 1))}><IconChevron /></button>
      </div>

      <section class="card">
        <FoodBars date={date} totals={totals ?? undefined} />
        {totals && (totals.carbs_g != null || totals.fat_g != null) && (
          <div class="muted small macro-line">Carbs {totals.carbs_g != null ? `${r0(totals.carbs_g)} g` : '–'} · Fat {totals.fat_g != null ? `${r0(totals.fat_g)} g` : '–'}</div>
        )}
      </section>

      <button class="btn primary block lg" onClick={() => setAdding({})}><IconPlus /> Add food</button>
      <div class="chips scroll-x quick-row">
        {saved.map((m) => (
          <button key={m.id} class="chip" onClick={async () => {
            const r = await logSavedMeal(m, date);
            toast(`${m.name} logged${r.skipped ? ` (${r.skipped} missing food skipped)` : ''}${date === today ? ' · tap Finish when done' : ''}`);
          }}>⚡ {m.name}</button>
        ))}
        <button class="chip" onClick={copyPrevious}>↺ Copy {date === today ? 'yesterday' : 'previous day'}</button>
      </div>

      {day && !day.meals.length && (
        <p class="empty">Nothing logged {date === today ? 'yet today' : 'this day'}. Tap <b>Add food</b>, a saved meal, or copy {date === today ? 'yesterday' : 'the previous day'}.</p>
      )}
      {day?.meals.map((m) => (
        <MealCard key={m.id} meal={m} logs={day.logs.filter((l) => l.meal_id === m.id)} foods={foodById}
          isToday={date === today} onAdd={() => setAdding({ mealId: m.id })} onEdit={setEditing} onTimes={() => setTimes(m)} />
      ))}
      {/* Entries whose meal was deleted on another device */}
      {day && day.logs.some((l) => !day.meals.some((m) => m.id === l.meal_id)) && (
        <section class="card">
          <div class="bold">Other</div>
          {day.logs.filter((l) => !day.meals.some((m) => m.id === l.meal_id)).map((l) => (
            <LogRow key={l.id} log={l} food={l.food_id ? foodById.get(l.food_id) : undefined} onClick={() => setEditing(l)} />
          ))}
        </section>
      )}

      <div class="row gap mt">
        <button class="btn grow" onClick={() => go('/food/foods')}>My foods</button>
        <button class="btn grow" onClick={() => setManageSaved(true)}>Saved meals</button>
      </div>
      <div class="bottom-space" />

      {adding && <AddFoodSheet date={date} mealId={adding.mealId} foods={foods} onClose={() => setAdding(null)} />}
      {editing && <EditLogSheet log={editing} food={editing.food_id ? foodById.get(editing.food_id) : undefined} onClose={() => setEditing(null)} />}
      {times && <TimesSheet meal={times} onClose={() => setTimes(null)} />}
      <Sheet open={targets} onClose={() => setTargets(false)} title="Targets"><TargetsForm /></Sheet>
      <SavedMealsSheet open={manageSaved} onClose={() => setManageSaved(false)} foods={foodById} />
    </div>
  );
}

function LogRow({ log, food, onClick }: { log: FoodLog; food: Food | undefined; onClick: () => void }) {
  return (
    <button class="log-row" onClick={onClick}>
      <span class="grow left">
        <span class="block ellipsis">{food?.name ?? log.name ?? 'Deleted food'}</span>
        <span class="block muted small">{!log.food_id ? 'one-time entry' : `${amountText(food, log.amount, log.unit)}${food?.restaurant ? ` · ${food.restaurant}` : ''}`}</span>
      </span>
      <span class="right">
        <span class="block num">{r0(log.kcal)} kcal</span>
        <span class="block muted small num">{r1(log.protein_g)} g protein</span>
      </span>
    </button>
  );
}

function MealCard(props: {
  meal: Meal; logs: FoodLog[]; foods: Map<string, Food>; isToday: boolean;
  onAdd: () => void; onEdit: (l: FoodLog) => void; onTimes: () => void;
}) {
  const { meal, logs } = props;
  const [menu, setMenu] = useState(false);
  const t = dayTotals(logs);
  const eating = !meal.finished_at && props.isToday;
  const mins = meal.started_at && meal.finished_at ? Math.round((Date.parse(meal.finished_at) - Date.parse(meal.started_at)) / 60000) : null;
  return (
    <section class={`card meal-card ${eating ? 'eating' : ''}`}>
      <div class="meal-head">
        <button class="grow left" onClick={() => setMenu(true)}>
          <span class="block bold">{meal.name}</span>
          <span class="block muted small">
            {eating ? `Eating since ${hm(meal.started_at)}` : meal.finished_at ? `${hm(meal.started_at)} – ${hm(meal.finished_at)}${mins != null ? ` · ${mins} min` : ''}` : `Started ${hm(meal.started_at)} · not finished`}
          </span>
        </button>
        <span class="right">
          <span class="block bold num">{r0(t.kcal)} kcal</span>
          <span class="block muted small num">{r1(t.protein_g)} g protein</span>
        </span>
      </div>
      {eating && <button class="btn primary block sm" onClick={() => finishMeal(meal)}>Finish meal</button>}
      {logs.map((l) => <LogRow key={l.id} log={l} food={l.food_id ? props.foods.get(l.food_id) : undefined} onClick={() => props.onEdit(l)} />)}
      <div class="meal-actions">
        <button class="link" onClick={props.onAdd}>+ Add food</button>
        <button class="link muted-link" onClick={() => setMenu(true)}>Edit</button>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={meal.name}>
        <div class="menu-list">
          <button onClick={() => { setMenu(false); props.onTimes(); }}>Edit start / finish time</button>
          <button onClick={async () => { setMenu(false); const n = await promptSheet('Rename meal', meal.name); if (n) await put('meals', { ...meal, name: n }); }}>Rename</button>
          {logs.length > 0 && <button onClick={async () => {
            setMenu(false);
            const n = await promptSheet('Save as a meal you can log in one tap', meal.name, 'Save', 'e.g. Usual breakfast');
            if (n) { await saveMealAsTemplate(meal, n); toast(`Saved “${n}” ✓`); }
          }}>Save as a saved meal</button>}
          {!meal.finished_at && <button onClick={() => { setMenu(false); finishMeal(meal); }}>Finish now</button>}
          <button class="danger-text" onClick={async () => {
            setMenu(false);
            if (await confirmSheet(`Delete ${meal.name} and its ${logs.length} item${logs.length === 1 ? '' : 's'}?`, 'Delete', true)) deleteMeal(meal);
          }}>Delete meal</button>
        </div>
      </Sheet>
    </section>
  );
}

function TimesSheet({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  const toHm = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');
  const [start, setStart] = useState(toHm(meal.started_at));
  const [end, setEnd] = useState(toHm(meal.finished_at));
  const at = (t: string) => {
    if (!t) return null;
    const [y, m, d] = meal.date.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi).toISOString();
  };
  return (
    <Sheet open onClose={onClose} title={`${meal.name} times`}>
      <div class="form">
        <label>Started</label>
        <input class="input" type="time" value={start} onInput={(e) => setStart((e.currentTarget as HTMLInputElement).value)} />
        <label>Finished</label>
        <input class="input" type="time" value={end} onInput={(e) => setEnd((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn primary block" onClick={async () => {
          const s = at(start); let f = at(end);
          if (s && f && f < s) f = new Date(Date.parse(f) + 86400000).toISOString(); // past midnight
          await setMealTimes(meal, s, f);
          onClose();
        }}>Save</button>
      </div>
    </Sheet>
  );
}

// ---------- Adding / editing food ----------

function AmountForm(props: {
  food: Food; initial: { amount: number; unit: 'g' | 'serving' }; submit: string;
  onSubmit: (amount: number, unit: 'g' | 'serving') => void; onDelete?: () => void;
}) {
  const f = props.food;
  const [unit, setUnit] = useState(props.initial.unit);
  const [amount, setAmount] = useState<number | null>(props.initial.amount);
  const both = canUseGrams(f) && canUseServings(f);
  const n = amount ? nutrientsFor(f, amount, unit) : null;
  const servingName = f.serving_label || 'serving';
  const switchUnit = (u: 'g' | 'serving') => {
    if (u === unit) return;
    // Keep the same quantity when switching.
    if (amount && f.serving_g) setAmount(u === 'g' ? Math.round(amount * f.serving_g) : Math.round((amount / f.serving_g) * 4) / 4);
    else setAmount(u === 'g' ? 100 : 1);
    setUnit(u);
  };
  const quick = unit === 'g' ? [50, 100, 150, 200, 250, 300] : [0.5, 1, 1.5, 2, 3];
  return (
    <div class="form">
      {both && <Segmented label="Unit" value={unit === 'g' ? 'grams' : servingName} options={['grams', servingName]} onChange={(v) => switchUnit(v === 'grams' ? 'g' : 'serving')} />}
      <Stepper value={amount} step={unit === 'g' ? 5 : 0.5} min={0} max={unit === 'g' ? 5000 : 50} decimals unit={unit === 'g' ? 'g' : servingName} onChange={setAmount} />
      <div class="chips wrap">{quick.map((q) => <button key={q} class={`chip ${amount === q ? 'on' : ''}`} onClick={() => setAmount(q)}>{q}{unit === 'g' ? ' g' : '×'}</button>)}</div>
      <div class="amount-preview">
        {n ? <><b>{r0(n.kcal)} kcal</b> · {r1(n.protein_g)} g protein{n.carbs_g != null ? ` · ${r0(n.carbs_g)} g carbs` : ''}{n.fat_g != null ? ` · ${r0(n.fat_g)} g fat` : ''}</> : <span class="muted">Enter an amount</span>}
      </div>
      <div class="row gap">
        {props.onDelete && <button class="btn danger-outline" onClick={props.onDelete}>Delete</button>}
        <button class="btn grow primary" disabled={!n} onClick={() => amount && props.onSubmit(amount, unit)}>{props.submit}</button>
      </div>
    </div>
  );
}

/** A one-time entry: name (optional) and its numbers, without saving it to My foods. */
function QuickAddForm(props: {
  initial?: QuickEntry; submit: string; allowSave?: boolean;
  onSubmit: (e: QuickEntry, saveToFoods: boolean) => void; onDelete?: () => void;
}) {
  const i = props.initial;
  const [name, setName] = useState(i?.name ?? '');
  const [kcal, setKcal] = useState<number | null>(i?.kcal ?? null);
  const [protein, setProtein] = useState<number | null>(i?.protein_g ?? null);
  const [carbs, setCarbs] = useState<number | null>(i?.carbs_g ?? null);
  const [fat, setFat] = useState<number | null>(i?.fat_g ?? null);
  const [save, setSave] = useState(false);
  return (
    <div class="form">
      {props.allowSave && <p class="muted small">For something you won’t eat again. Estimates are fine; it isn’t added to My foods.</p>}
      <label>What was it? (optional)</label>
      <input class="input" value={name} placeholder="e.g. Birthday cake" onInput={(ev) => setName((ev.currentTarget as HTMLInputElement).value)} />
      <label>Calories</label>
      <Stepper value={kcal} step={50} min={0} max={5000} unit="kcal" placeholder="0" onChange={setKcal}
        onInc={(c) => setKcal(Math.min(5000, (c ?? 0) + 50))} onDec={(c) => setKcal(Math.max(0, (c ?? 0) - 50))} />
      <label>Protein</label>
      <Stepper value={protein} step={5} min={0} max={500} decimals unit="g" placeholder="0" onChange={setProtein} />
      <div class="pair">
        <div><span class="pair-label">Carbs (optional)</span><Stepper value={carbs} step={5} min={0} max={500} decimals unit="g" placeholder="–" onChange={setCarbs} /></div>
        <div><span class="pair-label">Fat (optional)</span><Stepper value={fat} step={5} min={0} max={500} decimals unit="g" placeholder="–" onChange={setFat} /></div>
      </div>
      {props.allowSave && <Toggle label="Also save to My foods" hint="Turn on if you might have it again." checked={save} onChange={setSave} />}
      <div class="row gap mt">
        {props.onDelete && <button class="btn danger-outline" onClick={props.onDelete}>Delete</button>}
        <button class="btn grow primary" disabled={kcal == null}
          onClick={() => kcal != null && props.onSubmit({ name, kcal, protein_g: protein ?? 0, carbs_g: carbs, fat_g: fat }, save)}>{props.submit}</button>
      </div>
    </div>
  );
}

function AddFoodSheet(props: { date: string; mealId?: string; foods: Food[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [place, setPlace] = useState<string | null>(null);
  const [food, setFood] = useState<Food | null>(null);
  const [mode, setMode] = useState<'pick' | 'new' | 'quick'>('pick');
  const loaded = useLive(async () => (await db.food_logs.toArray()).filter((l) => !l.deleted), []);
  const logs = loaded ?? [];
  const places = useMemo(() => restaurants(props.foods), [props.foods]);
  const pool = useMemo(() => props.foods.filter((f) => fromRestaurant(f, place)), [props.foods, place]);
  // Wait for your history before showing the list, so it never reorders under your finger.
  const ranked = useMemo(() => rankFoods(pool, loaded ?? []), [pool, loaded]);
  const lastOf = (id: string) => logs.filter((l) => l.food_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const per = (f: Food) => `${r0(f.kcal)} kcal · ${r1(f.protein_g)} g protein per ${f.basis === 'per_100g' ? '100 g' : f.serving_label || 'serving'}`;
  const Row = ({ f }: { f: Food }) => (
    <button class="pick-item" onClick={() => setFood(f)}>
      <span class="bold">{f.name}</span>
      <span class="muted small">{place == null && f.restaurant ? `${f.restaurant} · ` : ''}{per(f)}</span>
    </button>
  );
  const title = food ? food.name : mode === 'new' ? 'New food' : mode === 'quick' ? 'Quick add' : 'Add food';

  return (
    <Sheet open onClose={props.onClose} title={title}>
      {food ? (
        <AmountForm food={food} initial={defaultAmount(food, lastOf(food.id))} submit="Add"
          onSubmit={async (amount, unit) => {
            await logFood(food, amount, unit, { date: props.date, mealId: props.mealId });
            toast(`${food.name} added ✓`);
            props.onClose();
          }} />
      ) : mode === 'new' ? (
        <FoodForm initialName={q} initialRestaurant={place} onSaved={(f) => { setMode('pick'); setFood(f); }} onCancel={() => setMode('pick')} />
      ) : mode === 'quick' ? (
        <QuickAddForm submit="Add" allowSave initial={q.trim() ? { name: q.trim(), kcal: 0, protein_g: 0, carbs_g: null, fat_g: null } : undefined}
          onSubmit={async (entry, saveToFoods) => {
            if (saveToFoods) {
              const [f] = await put('foods', {
                name: entry.name.trim() || 'Quick add', basis: 'per_serving', serving_g: null, serving_label: '',
                kcal: entry.kcal, protein_g: entry.protein_g, carbs_g: entry.carbs_g, fat_g: entry.fat_g, restaurant: place,
              });
              await logFood(f, 1, 'serving', { date: props.date, mealId: props.mealId });
            } else {
              await quickAdd(entry, { date: props.date, mealId: props.mealId });
            }
            toast(`${entry.name.trim() || 'Quick add'} added ✓`);
            props.onClose();
          }} />
      ) : (
        <>
          <input class="search" type="search" placeholder={places.length ? 'Search foods or restaurants' : 'Search your foods'} value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
          {places.length > 0 && (
            <div class="chips scroll-x place-chips">
              <button class={`chip ${place == null ? 'on' : ''}`} onClick={() => setPlace(null)}>All</button>
              {places.map((r) => <button key={r} class={`chip ${place === r ? 'on' : ''}`} onClick={() => setPlace(place === r ? null : r)}>{r}</button>)}
            </div>
          )}
          <div class="row gap add-modes">
            <button class="btn grow sm" onClick={() => setMode('quick')}>⚡ Quick add</button>
            <button class="btn grow sm" onClick={() => setMode('new')}>＋ New food</button>
          </div>
          <div class="pick-list">
            {loaded === undefined ? null : q.trim() ? pool.filter((f) => matchesSearch(f, q)).map((f) => <Row key={f.id} f={f} />) : (<>
              {ranked.recent.length > 0 && <div class="pick-group">Recent{place ? ` at ${place}` : ''}</div>}
              {ranked.recent.map((f) => <Row key={f.id} f={f} />)}
              {ranked.others.length > 0 && <div class="pick-group">{ranked.recent.length ? 'More' : place ?? 'Your foods'}</div>}
              {ranked.others.map((f) => <Row key={f.id} f={f} />)}
            </>)}
            {!props.foods.length && <p class="empty-note">Save foods you eat regularly once (logging is then a couple of taps), or use Quick add for one-offs.</p>}
          </div>
        </>
      )}
    </Sheet>
  );
}

function EditLogSheet({ log, food, onClose }: { log: FoodLog; food: Food | undefined; onClose: () => void }) {
  if (!log.food_id) {
    return (
      <Sheet open onClose={onClose} title={log.name || 'Quick add'}>
        <QuickAddForm submit="Save" initial={{ name: log.name ?? '', kcal: log.kcal, protein_g: log.protein_g, carbs_g: log.carbs_g, fat_g: log.fat_g }}
          onSubmit={async (entry) => { await updateQuick(log, entry); onClose(); }}
          onDelete={async () => { await deleteLog(log); onClose(); }} />
      </Sheet>
    );
  }
  // If the food was deleted, edit against what was recorded.
  const f: Food = food ?? {
    id: log.food_id, name: log.name ?? 'Deleted food', basis: log.unit === 'g' ? 'per_100g' : 'per_serving', serving_g: null, serving_label: '',
    kcal: log.unit === 'g' ? (log.kcal / log.amount) * 100 : log.kcal / log.amount,
    protein_g: log.unit === 'g' ? (log.protein_g / log.amount) * 100 : log.protein_g / log.amount,
    carbs_g: null, fat_g: null, created_at: '', updated_at: '', deleted: 1,
  };
  return (
    <Sheet open onClose={onClose} title={f.name}>
      <AmountForm food={f} initial={{ amount: log.amount, unit: log.unit }} submit="Save"
        onSubmit={async (amount, unit) => { await updateLog(log, food, amount, unit); onClose(); }}
        onDelete={async () => { await deleteLog(log); onClose(); }} />
    </Sheet>
  );
}

function SavedMealsSheet({ open, onClose, foods }: { open: boolean; onClose: () => void; foods: Map<string, Food> }) {
  const saved = useSavedMeals() ?? [];
  return (
    <Sheet open={open} onClose={onClose} title="Saved meals">
      {!saved.length && <p class="muted">Log a meal, then tap <b>Edit → Save as a saved meal</b>. It then appears as a one-tap button above your meals.</p>}
      {saved.map((m) => {
        const totals = m.items.reduce((a, it) => {
          if (!it.food_id) return { kcal: a.kcal + (it.kcal ?? 0), p: a.p + (it.protein_g ?? 0) };
          const f = foods.get(it.food_id);
          const n = f ? nutrientsFor(f, it.amount, it.unit) : null;
          return { kcal: a.kcal + (n?.kcal ?? 0), p: a.p + (n?.protein_g ?? 0) };
        }, { kcal: 0, p: 0 });
        return (
          <div key={m.id} class="list-item static">
            <span class="grow left">
              <span class="block bold">{m.name}</span>
              <span class="block muted small ellipsis">{m.items.map((it) => (it.food_id ? foods.get(it.food_id)?.name ?? 'deleted food' : it.name || 'Quick add')).join(', ')}</span>
              <span class="block muted small">{r0(totals.kcal)} kcal · {r1(totals.p)} g protein</span>
            </span>
            <button class="icon-btn sm" aria-label={`Rename ${m.name}`} onClick={async () => { const n = await promptSheet('Rename saved meal', m.name); if (n) await put('saved_meals', { ...m, name: n }); }}>✎</button>
            <button class="icon-btn sm" aria-label={`Delete ${m.name}`} onClick={async () => { if (await confirmSheet(`Delete saved meal “${m.name}”? Meals you already logged stay.`, 'Delete', true)) await softDelete('saved_meals', [m.id]); }}>✕</button>
          </div>
        );
      })}
    </Sheet>
  );
}

// ---------- My foods ----------

export function FoodsScreen() {
  const foods = useFoods() ?? [];
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Food | 'new' | null>(null);
  const groups = groupByRestaurant(foods.filter((f) => matchesSearch(f, q)));
  const hasPlaces = groups.some((g) => g.restaurant);
  return (
    <div class="page">
      <Header title="My foods" back="/food" right={<button class="btn sm primary" onClick={() => setEditing('new')}>New</button>} />
      <input class="search" type="search" placeholder="Search foods or restaurants" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
      {!foods.length && <p class="empty">Add each food you eat regularly once: its calories and protein per 100 g or per serving. Estimates are fine. Add a restaurant to group foods by where they're from.</p>}
      {groups.map((g) => (
        <section key={g.restaurant ?? '—'}>
          {hasPlaces && <h3 class="section-title">{g.restaurant ?? 'Other'} · {g.foods.length}</h3>}
          {g.foods.map((f) => (
            <button key={f.id} class="list-item" onClick={() => setEditing(f)}>
              <span class="grow left">
                <span class="block bold">{f.name}</span>
                <span class="block muted small">{r0(f.kcal)} kcal · {r1(f.protein_g)} g protein per {f.basis === 'per_100g' ? '100 g' : f.serving_label || 'serving'}</span>
              </span>
              <span class="muted">›</span>
            </button>
          ))}
        </section>
      ))}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New food' : 'Edit food'}>
        {editing && <FoodForm existing={editing === 'new' ? undefined : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Sheet>
      <div class="bottom-space" />
    </div>
  );
}

export function FoodForm(props: { existing?: Food; initialName?: string; initialRestaurant?: string | null; onSaved: (f: Food) => void; onCancel: () => void }) {
  const e = props.existing;
  const all = useFoods() ?? [];
  const places = restaurants(all);
  const [name, setName] = useState(e?.name ?? props.initialName ?? '');
  const [restaurant, setRestaurant] = useState(e?.restaurant ?? props.initialRestaurant ?? '');
  const [basis, setBasis] = useState<Food['basis']>(e?.basis ?? 'per_100g');
  const [servingG, setServingG] = useState<number | null>(e?.serving_g ?? null);
  const [servingLabel, setServingLabel] = useState(e?.serving_label ?? '');
  const [kcal, setKcal] = useState<number | null>(e?.kcal ?? null);
  const [protein, setProtein] = useState<number | null>(e?.protein_g ?? null);
  const [carbs, setCarbs] = useState<number | null>(e?.carbs_g ?? null);
  const [fat, setFat] = useState<number | null>(e?.fat_g ?? null);
  const per = basis === 'per_100g' ? 'per 100 g' : `per ${servingLabel || 'serving'}`;

  const save = async () => {
    if (!name.trim()) { toast('Give it a name'); return; }
    if (kcal == null) { toast('Enter the calories'); return; }
    // Reuse the existing spelling of a restaurant ("mcdonald's" → "McDonald's").
    const typed = restaurant.trim();
    const place = typed ? places.find((p) => p.toLowerCase() === typed.toLowerCase()) ?? typed : null;
    const [f] = await put('foods', {
      ...(e ?? {}), name: name.trim(), restaurant: place, basis, serving_g: servingG || null, serving_label: servingLabel.trim(),
      kcal, protein_g: protein ?? 0, carbs_g: carbs, fat_g: fat,
    } as Food);
    props.onSaved(f);
  };

  return (
    <div class="form">
      <label>Name</label>
      <input class="input" value={name} placeholder="e.g. Chicken burrito bowl" onInput={(ev) => setName((ev.currentTarget as HTMLInputElement).value)} />
      <label>Restaurant (optional)</label>
      <input class="input" value={restaurant} placeholder="e.g. Chipotle" onInput={(ev) => setRestaurant((ev.currentTarget as HTMLInputElement).value)} />
      {places.length > 0 && (
        <div class="chips wrap">
          {places.map((p) => (
            <button key={p} type="button" class={`chip place ${restaurant.trim().toLowerCase() === p.toLowerCase() ? 'on' : ''}`}
              onClick={() => setRestaurant(restaurant.trim().toLowerCase() === p.toLowerCase() ? '' : p)}>{p}</button>
          ))}
        </div>
      )}
      <label>Nutrition is</label>
      <Segmented label="Nutrition basis" value={basis === 'per_100g' ? 'Per 100 g' : 'Per serving'} options={['Per 100 g', 'Per serving']}
        onChange={(v) => setBasis(v === 'Per 100 g' ? 'per_100g' : 'per_serving')} />
      <label>Serving name {basis === 'per_100g' ? '(optional, lets you log by serving)' : ''}</label>
      <input class="input" value={servingLabel} placeholder={basis === 'per_100g' ? 'e.g. 1 bowl' : 'e.g. 1 scoop'} onInput={(ev) => setServingLabel((ev.currentTarget as HTMLInputElement).value)} />
      <label>Serving size in grams (optional)</label>
      <Stepper value={servingG} step={5} min={0} max={2000} decimals unit="g" placeholder="–" onChange={setServingG} />
      <label>Calories {per}</label>
      <Stepper value={kcal} step={10} min={0} max={5000} unit="kcal" placeholder="0" onChange={setKcal} />
      <label>Protein {per}</label>
      <Stepper value={protein} step={1} min={0} max={500} decimals unit="g" placeholder="0" onChange={setProtein} />
      <div class="pair">
        <div><span class="pair-label">Carbs {per} (optional)</span><Stepper value={carbs} step={1} min={0} max={500} decimals unit="g" placeholder="–" onChange={setCarbs} /></div>
        <div><span class="pair-label">Fat {per} (optional)</span><Stepper value={fat} step={1} min={0} max={500} decimals unit="g" placeholder="–" onChange={setFat} /></div>
      </div>
      <div class="row gap mt">
        {e && <button class="btn danger-outline" onClick={async () => {
          if (await confirmSheet(`Delete ${e.name}? Food you already logged keeps its numbers.`, 'Delete', true)) { await softDelete('foods', [e.id]); props.onCancel(); }
        }}>Delete</button>}
        <button class="btn grow" onClick={props.onCancel}>Cancel</button>
        <button class="btn grow primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}
