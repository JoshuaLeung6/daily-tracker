// Export/import. Export prefers the iOS share sheet (save to Files/iCloud,
// AirDrop, mail to self); falls back to a plain download elsewhere.

import {
  SCHEMA_VERSION, getData, replaceData, setLastExport, getLastExport,
  savePreImportSnapshot, getPreImportSnapshot, clearPreImportSnapshot,
} from './store.js';
import { todayISO } from './dates.js';

export async function exportData() {
  const doc = getData();
  const payload = {
    app: 'pcal',
    exportedAt: new Date().toISOString(),
    schemaVersion: doc.schemaVersion,
    trackers: doc.trackers,
    entries: doc.entries,
  };
  const json = JSON.stringify(payload, null, 2);
  const name = `tracker-backup-${todayISO()}.json`;
  const file = new File([json], name, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Tracker backup' });
      setLastExport();
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // fall through to download on any other share failure
    }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  setLastExport();
  return 'downloaded';
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid backup file.' };
  if (obj.app !== 'pcal') return { ok: false, error: 'This file was not exported by this app.' };
  if (typeof obj.schemaVersion !== 'number' || obj.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: 'This backup is from a newer version of the app. Update the app first.' };
  }
  if (!Array.isArray(obj.trackers) || obj.trackers.some((t) => !t || !t.id || !t.name || !t.type)) {
    return { ok: false, error: 'Backup file is damaged (trackers).' };
  }
  if (!obj.entries || typeof obj.entries !== 'object' || Array.isArray(obj.entries)) {
    return { ok: false, error: 'Backup file is damaged (entries).' };
  }
  return {
    ok: true,
    trackerCount: obj.trackers.length,
    dayCount: Object.keys(obj.entries).length,
  };
}

export async function readBackupFile(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: 'Could not read this file as JSON.' };
  }
  const result = validateBackup(obj);
  return result.ok ? { ...result, data: obj } : result;
}

// Snapshot current data first so the import can be undone from Settings.
export function applyImport(backup) {
  savePreImportSnapshot();
  replaceData({
    schemaVersion: backup.schemaVersion,
    trackers: backup.trackers,
    entries: backup.entries,
  });
}

export function canUndoImport() {
  return getPreImportSnapshot() !== null;
}

export function undoImport() {
  const snapshot = getPreImportSnapshot();
  if (!snapshot) return false;
  replaceData(snapshot);
  clearPreImportSnapshot();
  return true;
}

export function lastExportDays() {
  const ts = getLastExport();
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}
