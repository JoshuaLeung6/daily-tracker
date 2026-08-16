// Progress — two panes:
//   Goals: destination goals (reach a number, e.g. body weight) and
//          target attainment (streaks, bests, 30-day hit rate, dot strips)
//   Lifting: workout counts and per-lift stats with PR goals.

import { el } from '../ui.js';
import { fmt, todayISO, addDays, startOfWeek } from '../dates.js';
import { getEntry, getData } from '../store.js';
import {
  activeTrackers, allTrackers, addTracker, targetFor,
  dayMeets, weekMeets, streakFor, weekStreakFor,
  longestStreak, longestWeekStreak, adherence, weekAdherence, dotStrip,
  setGoal, clearGoal, goalProgress, latestValue, ratePerWeek, avgOverDays,
} from '../trackers.js';
import {
  SPLITS, SPLIT_LABELS, FOCUS_LABELS, workoutCounts, liftStats,
  liftGoal, setLiftGoal, weeklyVolume, daysSince,
  repRange, setRepRange,
} from '../workouts.js';
import { setTarget } from '../trackers.js';
import {
  suggestedIntake, calorieTracker, PACE_PRESETS,
  weightTracker, rateBand, weekReport, weekSuggestions,
} from '../insights.js';
import { lineChart, barChart, svgEl } from '../charts.js';
import { SPRINTS, sprintReport, currentSprint } from '../sprints.js';
import { liftingSessionTarget } from '../insights.js';

let pane = 'goals';
let filterSplit = null;
let expandedLift = null;
let editingGoalId = null; // tracker id, '__new__', or null

const fmtN = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const signed = (n) => `${n > 0 ? '+' : ''}${fmtN(n)}`;

export function render(container, ctx) {
  const rerender = () => render(container, ctx);

  const TITLES = { goals: 'Goals', lifting: 'Lifting', sprint: 'Sprint', coach: 'Coach' };
  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'Progress'),
      el('h1', {}, TITLES[pane]),
    ),
    el('span'),
  );

  const paneSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Progress section' },
    ...['goals', 'lifting', 'sprint', 'coach'].map((p) => el('button', {
      class: 'seg-btn', 'aria-pressed': String(pane === p),
      onclick: () => { pane = p; rerender(); },
    }, TITLES[p])),
  );

  const paneEl = pane === 'goals' ? goalsPane(rerender)
    : pane === 'lifting' ? liftingPane(rerender)
    : pane === 'sprint' ? sprintPane(rerender)
    : coachPane(rerender);
  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), paneSeg, paneEl);
}

/* ================= Goals pane ================= */

function goalsPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const withGoals = activeTrackers().filter((t) => t.goal);

  const goalSection = el('div', { class: 'settings-section' }, el('h2', {}, 'Goals'));
  for (const t of withGoals) goalSection.append(goalCard(t, rerender));
  if (withGoals.length === 0) {
    goalSection.append(el('div', { class: 'empty-state' }, 'No goal set yet — ask Claude to set one up.'));
  }
  wrap.append(goalSection);

  const withTargets = activeTrackers()
    .map((t) => ({ t, tgt: targetFor(t, todayISO()) }))
    .filter((x) => x.tgt);
  const attSection = el('div', { class: 'settings-section' }, el('h2', {}, 'Target attainment'));
  if (withTargets.length === 0) {
    attSection.append(el('div', { class: 'empty-state' }, 'No targets set. Add one from a tracker’s ✎ in Settings.'));
  }
  for (const { t, tgt } of withTargets) attSection.append(attainmentCard(t, tgt));
  wrap.append(attSection);

  return wrap;
}

