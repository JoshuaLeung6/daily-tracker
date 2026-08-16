// Week view — seven ledger rows plus totals, weekly goals, and streaks.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers, targetFor, weekStreakFor, weekMeets, dayAllMet } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, SPLITS } from '../workouts.js';
import { weekReport, weekSuggestions, weeksOverview, weekLineStatus, verdictBadge } from '../insights.js';
import { currentSprint } from '../sprints.js';
import { CALORIE_BANDS } from '../config.js';

// The tab opens zoomed out: every week graded green/yellow/red; tapping a
// week drills into its report card. Switching away and back resets to the
// overview.
let mode = 'overview';

export function enter() {
  mode = 'overview';
}

export function render(container, ctx) {
  if (mode === 'overview') renderOverview(container, ctx);
  else renderDetail(container, ctx);
}

function renderOverview(container, ctx) {
  const sprint = currentSprint();
  const weeks = weeksOverview(sprint ? { start: sprint.start, end: sprint.end } : null);
  const cur = weeks.find((w) => w.isCurrent);

  // sprint progress in the masthead: "Week 6 of 17" + a slim bar
  let progress = null;
  if (sprint && cur && cur.totalWeeks) {
    const fill = el('i', { class: 'goal-fill' });
    fill.style.width = Math.round((cur.index / cur.totalWeeks) * 100) + '%';
    progress = el('div', { class: 'wk-progress' },
      el('span', { class: 'wk-progress-label' }, `Week ${cur.index} of ${cur.totalWeeks}`),
      el('span', { class: 'wt-bar gc-bar wk-progress-bar' }, fill),
    );
  }

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Week by week'),
      el('h1', {}, 'Weeks'),
      progress,
    ),
    el('span'),
  );

  const list = el('div', { class: 'week-rows' });
  if (weeks.length === 0) {
    list.append(el('div', { class: 'empty-state' }, 'Nothing logged yet — weeks appear here as you log.'));
  }
  let currentRow = null;
  for (const wk of weeks) {
    const edgeNum = wk.index ? el('span', { class: 'wk-num' }, String(wk.index)) : null;
    const r = wk.report;
    const st = weekLineStatus(r);
    const daysSoFar = r.daysDone;
    const cell = (label, value, status) => el('span', { class: 'wk-cell' + (status ? ' st-' + status : '') },
      el('span', { class: 'wk-cell-v' }, value),
      el('span', { class: 'wk-cell-l' }, label),
    );
    const w = r.weight;
    const cells = el('span', { class: 'wk-cells' },
      cell('weight', w && w.weekAvg != null ? fmtN(w.weekAvg) : '—', st.weight),
      cell('kcal', r.intake && r.intake.avg != null ? Math.round(r.intake.avg).toLocaleString() : '—', st.calories),
      // protein is judged daily, so show days hit (calories shows the avg it is judged on)
      cell('protein', r.protein && r.protein.of > 0 ? `${r.protein.hit}/${r.protein.of}`
        : (r.protein && r.protein.avg != null ? Math.round(r.protein.avg) : '—'), st.protein),
      cell('lifts', r.training ? `${r.training.days}/${daysSoFar}` : '—', st.workouts),
    );

    const row = el('button', {
      class: 'wk-row wk-row-ledger' + (wk.isCurrent ? ' is-current' : ''),
      onclick: () => { mode = 'detail'; ctx.setDate(wk.ws); },
    },
      edgeNum,
      el('span', { class: 'wk-main' },
        el('span', { class: 'wk-title' },
          el('span', {
            class: 'wk-dot ' + (wk.isCurrent ? 'current' : (wk.grade || 'none')),
            'aria-label': wk.isCurrent ? 'in progress' : (wk.grade || 'no data'),
          }),
          el('b', {}, wk.isCurrent ? 'This week' : weekLabel(wk.ws)),
          wk.isCurrent ? el('span', { class: 'rp-dim wk-inprog' }, 'in progress') : null,
        ),
        cells,
      ),
    );
    if (wk.isCurrent) currentRow = row;
    list.append(row);
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), list);
}

