// Export/import. Export prefers the iOS share sheet (save to Files/iCloud,
// AirDrop, mail to self); falls back to a plain download elsewhere.

import {
  SCHEMA_VERSION, getData, replaceData, setLastExport, getLastExport, getProfile,
  savePreImportSnapshot, getPreImportSnapshot, clearPreImportSnapshot,
} from './store.js';
import { todayISO } from './dates.js';
import {
  targetFor, streakFor, longestStreak, adherence,
  weekStreakFor, longestWeekStreak, weekAdherence,
  goalProgress, latestValue, ratePerWeek, avgOverDays,
} from './trackers.js';
import { liftStats, weeklyVolume, workoutCounts } from './workouts.js';

export async function exportData() {
  const doc = getData();
  const payload = {
    app: 'pcal',
    exportedAt: new Date().toISOString(),
    schemaVersion: doc.schemaVersion,
    trackers: doc.trackers,
    entries: doc.entries,
    workouts: doc.workouts || {},
    liftGoals: doc.liftGoals || {},
    profile: doc.profile || {},
  };
  const result = await shareJSON(JSON.stringify(payload, null, 2), `tracker-backup-${todayISO()}.json`, 'Tracker backup');
  if (result !== 'cancelled') setLastExport();
  return result;
}

async function shareJSON(json, name, title) {
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
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
  return 'downloaded';
}

// A second export shaped for analysis (human or LLM): tracker NAMES as
// keys and the derived stats precomputed, so nothing needs re-deriving.
export function buildAnalysisPayload() {
  const doc = getData();
  const today = todayISO();

  const nameOf = {};
  const used = new Set();
  for (const t of doc.trackers) {
    let n = t.name;
    while (used.has(n.toLowerCase())) n += ' (2)';
    used.add(n.toLowerCase());
    nameOf[t.id] = n;
  }

  const days = {};
  for (const [iso, day] of Object.entries(doc.entries)) {
    days[iso] = {};
    for (const [id, v] of Object.entries(day)) days[iso][nameOf[id] || id] = v;
  }

  const targetStats = [];
  for (const t of doc.trackers) {
    if (t.archived) continue;
    const tgt = targetFor(t, today);
    if (!tgt) continue;
    if (tgt.period === 'day') {
      targetStats.push({
        name: nameOf[t.id], period: 'day', target: tgt.value, dir: tgt.dir || null,
        currentStreak: streakFor(t, today), longestStreak: longestStreak(t),
        last30Days: adherence(t, 30),
      });
    } else {
      targetStats.push({
        name: nameOf[t.id], period: 'week', target: tgt.value, dir: tgt.dir || null,
        currentWeekStreak: weekStreakFor(t, today), longestWeekStreak: longestWeekStreak(t),
        last8Weeks: weekAdherence(t, 8),
      });
    }
  }

  const measurements = [];
  for (const t of doc.trackers) {
    if (t.type !== 'measurement') continue;
    const latest = latestValue(t.id);
    const entry = { name: nameOf[t.id], unit: t.unit || null, latest, ratePerWeek28d: ratePerWeek(t.id, 28) };
    if (t.goal) {
      const p = goalProgress(t);
      entry.goal = {
        startValue: p.startValue, target: p.target, deadline: p.deadline,
        progressPct: Math.round(p.pct * 100), done: p.done,
      };
    }
    measurements.push(entry);
  }

  const calTracker = doc.trackers.find((t) => t.type === 'number' && !t.archived && t.name.toLowerCase() === 'calories');

  return {
    app: 'pcal-analysis',
    exportedAt: new Date().toISOString(),
    note: 'Derived stats are precomputed; days/workouts are the raw log. e1RM uses the Epley formula.',
    profile: getProfile(),
    trackers: doc.trackers.map((t) => ({
      name: nameOf[t.id], type: t.type, unit: t.unit || null, archived: !!t.archived,
      currentTarget: targetFor(t, today), targetHistory: t.targets || [], goal: t.goal || null,
    })),
    days,
    workouts: doc.workouts,
    stats: {
      targets: targetStats,
      measurements,
      intake: calTracker ? {
        tracker: nameOf[calTracker.id],
        avg7d: avgOverDays(calTracker.id, 7),
        avg28d: avgOverDays(calTracker.id, 28),
      } : null,
      lifts: liftStats().map((s) => ({
        name: s.name, sessions: s.sessions,
        bestWeight: s.best ? { weight: s.best.weight, reps: s.best.reps, date: s.best.date } : null,
        bestE1rm: s.bestE1rm ? Math.round(s.bestE1rm.e1rm * 10) / 10 : null,
        lastSession: s.last, trend: s.trend, trendMetric: s.trendInfo,
        prGoal: s.goal ? s.goal.target : null,
      })),
      weeklyVolume: weeklyVolume(12),
      workoutCounts: workoutCounts(),
    },
  };
}

export async function exportAnalysis() {
  const json = JSON.stringify(buildAnalysisPayload(), null, 2);
  return shareJSON(json, `fitness-analysis-${todayISO()}.json`, 'Fitness analysis export');
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
  if (obj.workouts && (typeof obj.workouts !== 'object' || Array.isArray(obj.workouts))) {
    return { ok: false, error: 'Backup file is damaged (workouts).' };
  }
  if (obj.liftGoals && (typeof obj.liftGoals !== 'object' || Array.isArray(obj.liftGoals))) {
    return { ok: false, error: 'Backup file is damaged (lift goals).' };
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
    workouts: backup.workouts || {},
    liftGoals: backup.liftGoals || {},
    profile: backup.profile || {},
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
