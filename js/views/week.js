// Week view — seven ledger rows plus totals/averages for number trackers.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers } from '../trackers.js';

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
    for (const t of trackers) {
      if (!(t.id in entry)) continue;
      has = true;
      const v = entry[t.id];
      if (t.type === 'number') {
        vals.append(el('span', {}, el('b', {}, Number(v).toLocaleString()), t.unit ? ` ${t.unit}` : ''));
      } else if (t.type === 'checkbox') {
        const chip = el('span', {}, `${t.name} `);
        const icon = checkIcon();
        icon.style.width = '11px';
        icon.style.height = '11px';
        icon.querySelector('path').setAttribute('stroke', 'var(--accent)');
        chip.append(icon);
        vals.append(chip);
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
        el('div', { class: 'dn' }, String(Number(iso.slice(8)))),
      ),
      vals,
    ));
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), rows);

  // totals + daily average for each number tracker logged this week
  const totals = trackers
    .filter((t) => t.type === 'number')
    .map((t) => {
      const logged = days.map((iso) => getEntry(iso)[t.id]).filter((v) => typeof v === 'number');
      return { t, logged };
    })
    .filter((x) => x.logged.length > 0);

  if (totals.length > 0) {
    const box = el('div', { class: 'week-totals' }, el('h2', {}, 'Week totals'));
    for (const { t, logged } of totals) {
      const sum = logged.reduce((a, b) => a + b, 0);
      const avg = sum / logged.length;
      box.append(el('div', { class: 'wt-row' },
        el('span', {}, t.name),
        el('span', {},
          el('b', {}, sum.toLocaleString(undefined, { maximumFractionDigits: 1 }), t.unit ? ` ${t.unit}` : ''),
          el('span', { class: 'avg' }, `avg ${avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}/day`),
        ),
      ));
    }
    container.append(box);
  }
}
