// Sprints — fixed training/nutrition blocks configured HERE (with Claude),
// not in the app. `start: null` means "the first day anything was logged".
//
// To add a sprint: append { id, name, start, end, focus } and redeploy.

import { getData } from './store.js';
import { allWorkouts, liftStats } from './workouts.js';
import { todayISO, addDays, startOfWeek } from './dates.js';
import { activeTrackers, targetFor, dayMeets, ratePerWeek } from './trackers.js';
import { getEntry } from './store.js';
import { weightTracker, calorieTracker, proteinTracker, trendWeightOn, isCardioDay, cardioTracker } from './insights.js';
import { MAIN_LIFTS } from './config.js';

// The main lifts: configured names (matched loosely — case/spacing/hyphens
// ignored, and a configured name may be a prefix of the logged one, so
// "Lat pulldown" matches "Lat Pulldown (cable)"). Falls back to the 3
// most-logged lifts if nothing configured matches yet.
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function mainLiftNames() {
  const stats = liftStats();
  if (MAIN_LIFTS.length) {
    const found = [];
    for (const want of MAIN_LIFTS) {
      const w = norm(want);
      // exact first; then CONTAINS in either direction. The old startsWith
      // test failed on "machine leg press" vs config "leg press" (neither is a
      // prefix of the other), so the leg press silently dropped out of the
      // strength score and the 3-most-logged fallback took over.
      const hit = stats.find((s) => norm(s.name) === w)
        || stats.find((s) => norm(s.name).includes(w) || w.includes(norm(s.name)));
      if (hit && !found.includes(hit.name)) found.push(hit.name);
    }
    // Return the configured lifts that have been logged. Do NOT fall back to
    // "3 most logged" when some are missing: the score is defined as THESE
    // three, and a quiet substitution is worse than an honest gap.
    if (found.length) return found;
  }
  return [...stats].sort((a, b) => b.sessions - a.sessions).slice(0, 3).map((s) => s.name);
}

// Short display form of a main-lift name, for tight breakdown lines and
// table headers ("DB press" fits where "Flat dumbbell press" does not).
export function shortLiftName(n) {
  return n.replace(/flat dumbbell press/i, 'DB press')
    .replace(/machine leg press/i, 'Leg press')
    .replace(/lat pulldown/i, 'Pulldown');
}

// Per main lift, the best e1RM set WITHIN one week (not the best-so-far).
// A running max can only ever rise, which hides a bad week; the within-week
// max shows it as a dip, which is the truth. Lifts not trained that week
// come back with best: null.
export function strengthPartsInWeek(weekStart, names) {
  const weekEnd = addDays(weekStart, 6);
  const stats = liftStats();
  return names.map((n) => {
    const s = stats.find((x) => x.name.toLowerCase() === n.toLowerCase());
    const inWeek = s ? s.history.filter((h) => h.date >= weekStart && h.date <= weekEnd && h.e1rm != null) : [];
    return { name: n, best: inWeek.length ? Math.max(...inWeek.map((h) => h.e1rm)) : null };
  });
}

// Baseline for the NORMALIZED strength score: each main lift's best e1RM in
// the first week (from `fromISO`, usually the sprint start) in which ALL
// main lifts were trained — "week 1" of the score. Null until such a week
// exists.
export function strengthBaseline(names, fromISO = null) {
  if (!names.length) return null;
  const wos = allWorkouts();
  if (!wos.length) return null;
  const stop = todayISO();
  for (let ws = startOfWeek(fromISO || wos[0].date); ws <= stop; ws = addDays(ws, 7)) {
    const parts = strengthPartsInWeek(ws, names);
    if (parts.every((p) => p.best != null)) return { ws, parts };
  }
  return null;
}

// Normalized strength score for ONE week: each lift's within-week best e1RM
// divided by that lift's baseline, averaged, ×100. The baseline week scores
// exactly 100 and every lift carries the same bearing (1/3) regardless of
// absolute load — a raw e1RM sum let the leg press (~440) swamp the presses
// (~180), so a pressing PR barely moved the number. 105 ≈ +5% average
// strength on the three lifts since week 1.
// Returns null unless EVERY main lift was trained that week — a partial
// score would read as a strength drop that never happened.
export function strengthScoreInWeek(weekStart, names, base) {
  if (!base) return null;
  const parts = strengthPartsInWeek(weekStart, names);
  if (parts.some((p) => p.best == null)) return null;
  const score = parts.reduce((sum, p, i) => sum + p.best / base.parts[i].best, 0) / parts.length * 100;
  return { score, parts };
}

