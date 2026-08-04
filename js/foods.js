// Personal food library: staples with per-serving calories + protein.
// Logging a food ADDS onto the day's Calories/Protein totals — the totals
// stay plain editable numbers, so manual entry remains first-class.

import { getData, getEntry, setValue, persistNow } from './store.js';
import { todayISO } from './dates.js';
import { calorieTracker, proteinTracker } from './insights.js';

export function listFoods() {
  // most-used first, then most recent — the top of the sheet is the staples
  return [...getData().foods].sort((a, b) => {
    const byUses = (b.uses || 0) - (a.uses || 0);
    if (byUses !== 0) return byUses;
    return (b.lastUsed || '') > (a.lastUsed || '') ? 1 : -1;
  });
}

export function addFood({ name, kcal, protein }) {
  const food = {
    id: 'f_' + crypto.randomUUID(),
    name: name.trim(),
    kcal: kcal != null ? Math.round(kcal) : null,
    protein: protein != null ? Math.round(protein * 10) / 10 : null,
    uses: 0,
    lastUsed: null,
  };
  getData().foods.push(food);
  persistNow();
  return food;
}

export function updateFood(id, patch) {
  const f = getData().foods.find((x) => x.id === id);
  if (!f) return;
  Object.assign(f, patch);
  persistNow();
}

export function deleteFood(id) {
  const doc = getData();
  doc.foods = doc.foods.filter((x) => x.id !== id);
  persistNow();
}

// Adds one serving onto the day's totals. Returns what was added (for the
// sheet's running summary and undo).
export function logFood(iso, food) {
  const applied = { kcal: 0, protein: 0 };
  const cal = calorieTracker();
  const pro = proteinTracker();
  if (cal && food.kcal != null) {
    const cur = typeof getEntry(iso)[cal.id] === 'number' ? getEntry(iso)[cal.id] : 0;
    setValue(iso, cal.id, Math.round((cur + food.kcal) * 10) / 10);
    applied.kcal = food.kcal;
  }
  if (pro && food.protein != null) {
    const cur = typeof getEntry(iso)[pro.id] === 'number' ? getEntry(iso)[pro.id] : 0;
    setValue(iso, pro.id, Math.round((cur + food.protein) * 10) / 10);
    applied.protein = food.protein;
  }
  food.uses = (food.uses || 0) + 1;
  food.lastUsed = todayISO();
  persistNow();
  return applied;
}

// Subtract a previously-logged serving (the sheet's undo).
export function unlogFood(iso, applied) {
  const cal = calorieTracker();
  const pro = proteinTracker();
  if (cal && applied.kcal) {
    const cur = typeof getEntry(iso)[cal.id] === 'number' ? getEntry(iso)[cal.id] : 0;
    const next = Math.round((cur - applied.kcal) * 10) / 10;
    setValue(iso, cal.id, next > 0 ? next : '');
  }
  if (pro && applied.protein) {
    const cur = typeof getEntry(iso)[pro.id] === 'number' ? getEntry(iso)[pro.id] : 0;
    const next = Math.round((cur - applied.protein) * 10) / 10;
    setValue(iso, pro.id, next > 0 ? next : '');
  }
  persistNow();
}

// Curated candidates (typical values — a starting point, not gospel).
// Skewed toward a lean bulk: protein anchors + calorie-dense closers.
export const FOOD_IDEAS = [
  { name: 'Mass shake (milk, oats, banana, PB, whey)', kcal: 900, protein: 55 },
  { name: 'Chicken breast (200 g cooked)', kcal: 330, protein: 62 },
  { name: 'Greek yogurt (1 cup, 2%)', kcal: 170, protein: 20 },
  { name: 'Whey scoop', kcal: 120, protein: 24 },
  { name: 'Eggs (3 large)', kcal: 215, protein: 19 },
  { name: 'Lean ground beef (200 g cooked)', kcal: 400, protein: 52 },
  { name: 'Salmon (150 g)', kcal: 310, protein: 33 },
  { name: 'Cottage cheese (1 cup)', kcal: 220, protein: 25 },
  { name: 'Rice (1 cup cooked)', kcal: 205, protein: 4 },
  { name: 'Oats (1 cup dry)', kcal: 300, protein: 10 },
  { name: 'Peanut butter (2 tbsp)', kcal: 190, protein: 7 },
  { name: 'Almonds (30 g)', kcal: 175, protein: 6 },
  { name: 'Banana', kcal: 105, protein: 1 },
  { name: 'Olive oil (1 tbsp)', kcal: 120, protein: 0 },
  { name: 'Whole milk (1 cup)', kcal: 150, protein: 8 },
];
