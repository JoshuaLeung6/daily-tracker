// Sprints — fixed training/nutrition blocks configured HERE (with Claude),
// not in the app. `start: null` means "the first day anything was logged".
//
// To add a sprint: append { id, name, start, end, focus } and redeploy.

import { getData } from './store.js';
import { allWorkouts, liftStats } from './workouts.js';
import { todayISO, addDays } from './dates.js';
import { activeTrackers, targetFor, dayMeets } from './trackers.js';
import { getEntry } from './store.js';
import { weightTracker, calorieTracker, proteinTracker, trendWeightOn } from './insights.js';

export const SPRINTS = [
  { id: 's1', name: 'Sprint 1', start: null, end: '2026-10-31', focus: 'Lean bulk · PPL 5–6×/wk' },
];

export function firstLoggedISO() {
  let min = null;
  for (const iso of Object.keys(getData().entries)) if (!min || iso < min) min = iso;
  for (const w of allWorkouts()) if (!min || w.date < min) min = w.date;
  return min;
}

export function resolveSprint(s) {
  const start = s.start || firstLoggedISO();
  return start ? { ...s, start } : null;
}

export function currentSprint() {
  const today = todayISO();
  for (const s of SPRINTS) {
    const r = resolveSprint(s);
    if (r && r.start <= today && today <= r.end) return r;
  }
  // fall back to the most recent one
  const resolved = SPRINTS.map(resolveSprint).filter(Boolean);
  return resolved.length ? resolved[resolved.length - 1] : null;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

// Snapshot of the key numbers at a date: trend weight, per-lift best e1RM
// up to that date, and running adherence within the sprint.
function snapshotAt(iso, sprintStart) {
  const wt = weightTracker();
  const snap = { iso, weight: null, lifts: {} };
  if (wt) {
    // for the start, use the first week's trend (a single day rarely has one)
    snap.weight = trendWeightOn(wt.id, iso) ?? trendWeightOn(wt.id, addDays(iso, 6));
  }
  for (const s of liftStats()) {
    const upTo = s.history.filter((h) => h.date <= iso && h.date >= sprintStart && h.e1rm != null);
    if (upTo.length) snap.lifts[s.name] = Math.max(...upTo.map((h) => h.e1rm));
  }
  return snap;
}

export function sprintReport(sprint) {
  const realToday = todayISO();
  // totals count COMPLETED days only — today is still in progress
  const today = addDays(realToday, -1);
  const s = resolveSprint(sprint);
  if (!s) return null;
  const endEff = s.end <= today ? s.end : today;
  const totalDays = daysBetween(s.start, s.end) + 1;
  const elapsed = Math.max(0, Math.min(totalDays, daysBetween(s.start, endEff) + 1));
  const report = {
    ...s,
    totalDays,
    elapsed,
    remaining: Math.max(0, totalDays - elapsed),
    done: s.end < realToday,
    start: snapshotAt(s.start, s.start),
    // "now" snapshot uses today's trend weight (a weigh-in is complete)
    now: snapshotAt(s.end <= realToday ? s.end : realToday, s.start),
  };

  // per-lift start-vs-now e1RM (start = first e1RM in the sprint)
  report.lifts = [];
  for (const st of liftStats()) {
    const inSprint = st.history.filter((h) => h.date >= s.start && h.date <= endEff && h.e1rm != null);
    if (inSprint.length === 0) continue;
    const first = inSprint[0].e1rm;
    const best = Math.max(...inSprint.map((h) => h.e1rm));
    report.lifts.push({ name: st.name, first, best, latest: inSprint[inSprint.length - 1].e1rm, sessions: inSprint.length });
  }
  report.lifts.sort((a, b) => b.sessions - a.sessions);

  // totals across the sprint so far
  const workouts = allWorkouts().filter((w) => w.date >= s.start && w.date <= endEff);
  const bySplit = { push: 0, pull: 0, legs: 0 };
  for (const w of workouts) bySplit[w.split] = (bySplit[w.split] || 0) + 1;
  let prs = 0;
  for (const st of liftStats()) for (const h of st.history) if (h.isPR && h.date >= s.start && h.date <= endEff) prs++;

  const cal = calorieTracker();
  const pro = proteinTracker();
  const adherence = { logged: 0, calHit: 0, calOf: 0, proHit: 0, proOf: 0 };
  let calSum = 0;
  let calN = 0;
  for (let i = 0; i < elapsed; i++) {
    const d = addDays(s.start, i);
    const e = getEntry(d);
    if (Object.keys(e).length > 0) adherence.logged++;
    if (cal) {
      if (typeof e[cal.id] === 'number') { calSum += e[cal.id]; calN++; }
      const t = targetFor(cal, d);
      if (t && t.period === 'day') { adherence.calOf++; if (dayMeets(cal, d)) adherence.calHit++; }
    }
    if (pro) {
      const t = targetFor(pro, d);
      if (t && t.period === 'day') { adherence.proOf++; if (dayMeets(pro, d)) adherence.proHit++; }
    }
  }
  report.totals = { workouts: workouts.length, bySplit, prs, adherence, calAvg: calN ? calSum / calN : null };

  // weekly sessions pace vs the lifting commitment
  const weeksElapsed = Math.max(1, elapsed / 7);
  report.sessionsPerWeek = workouts.length / weeksElapsed;

  return report;
}
