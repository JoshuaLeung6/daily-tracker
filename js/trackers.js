// Tracker CRUD. Entries reference tracker ids, so renaming preserves
// history; "archive" hides a tracker from the day form without touching data.

import { getData, persistNow } from './store.js';
import { todayISO, addDays, startOfWeek } from './dates.js';

export const TYPES = ['number', 'text', 'checkbox', 'select', 'multiselect'];
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