// Week-by-week strength breakout across the sprint: one row per week that
// saw ANY main-lift work — sprint week number, per-lift within-week best
// e1RMs, and the normalized score (null when not all lifts were trained).
// Weeks with no main-lift work at all are skipped, but the numbering keeps
// their place so gaps stay visible.
export function strengthWeeks(sprintStart, endISO, names) {
  const base = strengthBaseline(names, sprintStart);
  const out = [];
  let index = 0;
  for (let ws = startOfWeek(sprintStart); ws <= endISO; ws = addDays(ws, 7)) {
    index++;
    const parts = strengthPartsInWeek(ws, names);
    if (!parts.length || !parts.some((p) => p.best != null)) continue;
    const scored = base && parts.every((p) => p.best != null);
    out.push({
      ws,
      index,
      parts,
      score: scored ? parts.reduce((sum, p, i) => sum + p.best / base.parts[i].best, 0) / parts.length * 100 : null,
    });
  }
  return out;
}

// Rolling adherence over the last N completed days for the process habits.
export function adherence28(days = 28) {
  const realToday = todayISO();
  const end = addDays(realToday, -1);
  const start = addDays(end, -(days - 1));
  const out = {};
  const wt = weightTracker();
  const cal = calorieTracker();
  const pro = proteinTracker();
  const cardio = cardioTracker();
  const steps = activeTrackers().find((t) => t.type === 'checkbox' && /step/i.test(t.name));
  const sleep = activeTrackers().find((t) => t.type === 'checkbox' && /sleep/i.test(t.name));

  // lifts: workout days out of the lifting weekly target scaled to N days
  let liftDays = 0;
  for (const w of allWorkouts()) if (w.date >= start && w.date <= end) liftDays++;
  out.lifts = { done: liftDays, of: days };

  let proHit = 0; let proOf = 0;
  let calHit = 0; let calOf = 0;
  let stepsHit = 0; let stepsOf = 0;
  let sleepHit = 0; let sleepOf = 0;
  let weighIns = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const e = getEntry(d);
    if (pro) { const t = targetFor(pro, d); if (t && t.period === 'day') { proOf++; if (dayMeets(pro, d)) proHit++; } }
    if (cal) { const t = targetFor(cal, d); if (t && t.period === 'day') { calOf++; if (dayMeets(cal, d)) calHit++; } }
    // habit checkboxes count only days their target was in force — a tracker
    // added mid-sprint must not be graded on days it did not exist
    if (steps && targetFor(steps, d)) { stepsOf++; if (e[steps.id] === true) stepsHit++; }
    if (sleep && targetFor(sleep, d)) { sleepOf++; if (e[sleep.id] === true) sleepHit++; }
    if (wt && typeof e[wt.id] === 'number') weighIns++;
  }
  // Cardio is a WEEKLY target (e.g. 1x/week), so a per-day rate would be
  // misleading (1 session in 7 days is 100% of target, 14% of days). Score
  // it as weeks that hit the target out of complete weeks in the window.
  let cardioWeeksHit = 0;
  let cardioWeeks = 0;
  if (cardio) {
    const tgt = targetFor(cardio, end);
    const need = tgt && tgt.period === 'week' ? tgt.value : 1;
    for (let ws = startOfWeek(start); addDays(ws, 6) <= end; ws = addDays(ws, 7)) {
      if (ws < start) continue;
      let n = 0;
      for (let i = 0; i < 7; i++) if (isCardioDay(getEntry(addDays(ws, i))[cardio.id])) n++;
      cardioWeeks++;
      if (n >= need) cardioWeeksHit++;
    }
  }
  out.protein = { done: proHit, of: proOf || days };
  out.calories = { done: calHit, of: calOf || days };
  out.steps = steps && stepsOf > 0 ? { done: stepsHit, of: stepsOf } : null;
  out.sleep = sleep && sleepOf > 0 ? { done: sleepHit, of: sleepOf } : null;
  out.weighIns = wt ? { done: weighIns, of: days } : null;
  out.cardio = cardio && cardioWeeks > 0 ? { done: cardioWeeksHit, of: cardioWeeks } : null;
  out.days = days;
  return out;
}

