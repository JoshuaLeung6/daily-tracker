// Insight engine — trend weight, weekly rate vs band, the week report,
// and pre-committed if-then suggestions.
//
// Grounding (docs/fitness-principles.md):
// - Reason only from the 7-day trend weight, never single readings.
// - Rates are %BW/week. Bands: bulk +0.1–0.25%/wk (intermediate), cut
//   −1.0 to −0.5%/wk. Direction comes from the active goal.
// - Suggest intake changes of 100–150 kcal only after TWO consecutive
//   weeks off-band (the playbook's confirmation lag), and only with
//   enough logged data to trust the trend.

import { todayISO, addDays, startOfWeek, fromISO, toLocalISO } from './dates.js';
import { getEntry, getData } from './store.js';
import { activeTrackers, targetFor, dayMeets, dayAllMet, ratePerWeek, avgOverDays } from './trackers.js';
import { allWorkouts, liftVolume, liftStats, SPLITS, SPLIT_LABELS } from './workouts.js';

// Mean + count of a measurement's logged values over the trailing 7 days.
function trendStats(id, iso) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const v = getEntry(addDays(iso, -i))[id];
    if (typeof v === 'number') { sum += v; n++; }
  }
  return n > 0 ? { mean: sum / n, n } : null;
}

export function trendWeightOn(id, iso) {
  const s = trendStats(id, iso);
  return s ? s.mean : null;
}

// A weekly rate needs enough readings that it reflects a trend, not two
// scale readings' worth of water noise.
const MIN_READINGS_PER_WINDOW = 3;

export function weightTracker() {
  // the actual body-weight tracker wins over any other goaled measurement
  // (waist, body fat…) — %BW bands only make sense on body weight
  const measures = activeTrackers().filter((t) => t.type === 'measurement');
  return measures.find((t) => /weight/i.test(t.name)) || measures.find((t) => t.goal) || null;
}

export function calorieTracker() {
  return activeTrackers().find((t) => t.type === 'number' && t.name.toLowerCase() === 'calories') || null;
}

export function proteinTracker() {
  return activeTrackers().find((t) => t.type === 'number' && t.name.toLowerCase() === 'protein') || null;
}

function earliestValueISO(id) {
  let min = null;
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (typeof day[id] === 'number' && (!min || iso < min)) min = iso;
  }
  return min;
}

// %BW/week band from the goal's direction (or the goal's own chosen pace).
// Null when no goal, and null for non-bodyweight measurements — %BW bands
// don't apply to waist or body fat.
export function rateBand(t) {
  if (!t || !t.goal || !/weight/i.test(t.name)) return null;
  const gaining = t.goal.target > t.goal.startValue;
  const phase = gaining ? 'gain' : 'loss';
  if (t.goal.band && typeof t.goal.band.lo === 'number' && typeof t.goal.band.hi === 'number') {
    const b = t.goal.band;
    return { lo: b.lo, hi: b.hi, phase, label: `${b.lo > 0 ? '+' : ''}${b.lo}–${b.hi}%/wk` };
  }
  return gaining
    ? { lo: 0.1, hi: 0.25, label: '+0.1–0.25%/wk', phase }
    : { lo: -1.0, hi: -0.5, label: '−0.5–1%/wk', phase };
}

// The named pace presets a goal can choose from, per direction.
export const PACE_PRESETS = {
  gain: {
    conservative: { lo: 0.05, hi: 0.15, label: 'Conservative (+0.05–0.15%/wk)' },
    standard: { lo: 0.1, hi: 0.25, label: 'Standard (+0.1–0.25%/wk)' },
    aggressive: { lo: 0.25, hi: 0.5, label: 'Aggressive (+0.25–0.5%/wk, more fat)' },
  },
  loss: {
    conservative: { lo: -0.5, hi: -0.25, label: 'Gentle (−0.25–0.5%/wk)' },
    standard: { lo: -1.0, hi: -0.5, label: 'Standard (−0.5–1%/wk)' },
    aggressive: { lo: -1.25, hi: -1.0, label: 'Aggressive (−1–1.25%/wk, muscle risk)' },
  },
};

// Rate over the 7 days ending at `endISO`, from trend weights. Requires
// ≥3 readings in BOTH windows so the rate reflects a trend; returns null
// otherwise (sparse weigh-ins must never drive badges or suggestions).
export function weeklyRate(id, endISO) {
  const now = trendStats(id, endISO);
  const prev = trendStats(id, addDays(endISO, -7));
  if (!now || !prev) return null;
  if (now.n < MIN_READINGS_PER_WINDOW || prev.n < MIN_READINGS_PER_WINDOW) return null;
  return { abs: now.mean - prev.mean, pct: ((now.mean - prev.mean) / prev.mean) * 100, trend: now.mean };
}

