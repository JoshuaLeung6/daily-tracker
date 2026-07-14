// Day view — the quick-entry ledger. Renders once per date; typing updates
// the store directly (no re-render), so focus and the keyboard stay put.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, weekdayName, fmt } from '../dates.js';
import { getEntry, setValue, persistNow } from '../store.js';
import { activeTrackers, allTrackers, targetFor, streakFor, dayMeets, previousValue } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, FOCUS_LABELS } from '../workouts.js';
import { openWorkout } from './workout.js';

// Past days are read-only unless explicitly unlocked; the unlock covers one
// day and drops as soon as you navigate away.
let unlockedISO = null;

export function render(container, ctx) {
  const iso = ctx.date;
  const today = todayISO();
  const entry = getEntry(iso);
  const isToday = iso === today;
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  if (unlockedISO && unlockedISO !== iso) unlockedISO = null;
  const isPast = iso < today;
  const locked = isPast && unlockedISO !== iso;

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
  // locked days show only what was actually logged
  const active = activeTrackers().filter((t) => !locked || t.id in entry);
  for (const t of active) cards.append(trackerCard(t, iso, entry, locked));

  // archived trackers still show on days where they have data
  const archivedWithData = allTrackers().filter((t) => t.archived && t.id in entry);
  for (const t of archivedWithData) {
    const card = trackerCard(t, iso, entry, locked);
    card.classList.add('is-archived');
    cards.append(card);
  }
  if (locked && active.length === 0 && archivedWithData.length === 0) {
    cards.append(el('div', { class: 'empty-state' }, 'Nothing logged this day.'));
  }

  const pieces = [head, el('div', { class: 'ledger-rule' })];
  if (isPast) {
    const pill = el('button', {
      class: 'lock-pill' + (locked ? '' : ' unlocked'),
      'aria-pressed': String(!locked),
      onclick: () => {
        unlockedISO = locked ? iso : null;
        render(container, ctx);
      },
    }, lockIcon(locked), locked ? 'Locked — tap to edit' : 'Editing past day');
    pieces.push(el('div', { class: 'lock-row' }, pill));
  }
  container.replaceChildren(...pieces, cards, workoutSection(iso, locked, () => render(container, ctx)));

  if (!locked && active.length === 0 && archivedWithData.length === 0) {
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

// Below the trackers: the day's workout, or a quiet button to start one.
function workoutSection(iso, locked, rerender) {
  const wrap = el('div', { class: 'workout-section' });
  const wo = getWorkout(iso);
  const open = () => openWorkout(iso, { locked, onClose: rerender });

  if (wo) {
    const named = wo.lifts.filter((l) => l.name);
    wrap.append(el('button', { class: 'card workout-card', onclick: open },
      el('span', { class: 'wo-sum' },
        el('span', { class: 'wo-class' }, `${SPLIT_LABELS[wo.split]} · ${FOCUS_LABELS[wo.focus]}`),
        el('span', { class: 'wo-meta' }, `${named.length} lift${named.length === 1 ? '' : 's'} · ${named.map((l) => l.name).join(', ')}`),
      ),
      el('span', { class: 'wo-chevron' }, '›'),
    ));
  } else if (!locked) {
    wrap.append(el('button', { class: 'ghost-btn', onclick: open }, '+ Log workout'));
  }
  return wrap;
}

function trackerCard(t, iso, entry, locked) {
  let card;
  if (t.type === 'number' || t.type === 'measurement') card = numberCard(t, iso, entry, locked);
  else if (t.type === 'checkbox') card = checkboxCard(t, iso, entry, locked);
  else if (t.type === 'select' || t.type === 'multiselect') card = selectCard(t, iso, entry, locked);
  else card = textCard(t, iso, entry, locked);
  if (locked) card.classList.add('is-locked');
  return card;
}

function lockIcon(closed) {
  const span = el('span', { class: 'lock-ico', 'aria-hidden': 'true' });
  span.innerHTML = closed
    ? '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
    : '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 5.7-1.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  return span;
}

function numberCard(t, iso, entry, locked) {
  const isMeasure = t.type === 'measurement';
  const target = !isMeasure ? targetFor(t, iso) : null;
  const dailyGoal = target && target.period === 'day' ? target.value : null;

  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: '·',
    'aria-label': t.name,
    readonly: locked,
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
    const met = dayMeets(t, iso);
    fill.classList.toggle('met', met);
    tlText.classList.toggle('met', met);
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

  // measurements show the previous reading for context instead of a target
  if (isMeasure) {
    const prev = previousValue(t.id, iso);
    return el('label', { class: 'card card-num' }, row,
      prev && el('span', { class: 'target-line' },
        el('span', { class: 'tl-text' },
          `last ${prev.value.toLocaleString()}${t.unit ? ' ' + t.unit : ''} · ${fmt(prev.iso, { month: 'short', day: 'numeric' })}`),
      ),
    );
  }

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

function selectCard(t, iso, entry, locked) {
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
    const chip = el('button', { class: 'chip', 'aria-pressed': String(selected.has(opt)), disabled: locked }, opt);
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
    const met = dayMeets(t, iso);
    line.firstChild.textContent = (met ? 'done today' : 'daily target')
      + (streak >= 2 ? ` · ${streak}-day streak` : '');
    line.firstChild.classList.toggle('met', met);
  };
  refresh();
  card.append(line);
  card.addEventListener('click', () => requestAnimationFrame(refresh));
}

function textCard(t, iso, entry, locked) {
  const textarea = el('textarea', {
    rows: '2',
    placeholder: locked ? '' : 'Write it down…',
    'aria-label': t.name,
    readonly: locked,
  });
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

function checkboxCard(t, iso, entry, locked) {
  const row = el('span', { class: 'num-row' },
    el('span', { class: 't-name' }, t.name),
    el('span', { class: 'check-dot' }, checkIcon()),
  );
  const btn = el('button', {
    class: 'card card-check card-num',
    'aria-pressed': String(Boolean(entry[t.id])),
    disabled: locked,
  }, row);
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
