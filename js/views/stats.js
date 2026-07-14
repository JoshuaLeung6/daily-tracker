// Stats — lifting overview: workout counts, then per-lift bests, last
// session, trend, and expandable history.

import { el } from '../ui.js';
import { fmt } from '../dates.js';
import { SPLITS, SPLIT_LABELS, FOCUS_LABELS, workoutCounts, liftStats } from '../workouts.js';

let filterSplit = null;   // null = all
let expandedLift = null;  // lower-case lift name

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  const counts = workoutCounts();

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'Stats'),
      el('h1', {}, 'Lifting'),
    ),
    el('span'),
  );

  if (counts.total === 0) {
    container.replaceChildren(head, el('div', { class: 'ledger-rule' }),
      el('div', { class: 'empty-state' },
        'No workouts logged yet.', el('br'), 'Start one from the Day tab with “+ Log workout”.'));
    return;
  }

  const summary = el('div', { class: 'stats-summary' },
    statTile(String(counts.total), 'workouts'),
    statTile(String(counts.thisMonth), 'this month'),
    ...SPLITS.map((s) => statTile(String(counts.bySplit[s] || 0), SPLIT_LABELS[s].toLowerCase())),
  );

  const filter = el('div', { class: 'seg', role: 'group', 'aria-label': 'Filter by split' },
    el('button', {
      class: 'seg-btn', 'aria-pressed': String(filterSplit === null),
      onclick: () => { filterSplit = null; rerender(); },
    }, 'All'),
    ...SPLITS.map((s) => el('button', {
      class: 'seg-btn', 'aria-pressed': String(filterSplit === s),
      onclick: () => { filterSplit = s; rerender(); },
    }, SPLIT_LABELS[s])),
  );

  const stats = liftStats(filterSplit);
  const list = el('div', { class: 'stat-list' });
  for (const s of stats) list.append(liftRow(s, rerender));
  if (stats.length === 0) {
    list.append(el('div', { class: 'empty-state' }, `No ${SPLIT_LABELS[filterSplit]} lifts logged yet.`));
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), summary, filter, list);
}

function statTile(value, label) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'st-value' }, value),
    el('div', { class: 'st-label' }, label),
  );
}

function trendOf(s) {
  if (!s.prev || s.last.weight == null || s.prev.weight == null) return null;
  if (s.last.weight > s.prev.weight) return 'up';
  if (s.last.weight < s.prev.weight) return 'down';
  return 'flat';
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
  const trend = trendOf(s);

  const metaBits = [];
  if (s.best && s.best.weight != null) {
    metaBits.push(`best ${s.best.weight.toLocaleString()}${s.best.reps != null ? ' × ' + s.best.reps : ''}`);
  }
  metaBits.push(`last ${setStr(s.last)}`);
  metaBits.push(`${s.sessions} session${s.sessions === 1 ? '' : 's'}`);

  const row = el('button', {
    class: 'stat-row' + (expanded ? ' open' : ''),
    'aria-expanded': String(expanded),
    onclick: () => { expandedLift = expanded ? null : key; rerender(); },
  },
    el('span', { class: 'sr-main' },
      el('span', { class: 'sr-name' },
        s.name,
        trend && el('span', { class: `trend ${trend}` }, trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'),
      ),
      el('span', { class: 'sr-meta' }, metaBits.join(' · ')),
    ),
    el('span', { class: 'wo-chevron' }, expanded ? '⌄' : '›'),
  );

  if (!expanded) return row;

  const history = el('div', { class: 'sr-history' });
  for (const h of [...s.history].reverse()) {
    history.append(el('div', { class: 'sr-hrow' },
      el('span', { class: 'sr-hdate' }, fmt(h.date, { month: 'short', day: 'numeric' })),
      el('span', { class: 'sr-hclass' }, `${SPLIT_LABELS[h.split]} · ${FOCUS_LABELS[h.focus]}`),
      el('span', { class: 'sr-hset' }, setStr(h)),
    ));
  }
  return el('div', { class: 'stat-block' }, row, history);
}