function volumeBetween(startISO, endISOExcl, split = null) {
  let sum = 0;
  for (const w of allWorkouts()) {
    if (w.date < startISO || w.date >= endISOExcl) continue;
    if (split && w.split !== split) continue;
    for (const l of w.lifts) {
      const v = liftVolume(l);
      if (v != null) sum += v;
    }
  }
  return sum;
}

// Everything the Week Report Card needs, for the week containing `iso`.
export function weekReport(iso) {
  const today = todayISO();
  const ws = startOfWeek(iso);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  // for the current week, measure through today, not a future Sunday
  const end = days[6] <= today ? days[6] : today;
  const report = { ws, days, end, isCurrent: startOfWeek(today) === ws };

  // --- weight (never for fully-future weeks — their data window is empty) ---
  const wt = weightTracker();
  if (wt && ws <= today) {
    const rate = weeklyRate(wt.id, end);
    const band = rateBand(wt);
    // plain mean of THIS week's readings (the zoomed-out "avg" number)
    let sum = 0;
    let n = 0;
    for (const d of days) {
      if (d > today) continue;
      const v = getEntry(d)[wt.id];
      if (typeof v === 'number') { sum += v; n++; }
    }
    report.weight = {
      tracker: wt,
      trend: trendWeightOn(wt.id, end),
      weekAvg: n > 0 ? sum / n : null,
      rate,
      band,
      verdict: rate && band
        ? (rate.pct < band.lo ? 'below' : rate.pct > band.hi ? 'above' : 'in')
        : null,
    };
  }

  // --- intake ---
  const cal = calorieTracker();
  if (cal) {
    let sum = 0;
    let n = 0;
    for (const d of days) {
      if (d > today) continue;
      const v = getEntry(d)[cal.id];
      if (typeof v === 'number') { sum += v; n++; }
    }
    report.intake = n > 0 ? { avg: sum / n, loggedDays: n, unit: cal.unit || 'kcal' } : null;
  }

  const pro = proteinTracker();
  if (pro && targetFor(pro, end)) {
    let hit = 0;
    let of = 0;
    for (const d of days) {
      if (d > today) continue;
      const tgt = targetFor(pro, d);
      if (!tgt || tgt.period !== 'day') continue;
      of++;
      if (dayMeets(pro, d)) hit++;
    }
    if (of > 0) report.protein = { hit, of };
  }

  // --- training ---
  const bySplit = { push: 0, pull: 0, legs: 0 };
  let sessions = 0;
  for (const w of allWorkouts()) {
    if (w.date < ws || w.date > days[6]) continue;
    sessions++;
    bySplit[w.split] = (bySplit[w.split] || 0) + 1;
  }
  const vol = volumeBetween(ws, addDays(ws, 7));
  let prior = 0;
  let priorWeeks = 0;
  for (let i = 1; i <= 4; i++) {
    const pws = addDays(ws, -7 * i);
    const v = volumeBetween(pws, addDays(pws, 7));
    if (v > 0) { prior += v; priorWeeks++; }
  }
  report.training = {
    sessions,
    bySplit,
    volume: vol,
    volumeVsAvg: priorWeeks > 0 && vol > 0 ? (vol / (prior / priorWeeks) - 1) * 100 : null,
  };

  return report;
}

