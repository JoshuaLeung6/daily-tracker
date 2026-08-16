// Tracker CRUD. Entries reference tracker ids, so renaming preserves
// history; "archive" hides a tracker from the day form without touching data.

import { getData, persistNow } from './store.js';
import { todayISO, addDays, startOfWeek, fromISO } from './dates.js';

export const TYPES = ['number', 'measurement', 'text', 'checkbox', 'select', 'multiselect'];
const OPTION_TYPES = ['select', 'multiselect'];

export function allTrackers() {
  return [...getData().trackers].sort((a, b) => a.order - b.order);
}

export function activeTrackers() {
  return allTrackers().filter((t) => !t.archived);
}

export function getTracker(id) {
  return getData().trackers.find((t) => t.id === id) || null;
}

export function addTracker({ name, type, unit, options }) {
  const trackers = getData().trackers;
  const t = {
    id: 't_' + crypto.randomUUID(),
    name: name.trim(),
    type: TYPES.includes(type) ? type : 'text',
    unit: unit ? unit.trim() : null,
    order: trackers.reduce((max, x) => Math.max(max, x.order), -1) + 1,
    archived: false,
  };
  if (OPTION_TYPES.includes(t.type)) t.options = options || [];
  trackers.push(t);
  persistNow();
  return t;
}

export function updateTracker(id, patch) {
  const t = getTracker(id);
  if (!t) return;
  Object.assign(t, patch);
  persistNow();
}

export function moveTracker(id, delta) {
  const sorted = allTrackers();
  const i = sorted.findIndex((t) => t.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  [sorted[i].order, sorted[j].order] = [sorted[j].order, sorted[i].order];
  persistNow();
}

// Hard delete: removes the tracker AND its values from every day.
export function deleteTracker(id) {
  const doc = getData();
  doc.trackers = doc.trackers.filter((t) => t.id !== id);
  for (const [iso, day] of Object.entries(doc.entries)) {
    if (id in day) {
      delete day[id];
      if (Object.keys(day).length === 0) delete doc.entries[iso];
    }
  }
  persistNow();
}

export function daysWithValue(id) {
  return Object.values(getData().entries).filter((day) => id in day).length;
}

// ----- code config reconciliation -----
// Applies js/config.js TRACKERS to stored data. Idempotent; never touches
// logged values; archives (not deletes) trackers missing from config.

export function applyConfig(configTrackers, paceLookup) {
  const doc = getData();
  const today = todayISO();
  let changed = false;
  const byName = new Map(doc.trackers.map((t) => [t.name.trim().toLowerCase(), t]));
  const seen = new Set();

  configTrackers.forEach((c, i) => {
    const key = c.name.trim().toLowerCase();
    seen.add(key);
    let t = byName.get(key);
    if (!t) {
      t = {
        id: 't_' + crypto.randomUUID(), name: c.name, type: c.type,
        unit: c.unit || null, order: i, archived: false,
      };
      if (c.options) t.options = [...c.options];
      doc.trackers.push(t);
      byName.set(key, t);
      changed = true;
    } else {
      const patch = { type: c.type, unit: c.unit || null, order: i, archived: false };
      if (c.options) patch.options = [...c.options];
      for (const [k, v] of Object.entries(patch)) {
        if (JSON.stringify(t[k]) !== JSON.stringify(v)) { t[k] = v; changed = true; }
      }
      if (!c.options && t.options && (c.type === 'select' || c.type === 'multiselect')) { /* keep stored options */ }
    }

    // target: only rewrite when it differs from today's effective target
    if (c.target) {
      const cur = targetFor(t, today);
      const dir = c.type === 'number' ? (c.target.dir === 'atmost' ? 'atmost' : 'atleast') : undefined;
      const same = cur && cur.period === c.target.period && cur.value === c.target.value
        && (c.type !== 'number' || (cur.dir || 'atleast') === dir);
      const wantFrom = c.target.from || today;
      // with an explicit `from`, also require that it is the target in force
      // from that date (i.e. history was actually rewritten)
      const backdatedOK = !c.target.from || (t.targets || []).some((x) => x.from === c.target.from
        && x.value === c.target.value && x.period === c.target.period);
      if (!same || !backdatedOK) {
        t.targets ??= [];
        const entry = { from: wantFrom, value: c.target.value, period: c.target.period };
        if (dir) entry.dir = dir;
        if (c.target.from) {
          // backdate: drop everything on/after `from`, then insert
          t.targets = t.targets.filter((x) => x.from < c.target.from);
          t.targets.push(entry);
        } else {
          const idx = t.targets.findIndex((x) => x.from === today);
          if (idx >= 0) t.targets[idx] = entry; else t.targets.push(entry);
        }
        t.targets.sort((a, b) => (a.from < b.from ? -1 : 1));
        changed = true;
      }
    }

    // targeted cleanup: drop a stored goal only if it is the specific stale
    // one named in config (a goal that has since moved to the sprint)
    if (typeof c.clearGoalIfTarget === 'number' && t.goal && t.goal.target === c.clearGoalIfTarget) {
      delete t.goal;
      changed = true;
    }
    if (c.goal) {
      const band = c.goal.pace && paceLookup ? paceLookup(c.goal.target > c.goal.startValue ? 'gain' : 'loss', c.goal.pace) : null;
      const g = t.goal;
      const same = g && g.startValue === c.goal.startValue && g.target === c.goal.target
        && (g.deadline || null) === (c.goal.deadline || null)
        && JSON.stringify(g.band || null) === JSON.stringify(band ? { lo: band.lo, hi: band.hi } : null);
      if (!same) {
        t.goal = { from: today, startValue: c.goal.startValue, target: c.goal.target, deadline: c.goal.deadline || null };
        if (band) t.goal.band = { lo: band.lo, hi: band.hi };
        changed = true;
      }
    }
  });

  // anything stored but not configured -> archived (data preserved)
  for (const t of doc.trackers) {
    if (!seen.has(t.name.trim().toLowerCase()) && !t.archived) { t.archived = true; changed = true; }
  }

  if (changed) persistNow();
  return changed;
}

// Strip retired options from a picklist tracker's history (e.g. 'walk' from
// Cardio). Removes the option from every day; a day left with no options
// loses its cardio value entirely. Idempotent.
export function stripOptions(map) {
  const doc = getData();
  let changed = false;
  for (const [name, opts] of Object.entries(map || {})) {
    const t = doc.trackers.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!t) continue;
    const drop = new Set(opts.map((o) => o.toLowerCase()));
    for (const [iso, day] of Object.entries(doc.entries)) {
      const v = day[t.id];
      if (Array.isArray(v)) {
        const kept = v.filter((x) => !drop.has(String(x).toLowerCase()));
        if (kept.length !== v.length) {
          if (kept.length) day[t.id] = kept; else delete day[t.id];
          if (Object.keys(day).length === 0) delete doc.entries[iso];
          changed = true;
        }
      } else if (typeof v === 'string' && drop.has(v.toLowerCase())) {
        delete day[t.id];
        if (Object.keys(day).length === 0) delete doc.entries[iso];
        changed = true;
      }
    }
  }
  if (changed) persistNow();
  return changed;
}

