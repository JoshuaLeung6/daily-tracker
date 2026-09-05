// Progress — two panes:
//   Goals: destination goals (reach a number, e.g. body weight) and
//          target attainment (streaks, bests, 30-day hit rate, dot strips)
//   Lifting: workout counts and per-lift stats with PR goals.

import { el } from '../ui.js';
import { fmt, todayISO, addDays, startOfWeek } from '../dates.js';
import { getEntry, getData } from '../store.js';
// NOTE: no goal/target WRITE imports here on purpose — goals and targets are
// configured in js/config.js and js/sprints.js, never set from the UI.
import {
  activeTrackers, targetFor,
  dayMeets, weekMeets, streakFor, weekStreakFor,
  longestStreak, longestWeekStreak, adherence, weekAdherence, dotStrip,
  goalProgress, latestValue, ratePerWeek, avgOverDays,
} from '../trackers.js';
import {
  SPLITS, SPLIT_LABELS, FOCUS_LABELS, workoutCounts, liftStats,
  weeklyVolume, daysSince,
  repRange, rirSeries,
} from '../workouts.js';
import {
  suggestedIntake, calorieTracker, adaptiveTDEE,
  weightTracker, rateBand, weekReport, weekSuggestions,
} from '../insights.js';
import { lineChart, barChart, svgEl } from '../charts.js';
import { allPhotos } from '../photos.js';
import { openLightbox } from './day.js';
import { askClaude, hasClaudeKey, lastAsk } from '../claude.js';
import { SPRINTS, sprintReport, currentSprint, shortLiftName } from '../sprints.js';
import { liftingSessionTarget, cardioDayTarget } from '../insights.js';
import { CALORIE_BANDS, FLAGS } from '../config.js';

let pane = 'sprint';
let openSplit = null;      // which PPL group is expanded in the Lifts pane
let expandedLift = null;
let weightScale = 'logged'; // 'logged' | 'sprint' — weight chart x-axis range
let rirSplit = null;        // null (all) | 'push' | 'pull' | 'legs' — Effort chart filter

const fmtN = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const signed = (n) => `${n > 0 ? '+' : ''}${fmtN(n)}`;

export function render(container, ctx) {
  const rerender = () => render(container, ctx);

  // Three panes: the sprint dashboard, the lift ledger, and Coach.
  // (This used to force anything non-Coach back to 'sprint', which silently
  // made the Lifts tab unopenable once it was added.)
  const PANES = ['sprint', 'lifts', 'coach'];
  if (!PANES.includes(pane)) pane = 'sprint';
  const sprint = currentSprint();
  const TITLES = { sprint: 'Progress', lifts: 'Lifts', coach: 'Coach' };
  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Progress'),
      el('h1', {}, TITLES[pane]),
    ),
    el('span'),
  );

  const paneSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Progress section' },
    el('button', { class: 'seg-btn', 'aria-pressed': String(pane === 'sprint'), onclick: () => { pane = 'sprint'; rerender(); } }, 'Progress'),
    el('button', { class: 'seg-btn', 'aria-pressed': String(pane === 'lifts'), onclick: () => { pane = 'lifts'; rerender(); } }, 'Lifts'),
    el('button', { class: 'seg-btn', 'aria-pressed': String(pane === 'coach'), onclick: () => { pane = 'coach'; rerender(); } }, 'Coach'),
  );

  const paneEl = pane === 'coach' ? coachPane(rerender)
    : pane === 'lifts' ? liftingPane(rerender)
      : dashboardPane(rerender);
  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), paneSeg, paneEl);
}

/* ================= Dashboard (the sprint story) ================= */

function dashboardPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const sprint = currentSprint();
  if (!sprint) {
    wrap.append(el('div', { class: 'empty-state' }, 'The sprint starts with your first logged day — log something to begin.'));
    return wrap;
  }
  const r = sprintReport(sprint);
  const wt = weightTracker();
  const unit = wt && wt.unit ? ` ${wt.unit}` : '';
  const gw = r.goals && r.goals.weight;
  const st = r.strength;

  // 1. sprint position
  const pct = Math.round((r.elapsed / r.totalDays) * 100);
  const posFill = el('i', { class: 'goal-fill' });
  posFill.style.width = pct + '%';
  wrap.append(el('div', { class: 'dash-pos' },
    el('span', {}, r.done ? 'Sprint complete' : `Week ${Math.ceil(Math.max(1, r.elapsed) / 7)} of ${Math.ceil(r.totalDays / 7)}`),
    el('span', { class: 'wt-bar gc-bar dash-pos-bar' }, posFill),
    el('span', { class: 'rp-dim' }, `${fmt(r.start.iso, { month: 'short', day: 'numeric' })} → ${fmt(r.end, { month: 'short', day: 'numeric' })}`),
  ));

  // 2. hero: weight pace vs goal + strength total, side by side
  const heroes = el('div', { class: 'dash-heroes' });

  // weight hero
  if (gw) {
    // Two facts only: what the scale is doing, and what it needs to do.
    // Everything else (progress %, to-go, on/behind pace wording) was noise.
    let trendEl = null;
    let needEl = null;
    let paceCls = '';
    const req = gw.requiredPerWeek;
    const cur = gw.currentPerWeek;
    if (gw.done) { needEl = 'goal reached'; paceCls = ' pace-good'; }
    else if (r.done) needEl = `ended ${fmtN(Math.abs(gw.toGo))}${unit} ${gw.toGo > 0 ? 'short' : 'past'}`;
    else {
      trendEl = cur == null
        ? 'trending — needs more weigh-ins'
        : `trending ${cur > 0 ? '+' : ''}${fmtN(Math.round(cur * 10) / 10)}${unit}/wk`;
      if (req != null) {
        needEl = `need ${req > 0 ? '+' : ''}${fmtN(Math.round(req * 100) / 100)}${unit}/wk`;
        if (cur != null) {
          // Judge the RATIO, so overshooting is not scored as success:
          // gaining double what the goal needs is fat gain, not being ahead.
          const ratio = req !== 0 ? cur / req : (cur === 0 ? 1 : 0);
          const onPace = ratio >= 0.8 && ratio <= 1.5;
          const close = ratio >= 0.5 && ratio <= 2.2;
          paceCls = onPace ? ' pace-good' : close ? ' pace-mid' : ' pace-bad';
        }
      }
    }
    heroes.append(el('button', { class: 'card hero-card hero-tap', onclick: () => openWeightSheet(r, sprint, wt) },
      el('div', { class: 'hero-label' }, 'Weight', el('span', { class: 'hero-chev' }, '›')),
      el('div', { class: 'hero-num' }, fmtN(gw.current), el('span', { class: 'hero-unit' }, unit)),
      trendEl && el('div', { class: 'hero-sub' }, trendEl),
      needEl && el('div', { class: 'gc-pace hero-pace' + paceCls }, needEl),
    ));
  } else if (wt) {
    heroes.append(el('button', { class: 'card hero-card hero-tap', onclick: () => openWeightSheet(r, sprint, wt) },
      el('div', { class: 'hero-label' }, 'Weight', el('span', { class: 'hero-chev' }, '›')),
      el('div', { class: 'hero-num' }, r.now.weight != null ? fmtN(r.now.weight) : '—', el('span', { class: 'hero-unit' }, unit)),
      el('div', { class: 'hero-sub rp-dim' }, 'no sprint goal set — ask Claude'),
    ));
  }

  // strength hero — normalized score (week 1 = 100, each main lift 1/3 of
  // the bearing). Tapping opens the drill-down: per-lift 1RM charts and the
  // week-by-week breakout table.
  if (st && st.names.length) {
    heroes.append(el('button', { class: 'card hero-card hero-tap', onclick: () => openStrengthSheet(r, sprint) },
      el('div', { class: 'hero-label' }, 'Strength', el('span', { class: 'hero-chev' }, '›')),
      el('div', { class: 'hero-num' }, st.now != null ? String(Math.round(st.now)) : '—'),
      el('div', { class: 'hero-sub' },
        st.delta != null ? el('span', { class: st.delta > 0 ? 'met-day-text on' : '' }, `${st.delta > 0 ? '+' : ''}${Math.round(st.delta)} vs week ${st.baselineIndex}`) : `${st.names.length} main lifts`,
      ),
      el('div', { class: 'hero-foot rp-dim' },
        `${st.progressing}/${st.withTrend} lifts up`,
        st.prs ? el('span', { class: 'pr-star' }, ` · ★ ${st.prs}`) : null,
        st.stalled ? el('span', { class: 'b-badge b-stall' }, `${st.stalled} stalled`) : null,
      ),
    ));
  }
  wrap.append(heroes);

  // 2b. intake: measured maintenance + what to eat to hit the sprint goal
  if (wt) wrap.append(intakeCard(gw));

  // 3. consistency across the whole sprint so far — percentages only
  const a = r.adherence28;
  if (a) {
    const ring = (label, done, of, target) => {
      const p = of > 0 ? done / of : 0;
      const need = target != null ? target : 0.8;
      const cls = p >= need ? ' st-good' : p >= need * 0.6 ? ' st-neutral' : ' st-bad';
      return el('div', { class: 'adh-cell' + cls },
        el('div', { class: 'adh-pct wk-cell-v' }, `${Math.round(p * 100)}%`),
        el('div', { class: 'adh-l' }, label),
      );
    };
    const liftTarget = liftingSessionTarget() / 7;
    wrap.append(el('div', { class: 'settings-section' },
      el('div', { class: 'card adh-card' },
        ring('lifts', a.lifts.done, a.lifts.of, liftTarget * 0.9),
        ring('protein', a.protein.done, a.protein.of, 0.8),
        ring('calories', a.calories.done, a.calories.of, 0.7),
        // cardio is scored per WEEK (weeks hitting the target), not per day,
        // and counts real conditioning only (run/squash/bike) — the 10k-step
        // walking habit is its own daily ring
        a.cardio ? ring('cardio', a.cardio.done, a.cardio.of, 0.8) : null,
        a.steps ? ring('10k steps', a.steps.done, a.steps.of, 0.8) : null,
        a.sleep ? ring('sleep', a.sleep.done, a.sleep.of, 0.8) : null,
      ),
    ));
  }

  // 4. charts: weight vs goal line, strength total over the sprint
  // The range toggle governs BOTH charts (weight and strength share an
  // x-axis), so it lives in the section header, not inside the weight card.
  // "Sprint" spans the full sprint and extrapolates the weight trend to the
  // end date; "Logged" is just the data so far.
  const full = weightScale === 'sprint';
  const rangeSeg = el('span', { class: 'seg seg-mini', role: 'group', 'aria-label': 'Chart range' },
    // distinct class: these are NOT pane segments, and sharing .seg-btn made
    // "click the segment named X" ambiguous
    el('button', {
      class: 'seg-btn range-btn', 'aria-pressed': String(!full),
      onclick: () => { weightScale = 'logged'; rerender(); },
    }, 'Logged'),
    el('button', {
      class: 'seg-btn range-btn', 'aria-pressed': String(full),
      onclick: () => { weightScale = 'sprint'; rerender(); },
    }, 'Sprint'));
  const chartsSec = el('div', { class: 'settings-section' },
    el('div', { class: 'sec-head' }, el('h2', {}, 'Trends'), rangeSeg));
  let anyChart = false;
  if (wt) {
    const series = measurementSeries(wt.id).filter((p) => p.iso >= r.start.iso);
    if (series.length >= 2) {
      chartsSec.append(el('button', { class: 'card chart-card chart-tap', onclick: () => openWeightSheet(r, sprint, wt) },
        el('div', { class: 'gc-head' }, el('span', { class: 'gc-name' }, 'Weight'),
          el('span', { class: 'hero-chev' }, '›')),
        lineChart({
          points: series,
          goal: gw ? { value: gw.target, label: `goal ${fmtN(gw.target)}` } : null,
          unit: wt.unit || '',
          ariaLabel: 'Weight over the sprint',
          domain: full ? { from: r.start.iso, to: r.end } : null,
          project: full,
        }),
      ));
      anyChart = true;
    }
  }
  if (st && st.series.length >= 2) {
    chartsSec.append(el('button', { class: 'card chart-card chart-tap', onclick: () => openStrengthSheet(r, sprint) },
      el('div', { class: 'gc-head' }, el('span', { class: 'gc-name' }, 'Strength'),
        el('span', { class: 'hero-chev' }, '›')),
      // same x-axis as the weight chart, so the two read against each other
      lineChart({
        points: st.series,
        ariaLabel: 'Normalized strength score over the sprint',
        domain: { from: r.start.iso, to: weightScale === 'sprint' ? r.end : st.series[st.series.length - 1].iso },
      }),
      // what the score is built on: each main lift's most recent e1RM
      el('div', { class: 'st-parts' },
        ...(st.perLift || []).map((l) => el('div', { class: 'st-part' },
          el('span', { class: 'st-part-n' }, l.e1rm != null ? Math.round(l.e1rm).toLocaleString() : '—'),
          el('span', { class: 'st-part-l' }, l.name)))),
    ));
    anyChart = true;
  }
  if (anyChart) wrap.append(chartsSec);

  // 6. sprint totals — five plain numbers, no targets section: the
  // consistency percentages above already say how well each target is going,
  // so a second per-target card block was redundant
  const t = r.totals;
  const tot = el('div', { class: 'card report-card' });
  tot.append(rpRowS('Workouts', el('span', {}, el('b', {}, String(t.workouts)),
    el('span', { class: 'rp-dim' }, ` · ${r.sessionsPerWeek.toFixed(1)}/wk`))));
  tot.append(rpRowS('Days logged', el('span', {}, el('b', {}, String(t.adherence.logged)),
    el('span', { class: 'rp-dim' }, ` of ${r.elapsed}`))));
  if (t.calAvg != null) tot.append(rpRowS('Avg calories', el('span', {}, el('b', {}, Math.round(t.calAvg).toLocaleString()), ' kcal')));
  if (t.proAvg != null) tot.append(rpRowS('Avg protein', el('span', {}, el('b', {}, Math.round(t.proAvg).toLocaleString()), ' g')));
  tot.append(rpRowS('Cardio', el('span', {}, el('b', {}, String(t.cardioDays)), ' sessions')));
  wrap.append(el('div', { class: 'settings-section' }, el('h2', {}, r.done ? 'Sprint totals' : 'Sprint so far'), tot));

  // 7. the photo record — the gallery is where monthly photos pay off
  wrap.append(el('button', { class: 'ghost-btn photos-btn', onclick: () => openPhotoGallery(sprint) }, 'Progress photos'));

  return wrap;
}

