// Workout log: one workout per day, classified by PPL split and focus.
// "Memory" is derived from history — a new workout of a classification
// starts from the last workout of that same classification.
//
// Shape: workouts["YYYY-MM-DD"] = {
//   split: 'push'|'pull'|'legs', focus: 'weight'|'volume',
//   lifts: [{ name, weight, reps, sets }]   (numbers or null)
// }

import { getData, persistNow, setValue } from './store.js';
import { todayISO } from './dates.js';

export const SPLITS = ['push', 'pull', 'legs'];
export const SPLIT_LABELS = { push: 'Push', pull: 'Pull', legs: 'Legs' };
export const FOCUSES = ['weight', 'volume'];
export const FOCUS_LABELS = { weight: 'Weight day', volume: 'Volume day' };

export function getWorkout(iso) {
  return getData().workouts[iso] || null;
}

// Persists the workout; unnamed lift rows are pruned, and a workout with no
// lifts left is removed entirely (opening the editor leaves no trace).
export function saveWorkout(iso, draft) {
  const lifts = draft.lifts
    .filter((l) => l.name && l.name.trim())
    .map((l) => ({ name: l.name.trim(), weight: l.weight ?? null, reps: l.reps ?? null, sets: l.sets ?? null }));
  if (lifts.length === 0) {
    deleteWorkout(iso);
    return null;
  }
  getData().workouts[iso] = { split: draft.split, focus: draft.focus, lifts };
  autoCheckLifting(iso);
  persistNow();
  return getData().workouts[iso];
}

export function deleteWorkout(iso) {
  if (getData().workouts[iso]) {
    delete getData().workouts[iso];
    persistNow();
  }
}

// Logging a workout also ticks a checkbox tracker named "Weightlifting",
// if one exists — one less tap.
function autoCheckLifting(iso) {
  const t = getData().trackers.find(
    (x) => x.type === 'checkbox' && !x.archived && x.name.toLowerCase() === 'weightlifting',
  );
  if (t) setValue(iso, t.id, true);
}

export function allWorkouts() {
  return Object.entries(getData().workouts)
    .map(([date, w]) => ({ date, ...w }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function lastWhere(pred, beforeISO) {
  const list = allWorkouts().filter((w) => w.date < beforeISO && pred(w));
  return list.length ? list[list.length - 1] : null;
}

// Starting template for a new workout: the lifts from the most recent
// workout of the same split + focus.
export function templateFor(split, focus, iso) {
  const last = lastWhere((w) => w.split === split && w.focus === focus, iso);
  return last ? last.lifts.map((l) => ({ ...l })) : [];
}

// Default classification for a new workout: rotate P→P→L from the most
// recent workout, keeping its focus.
export function suggestedClass(iso) {
  const last = lastWhere(() => true, iso);
  if (!last) return { split: 'push', focus: 'weight' };
  return {
    split: SPLITS[(SPLITS.indexOf(last.split) + 1) % SPLITS.length],
    focus: last.focus,
  };
}

// Known lift names (optionally within one split), for autocomplete.
export function liftNames(split) {
  const names = new Map();
  for (const w of allWorkouts()) {
    if (split && w.split !== split) continue;
    for (const l of w.lifts) names.set(l.name.toLowerCase(), l.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Most recent numbers for a lift name — fills a freshly added row.
export function lastLift(name, beforeISO) {
  const key = name.trim().toLowerCase();
  let found = null;
  for (const w of allWorkouts()) {
    if (beforeISO && w.date >= beforeISO) continue;
    for (const l of w.lifts) {
      if (l.name.toLowerCase() === key) found = { ...l };
    }
  }
  return found;
}

// ----- stats -----

export function workoutCounts() {
  const list = allWorkouts();
  const bySplit = { push: 0, pull: 0, legs: 0 };
  for (const w of list) bySplit[w.split] = (bySplit[w.split] || 0) + 1;
  const month = todayISO().slice(0, 7);
  return {
    total: list.length,
    bySplit,
    thisMonth: list.filter((w) => w.date.startsWith(month)).length,
  };
}

// Per-lift aggregates, most recently trained first.
export function liftStats(filterSplit) {
  const map = new Map();
  for (const w of allWorkouts()) {
    if (filterSplit && w.split !== filterSplit) continue;
    for (const l of w.lifts) {
      const key = l.name.toLowerCase();
      if (!map.has(key)) map.set(key, { name: l.name, history: [] });
      const s = map.get(key);
      s.name = l.name; // latest spelling wins
      s.history.push({ date: w.date, split: w.split, focus: w.focus, weight: l.weight, reps: l.reps, sets: l.sets });
    }
  }
  const out = [...map.values()];
  for (const s of out) {
    s.sessions = s.history.length;
    s.last = s.history[s.history.length - 1];
    s.prev = s.history.length > 1 ? s.history[s.history.length - 2] : null;
    s.best = s.history.reduce(
      (best, h) => (h.weight != null && (best === null || h.weight > best.weight) ? h : best),
      null,
    );
  }
  out.sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  return out;
}