// Pre-committed if-then rules, evaluated only for the CURRENT week and only
// once the data can carry the conclusion.
export function weekSuggestions(report) {
  if (!report.isCurrent) return [];
  const out = [];
  const w = report.weight;

  if (w && w.band && w.rate) {
    // confirmation lag: this week's rate AND last week's rate both off-band
    const lastWeek = weeklyRate(w.tracker.id, addDays(report.end, -7));
    const spanOK = (() => {
      const first = earliestValueISO(w.tracker.id);
      return first && first <= addDays(report.end, -14);
    })();
    if (spanOK && lastWeek) {
      const gaining = w.band.phase === 'gain';
      if (w.rate.pct < w.band.lo && lastWeek.pct < w.band.lo) {
        out.push({
          id: 'rate-low',
          text: gaining
            ? 'Two weeks gaining below your band — add 100–150 kcal/day.'
            : 'Two weeks losing faster than your band — add 100–150 kcal/day to protect muscle.',
          why: `Trend rate ${fmtPct(w.rate.pct)} vs band ${w.band.label}, second week in a row. Small single adjustments beat big reactive swings.`,
        });
      } else if (w.rate.pct > w.band.hi && lastWeek.pct > w.band.hi) {
        out.push({
          id: 'rate-high',
          text: gaining
            ? 'Two weeks gaining above your band — trim 100–150 kcal/day (fast gains skew to fat).'
            : 'Two weeks losing slower than your band — trim 100–150 kcal/day or add equivalent activity.',
          why: `Trend rate ${fmtPct(w.rate.pct)} vs band ${w.band.label}, second week in a row.`,
        });
      }
    }
  }

  if (report.protein && report.protein.of >= 4 && report.protein.hit / report.protein.of < 0.6) {
    out.push({
      id: 'protein-low',
      text: `Protein target hit ${report.protein.hit}/${report.protein.of} days — anchor breakfast and lunch with 30–50 g each.`,
      why: 'Daily protein is the nutrition lever that matters most; it has no self-correcting signal like calories do.',
    });
  }

  const t = report.training;
  if (t && report.isCurrent) {
    const missing = SPLITS.filter((s) => !t.bySplit[s]);
    const dow = (new Date().getDay() + 6) % 7; // 0 = Monday
    if (dow >= 4 && t.sessions >= 2 && missing.length === 1) {
      out.push({
        id: 'split-missing',
        text: `${SPLIT_LABELS[missing[0]]} hasn’t been trained this week — slot it before Sunday.`,
        why: 'Each muscle should be hit at least once (ideally twice) per week; a skipped split is the main PPL failure mode.',
      });
    }
  }

  return out;
}

function fmtPct(p) {
  return `${p > 0 ? '+' : ''}${p.toFixed(2)}%/wk`;
}

// ----- adaptive TDEE & suggested intake -----

function countReadings(id, days) {
  const today = todayISO();
  const cutoff = addDays(today, -(days - 1));
  let n = 0;
  for (const [iso, day] of Object.entries(getData().entries)) {
    if (iso >= cutoff && iso <= today && typeof day[id] === 'number') n++;
  }
  return n;
}

// Maintenance calories measured from the user's own logs:
// TDEE ≈ mean intake − (weekly trend Δ × 3500)/7 over 28 days.
// Locked until the logs can carry the conclusion (principles: 3–4 weeks of
// consistent logging; the number is "effective for how you log", ±200).
export function adaptiveTDEE(days = 28) {
  const cal = calorieTracker();
  const wt = weightTracker();
  if (!cal || !wt) return null;
  const intake = avgOverDays(cal.id, days);
  const intakeDays = intake ? intake.loggedDays : 0;
  const weighIns = countReadings(wt.id, days);
  if (intakeDays < 20 || weighIns < 12) {
    return {
      locked: true,
      reason: `needs ~4 weeks of logs — ${intakeDays}/20 intake days, ${weighIns}/12 weigh-ins in the last 28`,
    };
  }
  const rate = ratePerWeek(wt.id, days);
  if (rate == null) return { locked: true, reason: 'weigh-ins too clustered for a rate — spread them across the weeks' };
  return {
    locked: false,
    tdee: intake.avg - (rate * 3500) / 7,
    intakeAvg: intake.avg,
    ratePerWeek: rate,
    unit: cal.unit || 'kcal',
  };
}

// TDEE + the phase's surplus/deficit = the daily calorie target to aim at.
export function suggestedIntake() {
  const t = adaptiveTDEE();
  if (!t) return null;
  if (t.locked) return t;
  const band = rateBand(weightTracker());
  if (!band) return null;
  const gaining = band.phase === 'gain';
  return {
    ...t,
    phase: band.phase,
    lo: Math.round((gaining ? t.tdee + 200 : t.tdee - 500) / 10) * 10,
    hi: Math.round((gaining ? t.tdee + 300 : t.tdee - 300) / 10) * 10,
  };
}

// ----- week grading (the zoomed-out view) -----

// Sessions/week commitment: the Weightlifting tracker's weekly target if
// set, else a 3-session floor once any workout has ever been logged.
export function liftingSessionTarget() {
  const t = activeTrackers().find((x) => x.type === 'checkbox' && /weightlift/i.test(x.name));
  if (t) {
    const tgt = targetFor(t, todayISO());
    if (tgt && tgt.period === 'week') return tgt.value;
  }
  return 3;
}