// All progress photos as a structured TIMELINE: one section per photo day,
// oldest first so the story reads forward, each with three fixed slots —
// front · side · back — so scanning down compares the same angle across
// months; a missing angle shows as a dashed placeholder. Custom/unlabeled
// photos follow in the same row. Tap a tile for the full-size lightbox.
function openPhotoGallery(sprint) {
  const overlay = el('div', { class: 'workout-overlay' });
  const urls = [];
  const close = () => {
    overlay.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  const grid = el('div', { class: 'gallery-grid' });
  const tile = (p, load) => {
    const url = URL.createObjectURL(p.blob);
    urls.push(url);
    return el('button', { class: 'gallery-tile', onclick: () => openLightbox(p, p.date, false, load) },
      el('img', { src: url, alt: `Progress photo ${p.date}${p.caption ? ` (${p.caption})` : ''}`, class: 'gallery-img' }),
      p.caption ? el('span', { class: 'gallery-label' }, p.caption) : null);
  };
  const load = async () => {
    const photos = await allPhotos();   // sorted oldest → newest
    grid.replaceChildren();
    if (!photos.length) {
      grid.append(el('div', { class: 'empty-state' }, 'No photos yet — + Photo on the Day view. Monthly, same light: front, side, back.'));
      return;
    }
    const byDate = new Map();
    for (const p of photos) {
      if (!byDate.has(p.date)) byDate.set(p.date, []);
      byDate.get(p.date).push(p);
    }
    const ANGLES = ['front', 'side', 'back'];
    for (const [date, list] of byDate) {
      // sprint week number ties the timeline to the app's week language
      let wk = null;
      if (sprint && date >= sprint.start && date <= sprint.end) {
        wk = Math.floor((new Date(date) - new Date(startOfWeek(sprint.start))) / 604800000) + 1;
      }
      const row = el('div', { class: 'gal-row' });
      const used = new Set();
      for (const a of ANGLES) {
        const p = list.find((x) => x.caption === a && !used.has(x));
        if (p) { used.add(p); row.append(tile(p, load)); } else row.append(el('div', { class: 'gal-slot' }, a));
      }
      for (const p of list) if (!used.has(p)) row.append(tile(p, load));
      grid.append(el('div', { class: 'gal-day' },
        el('div', { class: 'gal-head' },
          el('b', {}, fmt(date, { month: 'short', day: 'numeric' })),
          wk != null ? el('span', { class: 'rp-dim' }, ` · week ${wk}`) : null),
        row));
    }
  };
  load();

  overlay.append(
    el('div', { class: 'wo-head' },
      el('div', {},
        el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Progress'),
        el('h2', {}, 'Photos'),
      ),
      el('button', { class: 'btn primary', onclick: close }, 'Close'),
    ),
    el('div', { class: 'wo-body' }, grid),
  );
  document.body.append(overlay);
}

// Strength drill-down (tap the hero or the chart): per-lift weekly-best 1RM
// charts, then the week-by-week score breakout. Each lift's 1RM is coloured
// by its movement vs the previous week that has a value for THAT lift (gap
// weeks are skipped, not treated as drops); ±0.5 reads as flat. Single-week
// colour is a hint, not a verdict — e1RM carries 5–10% session noise.
function openStrengthSheet(r, sprint) {
  const st = r.strength;
  const weeks = st.weeks || [];
  const baseIdx = st.baselineIndex || 1;

  const overlay = el('div', { class: 'workout-overlay' });
  const close = () => overlay.remove();
  const body = el('div', { class: 'wo-body' });

  body.append(el('div', { class: 'st-expl rp-dim' },
    `Each lift's weekly best e1RM, indexed to week ${baseIdx} (= 100) and averaged — every lift carries a third of the score. 105 means +5% average strength across the three lifts.`));

  // per-lift 1RM charts: one dot per trained week, shared x-axis
  const chartEnd = weeks.length ? addDays(weeks[weeks.length - 1].ws, 6) : r.end;
  st.names.forEach((name, i) => {
    const points = weeks.filter((w) => w.parts[i].best != null)
      .map((w) => ({ iso: addDays(w.ws, 6), value: Math.round(w.parts[i].best) }));
    const cardEl = el('div', { class: 'card chart-card st-lift-card' },
      el('div', { class: 'gc-head' }, el('span', { class: 'gc-name' }, name),
        points.length ? el('span', { class: 'rp-dim' }, `1RM ${points[points.length - 1].value}`) : null));
    cardEl.append(points.length >= 2
      ? lineChart({ points, ariaLabel: `${name} weekly best e1RM`, domain: { from: r.start.iso, to: chartEnd } })
      : el('div', { class: 'rp-dim st-chart-note' }, 'chart appears after two trained weeks'));
    body.append(cardEl);
  });

  // week-by-week breakout table (columns follow the main-lift count — the
  // fallback score can run on fewer than three lifts)
  const grid = el('div', { class: 'st-grid' },
    el('span', { class: 'st-h' }, 'week'),
    el('span', { class: 'st-h st-r' }, 'score'),
    ...st.names.map((n) => el('span', { class: 'st-h st-r' }, shortLiftName(n))),
  );
  grid.style.gridTemplateColumns = `auto repeat(${st.names.length + 1}, 1fr)`;
  weeks.forEach((w, wi) => {
    grid.append(el('span', { class: 'st-wk' }, `W${w.index}`,
      el('span', { class: 'st-wk-d' }, fmt(w.ws, { month: 'short', day: 'numeric' }))));
    grid.append(el('span', { class: 'st-r st-score' }, w.score != null ? String(Math.round(w.score)) : '—'));
    w.parts.forEach((p, i) => {
      // colour vs the previous week that has a value for THIS lift
      let cls = '';
      if (p.best != null) {
        let prev = null;
        for (let k = wi - 1; k >= 0 && prev == null; k--) prev = weeks[k].parts[i].best;
        if (prev != null) cls = p.best > prev + 0.5 ? ' stx-good' : p.best < prev - 0.5 ? ' stx-bad' : '';
      }
      grid.append(el('span', { class: 'st-r st-1rm' + cls }, p.best != null ? String(Math.round(p.best)) : '—'));
    });
  });
  body.append(
    el('div', { class: 'wo-seg-label' }, 'Week by week'),
    el('div', { class: 'card st-table-card' }, grid),
  );

  overlay.append(
    el('div', { class: 'wo-head' },
      el('div', {},
        el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Progress'),
        el('h2', {}, 'Strength'),
      ),
      el('button', { class: 'btn primary', onclick: close }, 'Close'),
    ),
    body,
  );
  document.body.append(overlay);
}

// Weight drill-down (tap the hero or the chart): pacing vs the sprint goal,
// the full-sprint projection chart, and a week-by-week table of scale
// averages. Weekly Δs are graded against the sprint's %/wk band — green in
// band, red below it (not gaining is the failure mode of a bulk), plain
// above it while warnFastGain is off. A week needs 2+ weigh-ins on both
// sides of the comparison, matching the week view's rule.
function openWeightSheet(r, sprint, wt) {
  const gw = r.goals && r.goals.weight;
  const unit = wt.unit ? ` ${wt.unit}` : '';
  const band = rateBand(wt);
  const overlay = el('div', { class: 'workout-overlay' });
  const close = () => overlay.remove();
  const body = el('div', { class: 'wo-body' });

  // --- pacing: where the scale is, where it must go, where it will land ---
  if (gw) {
    const cur = gw.currentPerWeek;
    const req = gw.requiredPerWeek;
    const card = el('div', { class: 'card report-card' });
    card.append(rpRowS('Now', el('span', {}, el('b', {}, fmtN(gw.current)), unit)));
    card.append(rpRowS('Goal', el('span', {}, el('b', {}, fmtN(gw.target)), unit,
      el('span', { class: 'rp-dim' }, ` · by ${fmt(r.end, { month: 'short', day: 'numeric' })}`))));
    if (cur != null) {
      card.append(rpRowS('Trending', el('span', {}, el('b', {}, `${cur > 0 ? '+' : ''}${fmtN(Math.round(cur * 100) / 100)}`), `${unit}/wk`,
        el('span', { class: 'rp-dim' }, ' · 28-day rate'))));
    }
    if (req != null && !gw.done && !r.done) {
      card.append(rpRowS('Needed', el('span', {}, el('b', {}, `${req > 0 ? '+' : ''}${fmtN(Math.round(req * 100) / 100)}`), `${unit}/wk`,
        el('span', { class: 'rp-dim' }, ' · to hit the goal in time'))));
    }
    if (cur != null && !r.done && gw.remainingWeeks > 0) {
      const endW = gw.current + cur * gw.remainingWeeks;
      card.append(rpRowS('At this pace', el('span', {}, el('b', {}, fmtN(Math.round(endW * 10) / 10)), unit,
        el('span', { class: 'rp-dim' }, ` · on ${fmt(r.end, { month: 'short', day: 'numeric' })}`))));
      // when the goal lands, extrapolating the current rate
      if (cur !== 0 && Math.sign(cur) === Math.sign(gw.toGo)) {
        const weeksToGoal = gw.toGo / cur;
        card.append(rpRowS('Goal reached', weeksToGoal <= 104
          ? el('span', {}, el('b', {}, `≈ ${fmt(addDays(todayISO(), Math.round(weeksToGoal * 7)), { month: 'short', day: 'numeric' })}`),
            weeksToGoal * 7 > (gw.remainingWeeks * 7) ? el('span', { class: 'rp-dim' }, ' · after the sprint ends') : null)
          : el('span', { class: 'rp-dim' }, 'years away at this pace')));
      } else if (cur === 0 || Math.sign(cur) !== Math.sign(gw.toGo)) {
        card.append(rpRowS('Goal reached', el('span', { class: 'rp-dim' }, 'not at this pace — trend points the wrong way')));
      }
    }
    body.append(card);
  }

  // --- the sprint chart, always full-domain with the trend projected ---
  const series = measurementSeries(wt.id).filter((p) => p.iso >= r.start.iso);
  if (series.length >= 2) {
    body.append(el('div', { class: 'card chart-card' },
      el('div', { class: 'gc-head' }, el('span', { class: 'gc-name' }, 'Weight')),
      lineChart({
        points: series,
        goal: gw ? { value: gw.target, label: `goal ${fmtN(gw.target)}` } : null,
        unit: wt.unit || '',
        ariaLabel: 'Weight over the sprint, trend projected to the end',
        domain: { from: r.start.iso, to: r.end },
        project: true,
      }),
    ));
  }

  // --- week-by-week scale averages ---
  const rows = [];
  {
    const stop = todayISO();
    let index = 0;
    for (let ws = startOfWeek(r.start.iso); ws <= stop; ws = addDays(ws, 7)) {
      index++;
      let sum = 0; let n = 0;
      for (let i = 0; i < 7; i++) {
        const v = getEntry(addDays(ws, i))[wt.id];
        if (typeof v === 'number') { sum += v; n++; }
      }
      if (n > 0) rows.push({ ws, index, avg: sum / n, n, delta: null, prevAvg: null });
    }
    // Δ vs the latest earlier week where BOTH sides have 2+ weigh-ins;
    // thin weeks are skipped, not treated as changes
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].n < 2) continue;
      for (let k = i - 1; k >= 0; k--) {
        if (rows[k].n >= 2) { rows[i].delta = rows[i].avg - rows[k].avg; rows[i].prevAvg = rows[k].avg; break; }
      }
    }
  }
  if (rows.length) {
    const grid = el('div', { class: 'st-grid' },
      el('span', { class: 'st-h' }, 'week'),
      el('span', { class: 'st-h st-r' }, `avg${unit}`),
      el('span', { class: 'st-h st-r' }, 'weigh-ins'),
      el('span', { class: 'st-h st-r' }, 'vs prev wk'),
    );
    grid.style.gridTemplateColumns = 'auto 1fr 1fr 1fr';
    for (const w of rows) {
      grid.append(el('span', { class: 'st-wk' }, `W${w.index}`,
        el('span', { class: 'st-wk-d' }, fmt(w.ws, { month: 'short', day: 'numeric' }))));
      grid.append(el('span', { class: 'st-r st-score' }, fmtN(Math.round(w.avg * 10) / 10)));
      grid.append(el('span', { class: 'st-r st-1rm' }, String(w.n)));
      let cls = '';
      if (w.delta != null && band) {
        const pct = (w.delta / w.prevAvg) * 100;
        cls = pct >= band.lo && pct <= band.hi ? ' stx-good'
          : pct < band.lo ? ' stx-bad'
            : FLAGS.warnFastGain ? ' stx-bad' : '';
      }
      grid.append(el('span', { class: 'st-r st-1rm' + cls },
        w.delta != null ? `${w.delta >= 0 ? '+' : ''}${fmtN(Math.round(w.delta * 10) / 10)}` : '—'));
    }
    body.append(
      el('div', { class: 'wo-seg-label' }, 'Week by week'),
      el('div', { class: 'card st-table-card' }, grid),
    );
  }

  overlay.append(
    el('div', { class: 'wo-head' },
      el('div', {},
        el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Progress'),
        el('h2', {}, 'Weight'),
      ),
      el('button', { class: 'btn primary', onclick: close }, 'Close'),
    ),
    body,
  );
  document.body.append(overlay);
}

