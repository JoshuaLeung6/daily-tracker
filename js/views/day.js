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

// Commit rule, shared by the live preview and touchend so the armed
// indicator NEVER disagrees with what actually happens on release.
// Distance OR velocity, like every native pager: a long deliberate drag
// commits, and so does a short fast flick.
export const SWIPE_DIST = 90;      // px of travel that commits on its own
export const SWIPE_VELOCITY = 0.45; // px/ms (~450 px/s) that commits a flick
export function willCommit(delta, velocity) {
  if (Math.abs(delta) < 24) return false;              // ignore stray touches
  if (Math.abs(delta) >= SWIPE_DIST) return true;
  // a flick counts only if it is still moving the same way it was dragged
  return Math.abs(velocity) >= SWIPE_VELOCITY && Math.sign(velocity) === Math.sign(delta);
}

// Page transition on commit. What made the swipe feel wrong was not the
// thresholds: on release the view SPRANG BACK to zero and then the content
// swapped — the page moved against your finger, then teleported. A native
// pager continues in the direction you swiped: the outgoing page slides off
// that edge, the incoming one slides in from the other. This does that with
// the view's own transform transition: finish the exit off-screen, swap the
// content while it is out of sight, park it just past the far edge with no
// transition, then let it slide home.
//   dir: -1 = content moves left (you swiped left, going forward)
//        +1 = content moves right (you swiped right, going back)
let sliding = false;
let slideTimer = null;
export function slidePage(container, dir, swap) {
  // ignore a second swipe that lands mid-transition; a queued double-swap
  // would skip a page and leave the transform in a half state
  if (sliding) return;
  sliding = true;
  // SELF-HEAL: whatever happens below (a swap that throws, a tab switch mid
  // animation, a touchcancel), the lock MUST release, or every later swipe is
  // silently dropped and the app reads as "stuck". Hard ceiling on the lock.
  clearTimeout(slideTimer);
  slideTimer = setTimeout(() => {
    sliding = false;
    container.classList.remove('gesture-live');
    container.style.transform = '';
    container.style.opacity = '';
  }, 800);
  const w = container.clientWidth || window.innerWidth;
  const OUT = 220; // ms, matches the CSS transition
  // The drag left `gesture-live` (transition: none) on the container. Turning
  // the transition back on and setting the target in the SAME tick does not
  // animate — the browser coalesces both into one style change. Force a
  // reflow in between so the transition actually engages from the drag
  // position.
  container.classList.remove('gesture-live');
  void container.offsetWidth; // reflow: commit "transition on" first
  container.style.transform = `translateX(${dir * w}px)`;
  container.style.opacity = '0.6';
  setTimeout(() => {
    try { swap(); } catch (err) { console.error('slidePage swap failed', err); }
    // park off the OPPOSITE edge with no transition, then release
    container.classList.add('gesture-live');
    container.style.transform = `translateX(${-dir * w}px)`;
    container.style.opacity = '0.6';
    container.scrollTop = 0;
    void container.offsetWidth; // reflow: commit the parked position
    container.classList.remove('gesture-live');
    void container.offsetWidth; // reflow: transition back on, still parked
    container.style.transform = '';
    container.style.opacity = '';
    setTimeout(() => { sliding = false; clearTimeout(slideTimer); }, OUT);
  }, OUT);
}

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
    // no forward navigation past today — nothing to log for a future day
    el('button', {
      class: 'nav-arrow', 'aria-label': 'Next day', disabled: iso >= today,
      onclick: () => { if (iso < today) ctx.setDate(addDays(iso, 1)); },
    }, '›'),
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
  const HINT_W = 30; // .swipe-hint width (26) + its 2px edge offset, both sides
  // The hint lives on <body>, NOT inside the view: a transformed ancestor
  // makes position:fixed resolve against that ancestor, so a hint inside the
  // view would slide along with the content and always overlap it.
  const hint = document.getElementById('swipe-hint')
    || el('div', { class: 'swipe-hint', id: 'swipe-hint' });
  if (hint.parentElement !== document.body) document.body.append(hint);
  // g holds the in-flight gesture; hint/iso/ctx are refreshed every render so
  // the once-bound touchmove listener never reads a stale closure.
  g.hint = hint;
  g.iso = iso;
  g.ctx = ctx;
  // never swipe past today — there is nothing to log for a future day
  g.canNext = iso < todayISO();
  g.startX = g.startY = null;
  g.axis = null;

  const resetGesture = () => {
    container.classList.remove('gesture-live');
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
    // velocity tracking: a fast flick should commit even if it is short,
    // which is how every native pager (UIPageViewController, ViewPager2) works
    g.lastX = g.startX;
    g.lastY = g.startY;
    g.lastT = e.timeStamp;
    g.vx = 0;
    g.vy = 0;
  };
  // non-passive so a committed side swipe can preventDefault() and stop the
  // page scrolling vertically at the same time. Bound once per container.
  if (!container.dataset.gestureBound) {
    container.dataset.gestureBound = '1';
    container.addEventListener('touchmove', (e) => {
      if (g.startY === null) return;
      const dx = e.touches[0].clientX - g.startX;
      const dy = e.touches[0].clientY - g.startY;
      // rolling velocity in px/ms, used by touchend to accept a fast flick
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) {
        const nvx = (e.touches[0].clientX - g.lastX) / dt;
        const nvy = (e.touches[0].clientY - g.lastY) / dt;
        g.vx = g.vx * 0.7 + nvx * 0.3;   // smoothed: one jittery sample shouldn't decide
        g.vy = g.vy * 0.7 + nvy * 0.3;
        g.lastX = e.touches[0].clientX;
        g.lastY = e.touches[0].clientY;
        g.lastT = e.timeStamp;
      }
      if (!g.axis && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        // Decide the axis ONCE, and be strict about claiming vertical: the
        // pull-down-to-zoom-out gesture only owns a drag that is clearly
        // downward (steeper than it is wide) AND starts from the very top.
        // Everything else — an upward swipe, a diagonal, a wobble — is a
        // scroll and must be left to the browser. Claiming 'y' too eagerly
        // was the "stuck" bug: an upward flick got captured, translated the
        // whole page off-screen, and never scrolled.
        if (Math.abs(dx) > Math.abs(dy) * 1.4) g.axis = 'x';
        else if (g.startScroll <= 0 && dy > 0 && dy > Math.abs(dx) * 1.4) g.axis = 'y';
        else g.axis = 'scroll';
        if (g.axis !== 'scroll') container.classList.add('gesture-live');
      }
      // scrolling stays free during a swipe — the drag is only a visual follow
      if (g.axis === 'x') {
        // swiping forward from today is blocked: heavy rubber-band resistance
        const blocked = dx < 0 && !g.canNext;
        // 1:1 with the finger, the native pager feel. A blocked direction gets
        // progressive resistance instead, so it reads as a wall, not a lag.
        const shift = blocked ? Math.sign(dx) * Math.pow(Math.abs(dx), 0.6) * 1.2 : dx;
        container.style.transform = `translateX(${shift}px)`;
        const armed = !blocked && willCommit(dx, g.vx);
        g.hint.textContent = dx < 0 ? '›' : '‹';
        // centre the glyph in the strip the view vacated
        g.hint.style.setProperty('--hint-gap', Math.abs(shift) + 'px');
        g.hint.className = 'swipe-hint ' + (dx < 0 ? 'right' : 'left') + ' show'
          + (Math.abs(shift) >= HINT_W ? ' roomy' : '')
          + (armed ? ' armed' : '') + (blocked ? ' blocked' : '');
        // whole-view cue: once past the commit point the page dims slightly,
        // so the threshold is visible without watching the small chevron
        container.classList.toggle('gesture-armed', armed);
      } else if (g.axis === 'y') {
        // pull-down only ever moves DOWN. If the finger comes back above the
        // start point, snap to rest rather than dragging the page upward.
        const shift = Math.max(0, dy);
        container.style.transform = `translateY(${shift}px)`;
        const armed = dy > 0 && willCommit(dy, g.vy);
        g.hint.textContent = '⌄';
        g.hint.style.setProperty('--hint-gap', shift + 'px');
        g.hint.className = 'swipe-hint top show'
          + (shift >= HINT_W ? ' roomy' : '') + (armed ? ' armed' : '');
        container.classList.toggle('gesture-armed', armed);
      }
    }, { passive: false });
  }
  container.ontouchend = (e) => {
    if (g.startY === null) return;
    const dx = e.changedTouches[0].clientX - g.startX;
    const dy = e.changedTouches[0].clientY - g.startY;
    const usedAxis = g.axis;
    const scrolledTop = g.startScroll <= 0 && container.scrollTop <= 0;
    const vx = g.vx;
    const vy = g.vy;
    // same willCommit() the preview used, so the armed cue always tells truth
    if (usedAxis === 'x' && willCommit(dx, vx)) {
      const forward = dx < 0;
      if (forward && !g.canNext) { resetGesture(); return; }
      // do NOT reset the transform here — slidePage continues the motion in
      // the swipe direction and swaps the content while it is off-screen
      g.hint.classList.remove('show');
      container.classList.remove('gesture-armed');
      const target = addDays(g.iso, forward ? 1 : -1);
      const c = g.ctx;
      g.startX = g.startY = null; g.axis = null;
      slidePage(container, forward ? -1 : 1, () => c.setDate(target));
      return;
    }
    resetGesture();
    // zoom out one level: this day's week
    if (usedAxis === 'y' && scrolledTop && willCommit(dy, vy) && dy > 0 && g.ctx.goTab) {
      g.ctx.goTab('week', { detail: true });
    }
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
