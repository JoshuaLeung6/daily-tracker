// The Manual — the owner's handbook, one page per zone: the standing PLAN
// (config-written in js/config.js MANUAL, read-only here) plus free NOTES
// (editable, autosaved into the data document). Maintenance's reminder
// calendar and Repair's issue list will grow on their pages; until then
// every page is plan + notes.

import { el } from '../ui.js';
import { MANUAL } from '../config.js';
import { getManualNote, setManualNote, persistNow } from '../store.js';
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
  if (m.text) pane.append(el('div', { class: 'card manual-text' }, m.text));
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