// The sprint plan, stated plainly: what the sprint is FOR (outcome goals),
// what has to happen for that to work (process goals), and what is being
// tracked to know it is happening. Read from live config/targets so it can
// never drift out of sync with what the app is actually grading.
function planSection(r, sprint) {
  const sec = el('div', { class: 'settings-section plan-sec' }, el('h2', {}, 'The plan'));
  const wt = weightTracker();
  const wUnit = wt && wt.unit ? ` ${wt.unit}` : '';

  const block = (title, why, rows) => {
    const b = el('div', { class: 'card plan-card' },
      el('div', { class: 'plan-head' },
        el('span', { class: 'plan-title' }, title),
        el('span', { class: 'plan-why rp-dim' }, why)));
    for (const [k, v] of rows.filter(Boolean)) {
      b.append(el('div', { class: 'plan-row' },
        el('span', { class: 'plan-k' }, k),
        el('span', { class: 'plan-v' }, v)));
    }
    return b;
  };

  // --- outcomes: the destination ---
  const gw = r.goals && r.goals.weight;
  const outcomes = [];
  if (gw) {
    outcomes.push(['Body weight',
      `${fmtN(gw.startValue)} → ${fmtN(gw.target)}${wUnit}` + (gw.toGo != null ? ` · ${fmtN(Math.abs(gw.toGo))} to go` : '')]);
  } else if (sprint.goals && sprint.goals.weight != null) {
    outcomes.push(['Body weight', `${fmtN(sprint.goals.weight)}${wUnit} by sprint end`]);
  }
  const liftGoals = Object.entries((sprint.goals && sprint.goals.lifts) || {});
  for (const [name, target] of liftGoals) outcomes.push([name, `${fmtN(target)} e1RM`]);
  if (r.strength && r.strength.names.length) {
    outcomes.push(['Strength', `${r.strength.names.join(' + ')} e1RM`]);
  }
  if (outcomes.length) {
    sec.append(block('Outcome goals', 'where this sprint ends up', outcomes));
  }

  // --- process: the behaviours that produce the outcome ---
  const liftT = liftingSessionTarget();
  const cardioT = cardioDayTarget();
  const proT = (() => {
    const p = activeTrackers().find((x) => x.type === 'number' && /protein/i.test(x.name));
    const tg = p ? targetFor(p, todayISO()) : null;
    return tg ? `≥ ${fmtN(tg.value)} ${p.unit || 'g'}/day` : null;
  })();
  const calT = (() => {
    const c = calorieTracker();
    const tg = c ? targetFor(c, todayISO()) : null;
    if (tg) return `${tg.dir === 'atmost' ? '≤' : '≥'} ${fmtN(tg.value)} ${c.unit || 'kcal'}/day`;
    return `${CALORIE_BANDS.good.toLocaleString()}+ kcal/day (green band)`;
  })();
  sec.append(block('Process goals', 'what has to happen every week', [
    ['Lifting', `PPL · ${liftT}×/week`],
    ['Cardio', `${cardioT}×/week`],
    ['Steps', '10k/day'],
    ['Calories', calT],
    proT && ['Protein', proT],
  ]));

  // --- tracking: what is logged, and why it earns its place ---
  sec.append(block('Tracking plan', 'what gets logged, and what it is for', [
    ['Calories', 'drives the surplus — and measures maintenance'],
    ['Protein', 'keeps the gain lean rather than fat'],
    ['Weight', 'the feedback signal for pace'],
    ['Cardio + 10k steps', 'health and body-fat maintenance'],
    ['Workouts', 'PPL sessions, lifts, and e1RM progression'],
  ]));

  return sec;
}


