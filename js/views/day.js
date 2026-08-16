// Day view — the quick-entry ledger. Renders once per date; typing updates
// the store directly (no re-render), so focus and the keyboard stay put.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, weekdayName, fmt } from '../dates.js';
import { getEntry, setValue, persistNow, getNote, setNote } from '../store.js';
import { photosOn, addPhoto, deletePhoto } from '../photos.js';
import { activeTrackers, allTrackers, targetFor, streakFor, dayMeets, previousValue } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, FOCUS_LABELS, sessionHadPR } from '../workouts.js';
import { openWorkout } from './workout.js';

// Past days are read-only unless explicitly unlocked; the unlock covers one
// day and drops as soon as you navigate away.
let unlockedISO = null;

// Live swipe-gesture state, shared between the per-render on* handlers and
// the once-bound non-passive touchmove listener.
const g = { hint: null, iso: null, ctx: null, startX: null, startY: null, startScroll: 0, axis: null };

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

  const rerender = () => render(container, ctx);
  const cards = el('div', { class: 'cards' });
  // locked days show only what was actually logged. The Weightlifting
  // checkbox is derived from the workout log (logging a workout checks it),
  // so it has no card of its own — the workout section IS that checkbox.
  const isLiftBox = (t) => t.type === 'checkbox' && /weightlift/i.test(t.name);
  // measurements (weight) first — the morning number leads the day
  const active = activeTrackers()
    .filter((t) => !isLiftBox(t) && (!locked || t.id in entry))
    .sort((a, b) => (a.type === 'measurement' ? 0 : 1) - (b.type === 'measurement' ? 0 : 1));
  for (const t of active) cards.append(trackerCard(t, iso, entry, locked, rerender));

  // archived trackers still show on days where they have data
  const archivedWithData = allTrackers().filter((t) => t.archived && !isLiftBox(t) && t.id in entry);
  for (const t of archivedWithData) {
    const card = trackerCard(t, iso, entry, locked, rerender);
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
  container.replaceChildren(...pieces, cards,
    workoutSection(iso, locked, () => render(container, ctx)),
    journalSection(iso, locked));

  if (!locked && active.length === 0 && archivedWithData.length === 0) {
    cards.append(el('div', { class: 'empty-state' }, 'No trackers yet. Add one in Settings.'));
  }

  // textareas need layout before autogrow can measure them
  requestAnimationFrame(() => {
    container.querySelectorAll('textarea').forEach(grow);
  });

  // Gestures with live feedback. on* assignment replaces on re-render, but
  // touchmove must be non-passive (to preventDefault a side swipe) which
  // needs addEventListener — so that one is bound once per container.
  //  - swipe left/right -> previous / next day
  //  - pull down at the top -> zoom out to this day's week
  const DIST = 70;
  const hint = el('div', { class: 'swipe-hint' });
  container.append(hint);
  // g holds the in-flight gesture; hint/iso/ctx are refreshed every render so
  // the once-bound touchmove listener never reads a stale closure.
  g.hint = hint;
  g.iso = iso;
  g.ctx = ctx;
  g.startX = g.startY = null;
  g.axis = null;

  const resetGesture = () => {
    container.classList.remove('gesture-live', 'gesture-lock');
    container.style.transform = '';
    g.hint.classList.remove('show');
    g.startX = g.startY = null;
    g.axis = null;
  };

  container.ontouchstart = (e) => {
    if (e.target.closest('input, textarea, button')) { g.startX = g.startY = null; return; }
    g.startX = e.touches[0].clientX;
    g.startY = e.touches[0].clientY;
    g.startScroll = container.scrollTop;
    g.axis = null;
  };
  // non-passive so a committed side swipe can preventDefault() and stop the
  // page scrolling vertically at the same time. Bound once per container.
  if (!container.dataset.gestureBound) {
    container.dataset.gestureBound = '1';
    container.addEventListener('touchmove', (e) => {
      if (g.startY === null) return;
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      if (!g.axis && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x'
          : (g.startScroll <= 0 && dy > 0 ? 'y' : 'scroll');
        if (g.axis !== 'scroll') container.classList.add('gesture-live');
        // committed to a side swipe: freeze scrolling for the rest of it
        if (g.axis === 'x') container.classList.add('gesture-lock');
      }
      // once locked to an axis, own the gesture — no concurrent scroll
      if ((g.axis === 'x' || g.axis === 'y') && e.cancelable) e.preventDefault();
      if (g.axis === 'x') {
        container.style.transform = `translateX(${Math.max(-90, Math.min(90, dx * 0.35))}px)`;
        const armed = Math.abs(dx) > DIST;
        g.hint.textContent = dx < 0 ? '›' : '‹';
        g.hint.className = 'swipe-hint ' + (dx < 0 ? 'right' : 'left') + ' show' + (armed ? ' armed' : '');
      } else if (g.axis === 'y') {
        container.style.transform = `translateY(${Math.min(70, dy * 0.35)}px)`;
        const armed = dy > DIST + 20;
        g.hint.textContent = '⌄';
        g.hint.className = 'swipe-hint top show' + (armed ? ' armed' : '');
      }
    }, { passive: false });
  }
  container.ontouchend = (e) => {
    if (g.startY === null) return;
    const dx = e.changedTouches[0].clientX - g.startX;
    const dy = e.changedTouches[0].clientY - g.startY;
    const usedAxis = g.axis;
    const scrolledTop = g.startScroll <= 0 && container.scrollTop <= 0;
    resetGesture();
    if (usedAxis === 'x' && Math.abs(dx) > DIST) {
      g.ctx.setDate(addDays(g.iso, dx < 0 ? 1 : -1));
      return;
    }
    // zoom out one level: this day's week
    if (usedAxis === 'y' && scrolledTop && dy > DIST + 20 && g.ctx.goTab) g.ctx.goTab('week', { detail: true });
  };
  container.ontouchcancel = resetGesture;
}

