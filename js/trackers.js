// Tracker CRUD. Entries reference tracker ids, so renaming preserves
// history; "archive" hides a tracker from the day form without touching data.

import { getData, persistNow } from './store.js';

export const TYPES = ['number', 'text', 'checkbox'];

export function allTrackers() {
  return [...getData().trackers].sort((a, b) => a.order - b.order);
}

export function activeTrackers() {
  return allTrackers().filter((t) => !t.archived);
}

export function getTracker(id) {
  return getData().trackers.find((t) => t.id === id) || null;
}

export function addTracker({ name, type, unit }) {
  const trackers = getData().trackers;
  const t = {
    id: 't_' + crypto.randomUUID(),
    name: name.trim(),
    type: TYPES.includes(type) ? type : 'text',
    unit: unit ? unit.trim() : null,
    order: trackers.reduce((max, x) => Math.max(max, x.order), -1) + 1,
    archived: false,
  };
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