// Grade a week on its applicable components: rate in band, protein hit on
// ≥70% of target days (≈ the "80% adherence is enough" rule with slack),
// and training sessions vs the weekly commitment.
export function weekGrade(iso) {
  const report = weekReport(iso);
  const components = [];
  if (report.weight && report.weight.rate && report.weight.band) {
    components.push({ key: 'rate', met: report.weight.verdict === 'in' });
  }
  if (report.protein && report.protein.of > 0) {
    components.push({ key: 'protein', met: report.protein.hit / report.protein.of >= 0.7 });
  }
  if (allWorkouts().length > 0) {
    components.push({ key: 'training', met: report.training.sessions >= liftingSessionTarget() });
  }
  const met = components.filter((c) => c.met).length;
  const grade = components.length === 0 ? null
    : met === components.length ? 'green'
    : met === 0 ? 'red'
    : 'yellow';
  return { grade, met, applicable: components.length, components, report };
}

function earliestDataISO() {
  let min = null;
  for (const iso of Object.keys(getData().entries)) {
    if (!min || iso < min) min = iso;
  }
  for (const w of allWorkouts()) {
    if (!min || w.date < min) min = w.date;
  }
  return min;
}

// ----- month report (consistency at scale) -----

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function monthReport(iso) {
  const today = todayISO();
  const d = fromISO(iso);
  const y = d.getFullYear();
  const m = d.getMonth();
  const start = toLocalISO(new Date(y, m, 1));
  const endFull = toLocalISO(new Date(y, m + 1, 0));
  if (start > today) return null;
  const end = endFull <= today ? endFull : today;
  const report = { start, end, isCurrent: today >= start && today <= endFull };

  // weight: trend at month end vs first full trend window inside the month
  const wt = weightTracker();
  if (wt) {
    const startTrendISO = addDays(start, 6);
    const spanDays = daysBetween(startTrendISO, end);
    const s1 = trendStats(wt.id, startTrendISO);
    const s2 = trendStats(wt.id, end);
    if (s1 && s2 && s1.n >= MIN_READINGS_PER_WINDOW && s2.n >= MIN_READINGS_PER_WINDOW && spanDays >= 7) {
      const delta = s2.mean - s1.mean;
      const pctPerWeek = ((delta / s1.mean) * 100) / (spanDays / 7);
      const band = rateBand(wt);
      report.weight = {
        tracker: wt,
        delta,
        pctPerWeek,
        band,
        verdict: band ? (pctPerWeek < band.lo ? 'below' : pctPerWeek > band.hi ? 'above' : 'in') : null,
      };
    } else {
      report.weight = { tracker: wt };
    }
  }

  // training + PRs
  const bySplit = { push: 0, pull: 0, legs: 0 };
  let sessions = 0;
  for (const w of allWorkouts()) {
    if (w.date < start || w.date > endFull) continue;
    sessions++;
    bySplit[w.split] = (bySplit[w.split] || 0) + 1;
  }
  let prs = 0;
  for (const s of liftStats()) {
    for (const h of s.history) {
      if (h.isPR && h.date >= start && h.date <= endFull) prs++;
    }
  }
  report.training = { sessions, bySplit, prs };

  // consistency
  const elapsed = daysBetween(start, end) + 1;
  let loggedDays = 0;
  let allMet = 0;
  for (let i = 0; i < elapsed; i++) {
    const day = addDays(start, i);
    if (Object.keys(getEntry(day)).length > 0) loggedDays++;
    if (dayAllMet(day)) allMet++;
  }
  const pro = proteinTracker();
  let proteinHit = 0;
  let proteinOf = 0;
  if (pro) {
    for (let i = 0; i < elapsed; i++) {
      const day = addDays(start, i);
      const tgt = targetFor(pro, day);
      if (!tgt || tgt.period !== 'day') continue;
      proteinOf++;
      if (dayMeets(pro, day)) proteinHit++;
    }
  }
  report.consistency = { loggedDays, elapsed, allMet, proteinHit, proteinOf };

  return report;
}

// Newest-first list of weeks since data began (capped), graded.
export function weeksOverview(maxWeeks = 26) {
  const current = startOfWeek(todayISO());
  const first = earliestDataISO();
  if (!first) return [];
  const start = startOfWeek(first);
  const out = [];
  for (let ws = current; ws >= start && out.length < maxWeeks; ws = addDays(ws, -7)) {
    out.push({ ws, isCurrent: ws === current, ...weekGrade(ws) });
  }
  return out;
}