// Backdated seed values: fill only where the day has no value for that
// tracker. Idempotent and never destructive.
export function applySeedValues(seeds, anchorISO) {
  const doc = getData();
  // only the real dataset (whose history reaches the anchor date) gets seeded
  if (anchorISO) {
    const hasAnchor = Object.keys(doc.entries).some((iso) => iso <= anchorISO)
      || Object.keys(doc.workouts || {}).some((iso) => iso <= anchorISO);
    if (!hasAnchor) return false;
  }
  let changed = false;
  for (const [name, byDate] of Object.entries(seeds || {})) {
    const t = doc.trackers.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!t) continue;
    for (const [iso, value] of Object.entries(byDate)) {
      const day = doc.entries[iso];
      if (day && t.id in day) continue; // already logged — leave it
      (doc.entries[iso] ??= {})[t.id] = value;
      changed = true;
    }
  }
  if (changed) persistNow();
  return changed;
}

// ----- targets (effective-dated) -----
// tracker.targets is a from-date-sorted series: [{ from, value, period }].
// The target in force on a given day is the latest entry with from <= day,
// so changing a target never rewrites the past. value: null ends the target.
// period: 'day' | 'week' (non-number trackers always 'week', value = days).

export function targetFor(tracker, iso) {
  let match = null;
  for (const t of tracker.targets || []) {
    if (t.from <= iso) match = t;
    else break;
  }
  return match && match.value != null ? match : null;
}