// Goals live ON the sprint: a weight target for the sprint end, plus optional
// lift PR targets (best e1RM by the end). The required pace is derived from
// the target and the end date — no separate pace setting needed.
export const SPRINTS = [
  {
    id: 's1',
    name: 'Sprint 1',
    // Pinned, not `null` (= "first logged day"). A derived start silently
    // moves if anything is ever backdated earlier, and every number keyed to
    // it (week N of 16, start weight, adherence window) moves with it.
    //
    // Weeks run MONDAY→SUNDAY (see startOfWeek in dates.js). Jul 13 is a
    // Monday, so the sprint begins exactly on a week boundary. The earlier
    // logged days (Sat Jul 11, Sun Jul 12) both belong to the week starting
    // Jul 6, which would have made the sprint's first week a 2-day stub.
    // 12 whole weeks = 84 days inclusive: 2026-07-13 → 2026-10-04 (Sun).
    // (Shortened from 16 on 2026-09-27 — vacation starts after week 12.)
    start: '2026-07-13',
    end: '2026-10-04',
    focus: 'Lean bulk · PPL 5–6×/wk',
    // Colour palette for this sprint. Each sprint gets its own look so a
    // new block FEELS like a new block. Palettes are defined in styles.css
    // under html[data-sprint="<palette>"]; 'espresso' is the original
    // amber-on-dark scheme and belongs to Sprint 1.
    palette: 'espresso',
    goals: {
      weight: 145,          // lb, trend weight at sprint end (started ~134)
      lifts: {},            // e.g. { 'Bench press': 155 } — e1RM targets
    },
  },
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

// Every configured sprint, resolved, config order (oldest first).
export function allSprints() {
  return SPRINTS.map(resolveSprint).filter(Boolean);
}

// Is a sprint RUNNING today? The between-sprints gap keeps logging alive but
// silences coaching pressure (pacing lines, nags, suggestions).
export function sprintActive() {
  const today = todayISO();
  return allSprints().some((s) => s.start <= today && today <= s.end);
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
    // for the start, use the first available trend within the sprint's first
    // weeks (a single day rarely has one; the first weigh-in may come later)
    snap.weight = trendWeightOn(wt.id, iso) ?? trendWeightOn(wt.id, addDays(iso, 6));
    if (snap.weight == null && iso === sprintStart) {
      for (let i = 7; i <= 28 && snap.weight == null; i += 7) snap.weight = trendWeightOn(wt.id, addDays(iso, i));
    }
    // for an END-of-sprint snapshot, fall back BACKWARD: weigh-ins often
    // stop a few days before the end (a trip, a lapse), and a final report
    // with no weight outcome is worse than one dated a week early
    if (snap.weight == null && iso !== sprintStart) {
      for (let i = 7; i <= 28 && snap.weight == null; i += 7) snap.weight = trendWeightOn(wt.id, addDays(iso, -i));
    }
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
  const wt = weightTracker();
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
  const cardioT = cardioTracker();
  const adherence = { logged: 0, calHit: 0, calOf: 0, proHit: 0, proOf: 0 };
  let calSum = 0;
  let calN = 0;
  let proSum = 0;
  let proN = 0;
  let cardioDays = 0;
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
      if (typeof e[pro.id] === 'number') { proSum += e[pro.id]; proN++; }
      const t = targetFor(pro, d);
      if (t && t.period === 'day') { adherence.proOf++; if (dayMeets(pro, d)) adherence.proHit++; }
    }
    if (cardioT && isCardioDay(e[cardioT.id])) cardioDays++;
  }
  report.totals = {
    workouts: workouts.length,
    bySplit,
    prs,
    adherence,
    calAvg: calN ? calSum / calN : null,
    proAvg: proN ? proSum / proN : null,
    cardioDays,
  };

  // weekly sessions pace vs the lifting commitment
  const weeksElapsed = Math.max(1, elapsed / 7);
  report.sessionsPerWeek = workouts.length / weeksElapsed;

  // --- sprint goals: target, required pace from here, current pace ---
  // A tracker goal that still EXISTS is deliberate, so it wins; the sprint
  // goal is the default when the tracker has none. Stale tracker goals are
  // removed at startup by config's `clearGoalIfTarget`, so the old in-app
  // number cannot linger here and quietly outrank the sprint.
  report.goals = { weight: null, lifts: [] };
  const g = { ...(s.goals || {}) };
  if (wt && wt.goal && typeof wt.goal.target === 'number') g.weight = wt.goal.target;
  if (g.weight != null && report.now.weight != null) {
    const remainingDays = Math.max(0, daysBetween(realToday, s.end));
    const remainingWeeks = remainingDays / 7;
    const toGo = g.weight - report.now.weight;
    // progress is measured from the goal's own baseline when it has one
    // (a goal set mid-sprint), else from the sprint's starting trend weight
    const trackerGoal = wt && wt.goal && typeof wt.goal.startValue === 'number' && wt.goal.target === g.weight
      ? wt.goal.startValue : null;
    const startW = trackerGoal ?? report.start.weight;
    const pct = startW != null && g.weight !== startW
      ? Math.max(0, Math.min(1, (report.now.weight - startW) / (g.weight - startW)))
      : 0;
    report.goals.weight = {
      target: g.weight,
      current: report.now.weight,
      startValue: startW,
      toGo,
      pct,
      done: (g.weight >= (startW ?? g.weight)) ? report.now.weight >= g.weight : report.now.weight <= g.weight,
      requiredPerWeek: remainingWeeks > 0 ? toGo / remainingWeeks : null,
      currentPerWeek: wt ? ratePerWeek(wt.id, 28) : null,
      remainingWeeks,
    };
  }
  for (const [name, target] of Object.entries(g.lifts || {})) {
    const st = liftStats().find((x) => x.name.toLowerCase() === name.toLowerCase());
    const best = st && st.bestE1rm ? st.bestE1rm.e1rm : null;
    report.goals.lifts.push({ name, target, best, pct: best != null ? Math.min(1, best / target) : 0, done: best != null && best >= target });
  }

  // strength story: the normalized score (week 1 = 100, each main lift 1/3
  // of the bearing), plus lift counts and the week-by-week breakout
  const names = mainLiftNames();
  const stEnd = s.end <= realToday ? s.end : realToday;
  const base = strengthBaseline(names, s.start);
  const stWeeks = strengthWeeks(s.start, stEnd, names);
  const scoredWeeks = stWeeks.filter((w) => w.score != null);
  const latest = scoredWeeks.length ? scoredWeeks[scoredWeeks.length - 1] : null;
  const stats = liftStats();
  // per-lift most-recent e1RM, in MAIN_LIFTS order — what the score is built on
  const perLift = names.map((n) => {
    const st = stats.find((x) => x.name.toLowerCase() === n.toLowerCase());
    const withE1 = st ? st.history.filter((h) => h.e1rm != null && h.date >= s.start && h.date <= stEnd) : [];
    const last = withE1.length ? withE1[withE1.length - 1] : null;
    return { name: n, e1rm: last ? last.e1rm : null, date: last ? last.date : null };
  });
  report.strength = {
    names,
    perLift,
    weeks: stWeeks,
    baselineISO: base ? base.ws : null,
    // sprint week number of the baseline (= 100) — usually 1, later if the
    // first fully-trained week came later
    baselineIndex: base ? (stWeeks.find((w) => w.ws === base.ws) || { index: 1 }).index : null,
    now: latest ? latest.score : null,                       // latest scored week
    delta: latest ? latest.score - 100 : null,               // vs the baseline week
    progressing: stats.filter((x) => x.trend === 'up').length,
    withTrend: stats.filter((x) => x.trend != null).length,
    stalled: stats.filter((x) => x.stalled).length,
    ready: stats.filter((x) => x.ready).length,
    prs: report.totals.prs,
    // chart series: one point per scored week, dated the week's LAST day
    series: scoredWeeks.map((w) => ({ iso: addDays(w.ws, 6), value: Math.round(w.score) })),
  };
  // Adherence across the WHOLE sprint so far, not a rolling 28 days: the
  // sprint is the unit being judged, and a rolling window silently drops
  // early weeks. `elapsed` counts completed days from the sprint start.
  report.adherence28 = adherence28(Math.max(1, elapsed));

  return report;
}
