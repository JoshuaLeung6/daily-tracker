// Month view — a grid of days; amber dots mark what was logged.

import { el } from '../ui.js';
import { todayISO, addMonths, monthGrid, monthTitle, fmt, startOfWeek, addDays } from '../dates.js';
import { getEntry } from '../store.js';

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
    const count = Object.keys(getEntry(iso)).length;
    const dots = el('span', { class: 'dots' });
    for (let i = 0; i < Math.min(count, 3); i++) dots.append(el('i'));
    if (count > 3) dots.append(el('span', { class: 'more' }, `+${count - 3}`));

    grid.append(el('button', {
      class: 'month-cell' + (iso === today ? ' is-today' : ''),
      'aria-label': fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' }),
      onclick: () => ctx.openDay(iso),
    },
      el('span', {}, String(Number(iso.slice(8)))),
      dots,
    ));
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), grid);
}
