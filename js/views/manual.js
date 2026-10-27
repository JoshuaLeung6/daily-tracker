// The Manual — the owner's handbook, one page per zone: the standing PLAN
// (config-written in js/config.js MANUAL, read-only here) plus free NOTES
// (editable, autosaved into the data document). Maintenance's reminder
// calendar and Repair's issue list will grow on their pages; until then
// every page is plan + notes.

import { el } from '../ui.js';
import { MANUAL } from '../config.js';
import { getManualNote, setManualNote, persistNow, getRepairs, addRepair, updateRepair } from '../store.js';
import { todayISO, fmt } from '../dates.js';
import { maintenanceStatus } from '../insights.js';
import { listFoods } from '../foods.js';
import { coachPane } from './stats.js';

// Coach leads: the live "what should I do now" page, then the five zones.
const CATS = [
  ['coach', 'Coach'],
  ['movement', 'Move'],
  ['intake', 'Intake'],
  ['recovery', 'Recover'],
  ['maintenance', 'Maint.'],
  ['repair', 'Repair'],
];
let cat = 'coach';

export function render(container) {
  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'The owner’s manual'),
      el('h1', {}, 'Manual'),
    ),
    el('span'),
  );

  const seg = el('div', { class: 'seg manual-seg', role: 'group', 'aria-label': 'Zone' },
    ...CATS.map(([key, label]) => el('button', {
      class: 'seg-btn mn-btn',
      'aria-pressed': String(cat === key),
      onclick: () => { cat = key; render(container); },
    }, label)));

  if (cat === 'coach') {
    container.replaceChildren(head, el('div', { class: 'ledger-rule' }), seg, coachPane(() => render(container)));
    return;
  }

  const m = MANUAL[cat] || { text: '', rows: [] };
  const pane = el('div', { class: `pane manual-pane mnp-${cat}` });

  // Repair's issue tracker comes FIRST — its page rule
  if (cat === 'repair') pane.append(...repairSections(() => render(container)));

  if (m.text) pane.append(el('div', { class: 'card manual-text' }, m.text));

  // Maintain's reminder calendar leads its page
  if (cat === 'maintenance') {
    const rem = el('div', { class: 'card plan-card' });
    for (const it of maintenanceStatus()) {
      const chip = it.state === 'unarmed'
        ? el('span', { class: 'rp-dim' }, 'date needed — tell Claude your last visit')
        : el('span', { class: `mn-due mn-${it.state}` },
          it.state === 'overdue' ? `overdue — was due ${fmt(it.due, { month: 'short', day: 'numeric' })}`
            : it.state === 'soon' ? `due ${fmt(it.due, { month: 'short', day: 'numeric' })}`
              : `due ${fmt(it.due, { month: 'short', day: 'numeric', year: 'numeric' })}`);
      rem.append(el('div', { class: 'plan-row' },
        el('span', { class: 'plan-k' }, it.label),
        el('span', { class: 'plan-v' }, chip)));
    }
    pane.append(el('div', { class: 'settings-section' }, el('h2', {}, 'Reminders'), rem));
  }
  const rowCard = (rows) => {
    const card = el('div', { class: 'card plan-card' });
    for (const [k, v] of rows) {
      card.append(el('div', { class: 'plan-row' },
        el('span', { class: 'plan-k' }, k),
        el('span', { class: 'plan-v' }, v)));
    }
    return card;
  };
  if (m.rows && m.rows.length) pane.append(rowCard(m.rows));
  // encyclopedia-style pages (Maintain) carry titled sections of rows
  for (const [title, rows] of m.sections || []) {
    pane.append(el('div', { class: 'settings-section' }, el('h2', {}, title), rowCard(rows)));
  }

  // Intake's lookup: the saved food library (per-serving numbers)
  if (cat === 'intake') pane.append(foodSection());

  // notes: one free text per zone, autosaved like the day note
  const ta = el('textarea', {
    class: 'manual-notes',
    placeholder: 'Notes…',
    'aria-label': `${cat} notes`,
  });
  ta.value = getManualNote(cat);
  const grow = () => {
    ta.style.height = 'auto';
    ta.style.height = Math.max(96, ta.scrollHeight) + 'px';
  };
  ta.addEventListener('input', () => { setManualNote(cat, ta.value); grow(); });
  ta.addEventListener('blur', () => persistNow());
  pane.append(el('div', { class: 'settings-section' }, el('h2', {}, 'Notes'), ta));

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), seg, pane);
  requestAnimationFrame(grow);
}