function goalCard(t, rerender) {
  const p = goalProgress(t);
  const unit = t.unit ? ` ${t.unit}` : '';

  let status;
  if (p.done) status = 'Goal reached';
  else if (p.deadline) {
    status = p.daysLeft > 0
      ? `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left · needs ${signed(p.pacePerWeek)}${unit}/wk`
      : `deadline passed · ${fmtN(Math.abs(p.remaining))}${unit} to go`;
  } else status = `${fmtN(Math.abs(p.remaining))}${unit} to go`;

  const fill = el('i', { class: 'goal-fill' });
  fill.style.width = Math.round(p.pct * 100) + '%';

  const card = el('div', { class: 'card goal-card' },
    el('div', { class: 'gc-head' },
      el('span', { class: 'gc-name' }, t.name),
      rateBand(t) ? el('span', { class: 'att-desc' }, `pace ${rateBand(t).label}`) : null,
    ),
    el('div', { class: 'gc-route' },
      `${fmtN(p.startValue)} → ${fmtN(p.target)}${unit}`,
      el('span', { class: 'gc-now' },
        p.currentDate ? ` · now ${fmtN(p.current)} (${signed(p.change)})` : ' · nothing logged yet'),
    ),
    el('div', { class: 'wt-bar gc-bar' }, fill),
    el('div', { class: 'gc-status' + (p.done ? ' done' : '') }, status),
  );

  // intake <-> weight insight: trend rate, calorie average, pace projection
  const insight = buildInsight(t, p, rerender);
  if (insight) card.append(insight);

  // trendline of every logged measurement, with the goal as a reference line
  const series = measurementSeries(t.id);
  if (series.length >= 2) {
    card.append(lineChart({
      points: series,
      goal: { value: p.target, label: `goal ${fmtN(p.target)}` },
      unit: t.unit || '',
      ariaLabel: `${t.name} over time`,
    }));
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
    const showBtn = calT && (!cur || cur.period !== 'day' || Math.abs(cur.value - mid) > 50);
    tdeeEl = el('div', { class: 'gc-tdee' },
      el('div', {}, 'maintenance ≈ ', el('b', {}, `${Math.round(sug.tdee).toLocaleString()} ${sug.unit}`),
        el('span', { class: 'gc-window' }, ' measured from your logs, ±200')),
      el('div', {}, `suggested for this ${sug.phase === 'gain' ? 'bulk' : 'cut'}: `,
        el('b', {}, `${sug.lo.toLocaleString()}–${sug.hi.toLocaleString()} ${sug.unit}/day`)),
      showBtn && el('button', {
        class: 'btn primary gc-setbtn',
        onclick: () => {
          setTarget(calT.id, { value: mid, period: 'day', dir: sug.phase === 'gain' ? 'atleast' : 'atmost' });
          rerender();
        },
      }, `Set ${mid.toLocaleString()} ${sug.unit}/day as my calorie target`),
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

function goalForm(t, rerender) {
  // destination goals apply to measurements (weight, body fat, …), not
  // to daily amounts like calories — those use recurring targets instead
  const measurements = activeTrackers().filter((x) => x.type === 'measurement');
  const eligible = t ? [t] : measurements.filter((x) => !x.goal);
  const hasWeightTracker = allTrackers().some((x) => x.name.toLowerCase() === 'weight');

  if (!t && eligible.length === 0 && hasWeightTracker) {
    return el('div', { class: 'tracker-row' },
      el('div', { class: 'tr-edit' },
        el('div', { class: 'settings-note' },
          'Every measurement tracker already has a goal. Add a new measurement tracker in Settings first (type: Measurement).'),
        el('button', { class: 'btn', onclick: () => { editingGoalId = null; rerender(); } }, 'Close'),
      ),
    );
  }

  const trackerSel = el('select', { 'aria-label': 'Goal tracker' },
    ...eligible.map((x) => el('option', { value: x.id }, x.name)),
    !t && !hasWeightTracker && el('option', { value: '__new_weight__' }, '＋ New “Weight” tracker'),
  );
  if (t) trackerSel.disabled = true;

  const startInput = el('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Starting value' });
  const targetInput = el('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Goal target' });
  const deadlineInput = el('input', { type: 'date', 'aria-label': 'Deadline (optional)' });
  const paceSel = el('select', { 'aria-label': 'Pace' },
    el('option', { value: 'conservative' }, 'Conservative'),
    el('option', { value: 'standard' }, 'Standard (recommended)'),
    el('option', { value: 'aggressive' }, 'Aggressive'),
  );
  paceSel.value = 'standard';
  if (t && t.goal && t.goal.band) {
    for (const phase of ['gain', 'loss']) {
      for (const [key, preset] of Object.entries(PACE_PRESETS[phase])) {
        if (preset.lo === t.goal.band.lo && preset.hi === t.goal.band.hi) paceSel.value = key;
      }
    }
  }

  const prefillStart = () => {
    if (t && t.goal) { startInput.value = String(t.goal.startValue); return; }
    const id = trackerSel.value;
    if (id === '__new_weight__') { startInput.value = ''; return; }
    const latest = latestValue(id);
    startInput.value = latest ? String(latest.value) : '';
  };
  prefillStart();
  trackerSel.addEventListener('change', prefillStart);
  if (t && t.goal) {
    targetInput.value = String(t.goal.target);
    if (t.goal.deadline) deadlineInput.value = t.goal.deadline;
  }

  const save = () => {
    const start = parseFloat(startInput.value.replace(',', '.'));
    const target = parseFloat(targetInput.value.replace(',', '.'));
    if (!Number.isFinite(start) || !Number.isFinite(target)) { alert('Enter a starting value and a target.'); return; }
    if (start === target) { alert('Target must differ from the starting value.'); return; }
    let id = t ? t.id : trackerSel.value;
    if (id === '__new_weight__') id = addTracker({ name: 'Weight', type: 'measurement', unit: 'lb' }).id;
    const preset = PACE_PRESETS[target > start ? 'gain' : 'loss'][paceSel.value];
    setGoal(id, {
      startValue: start, target, deadline: deadlineInput.value || null,
      band: preset ? { lo: preset.lo, hi: preset.hi } : null,
    });
    editingGoalId = null;
    rerender();
  };

  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-edit' },
      el('div', { class: 'field' }, el('label', {}, 'Tracker'), trackerSel),
      el('div', { class: 'field' }, el('label', {}, 'Starting value'), startInput),
      el('div', { class: 'field' }, el('label', {}, 'Target'), targetInput),
      el('div', { class: 'field' }, el('label', {}, 'Pace (weight goals)'), paceSel),
      el('div', { class: 'field' }, el('label', {}, 'By date (optional)'), deadlineInput),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', onclick: save }, 'Save goal'),
        el('button', { class: 'btn', onclick: () => { editingGoalId = null; rerender(); } }, 'Cancel'),
      ),
      t && t.goal && el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn danger',
          onclick: () => {
            if (confirm(`Remove the ${t.name} goal?`)) { clearGoal(t.id); editingGoalId = null; rerender(); }
          },
        }, 'Remove goal'),
      ),
    ),
  );
}

