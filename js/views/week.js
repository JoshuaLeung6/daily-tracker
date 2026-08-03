// Week view — seven ledger rows plus totals, weekly goals, and streaks.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers, targetFor, weekStreakFor, weekMeets, dayAllMet } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, SPLITS } from '../workouts.js';
import { weekReport, weekSuggestions } from '../insights.js';

export function render(container, ctx) {
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

  const report = buildReportCard(ctx);
  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), ...report, rows);

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

  if (r.weight) {
    const w = r.weight;
    const unit = w.tracker.unit ? ` ${w.tracker.unit}` : '';
    const label = w.tracker.name;
    if (w.rate) {
      const pct = `${w.rate.pct > 0 ? '+' : ''}${w.rate.pct.toFixed(2)}%/wk`;
      let badge = null;
      if (w.verdict === 'in') badge = el('span', { class: 'rp-badge in' }, 'in band');
      else if (w.verdict) {
        const gaining = w.band.phase === 'gain';
        const harmful = (gaining && w.verdict === 'above') || (!gaining && w.verdict === 'below');
        badge = el('span', { class: 'rp-badge ' + (harmful ? 'bad' : 'off') },
          w.verdict === 'above' ? (gaining ? 'fast — fat risk' : 'slow') : (gaining ? 'slow' : 'fast — muscle risk'));
      }
      card.append(rpRow(label,
        el('span', {}, el('b', {}, `${fmtN(w.rate.trend)}${unit}`), ` trend · ${pct} `, badge)));
      any = true;
    } else if (w.trend != null) {
      card.append(rpRow(label,
        el('span', {}, el('b', {}, `${fmtN(w.trend)}${unit}`), ' trend',
          el('span', { class: 'rp-dim' }, ' · 3+ weigh-ins/wk unlock a rate'))));
      any = true;
    } else {
      card.append(rpRow(label, el('span', { class: 'rp-dim' }, 'not enough readings for a trend yet')));
      any = true;
    }
  }

  if (r.intake || r.protein) {
    card.append(rpRow('Intake',
      el('span', {},
        r.intake ? el('b', {}, Math.round(r.intake.avg).toLocaleString()) : null,
        r.intake ? ` ${r.intake.unit}/day avg` : null,
        r.protein
          ? el('span', { class: r.intake ? 'rp-dim' : '' },
              `${r.intake ? ' · ' : ''}protein ${r.protein.hit}/${r.protein.of} days`)
          : null,
      )));
    any = true;
  }

  if (r.training && r.training.sessions > 0) {
    const t = r.training;
    const splitBits = SPLITS.filter((s) => t.bySplit[s])
      .map((s) => `${SPLIT_LABELS[s]} ${t.bySplit[s]}`).join(' · ');
    card.append(rpRow('Training',
      el('span', {},
        el('b', {}, `${t.sessions} session${t.sessions === 1 ? '' : 's'}`),
        splitBits ? ` · ${splitBits}` : '',
        // a partial week vs full prior weeks reads as a false deficit —
        // only compare completed weeks
        t.volumeVsAvg != null && !r.isCurrent
          ? el('span', { class: 'rp-dim' }, ` · vol ${t.volumeVsAvg >= 0 ? '+' : ''}${Math.round(t.volumeVsAvg)}% vs 4wk`)
          : null,
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