// Maintenance calories, with the arithmetic shown rather than asserted.
// The whole method is: whatever you ate, minus whatever the scale says you
// banked or burned. 1 lb of body mass ~ 3,500 kcal, so a weekly rate converts
// to a daily calorie surplus/deficit by (rate * 3500) / 7.
function intakeCard(gw) {
  const t = adaptiveTDEE();
  const card = el('div', { class: 'card goal-card dash-insight' },
    el('div', { class: 'gc-head' }, el('span', { class: 'gc-name' }, 'Intake')));

  if (!t) return card;
  if (t.locked) {
    card.append(el('div', { class: 'mt-locked rp-dim' }, `Not enough data yet — ${t.reason}.`));
    return card;
  }

  const unit = t.unit;
  const wt = weightTracker();
  const wUnit = wt && wt.unit ? wt.unit : 'lb';
  const perDay = (t.ratePerWeek * 3500) / 7;
  const rounded = Math.round(t.tdee);
  const n = (v) => Math.round(v).toLocaleString();

  // the sum, as three labelled terms
  const term = (value, label, sub) => el('div', { class: 'mt-term' },
    el('div', { class: 'mt-val' }, value),
    el('div', { class: 'mt-lab' }, label),
    sub ? el('div', { class: 'mt-sub' }, sub) : null);
  const op = (sym) => el('div', { class: 'mt-op' }, sym);

  card.append(el('div', { class: 'mt-eq' },
    term(n(t.intakeAvg), 'eaten', `avg ${unit}/day`),
    op(perDay >= 0 ? '−' : '+'),
    term(n(Math.abs(perDay)), perDay >= 0 ? 'stored' : 'drawn on',
      `${signed(Math.round(t.ratePerWeek * 100) / 100)} ${wUnit}/wk`),
    op('='),
    term(n(rounded), 'maintenance', `${unit}/day`),
  ));

  // --- what to eat to land the sprint goal on time ---
  // The surplus is derived from the goal itself: how much weight is left and
  // how many weeks remain -> lb/wk -> kcal/day on top of measured maintenance.
  if (gw && gw.requiredPerWeek != null && gw.remainingWeeks > 0 && !gw.done) {
    const reqPerDay = (gw.requiredPerWeek * 3500) / 7;
    const aim = Math.round((rounded + reqPerDay) / 10) * 10;
    const gaining = gw.requiredPerWeek >= 0;
    // the 7-day average sits right beside the minimum, coloured against it,
    // so "am I eating enough this week" is one glance
    const cal = calorieTracker();
    const wk = cal ? avgOverDays(cal.id, 7) : null;
    const avg7 = wk && wk.avg != null ? Math.round(wk.avg) : null;
    const avgCls = avg7 == null ? '' : (gaining ? avg7 >= aim : avg7 <= aim) ? ' st-good' : ' st-bad';
    card.append(el('div', { class: 'mt-aim' },
      el('div', { class: 'mt-aim-row' },
        el('span', { class: 'mt-aim-lab' }, gaining ? 'Minimum to reach goal' : 'Maximum to reach goal'),
        el('span', { class: 'mt-aim-val' }, `${n(aim)} ${unit}/day`)),
      el('div', { class: 'mt-aim-row' },
        el('span', { class: 'mt-aim-lab' }, '7-day average'),
        el('span', { class: 'mt-aim-val mt-aim-avg' + avgCls }, avg7 != null ? `${n(avg7)} ${unit}/day` : '—'))));
  }

  return card;
}

function buildInsight(t, p, rerender) {
  const unit = t.unit ? ` ${t.unit}` : '';
  const rate = ratePerWeek(t.id, 28);
  const cal = activeTrackers().find((x) => x.type === 'number' && x.name.toLowerCase() === 'calories');
  const intake = cal ? avgOverDays(cal.id, 28) : null;

  const bits = [];
  if (rate != null) bits.push(`trending ${signed(Math.round(rate * 10) / 10)}${unit}/wk`);
  if (intake) bits.push(`avg ${Math.round(intake.avg).toLocaleString()} ${cal.unit || ''}/day`.trimEnd());
  if (bits.length === 0) return null;

  let pace = null;
  let paceClass = '';
  if (rate != null && !p.done) {
    const remaining = p.target - p.current;
    if (Math.abs(rate) <= 0.05) {
      pace = 'weight holding steady';
    } else if (Math.sign(rate) === Math.sign(remaining)) {
      const daysTo = Math.round(remaining / (rate / 7));
      if (daysTo <= 730) {
        const when = addDays(todayISO(), daysTo);
        const opts = when.slice(0, 4) === todayISO().slice(0, 4)
          ? { month: 'short', day: 'numeric' }
          : { month: 'short', day: 'numeric', year: 'numeric' };
        pace = `on pace for ${fmtN(p.target)} by ${fmt(when, opts)}`;
        paceClass = ' pace-good';
      } else {
        pace = 'at this pace: over 2 years out';
      }
    } else {
      pace = 'trending away from the goal';
      paceClass = ' pace-bad';
    }
  }

  // adaptive TDEE + the goals→actions link: suggested intake, one tap to set
  let tdeeEl = null;
  const sug = /weight/i.test(t.name) ? suggestedIntake() : null;
  if (sug && sug.locked) {
    tdeeEl = el('div', { class: 'gc-tdee rp-dim' }, `Measured TDEE: ${sug.reason}.`);
  } else if (sug) {
    const mid = Math.round((sug.lo + sug.hi) / 2 / 10) * 10;
    const calT = calorieTracker();
    const cur = calT ? targetFor(calT, todayISO()) : null;
    // The suggestion is INFORMATION only. Targets are set in js/config.js,
    // not from the UI, so there is no "apply this" button — if the suggested
    // number differs from the configured one, say so and leave the change
    // to a config edit.
    const drifted = calT && (!cur || cur.period !== 'day' || Math.abs(cur.value - mid) > 50);
    tdeeEl = el('div', { class: 'gc-tdee' },
      el('div', {}, 'maintenance ≈ ', el('b', {}, `${Math.round(sug.tdee).toLocaleString()} ${sug.unit}`),
        el('span', { class: 'gc-window' }, ' measured from your logs, ±200')),
      el('div', {}, `suggested for this ${sug.phase === 'gain' ? 'bulk' : 'cut'}: `,
        el('b', {}, `${sug.lo.toLocaleString()}–${sug.hi.toLocaleString()} ${sug.unit}/day`)),
      drifted && el('div', { class: 'gc-window' },
        cur && cur.period === 'day'
          ? `your target is ${cur.value.toLocaleString()} — change it in config if you want ${mid.toLocaleString()}`
          : `no daily calorie target set — add one in config (${mid.toLocaleString()} suggested)`),
    );
  }

  return el('div', { class: 'gc-insight' },
    el('div', {}, bits.join(' · '), el('span', { class: 'gc-window' }, ' · last 28 days')),
    pace && el('div', { class: 'gc-pace' + paceClass }, pace),
    tdeeEl,
  );
}

function measurementSeries(id) {
  return Object.entries(getData().entries)
    .filter(([, day]) => typeof day[id] === 'number')
    .map(([iso, day]) => ({ iso, value: day[id] }))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
}


/* ================= Lifting pane ================= */

function liftingPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const counts = workoutCounts();

  if (counts.total === 0) {
    wrap.append(el('div', { class: 'empty-state' },
      'No workouts logged yet.', el('br'), 'Start one from the Day tab with “+ Log workout”.'));
    return wrap;
  }

  wrap.append(el('div', { class: 'stats-summary' },
    statTile(String(counts.total), 'workouts'),
    statTile(String(counts.thisMonth), 'this month'),
    ...SPLITS.map((s) => {
      const ds = daysSince(s);
      const sub = ds === null ? '—' : ds === 0 ? 'today' : `${ds}d ago`;
      return statTile(String(counts.bySplit[s] || 0), SPLIT_LABELS[s].toLowerCase(), sub, ds !== null && ds >= 7);
    }),
  ));

  // headline verdict: how many lifts are actually progressing
  const allStats = liftStats();
  const withTrend = allStats.filter((s) => s.trend != null);
  if (withTrend.length > 0) {
    const up = withTrend.filter((s) => s.trend === 'up').length;
    const stalledCount = allStats.filter((s) => s.stalled).length;
    const readyCount = allStats.filter((s) => s.ready).length;
    wrap.append(el('div', { class: 'card verdict-card' },
      el('b', {}, `${up} of ${withTrend.length} lift${withTrend.length === 1 ? '' : 's'} progressing`),
      el('span', { class: 'rp-dim' },
        readyCount > 0 ? ` · ${readyCount} ready to load` : '',
        stalledCount > 0 ? ` · ${stalledCount} stalled` : '',
      ),
    ));
  }

  // weekly training volume across all splits
  const weeks = weeklyVolume(8, null);
  if (weeks.some((w) => w.value > 0)) {
    wrap.append(el('div', { class: 'card chart-card' },
      el('div', { class: 'gc-head' },
        el('span', { class: 'gc-name' }, 'Weekly volume'),
        el('span', { class: 'att-desc' }, 'all splits'),
      ),
      barChart({
        bars: weeks.map((w) => ({ label: fmt(w.startISO, { month: 'short', day: 'numeric' }), value: w.value })),
        ariaLabel: 'Weekly lifted volume, last 8 weeks',
      }),
    ));
  }

  // session effort: average last-set RIR per workout — the honesty meter for
  // whether a flat e1RM means stalling (RIR ~1) or sandbagging (RIR 3–4).
  // Invisible until an RIR has ever been logged; filterable to one split.
  if (rirSeries(null).length) {
    const pts = rirSeries(rirSplit).map((p) => ({ iso: p.iso, value: p.value }));
    const segBtn = (label, val) => el('button', {
      class: 'seg-btn rir-btn',
      'aria-pressed': String(rirSplit === val),
      onclick: () => { rirSplit = val; rerender(); },
    }, label);
    wrap.append(el('div', { class: 'card chart-card' },
      el('div', { class: 'gc-head' },
        el('span', { class: 'gc-name' }, 'Effort'),
        el('span', { class: 'seg seg-mini', role: 'group', 'aria-label': 'Effort split filter' },
          segBtn('All', null), segBtn('Push', 'push'), segBtn('Pull', 'pull'), segBtn('Legs', 'legs')),
      ),
      pts.length >= 2
        ? lineChart({ points: pts, ariaLabel: 'Average last-set RIR per session' })
        : el('div', { class: 'rp-dim st-chart-note' }, 'chart appears after two sessions with RIR logged'),
      el('div', { class: 'ch-caption' }, 'session avg RIR · lower = closer to failure'),
    ));
  }

  // lifts grouped by PPL, each group collapsible — a flat list of every lift
  // is hard to scan, and you think in Push/Pull/Legs anyway
  for (const sp of SPLITS) {
    const stats = liftStats(sp);
    if (stats.length === 0) continue;
    const open = openSplit === sp;
    const ready = stats.filter((s) => s.ready).length;
    const stalled = stats.filter((s) => s.stalled).length;

    wrap.append(el('button', {
      class: 'pick-section lift-group' + (open ? ' open' : ''),
      'aria-expanded': String(open),
      onclick: () => { openSplit = open ? null : sp; rerender(); },
    },
    el('span', { class: 'lg-name' }, SPLIT_LABELS[sp]),
    el('span', { class: 'lg-meta rp-dim' },
      `${stats.length} lift${stats.length === 1 ? '' : 's'}`,
      ready > 0 ? ` · ${ready} ready` : '',
      stalled > 0 ? ` · ${stalled} stalled` : ''),
    el('span', { class: 'wo-chevron' }, open ? '⌄' : '›')));

    if (open) {
      const list = el('div', { class: 'stat-list' });
      for (const s of stats) list.append(liftRow(s, rerender));
      wrap.append(list);
    }
  }

  if (liftStats().length === 0) {
    wrap.append(el('div', { class: 'empty-state' }, 'No lifts logged yet.'));
  }
  return wrap;
}

function rpRowS(label, valueEl) {
  return el('div', { class: 'rp-row' },
    el('span', { class: 'rp-label' }, label),
    el('span', { class: 'rp-value' }, valueEl),
  );
}

/* ================= Coach pane ================= */

function coachPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const today = todayISO();

  // phase summary
  const wt = weightTracker();
  const band = wt ? rateBand(wt) : null;
  if (band) {
    // count weeks from the sprint start; a tracker goal is no longer required
    const sp = currentSprint();
    const from = (wt && wt.goal && wt.goal.from) || (sp && sp.start) || today;
    const weeksIn = Math.max(1, Math.ceil((Date.parse(today) - Date.parse(from)) / (7 * 86400000)));
    wrap.append(el('div', { class: 'card verdict-card' },
      el('b', {}, band.phase === 'gain' ? 'Lean bulk' : 'Cut'),
      el('span', { class: 'rp-dim' }, ` · week ${weeksIn} · pace band ${band.label}`),
    ));
  }

  // --- active guidance ---
  const active = el('div', { class: 'settings-section' }, el('h2', {}, 'Right now'));
  let anyActive = false;

  const report = weekReport(today);
  for (const sg of weekSuggestions(report)) {
    active.append(el('div', { class: 'card suggest-card' },
      el('div', { class: 'sg-text' }, sg.text),
      el('div', { class: 'sg-why' }, sg.why)));
    anyActive = true;
  }

  const stats = liftStats();
  const readyLifts = stats.filter((s) => s.ready);
  if (readyLifts.length > 0) {
    active.append(el('div', { class: 'card suggest-card' },
      el('div', { class: 'sg-text' },
        `Ready to add weight: ${readyLifts.map((s) => `${s.name} (try ${fmtN(s.ready.suggest)})`).join(', ')}.`),
      el('div', { class: 'sg-why' }, 'These hit the top of their rep range last session.')));
    anyActive = true;
  }
  for (const s of stats.filter((x) => x.stalled)) {
    active.append(el('div', { class: 'card rx-card' },
      el('div', { class: 'sg-text' }, `${s.name} has stalled — ${s.stalled.sessions} weight-day sessions without an e1RM PR.`),
      el('div', { class: 'sg-why' }, 'Open it in Lifting for the fix list: effort check → add a set → change range → deload.')));
    anyActive = true;
  }

  // Monthly progress-photo cadence: photos only earn their keep on a schedule.
  // Photos live in IndexedDB (async), so the card fills in after render; it
  // replaces the "nothing needs attention" line if that was showing.
  allPhotos().then((photos) => {
    const last = photos.length ? photos[photos.length - 1].date : null;
    if (last && last > addDays(today, -28)) return;   // fresh enough
    const es = active.querySelector('.empty-state');
    if (es) es.remove();
    active.append(el('div', { class: 'card suggest-card' },
      el('div', { class: 'sg-text' }, last
        ? `Monthly progress photo due — last one ${fmt(last, { month: 'short', day: 'numeric' })}.`
        : 'Take your first progress photo.'),
      el('div', { class: 'sg-why' }, 'Same lighting, front and side — + Photo on the Day view. Paired with the weight trend, it is how a bulk proves it is lean.')));
  }).catch(() => {});

  for (const sp of SPLITS) {
    const ds = daysSince(sp);
    if (ds != null && ds >= 7) {
      active.append(el('div', { class: 'card rx-card' },
        el('div', { class: 'sg-text' }, `${SPLIT_LABELS[sp]} hasn’t been trained in ${ds} days.`),
        el('div', { class: 'sg-why' }, 'Each muscle should be hit at least once — ideally twice — per week.')));
      anyActive = true;
    }
  }

  const sug = suggestedIntake();
  if (sug && sug.locked) {
    active.append(el('div', { class: 'settings-note' }, `Measured TDEE: ${sug.reason}.`));
    anyActive = true;
  } else if (sug) {
    active.append(el('div', { class: 'settings-note' },
      `Maintenance ≈ ${Math.round(sug.tdee).toLocaleString()} ${sug.unit} · aim ${sug.lo.toLocaleString()}–${sug.hi.toLocaleString()}/day (targets are set in config).`));
    anyActive = true;
  }

  if (!anyActive) active.append(el('div', { class: 'empty-state' }, 'Nothing needs attention — keep logging.'));
  wrap.append(active);

  // --- Ask Claude: on-device analysis with the user's own API key.
  // No key = NO section (not a pointer): an unused optional feature must be
  // invisible. Settings > Claude is the on-switch.
  const ai = askClaudeSection();
  if (ai) wrap.append(ai);

  // --- the plan: what this sprint is for, and how it is being run ---
  // Lives here rather than on Progress: Progress is the live scoreboard,
  // this is the standing reference for what the numbers are aiming at.
  const sprintNow = currentSprint();
  if (sprintNow) wrap.append(planSection(sprintReport(sprintNow), sprintNow));

  // --- reference cards ---
  const ref = el('div', { class: 'settings-section' }, el('h2', {}, 'Reference'));
  ref.append(
    refCard('Rep ranges', 'Strength lives at 1–6 reps with heavy loads; muscle grows anywhere from ~5–30 reps if sets approach failure. You train 8–15 across the board — weight days push load, volume days push sets.', repRangeDiagram()),
    refCard('Weekly volume', '10–20 hard sets per muscle per week is the productive band — most gains arrive by ~10, returns shrink past 20. Only sets within 0–4 reps of failure count.', volumeBandDiagram()),
    band && refCard('Gain rate', 'Faster gaining mostly adds fat: intermediates do best around +0.1–0.25% BW/week. The dashed marker is your chosen band.', rateBandDiagram(band)),
    refCard('Effort (reps in reserve)', 'A set counts when you stop 0–3 reps short of failure. Heavy compound sets: keep 2–3 in reserve — grinding true failure costs more than it gives.', rirDiagram()),
    refCard('When stuck', 'Diagnose in order: eating enough? → protein? → sleep? → missed sessions? Then: add a set, change the rep range, or deload one week at ~50% of sets. Change one thing at a time.', null),
    refCard('e1RM', 'Estimated 1RM (weight × (1 + reps/30)) tracks strength across rep counts — but only from sets of ≤15 reps. Higher-rep sets count toward volume, not strength trends.', null),
  );
  wrap.append(ref);

  return wrap;
}