function attainmentCard(t, tgt) {
  const unit = t.unit ? ` ${t.unit}` : '';
  const today = todayISO();

  if (tgt.period === 'day') {
    let desc;
    if (t.type === 'number') desc = `${tgt.dir === 'atmost' ? '≤' : '≥'} ${fmtN(tgt.value)}${unit}/day`;
    else if (t.type === 'multiselect' && tgt.value > 1) desc = `${tgt.value} per day`;
    else desc = 'every day';
    const metToday = dayMeets(t, today);
    const adh = adherence(t, 30);

    const strip = el('div', { class: 'dstrip', 'aria-label': 'Last 14 days' });
    for (const d of dotStrip(t, 14)) strip.append(el('i', { class: d.state }));

    return el('div', { class: 'card att-card' },
      el('div', { class: 'gc-head' },
        el('span', { class: 'gc-name' }, t.name),
        el('span', { class: 'att-desc met-day-text' + (metToday ? ' on' : '') }, desc),
      ),
      el('div', { class: 'att-stats' },
        attStat(String(streakFor(t, today)), 'streak', metToday && 'met-day-text on'),
        attStat(String(longestStreak(t)), 'best'),
        attStat(`${adh.hit}/${adh.of}`, 'last 30 days'),
      ),
      strip,
    );
  }

  // weekly target
  const ws = startOfWeek(today);
  let current = 0;
  if (t.type === 'number') {
    for (let i = 0; i < 7; i++) {
      const v = getEntry(addDays(ws, i))[t.id];
      if (typeof v === 'number') current += v;
    }
  } else {
    for (let i = 0; i < 7; i++) if (t.id in getEntry(addDays(ws, i))) current++;
  }
  const met = weekMeets(t, ws);
  const adh = weekAdherence(t, 8);
  const desc = t.type === 'number'
    ? `${tgt.dir === 'atmost' ? '≤' : '≥'} ${fmtN(tgt.value)}${unit}/week`
    : `${tgt.value} days/week`;

  return el('div', { class: 'card att-card' },
    el('div', { class: 'gc-head' },
      el('span', { class: 'gc-name' }, t.name),
      el('span', { class: 'att-desc met-week-text' + (met ? ' on' : '') }, desc),
    ),
    el('div', { class: 'att-stats' },
      attStat(t.type === 'number' ? fmtN(current) : `${current}/${tgt.value}`, 'this week', met && 'met-week-text on'),
      attStat(`${weekStreakFor(t, today)}`, 'week streak'),
      attStat(`${longestWeekStreak(t)}`, 'best'),
      attStat(`${adh.hit}/${adh.of}`, 'last 8 weeks'),
    ),
  );
}