export function setTarget(id, { value, period, dir }) {
  const t = getTracker(id);
  if (!t) return;
  const from = todayISO();
  const entry = { from, value, period };
  if (t.type === 'number') entry.dir = dir === 'atmost' ? 'atmost' : 'atleast';
  t.targets ??= [];
  const i = t.targets.findIndex((x) => x.from === from);
  if (i >= 0) t.targets[i] = entry;
  else {
    t.targets.push(entry);
    t.targets.sort((a, b) => (a.from < b.from ? -1 : 1));
  }
  persistNow();
}

// ----- streaks -----

// Did this day meet its (daily) target? Uses the target in force ON that day.
export function dayMeets(tracker, iso) {
  if (tracker.type === 'measurement' || tracker.type === 'text') return false;
  const tgt = targetFor(tracker, iso);
  if (!tgt || tgt.period !== 'day') return false;
  const day = getData().entries[iso];
  const v = day ? day[tracker.id] : undefined;
  if (v === undefined) return false;
  if (tracker.type === 'number') {
    if (typeof v !== 'number') return false;
    return tgt.dir === 'atmost' ? v <= tgt.value : v >= tgt.value;
  }
  if (tracker.type === 'multiselect') return Array.isArray(v) && v.length >= tgt.value;
  return true; // checkbox true / select picked — value presence means done
}

