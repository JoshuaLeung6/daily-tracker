// Storage layer — the ONLY module that touches localStorage.
// One JSON document under `pcal:data`; debounced autosave with
// immediate flush on blur/hide so iOS suspending the PWA never loses input.

export const SCHEMA_VERSION = 1;

const KEY = 'pcal:data';
const KEY_PRE_IMPORT = 'pcal:backup:pre-import';
const KEY_LAST_EXPORT = 'pcal:lastExport';

let data = null;
let saveTimer = null;
let errorHandler = null;

function seed() {
  return {
    schemaVersion: SCHEMA_VERSION,
    trackers: [
      { id: 't_' + crypto.randomUUID(), name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
      { id: 't_' + crypto.randomUUID(), name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false },
      { id: 't_' + crypto.randomUUID(), name: 'Workout', type: 'text', unit: null, order: 2, archived: false },
    ],
    entries: {},
  };
}

export function init({ onStorageError } = {}) {
  errorHandler = onStorageError || null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.trackers)) {
    data = seed();
    persistNow();
  }
  // future schema migrations run here, keyed on data.schemaVersion

  window.addEventListener('pagehide', () => persistNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow();
  });
  return data;
}

export function getData() {
  return data;
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistNow(true), 300);
}

export function persistNow(notify = false) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    notify = true;
  }
  if (!data) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    if (errorHandler) errorHandler(null);
    if (notify) document.dispatchEvent(new CustomEvent('pcal:saved'));
  } catch (e) {
    if (errorHandler) errorHandler(e);
  }
}

// ----- entries -----

export function getEntry(iso) {
  return data.entries[iso] || {};
}

export function setValue(iso, trackerId, value) {
  const isEmpty = value === '' || value === null || value === undefined || value === false;
  const day = data.entries[iso];
  if (isEmpty) {
    if (!day || !(trackerId in day)) return;
    delete day[trackerId];
    if (Object.keys(day).length === 0) delete data.entries[iso];
  } else {
    (data.entries[iso] ??= {})[trackerId] = value;
  }
  scheduleSave();
}

export function loggedDayCount() {
  return Object.keys(data.entries).length;
}

export function replaceData(next) {
  data = next;
  persistNow();
}

// ----- backup bookkeeping -----

export function setLastExport() {
  try { localStorage.setItem(KEY_LAST_EXPORT, String(Date.now())); } catch { /* non-critical */ }
}

export function getLastExport() {
  const v = localStorage.getItem(KEY_LAST_EXPORT);
  return v ? Number(v) : null;
}

export function savePreImportSnapshot() {
  localStorage.setItem(KEY_PRE_IMPORT, JSON.stringify(data));
}

export function getPreImportSnapshot() {
  try {
    const raw = localStorage.getItem(KEY_PRE_IMPORT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPreImportSnapshot() {
  localStorage.removeItem(KEY_PRE_IMPORT);
}
