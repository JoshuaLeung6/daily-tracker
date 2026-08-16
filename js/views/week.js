// Week view — seven ledger rows plus totals, weekly goals, and streaks.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers, targetFor, weekStreakFor, weekMeets, dayAllMet } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, SPLITS } from '../workouts.js';
import { weekReport, weekSuggestions, weeksOverview } from '../insights.js';
import { currentSprint } from '../sprints.js';

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
  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Week by week'),
      el('h1', {}, 'Weeks'),
    ),
    el('span'),
  );

  const list = el('div', { class: 'week-rows' });
  const weeks = weeksOverview(sprint ? { start: sprint.start, end: sprint.end } : null);
  if (weeks.length === 0) {
    list.append(el('div', { class: 'empty-state' }, 'Nothing logged yet — weeks appear here as you log.'));
  }
  const total = weeks.length;
  let currentRow = null;
  for (const wk of weeks) {
    if (wk.isFuture) {
      list.append(el('div', { class: 'wk-row is-future' },
        el('span', { class: 'wk-dot none' }),
        el('span', { class: 'wk-main' },
          el('b', {}, weekLabel(wk.ws)),
          el('span', { class: 'wk-bits' }, `week ${wk.index} of ${total} · upcoming`),
        ),
      ));
      continue;
    }
    const r = wk.report;
    const bits = [];
    if (r.weight && r.weight.weekAvg != null) {
      bits.push(`${fmtN(r.weight.weekAvg)}${r.weight.tracker.unit ? ' ' + r.weight.tracker.unit : ''} avg`);
    }
    if (r.weight && r.weight.rate) {
      bits.push(`${r.weight.rate.pct > 0 ? '+' : ''}${r.weight.rate.pct.toFixed(2)}%/wk`);
    }
    if (r.training && r.training.sessions > 0) {
      bits.push(`${r.training.sessions} session${r.training.sessions === 1 ? '' : 's'}`);
    }
    if (r.protein && r.protein.of > 0) bits.push(`protein ${r.protein.hit}/${r.protein.of}`);
    if (bits.length === 0) bits.push('nothing logged');

    const row = el('button', {
      class: 'wk-row' + (wk.isCurrent ? ' is-current' : ''),
      onclick: () => { mode = 'detail'; ctx.setDate(wk.ws); },
    },
      el('span', {
        class: 'wk-dot ' + (wk.isCurrent ? 'current' : (wk.grade || 'none')),
        'aria-label': wk.isCurrent ? 'in progress' : (wk.grade || 'no data'),
      }),
      el('span', { class: 'wk-main' },
        el('b', {}, wk.isCurrent ? 'This week' : weekLabel(wk.ws)),
        el('span', { class: 'wk-bits' },
          wk.index ? el('span', { class: 'rp-dim' }, `wk ${wk.index}/${total} · `) : null,
          bits.join(' · '), wk.isCurrent ? el('span', { class: 'rp-dim' }, ' · in progress') : null),
      ),
      el('span', { class: 'wo-chevron' }, '›'),
    );
    if (wk.isCurrent) currentRow = row;
    list.append(row);
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), list);
  // in a long sprint timeline, land on the current week
  if (currentRow && sprint) {
    requestAnimationFrame(() => currentRow.scrollIntoView({ block: 'center' }));
  }
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

  const summary = buildSummary(trackers, days);
  if (summary) container.append(summary);
}

// The report card: the week's verdict — rate vs band, intake, training —
// plus any triggered if-then suggestions. This is the weekly review surface.
function buildReportCard(ctx) {
  const r = weekReport(ctx.date);
  const parts = [];
  const card = el('div', { class: 'card report-card' });
  let any = false;

  // the number of days in the week that have happened (7 for past weeks)
  const daysSoFar = r.days.filter((d) => d <= todayISO()).length;
  const outOf = (n) => el('span', { class: 'rp-dim' }, ` · ${n}/${daysSoFar} days`);

  // 1. weight: avg · % vs previous week · weigh-in count (+ band badge)
  if (r.weight) {
    const w = r.weight;
    const unit = w.tracker.unit ? ` ${w.tracker.unit}` : '';
    if (w.weekAvg != null) {
      let badge = null;
      if (w.verdict === 'in') badge = el('span', { class: 'rp-badge in' }, 'in band');
      else if (w.verdict) {
        const gaining = w.band.phase === 'gain';
        const harmful = (gaining && w.verdict === 'above') || (!gaining && w.verdict === 'below');
        badge = el('span', { class: 'rp-badge ' + (harmful ? 'bad' : 'off') },
          w.verdict === 'above' ? (gaining ? 'fast — fat risk' : 'slow') : (gaining ? 'slow' : 'fast — muscle risk'));
      }
      card.append(rpRow(w.tracker.name,
        el('span', {},
          el('b', {}, `${fmtN(w.weekAvg)}${unit}`), ' avg',
          w.pctVsPrev != null
            ? ` · ${w.pctVsPrev > 0 ? '+' : ''}${w.pctVsPrev.toFixed(2)}% vs last wk `
            : el('span', { class: 'rp-dim' }, ' · no prior week '),
          badge,
          // trend rate drives the band verdict; keep it visible when known
          w.rate ? el('span', { class: 'rp-dim' }, ` · trend ${w.rate.pct > 0 ? '+' : ''}${w.rate.pct.toFixed(2)}%/wk`) : null,
          el('span', { class: 'rp-dim' }, ` · ${w.weighIns} weigh-in${w.weighIns === 1 ? '' : 's'}`),
        )));
    } else {
      card.append(rpRow(w.tracker.name, el('span', { class: 'rp-dim' }, 'no weigh-ins this week')));
    }
    any = true;
  }

  // 2. calories: avg · target days
  if (r.intake) {
    card.append(rpRow('Calories',
      el('span', {},
        r.intake.avg != null ? el('b', {}, Math.round(r.intake.avg).toLocaleString()) : el('span', { class: 'rp-dim' }, '—'),
        r.intake.avg != null ? ` ${r.intake.unit} avg` : '',
        r.intake.of > 0 ? outOf(r.intake.hit) : el('span', { class: 'rp-dim' }, ' · no target set'),
      )));
    any = true;
  }

  // 3. protein: avg · target days
  if (r.protein) {
    card.append(rpRow('Protein',
      el('span', {},
        r.protein.avg != null ? el('b', {}, fmtN(r.protein.avg)) : el('span', { class: 'rp-dim' }, '—'),
        r.protein.avg != null ? ` ${r.protein.unit} avg` : '',
        r.protein.of > 0 ? outOf(r.protein.hit) : el('span', { class: 'rp-dim' }, ' · no target set'),
      )));
    any = true;
  }

  // 4. cardio: days done
  if (r.cardio) {
    card.append(rpRow('Cardio', el('span', {}, el('b', {}, `${r.cardio.days}/${daysSoFar}`), ' days')));
    any = true;
  }

  // 5. workouts: days trained (+ split breakdown when there is one)
  if (r.training) {
    const t = r.training;
    const splitBits = SPLITS.filter((s) => t.bySplit[s])
      .map((s) => `${SPLIT_LABELS[s]} ${t.bySplit[s]}`).join(' · ');
    card.append(rpRow('Workouts',
      el('span', {},
        el('b', {}, `${t.days}/${daysSoFar}`), ' days',
        splitBits ? el('span', { class: 'rp-dim' }, ` · ${splitBits}`) : null,
      )));
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