function attStat(value, label, extraClass) {
  return el('div', { class: 'as' },
    el('div', { class: 'as-v' + (extraClass ? ' ' + extraClass : '') }, value),
    el('div', { class: 'as-l' }, label),
  );
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

  wrap.append(el('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by split' },
    el('button', {
      class: 'seg-btn', 'aria-pressed': String(filterSplit === null),
      onclick: () => { filterSplit = null; rerender(); },
    }, 'All'),
    ...SPLITS.map((s) => el('button', {
      class: 'seg-btn', 'aria-pressed': String(filterSplit === s),
      onclick: () => { filterSplit = s; rerender(); },
    }, SPLIT_LABELS[s])),
  ));

  // weekly training volume (respects the split filter)
  const weeks = weeklyVolume(8, filterSplit);
  if (weeks.some((w) => w.value > 0)) {
    wrap.append(el('div', { class: 'card chart-card' },
      el('div', { class: 'gc-head' },
        el('span', { class: 'gc-name' }, 'Weekly volume'),
        el('span', { class: 'att-desc' }, filterSplit ? SPLIT_LABELS[filterSplit] : 'all splits'),
      ),
      barChart({
        bars: weeks.map((w) => ({ label: fmt(w.startISO, { month: 'short', day: 'numeric' }), value: w.value })),
        ariaLabel: 'Weekly lifted volume, last 8 weeks',
      }),
    ));
  }

  const stats = liftStats(filterSplit);
  const list = el('div', { class: 'stat-list' });
  for (const s of stats) list.append(liftRow(s, rerender));
  if (stats.length === 0) {
    list.append(el('div', { class: 'empty-state' }, `No ${SPLIT_LABELS[filterSplit]} lifts logged yet.`));
  }
  wrap.append(list);
  return wrap;
}

/* ================= Sprint pane ================= */

function sprintPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const sprint = currentSprint();
  if (!sprint) {
    wrap.append(el('div', { class: 'empty-state' }, 'The sprint starts with your first logged day — log something to begin.'));
    return wrap;
  }
  const r = sprintReport(sprint);
  const wt = weightTracker();
  const unit = wt && wt.unit ? ` ${wt.unit}` : '';

  // header: name, dates, progress bar through the sprint
  const pct = Math.round((r.elapsed / r.totalDays) * 100);
  const fill = el('i', { class: 'goal-fill' });
  fill.style.width = pct + '%';
  wrap.append(el('div', { class: 'card goal-card' },
    el('div', { class: 'gc-head' },
      el('span', { class: 'gc-name' }, r.name),
      el('span', { class: 'att-desc' }, r.focus),
    ),
    el('div', { class: 'gc-route' }, `${fmt(r.start.iso, { month: 'short', day: 'numeric' })} → ${fmt(r.end, { month: 'short', day: 'numeric' })}`),
    el('div', { class: 'wt-bar gc-bar' }, fill),
    el('div', { class: 'gc-status' + (r.done ? ' done' : '') },
      r.done ? 'Sprint complete' : `day ${r.elapsed} of ${r.totalDays} · ${r.remaining} days left`),
  ));

  // sprint goal: weight target with required vs current pace
  const gw = r.goals && r.goals.weight;
  if (gw) {
    const gfill = el('i', { class: 'goal-fill' });
    gfill.style.width = Math.round(gw.pct * 100) + '%';
    let paceLine;
    if (gw.done) paceLine = el('div', { class: 'gc-pace pace-good' }, 'Sprint goal reached');
    else if (r.done) paceLine = el('div', { class: 'gc-pace' }, `finished ${fmtN(Math.abs(gw.toGo))}${unit} ${gw.toGo > 0 ? 'short of' : 'past'} the target`);
    else if (gw.requiredPerWeek != null) {
      const req = gw.requiredPerWeek;
      const cur = gw.currentPerWeek;
      const onPace = cur != null && (req >= 0 ? cur >= req * 0.9 : cur <= req * 0.9);
      paceLine = el('div', { class: 'gc-pace' + (cur == null ? '' : onPace ? ' pace-good' : ' pace-bad') },
        `needs ${req > 0 ? '+' : ''}${fmtN(req)}${unit}/wk from here`,
        cur != null ? ` · trending ${cur > 0 ? '+' : ''}${fmtN(Math.round(cur * 10) / 10)}${unit}/wk` : ' · trend needs more weigh-ins',
        cur != null ? (onPace ? ' · on pace' : ' · behind pace') : '');
    }
    wrap.append(el('div', { class: 'card goal-card' },
      el('div', { class: 'gc-head' },
        el('span', { class: 'gc-name' }, 'Sprint goal'),
        el('span', { class: 'att-desc' }, `by ${fmt(r.end, { month: 'short', day: 'numeric' })}`),
      ),
      el('div', { class: 'gc-route' },
        `${gw.startValue != null ? fmtN(gw.startValue) : '?'} → ${fmtN(gw.target)}${unit}`,
        el('span', { class: 'gc-now' }, ` · now ${fmtN(gw.current)} · ${fmtN(Math.abs(gw.toGo))}${unit} to go`),
      ),
      el('div', { class: 'wt-bar gc-bar' }, gfill),
      paceLine,
    ));
  }

  // start vs now (vs target) comparison
  const cmp = el('div', { class: 'card report-card' });
  const nowLabel = r.done ? 'End' : 'Now';
  const hasTargets = Boolean(gw) || (r.goals && r.goals.lifts.length > 0);
  const cols = hasTargets ? 'rp-cols rp-cols-4' : 'rp-cols';
  cmp.append(el('div', { class: 'rp-row rp-headrow' },
    el('span', { class: 'rp-label' }, ''),
    el('span', { class: 'rp-value ' + cols },
      el('span', {}, 'Start'), el('span', {}, nowLabel), el('span', {}, 'Δ'),
      hasTargets ? el('span', {}, 'Target') : null),
  ));
  const cmpRow = (label, a, b, fmtV, unitStr = '', target = null) => {
    const delta = a != null && b != null ? b - a : null;
    cmp.append(el('div', { class: 'rp-row' },
      el('span', { class: 'rp-label' }, label),
      el('span', { class: 'rp-value ' + cols },
        el('span', {}, a != null ? fmtV(a) + unitStr : '—'),
        el('b', {}, b != null ? fmtV(b) + unitStr : '—'),
        el('span', { class: delta != null && delta !== 0 ? (delta > 0 ? 'met-day-text on' : 'rp-dim') : 'rp-dim' },
          delta != null ? `${delta > 0 ? '+' : ''}${fmtV(delta)}` : '—'),
        hasTargets ? el('span', { class: target != null && b != null && b >= target ? 'met-day-text on' : 'rp-dim' },
          target != null ? fmtV(target) : '—') : null,
      ),
    ));
  };
  if (wt) cmpRow('Weight', r.start.weight, r.now.weight, fmtN, unit, gw ? gw.target : null);
  const liftTargets = new Map((r.goals ? r.goals.lifts : []).map((l) => [l.name.toLowerCase(), l.target]));
  for (const l of r.lifts.slice(0, 8)) cmpRow(l.name, l.first, l.latest, (v) => fmtN(v), '', liftTargets.get(l.name.toLowerCase()) ?? null);
  wrap.append(el('div', { class: 'settings-section' }, el('h2', {}, 'Start vs ' + nowLabel.toLowerCase()), cmp));
  if (r.lifts.length > 0) {
    wrap.append(el('div', { class: 'settings-note' }, 'Lifts show estimated 1RM: first session of the sprint vs latest.'));
  }

  // sprint totals
  const t = r.totals;
  const tot = el('div', { class: 'card report-card' });
  const target = liftingSessionTarget();
  tot.append(rpRowS('Workouts', el('span', {},
    el('b', {}, String(t.workouts)),
    ` · ${r.sessionsPerWeek.toFixed(1)}/wk`,
    el('span', { class: 'rp-dim' }, ` (target ${target})`),
    ' · ', SPLITS.filter((s) => t.bySplit[s]).map((s) => `${SPLIT_LABELS[s]} ${t.bySplit[s]}`).join(' · '),
  )));
  tot.append(rpRowS('PRs', el('span', {}, el('b', { class: 'pr-star' }, `★ ${t.prs}`))));
  tot.append(rpRowS('Logged', el('span', {}, el('b', {}, `${t.adherence.logged}/${r.elapsed}`), ' days')));
  if (t.calAvg != null) {
    tot.append(rpRowS('Calories', el('span', {},
      el('b', {}, Math.round(t.calAvg).toLocaleString()), ' avg',
      t.adherence.calOf > 0 ? el('span', { class: 'rp-dim' }, ` · ${t.adherence.calHit}/${t.adherence.calOf} on target`) : null)));
  }
  if (t.adherence.proOf > 0) {
    tot.append(rpRowS('Protein', el('span', {}, el('b', {}, `${t.adherence.proHit}/${t.adherence.proOf}`), ' days on target')));
  }
  wrap.append(el('div', { class: 'settings-section' }, el('h2', {}, r.done ? 'Sprint totals' : 'So far'), tot));

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
  if (band && wt.goal) {
    const weeksIn = Math.max(1, Math.ceil((Date.parse(today) - Date.parse(wt.goal.from)) / (7 * 86400000)));
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
      `Maintenance ≈ ${Math.round(sug.tdee).toLocaleString()} ${sug.unit} · aim ${sug.lo.toLocaleString()}–${sug.hi.toLocaleString()}/day (set it from the Goals pane).`));
    anyActive = true;
  }

  if (!anyActive) active.append(el('div', { class: 'empty-state' }, 'Nothing needs attention — keep logging.'));
  wrap.append(active);

  // --- reference cards ---
  const ref = el('div', { class: 'settings-section' }, el('h2', {}, 'Reference'));
  ref.append(
    refCard('Rep ranges', 'Strength lives at 1–6 reps with heavy loads; muscle grows anywhere from ~5–30 reps if sets approach failure. Your weight days sit at 3–6, volume days at 8–15.', repRangeDiagram()),
    refCard('Weekly volume', '10–20 hard sets per muscle per week is the productive band — most gains arrive by ~10, returns shrink past 20. Only sets within 0–4 reps of failure count.', volumeBandDiagram()),
    band && refCard('Gain rate', 'Faster gaining mostly adds fat: intermediates do best around +0.1–0.25% BW/week. The dashed marker is your chosen band.', rateBandDiagram(band)),
    refCard('Effort (reps in reserve)', 'A set counts when you stop 0–3 reps short of failure. Heavy compound sets: keep 2–3 in reserve — grinding true failure costs more than it gives.', rirDiagram()),
    refCard('When stuck', 'Diagnose in order: eating enough? → protein? → sleep? → missed sessions? Then: add a set, change the rep range, or deload one week at ~50% of sets. Change one thing at a time.', null),
    refCard('e1RM', 'Estimated 1RM (weight × (1 + reps/30)) tracks strength across rep counts — but only from sets of ≤10 reps. High-rep sets count toward volume, not strength trends.', null),
  );
  wrap.append(ref);

  return wrap;
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
  bracket(3, 6, 54, 'weight day 3–6');
  bracket(8, 15, 72, 'volume day 8–15');
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
  return parts.join(' × ') || '—';
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

  // PR goal editor
  const goalInput = el('input', {
    type: 'text', inputmode: 'decimal', 'aria-label': `${s.name} goal weight`,
    placeholder: 'e.g. 225',
    value: s.goal ? String(s.goal.target) : '',
  });
  goalInput.addEventListener('click', (e) => e.stopPropagation());
  const goalRow = el('div', { class: 'sr-goalrow' },
    el('span', { class: 'sr-goallabel' }, 'PR goal'),
    goalInput,
    el('button', {
      class: 'btn primary sr-goalbtn',
      onclick: () => {
        const v = parseFloat(goalInput.value.replace(',', '.'));
        setLiftGoal(s.name, Number.isFinite(v) && v > 0 ? v : null);
        rerender();
      },
    }, 'Save'),
    s.goal && el('button', {
      class: 'btn danger sr-goalbtn',
      onclick: () => { setLiftGoal(s.name, null); rerender(); },
    }, '✕'),
  );

  // rep-range editor (double progression)
  const range = repRange(s.name, s.last.focus);
  const loIn = el('input', { type: 'text', class: 'rep-in', inputmode: 'numeric', 'aria-label': `${s.name} rep range low`, value: String(range.lo) });
  const hiIn = el('input', { type: 'text', class: 'rep-in', inputmode: 'numeric', 'aria-label': `${s.name} rep range high`, value: String(range.hi) });
  const rangeRow = el('div', { class: 'sr-goalrow' },
    el('span', { class: 'sr-goallabel' }, 'Rep range'),
    loIn, el('span', { class: 'rp-dim' }, '–'), hiIn,
    el('button', {
      class: 'btn primary sr-goalbtn',
      onclick: () => {
        const lo = parseInt(loIn.value, 10);
        const hi = parseInt(hiIn.value, 10);
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 1 && hi > lo) setRepRange(s.name, lo, hi);
        else setRepRange(s.name, null, null);
        rerender();
      },
    }, 'Save'),
    range.custom && el('span', { class: 'pick-hint' }, 'custom'),
  );

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