// "Ask Claude" on the Coach pane: canned questions or free text, answered by
// claude-opus-5 against the same JSON the analysis export produces. Needs an
// API key (Settings); the reply survives tab switches within the session.
function askClaudeSection() {
  if (!hasClaudeKey()) return null;   // invisible until a key exists
  const sec = el('div', { class: 'settings-section' }, el('h2', {}, 'Ask Claude'));

  const out = el('div', { class: 'card ai-reply', hidden: true });
  const status = el('div', { class: 'settings-note ai-status', 'aria-live': 'polite' }, '');
  const qIn = el('textarea', {
    class: 'ai-q', rows: '2',
    placeholder: 'Ask anything about your data…',
    'aria-label': 'Question for Claude',
  });

  let busy = false;
  const run = async (question) => {
    if (busy || !question) return;
    busy = true;
    out.hidden = true;
    status.textContent = 'Thinking… (can take ~30s)';
    try {
      const r = await askClaude(question);
      out.textContent = r.text;
      out.hidden = false;
      status.textContent = r.usage
        ? `${(r.usage.input_tokens || 0).toLocaleString()} tokens in · ${(r.usage.output_tokens || 0).toLocaleString()} out`
        : '';
    } catch (e) {
      status.textContent = e && e.message ? e.message : 'Something went wrong.';
    }
    busy = false;
  };

  const chip = (label, q) => el('button', { class: 'chip chip-suggest', onclick: () => run(q) }, label);
  sec.append(
    el('div', { class: 'chips ai-chips' },
      chip('Weekly review', 'Review my last 7 days: weight trend vs goal pace, intake and protein vs targets, training done vs planned, and strength movement. End with the single highest-leverage fix for next week.'),
      chip('How’s the bulk?', 'Judge the bulk overall: is the weight-gain pace right, is it likely lean (use intake, protein, training consistency, and strength trends), and what would you change?'),
      chip('Fix one thing', 'Across everything in my data, what is the ONE thing most limiting my results right now? Make the case with my numbers, then give the concrete fix.'),
    ),
    qIn,
    el('div', { class: 'btn-row ai-ask-row' },
      el('button', { class: 'btn primary', onclick: () => run(qIn.value.trim()) }, 'Ask'),
    ),
    status,
    out,
  );

  // a reply from earlier in this session survives tab switches
  if (lastAsk) {
    out.textContent = lastAsk.text;
    out.hidden = false;
  }
  return sec;
}

function refCard(title, text, diagram) {
  return el('div', { class: 'card ref-card' },
    el('div', { class: 'gc-name' }, title),
    el('div', { class: 'ref-text' }, text),
    diagram,
  );
}

// --- tiny static diagrams (single hue, labels in ink tokens) ---

const DW = 320;
function diagramSvg(h, label) {
  return svgEl('svg', { viewBox: `0 0 ${DW} ${h}`, class: 'chart diagram', role: 'img', 'aria-label': label });
}

function axisX(v, max, pad = 14) {
  return pad + (DW - 2 * pad) * (v / max);
}

function repRangeDiagram() {
  const svg = diagramSvg(96, 'rep range zones');
  svg.append(svgEl('rect', { x: axisX(1, 30), y: 10, width: axisX(6, 30) - axisX(1, 30), height: 11, rx: 4, class: 'dg-strong' }));
  svg.append(svgEl('text', { x: axisX(6, 30) + 6, y: 20, class: 'ch-lab' }, 'strength 1–6'));
  svg.append(svgEl('rect', { x: axisX(5, 30), y: 28, width: axisX(30, 30) - axisX(5, 30), height: 11, rx: 4, class: 'dg-soft' }));
  svg.append(svgEl('text', { x: axisX(5, 30) + 8, y: 37, class: 'ch-lab dg-ink' }, 'hypertrophy 5–30 (near failure)'));
  const bracket = (lo, hi, y, label) => {
    const x1 = axisX(lo, 30);
    const x2 = axisX(hi, 30);
    svg.append(svgEl('line', { x1, y1: y, x2, y2: y, class: 'dg-marker' }));
    svg.append(svgEl('line', { x1, y1: y - 4, x2: x1, y2: y + 4, class: 'dg-marker' }));
    svg.append(svgEl('line', { x1: x2, y1: y - 4, x2, y2: y + 4, class: 'dg-marker' }));
    svg.append(svgEl('text', { x: x2 + 6, y: y + 3, class: 'ch-lab' }, label));
  };
  bracket(8, 15, 63, 'your range 8–15');
  svg.append(svgEl('text', { x: axisX(1, 30), y: 92, class: 'ch-lab' }, '1 rep'));
  svg.append(svgEl('text', { x: axisX(30, 30), y: 92, class: 'ch-lab ch-end' }, '30'));
  return svg;
}

function volumeBandDiagram() {
  const svg = diagramSvg(58, 'weekly volume zones');
  const zone = (lo, hi, cls) => svg.append(svgEl('rect', {
    x: axisX(lo, 25), y: 12, width: axisX(hi, 25) - axisX(lo, 25), height: 12, rx: 4, class: cls,
  }));
  zone(0, 10, 'dg-dim');
  zone(10, 20, 'dg-good');
  zone(20, 25, 'dg-dim');
  svg.append(svgEl('text', { x: axisX(5, 25), y: 40, class: 'ch-lab dg-center' }, 'too little'));
  svg.append(svgEl('text', { x: axisX(15, 25), y: 40, class: 'ch-lab dg-center dg-goodtext' }, '10–20 · aim 12–16'));
  svg.append(svgEl('text', { x: axisX(22.5, 25), y: 40, class: 'ch-lab dg-center' }, 'diminishing'));
  svg.append(svgEl('text', { x: axisX(0, 25), y: 54, class: 'ch-lab' }, '0'));
  svg.append(svgEl('text', { x: axisX(25, 25), y: 54, class: 'ch-lab ch-end' }, '25+ sets/muscle/wk'));
  return svg;
}