// Jump straight to the Repair page (the day-view banner's target).
export function showRepair() {
  cat = 'repair';
}

// Food library lookup on the Intake page: every saved food's per-serving
// kcal + protein, most-used first (same order as the + Food sheet), with a
// filter once the list is long enough to need one. Read-only here — foods
// are added/edited from the Day view's Calories card.
function foodSection() {
  const sec = el('div', { class: 'settings-section' }, el('h2', {}, 'Food library'));
  const foods = listFoods();
  if (!foods.length) {
    sec.append(el('div', { class: 'empty-state' },
      'No foods saved yet — add them with + Food on the Day view’s Calories card.'));
    return sec;
  }
  const card = el('div', { class: 'card plan-card' });
  const renderRows = (q) => {
    const needle = (q || '').trim().toLowerCase();
    card.replaceChildren();
    for (const f of foods) {
      if (needle && !f.name.toLowerCase().includes(needle)) continue;
      card.append(el('div', { class: 'plan-row' },
        el('span', { class: 'plan-k' }, f.name),
        el('span', { class: 'plan-v' },
          [f.kcal != null ? `${f.kcal.toLocaleString()} kcal` : null,
            f.protein != null ? `${f.protein} g protein` : null,
          ].filter(Boolean).join(' · ') || '—')));
    }
    if (!card.children.length) card.append(el('div', { class: 'empty-state' }, 'No food matches.'));
  };
  if (foods.length > 6) {
    const search = el('input', {
      class: 'food-search', type: 'search',
      placeholder: 'Search foods…', 'aria-label': 'Search foods',
    });
    search.addEventListener('input', () => renderRows(search.value));
    sec.append(search);
  }
  renderRows('');
  sec.append(card);
  return sec;
}

// The Repair issue tracker: open issues (title, opened date, a small note,
// a Resolved button), a one-tap way to open one, and the resolved history.
// Empty is the goal state, and the page says so.
function repairSections(rerender) {
  const out = [];
  const open = getRepairs().filter((r) => !r.closed);
  const closed = getRepairs().filter((r) => r.closed);

  const sec = el('div', { class: 'settings-section' }, el('h2', {}, 'Open'));
  if (!open.length) {
    sec.append(el('div', { class: 'empty-state' }, 'Nothing broken — the goal state.'));
  }
  for (const r of open) {
    const note = el('textarea', {
      class: 'repair-note', rows: '2',
      placeholder: 'What, who you’re seeing, what to avoid…',
      'aria-label': `${r.title} note`,
    });
    note.value = r.note || '';
    note.addEventListener('input', () => updateRepair(r.id, { note: note.value }));
    note.addEventListener('blur', () => persistNow());
    sec.append(el('div', { class: 'card repair-card' },
      el('div', { class: 'repair-head' },
        el('span', { class: 'repair-title' }, r.title),
        el('span', { class: 'rp-dim' }, `since ${fmt(r.opened, { month: 'short', day: 'numeric' })}`),
        el('button', {
          class: 'btn repair-close',
          onclick: () => { updateRepair(r.id, { closed: todayISO() }); persistNow(); rerender(); },
        }, 'Resolved'),
      ),
      note,
    ));
  }
  sec.append(el('button', {
    class: 'ghost-btn',
    onclick: () => {
      const t = prompt('What hurts / what broke?');
      if (t && t.trim()) { addRepair(t, todayISO()); rerender(); }
    },
  }, '+ New issue'));
  out.push(sec);

  if (closed.length) {
    const hist = el('div', { class: 'card report-card' });
    for (const r of [...closed].reverse()) {
      hist.append(el('div', { class: 'plan-row' },
        el('span', { class: 'plan-k' }, r.title),
        el('span', { class: 'plan-v rp-dim' },
          `${fmt(r.opened, { month: 'short', day: 'numeric' })} – ${fmt(r.closed, { month: 'short', day: 'numeric' })}`)));
    }
    out.push(el('div', { class: 'settings-section' }, el('h2', {}, 'Resolved'), hist));
  }
  return out;
}
