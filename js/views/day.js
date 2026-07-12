// Day view — the quick-entry ledger. Renders once per date; typing updates
// the store directly (no re-render), so focus and the keyboard stay put.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, weekdayName, fmt } from '../dates.js';
import { getEntry, setValue, persistNow } from '../store.js';
import { activeTrackers, allTrackers, targetFor, streakFor } from '../trackers.js';

export function render(container, ctx) {
  const iso = ctx.date;
  const today = todayISO();
  const entry = getEntry(iso);
  const isToday = iso === today;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);

  const head = el('header', { class: 'view-head' },
    el('button', { class: 'nav-arrow', 'aria-label': 'Previous day', onclick: () => ctx.setDate(addDays(iso, -1)) }, '‹'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, isToday ? 'Today' : weekdayName(iso)),
      el('h1', {}, fmt(iso, sameYear ? { month: 'long', day: 'numeric' } : { month: 'long', day: 'numeric', year: 'numeric' })),
      !isToday && el('button', { class: 'today-pill', onclick: () => ctx.setDate(today) }, 'Back to today'),
    ),
    el('button', { class: 'nav-arrow', 'aria-label': 'Next day', onclick: () => ctx.setDate(addDays(iso, 1)) }, '›'),
  );

  const cards = el('div', { class: 'cards' });
  const active = activeTrackers();
  for (const t of active) cards.append(trackerCard(t, iso, entry));

  // archived trackers still show on days where they have data
  const archivedWithData = allTrackers().filter((t) => t.archived && t.id in entry);
  for (const t of archivedWithData) {
    const card = trackerCard(t, iso, entry);
    card.classList.add('is-archived');
    cards.append(card);
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), cards);

  if (active.length === 0 && archivedWithData.length === 0) {
    cards.append(el('div', { class: 'empty-state' }, 'No trackers yet. Add one in Settings.'));
  }

  // textareas need layout before autogrow can measure them
  requestAnimationFrame(() => {
    container.querySelectorAll('textarea').forEach(grow);
  });

  // swipe left/right to change day (assignment keeps listeners from stacking)
  let startX = null;
  let startY = null;
  container.ontouchstart = (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  };
  container.ontouchend = (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    startX = startY = null;
    if (e.target.closest('input, textarea, button')) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy)) {
      ctx.setDate(addDays(iso, dx < 0 ? 1 : -1));
    }
  };
}

function trackerCard(t, iso, entry) {
  if (t.type === 'number') return numberCard(t, iso, entry);
  if (t.type === 'checkbox') return checkboxCard(t, iso, entry);
  if (t.type === 'select' || t.type === 'multiselect') return selectCard(t, iso, entry);
  return textCard(t, iso, entry);
}

function numberCard(t, iso, entry) {
  const target = targetFor(t, iso);
  const dailyGoal = target && target.period === 'day' ? target.value : null;

  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: '·',
    'aria-label': t.name,
    value: t.id in entry ? String(entry[t.id]) : '',
  });

  const atMost = target && target.dir === 'atmost';
  let fill = null;
  let tlText = null;
  const targetLabel = () =>
    `target ${atMost ? '≤' : '≥'} ${dailyGoal.toLocaleString()}${t.unit ? ' ' + t.unit : ''}`;
  const updateFill = () => {
    if (!fill) return;
    const num = parseFloat(input.value.replace(',', '.'));
    const pct = Number.isFinite(num) ? (num / dailyGoal) * 100 : 0;
    fill.style.width = Math.min(100, pct) + '%';
    fill.classList.toggle('over', atMost && pct > 100);
    const streak = streakFor(t, iso);
    tlText.textContent = targetLabel() + (streak >= 2 ? ` · ${streak}-day streak` : '');
  };

  input.addEventListener('input', () => {
    const cleaned = input.value.replace(/[^0-9.,]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    const num = parseFloat(cleaned.replace(',', '.'));
    setValue(iso, t.id, Number.isFinite(num) ? num : '');
    updateFill();
  });
  input.addEventListener('blur', () => persistNow());
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  const row = el('span', { class: 'num-row' },
    el('span', { class: 't-name' }, t.name),
    el('span', { class: 't-value' }, input, t.unit && el('span', { class: 'unit' }, t.unit)),
  );
  if (dailyGoal == null) return el('label', { class: 'card card-num' }, row);

  fill = el('i');
  tlText = el('span', { class: 'tl-text' });
  const targetLine = el('span', { class: 'target-line' },
    el('span', { class: 'bar' }, fill),
    tlText,
  );
  updateFill();
  return el('label', { class: 'card card-num' }, row, targetLine);
}

function selectCard(t, iso, entry) {
  const multi = t.type === 'multiselect';
  const current = entry[t.id];
  const selected = new Set(multi
    ? (Array.isArray(current) ? current : [])
    : (current != null ? [String(current)] : []));

  // include historical values no longer among the options, so old days render
  const options = [...(t.options || [])];
  for (const v of selected) if (!options.includes(v)) options.push(v);

  const chipRow = el('div', { class: 'chips' });
  for (const opt of options) {
    const chip = el('button', { class: 'chip', 'aria-pressed': String(selected.has(opt)) }, opt);
    chip.addEventListener('click', () => {
      if (selected.has(opt)) selected.delete(opt);
      else {
        if (!multi) selected.clear();
        selected.add(opt);
      }
      for (const c of chipRow.children) c.setAttribute('aria-pressed', String(selected.has(c.textContent)));
      setValue(iso, t.id, multi ? [...selected] : (selected.size ? [...selected][0] : ''));
      persistNow();
    });
    chipRow.append(chip);
  }
  if (options.length === 0) {
    chipRow.append(el('span', { class: 'settings-note' }, 'No options yet — add some in Settings.'));
  }

  const card = el('div', { class: 'card card-select' },
    el('span', { class: 't-name' }, t.name),
    chipRow,
  );
  attachStreakLine(card, t, iso);
  return card;
}

// For non-number cards with a daily target: show the running streak,
// refreshed live as today's entry changes.
function attachStreakLine(card, t, iso) {
  const target = targetFor(t, iso);
  if (!target || target.period !== 'day') return;
  const line = el('span', { class: 'target-line' }, el('span', { class: 'tl-text' }, ''));
  const refresh = () => {
    const streak = streakFor(t, iso);
    line.firstChild.textContent = streak >= 2 ? `${streak}-day streak` : 'daily target';
  };
  refresh();
  card.append(line);
  card.addEventListener('click', () => requestAnimationFrame(refresh));
}

function textCard(t, iso, entry) {
  const textarea = el('textarea', { rows: '2', placeholder: 'Write it down…', 'aria-label': t.name });
  textarea.value = t.id in entry ? entry[t.id] : '';
  textarea.addEventListener('input', () => {
    grow(textarea);
    setValue(iso, t.id, textarea.value.trim() === '' ? '' : textarea.value);
  });
  textarea.addEventListener('blur', () => persistNow());
  return el('label', { class: 'card card-text' },
    el('span', { class: 't-name' }, t.name),
    textarea,
  );
}

function checkboxCard(t, iso, entry) {
  const row = el('span', { class: 'num-row' },
    el('span', { class: 't-name' }, t.name),
    el('span', { class: 'check-dot' }, checkIcon()),
  );
  const btn = el('button', { class: 'card card-check card-num', 'aria-pressed': String(Boolean(entry[t.id])) }, row);
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    setValue(iso, t.id, next);
    persistNow();
  });
  attachStreakLine(btn, t, iso);
  return btn;
}

function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}
