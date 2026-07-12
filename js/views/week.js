// Week view — seven ledger rows plus totals, weekly goals, and streaks.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers, targetFor, weekStreakFor } from '../trackers.js';

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
        el('div', { class: 'dn' }, String(Number(iso.slice(8)))),
      ),
      vals,
    ));
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), rows);

  const summary = buildSummary(trackers, days);
  if (summary) container.append(summary);
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
          const streak = weekStreakFor(t, endOfWeek);
          if (streak >= 2) item.streak = `${streak}-week streak`;
        }
      }
      items.push(item);
    } else if (t.type !== 'text' && tgt && tgt.period === 'week') {
      const count = days.filter((iso) => t.id in getEntry(iso)).length;
      const item = {
        name: t.name,
        main: `${count} / ${tgt.value} days`,
        ratio: tgt.value > 0 ? count / tgt.value : 0,
        goalText: `${tgt.value} days/week`,
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
      el('span', {}, el('b', {}, item.main), item.sub ? el('span', { class: 'avg' }, item.sub) : null),
    ));
    if (item.ratio !== undefined) {
      const fill = el('i', item.over ? { class: 'over' } : {});
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