function renderDetail(container, ctx) {
  const today = todayISO();
  const start = startOfWeek(ctx.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const trackers = activeTrackers();
  const inWeek = days.includes(today);

  const head = el('header', { class: 'view-head' },
    el('button', { class: 'nav-arrow', 'aria-label': 'Previous week', onclick: () => ctx.setDate(addDays(ctx.date, -7)) }, '‹'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, inWeek ? 'This week' : fmt(start, { year: 'numeric' })),
      el('h1', {}, weekLabel(ctx.date)),
      !inWeek && el('button', { class: 'today-pill', onclick: () => ctx.setDate(today) }, 'Back to today'),
    ),
    el('button', { class: 'nav-arrow', 'aria-label': 'Next week', onclick: () => ctx.setDate(addDays(ctx.date, 7)) }, '›'),
  );

  const rows = el('div', { class: 'week-rows' });
  for (const iso of days) {
    const entry = getEntry(iso);
    const vals = el('span', { class: 'wr-vals' });
    let has = false;
    const wo = getWorkout(iso);
    if (wo) {
      has = true;
      vals.append(el('span', { class: 'wr-workout' }, `${SPLIT_LABELS[wo.split]} day`));
    }
    for (const t of trackers) {
      if (!(t.id in entry)) continue;
      has = true;
      const v = entry[t.id];
      if (t.type === 'number' || t.type === 'measurement') {
        vals.append(el('span', {}, el('b', {}, Number(v).toLocaleString()), t.unit ? ` ${t.unit}` : ''));
      } else if (t.type === 'checkbox') {
        const chip = el('span', {}, `${t.name} `);
        const icon = checkIcon();
        icon.style.width = '11px';
        icon.style.height = '11px';
        icon.querySelector('path').setAttribute('stroke', 'var(--accent)');
        chip.append(icon);
        vals.append(chip);
      } else if (t.type === 'multiselect' || t.type === 'select') {
        const list = Array.isArray(v) ? v : [v];
        vals.append(el('span', {}, el('b', {}, list.join(' · '))));
      } else {
        vals.append(el('span', { class: 'wr-note' }, String(v)));
      }
    }
    if (!has) vals.append(el('span', { class: 'none' }, 'nothing logged'));

    rows.append(el('button', {
      class: 'week-row' + (iso === today ? ' is-today' : ''),
      onclick: () => ctx.openDay(iso),
    },
      el('span', { class: 'wr-date' },
        el('div', { class: 'wd' }, fmt(iso, { weekday: 'short' })),
        el('div', { class: 'dn' + (dayAllMet(iso) ? ' all-met' : '') }, String(Number(iso.slice(8)))),
      ),
      vals,
    ));
  }

  const back = el('div', { class: 'lock-row wk-back' },
    el('button', {
      class: 'lock-pill',
      onclick: () => { mode = 'overview'; render(container, ctx); },
    }, '‹ All weeks'));

  const report = buildReportCard(ctx);
  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), back, ...report, rows);
}

// The report card: the week's verdict — rate vs band, intake, training —
// plus any triggered if-then suggestions. This is the weekly review surface.
function buildReportCard(ctx) {
  const r = weekReport(ctx.date);
  const parts = [];
  const card = el('div', { class: 'card report-card' });
  let any = false;

  // completed days in the week (7 for past weeks; today excluded for the current)
  const daysSoFar = r.daysDone;
  const outOf = (n) => el('span', { class: 'rp-dim' }, ` · ${n}/${daysSoFar} days`);
  const st = weekLineStatus(r);
  const rpRowC = (label, valueEl, status) => {
    const row = rpRow(label, valueEl);
    if (status) row.classList.add('st-' + status);
    return row;
  };

  // 1. weight: avg · % vs previous week · weigh-in count (+ band badge)
  if (r.weight) {
    const w = r.weight;
    const unit = w.tracker.unit ? ` ${w.tracker.unit}` : '';
    if (w.weekAvg != null) {
      const badge = verdictBadge(w.band, w.verdict);
      card.append(rpRowC(w.tracker.name,
        el('span', {},
          el('b', {}, `${fmtN(w.weekAvg)}${unit}`), ' avg',
          w.pctVsPrev != null
            ? ` · ${w.pctVsPrev > 0 ? '+' : ''}${w.pctVsPrev.toFixed(2)}% vs last wk `
            : el('span', { class: 'rp-dim' }, ' · no prior week '),
          badge,
          // trend rate drives the band verdict; keep it visible when known
          w.rate ? el('span', { class: 'rp-dim' }, ` · trend ${w.rate.pct > 0 ? '+' : ''}${w.rate.pct.toFixed(2)}%/wk`) : null,
          el('span', { class: 'rp-dim' }, ` · ${w.weighIns} weigh-in${w.weighIns === 1 ? '' : 's'}`),
        ), st.weight));
    } else {
      card.append(rpRow(w.tracker.name, el('span', { class: 'rp-dim' }, 'no weigh-ins this week')));
    }
    any = true;
  }

  // 2. calories: weekly avg against the grading bands · target days as context
  if (r.intake) {
    card.append(rpRowC('Calories',
      el('span', {},
        r.intake.avg != null ? el('b', {}, Math.round(r.intake.avg).toLocaleString()) : el('span', { class: 'rp-dim' }, '—'),
        r.intake.avg != null ? ` ${r.intake.unit} avg` : '',
        el('span', { class: 'rp-dim' }, ` · aim ${CALORIE_BANDS.good.toLocaleString()}+`),
        r.intake.of > 0 ? outOf(r.intake.hit) : null,
      ), st.calories));
    any = true;
  }

  // 3. protein: avg · target days
  if (r.protein) {
    card.append(rpRowC('Protein',
      el('span', {},
        r.protein.avg != null ? el('b', {}, fmtN(r.protein.avg)) : el('span', { class: 'rp-dim' }, '—'),
        r.protein.avg != null ? ` ${r.protein.unit} avg` : '',
        r.protein.of > 0 ? outOf(r.protein.hit) : el('span', { class: 'rp-dim' }, ' · no target set'),
      ), st.protein));
    any = true;
  }

  // 4. cardio: days done
  if (r.cardio) {
    card.append(rpRowC('Cardio', el('span', {}, el('b', {}, `${r.cardio.days}/${daysSoFar}`), ' days'), st.cardio));
    any = true;
  }

  // 5. workouts: days trained (+ split breakdown when there is one)
  if (r.training) {
    const t = r.training;
    const splitBits = SPLITS.filter((s) => t.bySplit[s])
      .map((s) => `${SPLIT_LABELS[s]} ${t.bySplit[s]}`).join(' · ');
    card.append(rpRowC('Workouts',
      el('span', {},
        el('b', {}, `${t.days}/${daysSoFar}`), ' days',
        splitBits ? el('span', { class: 'rp-dim' }, ` · ${splitBits}`) : null,
      ), st.workouts));
    any = true;
  }

  if (any) parts.push(card);

  for (const s of weekSuggestions(r)) {
    parts.push(el('div', { class: 'card suggest-card' },
      el('div', { class: 'sg-text' }, s.text),
      el('div', { class: 'sg-why' }, s.why),
    ));
  }
  return parts;
}

