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
  setGoal, clearGoal, goalProgress, latestValue,
} from '../trackers.js';
import {
  SPLITS, SPLIT_LABELS, FOCUS_LABELS, workoutCounts, liftStats,
  liftGoal, setLiftGoal, weeklyVolume,
} from '../workouts.js';
import { lineChart, barChart } from '../charts.js';

let pane = 'goals';
let filterSplit = null;
let expandedLift = null;
let editingGoalId = null; // tracker id, '__new__', or null

const fmtN = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const signed = (n) => `${n > 0 ? '+' : ''}${fmtN(n)}`;

export function render(container, ctx) {
  const rerender = () => render(container, ctx);

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'Progress'),
      el('h1', {}, pane === 'goals' ? 'Goals' : 'Lifting'),
    ),
    el('span'),
  );

  const paneSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Progress section' },
    el('button', {
      class: 'seg-btn', 'aria-pressed': String(pane === 'goals'),
      onclick: () => { pane = 'goals'; rerender(); },
    }, 'Goals'),
    el('button', {
      class: 'seg-btn', 'aria-pressed': String(pane === 'lifting'),
      onclick: () => { pane = 'lifting'; rerender(); },
    }, 'Lifting'),
  );

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), paneSeg,
    pane === 'goals' ? goalsPane(rerender) : liftingPane(rerender));
}

/* ================= Goals pane ================= */

function goalsPane(rerender) {
  const wrap = el('div', { class: 'pane' });
  const withGoals = activeTrackers().filter((t) => t.goal);

  const goalSection = el('div', { class: 'settings-section' }, el('h2', {}, 'Goals'));
  for (const t of withGoals) {
    goalSection.append(editingGoalId === t.id ? goalForm(t, rerender) : goalCard(t, rerender));
  }
  if (editingGoalId === '__new__') goalSection.append(goalForm(null, rerender));
  else {
    goalSection.append(el('button', {
      class: 'ghost-btn',
      onclick: () => { editingGoalId = '__new__'; rerender(); },
    }, '+ Add goal'));
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
      el('button', {
        class: 'icon-btn', 'aria-label': `Edit ${t.name} goal`,
        onclick: () => { editingGoalId = t.id; rerender(); },
      }, '✎'),
    ),
    el('div', { class: 'gc-route' },
      `${fmtN(p.startValue)} → ${fmtN(p.target)}${unit}`,
      el('span', { class: 'gc-now' },
        p.currentDate ? ` · now ${fmtN(p.current)} (${signed(p.change)})` : ' · nothing logged yet'),
    ),
    el('div', { class: 'wt-bar gc-bar' }, fill),
    el('div', { class: 'gc-status' + (p.done ? ' done' : '') }, status),
  );

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
    setGoal(id, { startValue: start, target, deadline: deadlineInput.value || null });
    editingGoalId = null;
    rerender();
  };

  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-edit' },
      el('div', { class: 'field' }, el('label', {}, 'Tracker'), trackerSel),
      el('div', { class: 'field' }, el('label', {}, 'Starting value'), startInput),
      el('div', { class: 'field' }, el('label', {}, 'Target'), targetInput),
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
    ...SPLITS.map((s) => statTile(String(counts.bySplit[s] || 0), SPLIT_LABELS[s].toLowerCase())),
  ));

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

function statTile(value, label) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'st-value' }, value),
    el('div', { class: 'st-label' }, label),
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

  const metaBits = [];
  // trend metric first, so the arrow is explainable: e1RM on weight days,
  // total volume on volume days — always compared within the same day type
  if (s.trendInfo && s.trendInfo.cur != null) {
    metaBits.push(s.trendInfo.kind === 'e1rm'
      ? `e1RM ${fmtN(s.trendInfo.cur)}`
      : `vol ${Math.round(s.trendInfo.cur).toLocaleString()}`);
  }
  if (s.best && s.best.weight != null) {
    metaBits.push(`best ${s.best.weight.toLocaleString()}${s.best.reps != null ? ' × ' + s.best.reps : ''}`);
  }
  metaBits.push(`last ${setStr(s.last)}`);
  metaBits.push(`${s.sessions} session${s.sessions === 1 ? '' : 's'}`);

  const main = el('span', { class: 'sr-main' },
    el('span', { class: 'sr-name' },
      s.name,
      trend && el('span', { class: `trend ${trend}` }, trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'),
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

  const history = el('div', { class: 'sr-history' }, goalRow);

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

  for (const h of [...s.history].reverse()) {
    history.append(el('div', { class: 'sr-hrow' },
      el('span', { class: 'sr-hdate' }, fmt(h.date, { month: 'short', day: 'numeric' })),
      el('span', { class: 'sr-hclass' }, `${SPLIT_LABELS[h.split]} · ${FOCUS_LABELS[h.focus]}`),
      el('span', { class: 'sr-hset' }, setStr(h)),
    ));
  }
  return el('div', { class: 'stat-block' }, row, history);
}
