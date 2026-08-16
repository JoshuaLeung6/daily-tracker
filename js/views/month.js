// Month view — a grid of days; amber dots mark what was logged.

import { el } from '../ui.js';
import { todayISO, addMonths, monthGrid, monthTitle, fmt, startOfWeek, addDays } from '../dates.js';
import { getEntry } from '../store.js';
import { dayAllMet } from '../trackers.js';
import { getWorkout, SPLITS, SPLIT_LABELS } from '../workouts.js';
import { monthReport, verdictBadge } from '../insights.js';
import { photoDates } from '../photos.js';

export function render(container, ctx) {
  const today = todayISO();
  const sameMonth = ctx.date.slice(0, 7) === today.slice(0, 7);

  const head = el('header', { class: 'view-head' },
    el('button', { class: 'nav-arrow', 'aria-label': 'Previous month', onclick: () => ctx.setDate(addMonths(ctx.date, -1)) }, '‹'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, fmt(ctx.date, { year: 'numeric' })),
      el('h1', {}, fmt(ctx.date, { month: 'long' })),
      !sameMonth && el('button', { class: 'today-pill', onclick: () => ctx.setDate(today) }, 'Back to today'),
    ),
    el('button', { class: 'nav-arrow', 'aria-label': 'Next month', onclick: () => ctx.setDate(addMonths(ctx.date, 1)) }, '›'),
  );

  const grid = el('div', { class: 'month-grid' });

  // localized Mon–Sun header derived from a real week
  const monday = startOfWeek(today);
  for (let i = 0; i < 7; i++) {
    grid.append(el('div', { class: 'month-wd' }, fmt(addDays(monday, i), { weekday: 'narrow' })));
  }

  for (const iso of monthGrid(ctx.date)) {
    if (iso === null) {
      grid.append(el('div', { class: 'month-cell is-empty' }));
      continue;
    }
    const count = Object.keys(getEntry(iso)).length + (getWorkout(iso) ? 1 : 0);
    const dots = el('span', { class: 'dots' });
    for (let i = 0; i < Math.min(count, 3); i++) dots.append(el('i'));
    if (count > 3) dots.append(el('span', { class: 'more' }, `+${count - 3}`));

    grid.append(el('button', {
      class: 'month-cell' + (iso === today ? ' is-today' : ''),
      'aria-label': fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' }),
      'data-iso': iso,
      onclick: () => ctx.openDay(iso),
    },
      el('span', { class: 'cell-day' + (dayAllMet(iso) ? ' all-met' : '') }, String(Number(iso.slice(8)))),
      dots,
    ));
  }

  const summary = buildMonthSummary(ctx.date);
  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), ...(summary ? [summary] : []), grid);

  // async: mark days that have progress photos (violet tick after the number)
  photoDates().then((dates) => {
    for (const cell of grid.querySelectorAll('.month-cell')) {
      const label = cell.getAttribute('aria-label');
      if (!label) continue;
      const iso = cell.dataset.iso;
      if (iso && dates.has(iso)) cell.querySelector('.cell-day').classList.add('has-photo');
    }
  }).catch(() => { /* photos unavailable — grid still fine */ });
}

// Month = consistency at scale: weight change vs band, training totals,
// PRs, and adherence — totals only, never which days were missed.
function buildMonthSummary(iso) {
  const r = monthReport(iso);
  if (!r) return null;
  const card = el('div', { class: 'card report-card month-summary' });
  let any = false;
  const fmtN = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  if (r.weight && r.weight.delta != null) {
    const w = r.weight;
    const unit = w.tracker.unit ? ` ${w.tracker.unit}` : '';
    const badge = verdictBadge(w.band, w.verdict);
    card.append(rpRow(w.tracker.name,
      el('span', {},
        el('b', {}, `${w.delta > 0 ? '+' : ''}${fmtN(w.delta)}${unit}`),
        ` ${r.isCurrent ? 'so far' : 'this month'} · ${w.pctPerWeek > 0 ? '+' : ''}${w.pctPerWeek.toFixed(2)}%/wk `,
        badge)));
    any = true;
  }

  if (r.training.sessions > 0 || r.training.prs > 0) {
    const splitBits = SPLITS.filter((s) => r.training.bySplit[s])
      .map((s) => `${SPLIT_LABELS[s]} ${r.training.bySplit[s]}`).join(' · ');
    card.append(rpRow('Training',
      el('span', {},
        el('b', {}, `${r.training.sessions} session${r.training.sessions === 1 ? '' : 's'}`),
        splitBits ? ` · ${splitBits}` : '',
        r.training.prs > 0 ? el('span', { class: 'pr-star' }, ` · ${r.training.prs} PR${r.training.prs === 1 ? '' : 's'} ★`) : null,
      )));
    any = true;
  }

  const c = r.consistency;
  if (c.loggedDays > 0) {
    card.append(rpRow('Consistency',
      el('span', {},
        el('b', {}, `${c.loggedDays}/${c.elapsed}`), ' days logged',
        c.proteinOf > 0 ? el('span', { class: 'rp-dim' }, ` · protein ${c.proteinHit}/${c.proteinOf}`) : null,
        c.allMet > 0 ? el('span', { class: 'rp-dim' }, ` · ${c.allMet} all-target day${c.allMet === 1 ? '' : 's'}`) : null,
      )));
    any = true;
  }

  return any ? card : null;
}

function rpRow(label, valueEl) {
  return el('div', { class: 'rp-row' },
    el('span', { class: 'rp-label' }, label),
    el('span', { class: 'rp-value' }, valueEl),
  );
}