// Optional journal for the day: a free-text note and progress photos.
// Both start collapsed behind quiet buttons — zero pressure when unused.
function journalSection(iso, locked) {
  const wrap = el('div', { class: 'journal-section' });
  const note = getNote(iso);

  // --- note ---
  const noteBox = el('div', { class: 'card card-text journal-note' });
  const buildNote = (open) => {
    noteBox.replaceChildren();
    if (!open) return;
    const ta = el('textarea', {
      rows: '2', placeholder: 'How did today go?', 'aria-label': 'Day note', readonly: locked,
    });
    ta.value = getNote(iso);
    ta.addEventListener('input', () => { grow(ta); setNote(iso, ta.value); });
    ta.addEventListener('blur', () => {
      persistNow();
      // opened but left empty -> revert to "no note" (collapse + restore the button)
      if (!ta.value.trim()) {
        setNote(iso, '');
        buildNote(false);
        if (!locked && !actions.querySelector('.journal-note-btn')) {
          actions.prepend(el('button', {
            class: 'ghost-btn journal-btn journal-note-btn',
            onclick: (e) => { buildNote(true); e.currentTarget.remove(); noteBox.querySelector('textarea').focus(); },
          }, '+ Note'));
        }
      }
    });
    noteBox.append(el('span', { class: 't-name' }, 'Note'), ta);
    requestAnimationFrame(() => grow(ta));
  };
  const hasNote = Boolean(note.trim());
  buildNote(hasNote);
  if (locked) noteBox.classList.add('is-locked');

  // --- photos ---
  const photoStrip = el('div', { class: 'photo-strip' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      await addPhoto(iso, file);
      await loadPhotos();
    } catch (e) {
      alert('Could not save that photo. Try a smaller image.');
    }
  });

  const loadPhotos = async () => {
    const photos = await photosOn(iso);
    photoStrip.replaceChildren();
    for (const p of photos) {
      const url = URL.createObjectURL(p.blob);
      const img = el('img', { src: url, alt: `Progress photo ${iso}`, class: 'photo-thumb' });
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      const tile = el('div', { class: 'photo-tile' }, img);
      tile.addEventListener('click', () => openLightbox(p, iso, locked, loadPhotos));
      photoStrip.append(tile);
    }
    photoStrip.hidden = photos.length === 0;
  };
  loadPhotos();

  const actions = el('div', { class: 'journal-actions' });
  if (!locked) {
    if (!hasNote) {
      actions.append(el('button', {
        class: 'ghost-btn journal-btn journal-note-btn',
        onclick: (e) => { buildNote(true); e.currentTarget.remove(); noteBox.querySelector('textarea').focus(); },
      }, '+ Note'));
    }
    actions.append(el('button', { class: 'ghost-btn journal-btn', onclick: () => fileInput.click() }, '+ Photo'));
  }

  wrap.append(noteBox, photoStrip, actions, fileInput);
  return wrap;
}

function openLightbox(photo, iso, locked, onChange) {
  const backdrop = el('div', { class: 'sheet-backdrop lightbox' });
  const close = () => { backdrop.remove(); URL.revokeObjectURL(url); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const url = URL.createObjectURL(photo.blob);
  backdrop.append(el('div', { class: 'lightbox-body' },
    el('img', { src: url, alt: `Progress photo ${iso}`, class: 'lightbox-img' }),
    el('div', { class: 'btn-row lightbox-actions' },
      el('button', { class: 'btn', onclick: close }, 'Close'),
      !locked && el('button', {
        class: 'btn danger',
        onclick: async () => {
          if (confirm('Delete this photo?')) { await deletePhoto(photo.id); close(); onChange(); }
        },
      }, 'Delete'),
    ),
  ));
  document.body.append(backdrop);
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
        el('span', { class: 'wo-class' },
          `${SPLIT_LABELS[wo.split]} · ${FOCUS_LABELS[wo.focus]}`,
          sessionHadPR(iso) && el('span', { class: 'pr-star' }, ' ★ PR'),
        ),
        el('span', { class: 'wo-meta' }, `${named.length} lift${named.length === 1 ? '' : 's'} · ${named.map((l) => l.name).join(', ')}`),
      ),
      el('span', { class: 'wo-chevron' }, '›'),
    ));
  } else if (!locked) {
    wrap.append(el('button', { class: 'ghost-btn', onclick: open }, '+ Log workout'));
  }
  return wrap;
}

function trackerCard(t, iso, entry, locked, rerender) {
  let card;
  if (t.type === 'number' || t.type === 'measurement') card = numberCard(t, iso, entry, locked, rerender);
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

function numberCard(t, iso, entry, locked, rerender) {
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

// For non-number cards with a daily target: show the running streak once
// there IS one (≥2 days) — no "daily target" filler text otherwise.
function attachStreakLine(card, t, iso) {
  const target = targetFor(t, iso);
  if (!target || target.period !== 'day') return;
  if (streakFor(t, iso) < 2) return;
  const line = el('span', { class: 'target-line' }, el('span', { class: 'tl-text' }, ''));
  const refresh = () => {
    const streak = streakFor(t, iso);
    const met = dayMeets(t, iso);
    line.firstChild.textContent = streak >= 2 ? `${streak}-day streak` : '';
    line.firstChild.classList.toggle('met', met);
    line.hidden = streak < 2;
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