// Consecutive days meeting the daily target, ending today — or ending
// yesterday if today isn't met yet, so an open day doesn't zero the streak.
export function streakFor(tracker, iso) {
  let day = dayMeets(tracker, iso) ? iso : addDays(iso, -1);
  let streak = 0;
  while (dayMeets(tracker, day) && streak < 3660) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

// Did the week starting at weekStartISO meet its weekly target?
// Uses the target in force at that week's end.
export function weekMeets(tracker, weekStartISO) {
  if (tracker.type === 'measurement' || tracker.type === 'text') return false;
  const tgt = targetFor(tracker, addDays(weekStartISO, 6));
  if (!tgt || tgt.period !== 'week') return false;
  const entries = getData().entries;
  if (tracker.type === 'number') {
    let sum = 0;
    let logged = false;
    for (let i = 0; i < 7; i++) {
      const day = entries[addDays(weekStartISO, i)];
      const v = day ? day[tracker.id] : undefined;
      if (typeof v === 'number') { sum += v; logged = true; }
    }
    if (!logged) return false;
    return tgt.dir === 'atmost' ? sum <= tgt.value : sum >= tgt.value;
  }
  let days = 0;
  for (let i = 0; i < 7; i++) {
    const day = entries[addDays(weekStartISO, i)];
    if (day && tracker.id in day) days++;
  }
  return days >= tgt.value;
}

// Consecutive weeks meeting the weekly target, ending with the week
// containing iso — or the week before if the current week isn't met yet.
export function weekStreakFor(tracker, iso) {
  let start = startOfWeek(iso);
  if (!weekMeets(tracker, start)) start = addDays(start, -7);
  let streak = 0;
  while (weekMeets(tracker, start) && streak < 530) {
    streak++;
    start = addDays(start, -7);
  }
  return streak;
}

// ----- attainment reporting -----

function firstTargetISO(tracker) {
  let min = null;
  for (const t of tracker.targets || []) {
    if (t.from && (!min || t.from < min)) min = t.from;
  }
  return min;
}

export function longestStreak(tracker) {
  const start = firstTargetISO(tracker);
  if (!start) return 0;
  const today = todayISO();
  let best = 0;
  let run = 0;
  for (let iso = start; iso <= today; iso = addDays(iso, 1)) {
    if (dayMeets(tracker, iso)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

// Of the last `days` days that had a daily target in force, how many were met?
export function adherence(tracker, days = 30) {
  const today = todayISO();
  let hit = 0;
  let of = 0;
  for (let i = 0; i < days; i++) {
    const iso = addDays(today, -i);
    const tgt = targetFor(tracker, iso);
    if (!tgt || tgt.period !== 'day') continue;
    of++;
    if (dayMeets(tracker, iso)) hit++;
  }
  return { hit, of };
}

// Last `days` days, oldest first: met / unmet / no daily target that day.
export function dotStrip(tracker, days = 14) {
  const today = todayISO();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = addDays(today, -i);
    const tgt = targetFor(tracker, iso);
    out.push({
      iso,
      state: !tgt || tgt.period !== 'day' ? 'notarget' : (dayMeets(tracker, iso) ? 'met' : 'unmet'),
    });
  }
  return out;
}

export function longestWeekStreak(tracker) {
  const start = firstTargetISO(tracker);
  if (!start) return 0;
  const lastWeek = startOfWeek(todayISO());
  let best = 0;
  let run = 0;
  for (let ws = startOfWeek(start); ws <= lastWeek; ws = addDays(ws, 7)) {
    if (weekMeets(tracker, ws)) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

export function weekAdherence(tracker, weeks = 8) {
  const thisWeek = startOfWeek(todayISO());
  let hit = 0;
  let of = 0;
  for (let i = 0; i < weeks; i++) {
    const ws = addDays(thisWeek, -7 * i);
    const tgt = targetFor(tracker, addDays(ws, 6));
    if (!tgt || tgt.period !== 'week') continue;
    of++;
    if (weekMeets(tracker, ws)) hit++;
  }
  return { hit, of };
}

// True when the day had at least one daily target and met them all —
// drives the green day numbers on week/month calendars.
export function dayAllMet(iso) {
  let any = false;
  for (const t of activeTrackers()) {
    const tgt = targetFor(t, iso);
    if (!tgt || tgt.period !== 'day') continue;
    any = true;
    if (!dayMeets(t, iso)) return false;
  }
  return any;
}

// ----- value goals (destinations: reach a number, e.g. body weight) -----
// tracker.goal = { from, startValue, target, deadline|null }

export function setGoal(id, { startValue, target, deadline, band }) {
  const t = getTracker(id);
  if (!t) return;
  t.goal = { from: todayISO(), startValue, target, deadline: deadline || null };
  if (band) t.goal.band = { lo: band.lo, hi: band.hi };
  persistNow();
}

export function clearGoal(id) {
  const t = getTracker(id);
  if (t && t.goal) {
    delete t.goal;
    persistNow();
  }
}

export function latestValue(id) {
  let best = null;
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (id in day && typeof day[id] === 'number' && (!best || iso > best.iso)) {
      best = { iso, value: day[id] };
    }
  }
  return best;
}

// Most recent numeric value strictly before a date — the "last reading"
// shown on measurement cards.
export function previousValue(id, beforeISO) {
  let best = null;
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (iso >= beforeISO) continue;
    if (id in day && typeof day[id] === 'number' && (!best || iso > best.iso)) {
      best = { iso, value: day[id] };
    }
  }
  return best;
}

// Least-squares slope of a numeric tracker over the last `days` days,
// in units per week — the honest "trending -0.5 lb/wk" number.
export function ratePerWeek(id, days = 28) {
  const today = todayISO();
  const cutoff = addDays(today, -(days - 1));
  const pts = [];
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (iso < cutoff || iso > today) continue;
    if (typeof day[id] === 'number') pts.push({ x: Date.parse(iso) / 86400000, y: day[id] });
  }
  if (pts.length < 2) return null;
  const span = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  if (span < 5) return null; // need points spread over most of a week
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  return ((n * sxy - sx * sy) / denom) * 7;
}

// Average logged value per logged day over the last `days` days.
export function avgOverDays(id, days = 28) {
  const today = todayISO();
  const cutoff = addDays(today, -(days - 1));
  let sum = 0;
  let count = 0;
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (iso < cutoff || iso > today) continue;
    if (typeof day[id] === 'number') { sum += day[id]; count++; }
  }
  return count > 0 ? { avg: sum / count, loggedDays: count } : null;
}

export function goalProgress(t) {
  if (!t.goal) return null;
  const g = t.goal;
  const latest = latestValue(t.id);
  const current = latest ? latest.value : g.startValue;
  const span = g.target - g.startValue;
  const done = span >= 0 ? current >= g.target : current <= g.target;
  const pct = span === 0 ? 1 : Math.max(0, Math.min(1, (current - g.startValue) / span));
  const out = {
    ...g,
    current,
    currentDate: latest ? latest.iso : null,
    pct: done ? 1 : pct,
    done,
    change: current - g.startValue,
    remaining: g.target - current,
    direction: span < 0 ? 'down' : 'up',
  };
  if (g.deadline) {
    out.daysLeft = Math.ceil((fromISO(g.deadline) - fromISO(todayISO())) / 86400000);
    if (!done && out.daysLeft > 0) out.pacePerWeek = out.remaining / (out.daysLeft / 7);
  }
  return out;
}