function rateBandDiagram(band) {
  const svg = diagramSvg(58, 'gain rate zones');
  const max = 0.6;
  const zone = (lo, hi, cls) => svg.append(svgEl('rect', {
    x: axisX(lo, max), y: 12, width: axisX(hi, max) - axisX(lo, max), height: 12, rx: 4, class: cls,
  }));
  zone(0.05, 0.15, 'dg-dim');
  zone(0.1, 0.25, 'dg-good');
  zone(0.25, 0.5, 'dg-warn');
  const lo = Math.abs(band.lo);
  const hi = Math.abs(band.hi);
  svg.append(svgEl('rect', {
    x: axisX(Math.min(lo, max), max), y: 8,
    width: Math.max(4, axisX(Math.min(hi, max), max) - axisX(Math.min(lo, max), max)), height: 20,
    class: 'dg-yours', rx: 4,
  }));
  svg.append(svgEl('text', { x: axisX(Math.min((lo + hi) / 2, max), max), y: 44, class: 'ch-lab dg-center dg-goodtext' }, 'your band'));
  svg.append(svgEl('text', { x: axisX(0, max), y: 54, class: 'ch-lab' }, '0'));
  svg.append(svgEl('text', { x: axisX(max, max), y: 54, class: 'ch-lab ch-end' }, '+0.6%/wk'));
  return svg;
}

function rirDiagram() {
  const svg = diagramSvg(64, 'reps in reserve scale');
  const labels = ['0', '1', '2', '3', '4', '5+'];
  labels.forEach((lab, i) => {
    const x = 14 + i * 40;
    svg.append(svgEl('rect', { x, y: 8, width: 32, height: 20, rx: 5, class: i <= 3 ? 'dg-good' : 'dg-dim' }));
    svg.append(svgEl('text', { x: x + 16, y: 22, class: 'ch-lab dg-center dg-ink' }, lab));
  });
  svg.append(svgEl('text', { x: 14 + 2 * 40, y: 44, class: 'ch-lab dg-center dg-goodtext' }, '0–3 = a hard set'));
  svg.append(svgEl('text', { x: 14 + 4.5 * 40 + 16, y: 44, class: 'ch-lab dg-center' }, "doesn't count"));
  svg.append(svgEl('text', { x: 14, y: 60, class: 'ch-lab' }, 'reps left in the tank when the set ends'));
  return svg;
}

function statTile(value, label, sub, subWarn) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'st-value' }, value),
    el('div', { class: 'st-label' }, label),
    sub != null && el('div', { class: 'st-sub' + (subWarn ? ' warn' : '') }, sub),
  );
}

function setStr(h) {
  const parts = [];
  if (h.weight != null) parts.push(h.weight.toLocaleString());
  if (h.reps != null) parts.push(String(h.reps));
  if (h.sets != null) parts.push(String(h.sets));
  // @N = reps in reserve on the last working set, when logged
  const rir = h.rir != null ? ` @${h.rir >= 4 ? '4+' : h.rir}` : '';
  return (parts.join(' × ') || '—') + rir;
}

function liftRow(s, rerender) {
  const key = s.name.toLowerCase();
  const expanded = expandedLift === key;
  const trend = s.trend;

  // collapsed rows stay slim: ONE metric plus state badges; the detail
  // (best/last/sessions/history) lives in the expansion
  const metaBits = [];
  if (s.trendInfo && s.trendInfo.cur != null) {
    metaBits.push(s.trendInfo.kind === 'e1rm'
      ? `e1RM ${fmtN(s.trendInfo.cur)}`
      : `vol ${Math.round(s.trendInfo.cur).toLocaleString()}`);
  } else {
    metaBits.push(`last ${setStr(s.last)}`);
  }

  const main = el('span', { class: 'sr-main' },
    el('span', { class: 'sr-name' },
      s.name,
      trend && el('span', { class: `trend ${trend}` }, trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'),
      s.last.isPR && el('span', { class: 'pr-star', title: 'New e1RM PR' }, '★'),
      s.ready && el('span', { class: 'b-badge b-ready' }, 'ready to load'),
      s.stalled && el('span', { class: 'b-badge b-stall' }, 'stalled'),
    ),
    el('span', { class: 'sr-meta' },
      metaBits.join(' · '),
      s.goal && el('span', { class: 'sr-goal' }, `  ·  goal ${fmtN(s.goal.target)}${s.goalPct != null ? ` · ${Math.round(s.goalPct * 100)}%` : ''}`),
    ),
  );
  if (s.goal && s.goalPct != null) {
    const fill = el('i', { class: 'goal-fill' });
    fill.style.width = Math.round(s.goalPct * 100) + '%';
    main.append(el('span', { class: 'wt-bar gc-bar' }, fill));
  }

  const row = el('button', {
    class: 'stat-row' + (expanded ? ' open' : ''),
    'aria-expanded': String(expanded),
    onclick: () => { expandedLift = expanded ? null : key; rerender(); },
  }, main, el('span', { class: 'wo-chevron' }, expanded ? '⌄' : '›'));

  if (!expanded) return row;

  // PR goal — READ ONLY. Lift goals are configured in js/sprints.js
  // (SPRINTS[].goals.lifts), not set from the UI.
  const goalRow = s.goal
    ? el('div', { class: 'sr-goalrow' },
      el('span', { class: 'sr-goallabel' }, 'PR goal'),
      el('span', { class: 'sr-goalval' }, `${s.goal.target}${s.unit ? ` ${s.unit}` : ''}`))
    : null;

  // Rep range is fixed at 8–15 for every lift (REP_RANGE in workouts.js) —
  // no per-lift editor. Shown read-only so the progression rule is visible.
  const range = repRange();
  const rangeRow = el('div', { class: 'sr-goalrow' },
    el('span', { class: 'sr-goallabel' }, 'Rep range'),
    el('span', { class: 'sr-goalval' }, `${range.lo}–${range.hi}`));

  const history = el('div', { class: 'sr-history' }, goalRow, rangeRow);

  if (s.ready) {
    history.append(el('div', { class: 'rx-card rx-good' },
      el('div', { class: 'sg-text' }, `All reps at the top of the range — add weight: try ${fmtN(s.ready.suggest)}.`),
      el('div', { class: 'sg-why' }, 'Double progression: fill the rep range, add ~2.5–5%, reset to the bottom.'),
    ));
  }

  if (s.stalled) {
    history.append(el('div', { class: 'rx-card' },
      el('div', { class: 'sg-text' }, `Stalled: no e1RM PR in the last ${s.stalled.sessions} weight-day sessions (${s.stalled.spanDays} days).`),
      el('div', { class: 'sg-why' },
        '1. Check effort — hard sets should end 0–3 reps from failure. ',
        '2. Add a set to this lift for 2–3 weeks. ',
        '3. Or change the rep range for a block. ',
        '4. Still stuck: deload a week at ~50% of sets, then retest.'),
    ));
  }

  // e1RM works across day types, so one line tells the strength story
  const e1rmPoints = s.history
    .filter((h) => h.e1rm != null)
    .map((h) => ({ iso: h.date, value: Math.round(h.e1rm * 10) / 10 }));
  if (e1rmPoints.length >= 2) {
    history.append(
      el('div', { class: 'ch-caption' }, 'estimated 1RM over time'),
      lineChart({ points: e1rmPoints, ariaLabel: `${s.name} estimated 1RM over time` }),
    );
  }

  history.append(el('div', { class: 'sr-detail' },
    s.best && s.best.weight != null ? `best ${s.best.weight.toLocaleString()}${s.best.reps != null ? ' × ' + s.best.reps : ''} · ` : '',
    `last ${setStr(s.last)} · ${s.sessions} session${s.sessions === 1 ? '' : 's'}`,
  ));

  for (const h of [...s.history].reverse()) {
    history.append(el('div', { class: 'sr-hrow' },
      el('span', { class: 'sr-hdate' }, fmt(h.date, { month: 'short', day: 'numeric' })),
      el('span', { class: 'sr-hclass' }, `${SPLIT_LABELS[h.split]} · ${FOCUS_LABELS[h.focus]}`),
      el('span', { class: 'sr-hset' }, h.isPR && el('span', { class: 'pr-star' }, '★ '), setStr(h)),
    ));
  }
  return el('div', { class: 'stat-block' }, row, history);
}