function rpRow(label, valueEl) {
  return el('div', { class: 'rp-row' },
    el('span', { class: 'rp-label' }, label),
    el('span', { class: 'rp-value' }, valueEl),
  );
}

function buildSummary(trackers, days) {
  const endOfWeek = days[6];
  const items = [];

  for (const t of trackers) {
    const tgt = targetFor(t, endOfWeek);

    if (t.type === 'number') {
      const logged = days.map((iso) => getEntry(iso)[t.id]).filter((v) => typeof v === 'number');
      if (logged.length === 0 && !tgt) continue;
      const sum = logged.reduce((a, b) => a + b, 0);
      const avg = logged.length ? sum / logged.length : 0;
      const item = { name: t.name, main: fmtN(sum) + (t.unit ? ` ${t.unit}` : ''), sub: logged.length ? `avg ${fmtN(avg)}/day` : 'nothing logged' };
      if (tgt) {
        const goal = tgt.period === 'week' ? tgt.value : tgt.value * 7;
        const atMost = tgt.dir === 'atmost';
        item.goalText = `${atMost ? '≤' : '≥'} ${fmtN(tgt.value)}${t.unit ? ' ' + t.unit : ''}${tgt.period === 'day' ? '/day' : '/week'}`;
        item.ratio = goal > 0 ? sum / goal : 0;
        item.over = atMost && item.ratio > 1;
        if (tgt.period === 'week') {
          item.wkMet = weekMeets(t, days[0]);
          const streak = weekStreakFor(t, endOfWeek);
          if (streak >= 2) item.streak = `${streak}-week streak`;
        }
      }
      items.push(item);
    } else if (t.type === 'measurement') {
      // no totals for measurements — show latest and average instead
      const logged = days
        .map((iso) => ({ iso, v: getEntry(iso)[t.id] }))
        .filter((x) => typeof x.v === 'number');
      if (logged.length === 0) continue;
      const latest = logged[logged.length - 1].v;
      const avg = logged.reduce((a, b) => a + b.v, 0) / logged.length;
      items.push({
        name: t.name,
        main: `${fmtN(latest)}${t.unit ? ' ' + t.unit : ''}`,
        sub: logged.length > 1 ? `avg ${fmtN(avg)}` : 'latest',
      });
    } else if (t.type !== 'text' && tgt && tgt.period === 'week') {
      const count = days.filter((iso) => t.id in getEntry(iso)).length;
      const item = {
        name: t.name,
        main: `${count} / ${tgt.value} days`,
        ratio: tgt.value > 0 ? count / tgt.value : 0,
        goalText: `${tgt.value} days/week`,
        wkMet: count >= tgt.value,
      };
      const streak = weekStreakFor(t, endOfWeek);
      if (streak >= 2) item.streak = `${streak}-week streak`;
      items.push(item);
    }
  }

  if (items.length === 0) return null;

  const box = el('div', { class: 'week-totals' }, el('h2', {}, 'Week totals'));
  for (const item of items) {
    box.append(el('div', { class: 'wt-row' },
      el('span', {}, item.name, item.goalText ? el('span', { class: 'wt-goal' }, `  ·  ${item.goalText}`) : null),
      el('span', {}, el('b', item.wkMet ? { class: 'wk-met' } : {}, item.main), item.sub ? el('span', { class: 'avg' }, item.sub) : null),
    ));
    if (item.ratio !== undefined) {
      const fill = el('i', { class: (item.over ? 'over' : '') + (item.wkMet ? ' wk-met' : '') });
      fill.style.width = Math.min(100, item.ratio * 100) + '%';
      box.append(el('div', { class: 'wt-bar' }, fill));
    }
    if (item.streak) {
      box.append(el('div', { class: 'wt-goal' }, item.streak));
    }
  }
  return box;
}

function fmtN(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
