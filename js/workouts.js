// Workout log: one workout per day, classified by PPL split and focus.
// "Memory" is derived from history — a new workout of a classification
// starts from the last workout of that same classification.
//
// Shape: workouts["YYYY-MM-DD"] = {
//   split: 'push'|'pull'|'legs', focus: 'weight'|'volume',
//   lifts: [{ name, weight, reps, sets }]   (numbers or null)
// }

import { getData, persistNow, setValue } from './store.js';
import { todayISO, addDays, startOfWeek } from './dates.js';

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

// ----- lift PR goals -----
// doc.liftGoals[name.toLowerCase()] = { target, setAt }

export function liftGoal(name) {
  return getData().liftGoals[name.trim().toLowerCase()] || null;
}

export function setLiftGoal(name, target) {
  const key = name.trim().toLowerCase();
  if (target == null) delete getData().liftGoals[key];
  else getData().liftGoals[key] = { target, setAt: todayISO() };
  persistNow();
}

// ----- derived metrics -----
// e1RM (Epley): weight x (1 + reps/30) — folds reps into a strength
// estimate so 185x8 correctly beats 185x6. Volume: weight x reps x sets.

export function epley(weight, reps) {
  if (weight == null) return null;
  if (reps == null || reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export function liftVolume(l) {
  if (l.weight == null || l.reps == null || l.sets == null) return null;
  return l.weight * l.reps * l.sets;
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

// Days since the last workout of a split (0 = today), or null if never.
export function daysSince(split) {
  const list = allWorkouts().filter((w) => w.split === split);
  if (list.length === 0) return null;
  const last = list[list.length - 1].date;
  return Math.round((Date.parse(todayISO()) - Date.parse(last)) / 86400000);
}

// Did any lift set a new all-time e1RM best on this date?
export function sessionHadPR(iso) {
  return liftStats().some((s) => s.history.some((h) => h.date === iso && h.isPR));
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
    let runningMax = null;
    for (const h of s.history) {
      h.e1rm = epley(h.weight, h.reps);
      h.vol = liftVolume(h);
      // a PR beats a previous best — the first-ever session doesn't count
      h.isPR = h.e1rm != null && runningMax != null && h.e1rm > runningMax + 1e-9;
      if (h.e1rm != null && (runningMax === null || h.e1rm > runningMax)) runningMax = h.e1rm;
    }
    s.sessions = s.history.length;
    s.last = s.history[s.history.length - 1];
    s.best = s.history.reduce(
      (best, h) => (h.weight != null && (best === null || h.weight > best.weight) ? h : best),
      null,
    );
    s.bestE1rm = s.history.reduce(
      (best, h) => (h.e1rm != null && (best === null || h.e1rm > best.e1rm) ? h : best),
      null,
    );
    s.bestVol = s.history.reduce(
      (best, h) => (h.vol != null && (best === null || h.vol > best.vol) ? h : best),
      null,
    );

    // Trend compares the latest session against the previous session of the
    // SAME day type — weight days trend on e1RM, volume days on volume.
    const kind = s.last.focus === 'volume' ? 'vol' : 'e1rm';
    const sameFocus = s.history.filter((h) => h.focus === s.last.focus);
    const prevSame = sameFocus.length > 1 ? sameFocus[sameFocus.length - 2] : null;
    const cur = s.last[kind];
    const prev = prevSame ? prevSame[kind] : null;
    s.trendInfo = { kind, cur, prev };
    s.trend = cur == null || prev == null ? null
      : cur > prev + 1e-9 ? 'up'
      : cur < prev - 1e-9 ? 'down'
      : 'flat';

    s.goal = liftGoal(s.name);
    s.goalPct = s.goal && s.best && s.best.weight != null
      ? Math.min(1, s.best.weight / s.goal.target)
      : null;
  }
  out.sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  return out;
}

// Most recent performance of a named lift before a date, optionally
// restricted to one day type — powers the "last: 185 x 8 x 3" previews.
export function lastLiftOfFocus(name, focus, beforeISO) {
  const key = name.trim().toLowerCase();
  let found = null;
  for (const w of allWorkouts()) {
    if (beforeISO && w.date >= beforeISO) continue;
    if (focus && w.focus !== focus) continue;
    for (const l of w.lifts) {
      if (l.name.toLowerCase() === key) found = { ...l, date: w.date, focus: w.focus };
    }
  }
  return found;
}

// Total lifted volume per week for the last `weeks` weeks (oldest first),
// optionally filtered to one split. Weeks with no workouts count as 0.
export function weeklyVolume(weeks = 8, split = null) {
  const thisWeek = startOfWeek(todayISO());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i);
    const we = addDays(ws, 7);
    let sum = 0;
    for (const w of allWorkouts()) {
      if (w.date < ws || w.date >= we) continue;
      if (split && w.split !== split) continue;
      for (const l of w.lifts) {
        const v = liftVolume(l);
        if (v != null) sum += v;
      }
    }
    out.push({ startISO: ws, value: sum });
  }
  return out;
}
