// Workout editor — a full-screen sheet over the day view.
//
// Layout, top to bottom:
//   1. classification: split (Push/Pull/Legs) + day type (Weight/Volume/Maint.)
//   2. logged lifts — one block per lift: name, then three number cells
//      (lb × reps × sets) with the last three sessions of that lift stacked
//      beside them as the reference to beat. Numbers are NEVER pre-filled.
//   3. add lifts — inline, no popup: one-tap chips from the last same-split
//      session, then every known lift under collapsible Push / Pull / Legs
//      headers (collapsed by default), and a "New lift…" row that reveals a
//      text field only when actually creating one.
//   4. delete workout (existing workouts only)

import { el } from '../ui.js';
import { svgEl } from '../charts.js';
import { fmt, weekdayName } from '../dates.js';
import {
  SPLITS, SPLIT_LABELS, FOCUSES, FOCUS_LABELS,
  getWorkout, saveWorkout, deleteWorkout, templateFor, suggestedClass,
  liftsBySplit, recentLifts, isLiftPR,
} from '../workouts.js';

const DAY_TYPE_SHORT = { weight: 'Weight', volume: 'Volume', maintenance: 'Maint.' };

// "185×8×3 @2" — the notation used everywhere a set is shown. The @ suffix
// is the RIR (reps in reserve) of the LAST working set, when logged.
const rirStr = (r) => (r == null ? '' : ` @${r >= 4 ? '4+' : r}`);
const setStr = (l) => ([l.weight, l.reps, l.sets].filter((v) => v != null)
  .map((v) => v.toLocaleString()).join('×') || '—') + rirStr(l.rir);

export function openWorkout(iso, { locked = false, onClose } = {}) {
  const existing = getWorkout(iso);
  const draft = existing
    ? { split: existing.split, focus: existing.focus, lifts: existing.lifts.map((l) => ({ ...l })) }
    : { ...suggestedClass(iso), lifts: [] };

  let dirty = Boolean(existing);
  const persist = () => { if (dirty && !locked) saveWorkout(iso, draft); };
  const touch = () => { dirty = true; persist(); };

  const overlay = el('div', { class: 'workout-overlay' });
  const close = () => {
    persist();
    overlay.remove();
    if (onClose) onClose();
  };

  const addedNames = () => new Set(draft.lifts.map((l) => (l.name || '').trim().toLowerCase()));

  const addLift = (name) => {
    if (!name || !name.trim()) return;
    draft.lifts.push({ name: name.trim(), weight: null, reps: null, sets: null, rir: null, locked: false });
    touch();
    renderRows();
    renderAdd();
    // no auto-focus: raising the keyboard uninvited is exactly the annoyance
    // we're avoiding — tap a cell when ready
  };
  const removeLift = (index) => {
    draft.lifts.splice(index, 1);
    touch();
    renderRows();
    renderAdd();
  };

  // ---- 1. classification segments ----
  const splitSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Split' });
  const focusSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Day type' });
  const renderSegs = () => {
    splitSeg.replaceChildren(...SPLITS.map((sp) => el('button', {
      class: 'seg-btn',
      'aria-pressed': String(draft.split === sp),
      disabled: locked,
      onclick: () => setClass({ split: sp }),
    }, SPLIT_LABELS[sp])));
    focusSeg.replaceChildren(...FOCUSES.map((f) => el('button', {
      class: 'seg-btn',
      'aria-pressed': String(draft.focus === f),
      disabled: locked,
      'aria-label': FOCUS_LABELS[f],
      onclick: () => setClass({ focus: f }),
    }, DAY_TYPE_SHORT[f])));
  };
  const setClass = (patch) => {
    Object.assign(draft, patch);
    if (dirty) persist();
    renderSegs();
    renderRows();
    renderAdd();   // suggestions follow the split
  };

  // ---- 2. logged lifts ----
  const numInput = (lift, key, label, integer, onValue) => {
    const input = el('input', {
      type: 'text',
      inputmode: integer ? 'numeric' : 'decimal',
      autocomplete: 'off',
      enterkeyhint: 'next',
      class: 'lift-num',
      'aria-label': label,
      readonly: locked || lift.locked === true,
      value: lift[key] != null ? String(lift[key]) : '',
    });
    input.addEventListener('input', () => {
      if (lift.locked) return;
      const cleaned = input.value.replace(integer ? /[^0-9]/g : /[^0-9.,]/g, '');
      if (cleaned !== input.value) input.value = cleaned;
      const num = integer ? parseInt(cleaned, 10) : parseFloat(cleaned.replace(',', '.'));
      lift[key] = Number.isFinite(num) ? num : null;
      touch();
      if (onValue) onValue();
    });
    // keep the focused cell above the iOS keyboard
    input.addEventListener('focus', () => {
      setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    });
    return input;
  };
  const cell = (lift, key, label, unit, integer, onValue) => el('label', { class: 'lift-cell' },
    numInput(lift, key, label, integer, onValue),
    el('span', { class: 'lift-unit' }, unit),
  );

  // Per-lift lock: freezes the row (inputs read-only, RIR and remove off)
  // so a finished entry can't be fat-thumbed while logging the next lift.
  // Persisted on the lift, so it survives closing and reopening the editor.
  const lockBtn = (lift) => {
    if (locked) return null;   // the whole day is read-only already
    // svgEl takes (tag, attrs, text) — element children must be appended
    const ico = svgEl('svg', { viewBox: '0 0 24 24', class: 'lift-lock-ico', 'aria-hidden': 'true' });
    ico.append(
      svgEl('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4', class: 'lk-shackle' }),
      svgEl('rect', { x: '5.5', y: '11', width: '13', height: '8.5', rx: '2', class: 'lk-body' }),
    );
    return el('button', {
      class: 'lift-lock' + (lift.locked ? ' on' : ''),
      'aria-label': `${lift.locked ? 'Unlock' : 'Lock'} ${lift.name || 'lift'}`,
      'aria-pressed': String(lift.locked === true),
      onclick: () => { lift.locked = lift.locked !== true; touch(); renderRows(); },
    }, ico);
  };

  // The last three sessions of this lift, ANY day type, newest first, one
  // per line: what you did last is what you load against.
  const previewEl = (name) => {
    const wrap = el('div', { class: 'lift-preview' });
    if (!name || !name.trim()) return wrap;
    for (const l of recentLifts(name, iso, 3)) {
      wrap.append(el('div', { class: 'lp-line' },
        el('span', { class: 'lp-set' }, setStr(l)),
        el('span', { class: 'lp-date' }, fmt(l.date, { month: 'short', day: 'numeric' }))));
    }
    return wrap;
  };

  // RIR pill: optional, one tap cycles — → 0 → 1 → 2 → 3 → 4+ → —.
  // It describes the LAST working set (the hardest one at a fixed load);
  // no per-set logging. Never required, invisible cost when unused.
  const RIR_CYCLE = [null, 0, 1, 2, 3, 4];
  const rirLabel = (r) => (r == null ? 'RIR —' : r >= 4 ? 'RIR 4+' : `RIR ${r}`);
  const rirPill = (lift) => {
    if (locked && lift.rir == null) return null;   // read-only day, nothing logged: no noise
    const b = el('button', {
      class: 'rir-pill' + (lift.rir != null ? ' rir-set' : ''),
      'aria-label': 'Reps in reserve on the last set',
      disabled: locked || lift.locked === true,
      onclick: () => {
        const i = RIR_CYCLE.indexOf(lift.rir != null ? lift.rir : null);
        lift.rir = RIR_CYCLE[(i + 1) % RIR_CYCLE.length];
        touch();
        b.textContent = rirLabel(lift.rir);
        b.classList.toggle('rir-set', lift.rir != null);
      },
    }, rirLabel(lift.rir));
    return b;
  };

  const liftBlock = (lift, index) => {
    // ★ PR the moment today's numbers beat this lift's previous best e1RM —
    // refreshed on every keystroke (touch() persists first, so the check
    // always sees the current numbers); first-ever sessions never badge
    const prEl = el('span', { class: 'pr-star lift-pr', hidden: !isLiftPR(lift.name, iso) }, '★ PR');
    const refreshPR = () => { prEl.hidden = !isLiftPR(lift.name, iso); };
    return el('div', { class: 'lift-row' + (lift.locked ? ' lift-locked' : '') },
      el('div', { class: 'lift-head' },
        // badge is a SIBLING of the name, not inside it — .lift-label's
        // textContent must stay exactly the lift name
        el('span', { class: 'lift-name-wrap' },
          el('span', { class: 'lift-label', 'aria-label': 'Lift name' }, lift.name || '—'),
          prEl),
        lockBtn(lift),
        rirPill(lift),
        el('button', {
          class: 'row-x',
          'aria-label': `Remove ${lift.name || 'lift'}`,
          hidden: locked || lift.locked === true,
          onclick: () => removeLift(index),
        }, '✕'),
      ),
      el('div', { class: 'lift-body' },
        el('div', { class: 'lift-cells' },
          cell(lift, 'weight', 'Weight', 'lb', false, refreshPR),
          el('span', { class: 'lift-x' }, '×'),
          cell(lift, 'reps', 'Reps', 'reps', true, refreshPR),
          el('span', { class: 'lift-x' }, '×'),
          cell(lift, 'sets', 'Sets', 'sets', true, refreshPR),
        ),
        previewEl(lift.name),
      ),
    );
  };

  const rows = el('div', { class: 'lift-rows' });
  const renderRows = () => {
    rows.replaceChildren();
    draft.lifts.forEach((lift, i) => rows.append(liftBlock(lift, i)));
    if (draft.lifts.length === 0 && locked) {
      rows.append(el('div', { class: 'empty-state' }, 'No lifts logged.'));
    }
  };

  // ---- 3. add lifts (inline) ----
  // Which PPL sections are expanded — all collapsed to start; the state
  // survives re-renders within this editor session.
  const openSections = new Set();
  let showNew = false;
  const addWrap = el('div', { class: 'wo-add' });
  const renderAdd = () => {
    addWrap.replaceChildren();
    if (locked) return;
    const added = addedNames();

    // one-tap chips: the last same-split session, minus what's already logged
    const names = templateFor(draft.split, null, iso)
      .map((l) => l.name)
      .filter((n) => !added.has(n.trim().toLowerCase()));
    if (names.length) {
      addWrap.append(
        el('div', { class: 'wo-seg-label' }, `Last ${SPLIT_LABELS[draft.split]} session`),
        el('div', { class: 'chips' }, ...names.map((n) =>
          el('button', { class: 'chip chip-suggest', onclick: () => addLift(n) }, `+ ${n}`))),
      );
    }

    // every known lift under collapsible Push / Pull / Legs headers
    const groups = liftsBySplit();
    const list = el('div', { class: 'pick-list' });
    for (const sp of SPLITS) {
      const items = groups[sp];
      const open = openSections.has(sp);
      list.append(el('button', {
        class: 'pick-section' + (open ? ' open' : ''),
        'aria-expanded': String(open),
        onclick: () => { if (open) openSections.delete(sp); else openSections.add(sp); renderAdd(); },
      },
        el('span', {}, SPLIT_LABELS[sp]),
        el('span', { class: 'pick-count' }, `${items.length}`),
        el('span', { class: 'wo-chevron' }, open ? '⌄' : '›'),
      ));
      if (!open) continue;
      if (items.length === 0) {
        list.append(el('div', { class: 'pick-empty' }, `No ${SPLIT_LABELS[sp].toLowerCase()} lifts yet.`));
      }
      for (const it of items) {
        const isAdded = added.has(it.name.toLowerCase());
        const last = recentLifts(it.name, iso, 1)[0];
        list.append(el('button', {
          class: 'pick-row', disabled: isAdded,
          onclick: () => addLift(it.name),
        },
          el('span', {}, it.name),
          el('span', { class: 'pick-hint' }, isAdded ? 'added' : last ? setStr(last) : 'new'),
        ));
      }
    }

    // new lift (typed) — the field only appears when asked for
    if (showNew) {
      const nameIn = el('input', { type: 'text', placeholder: 'Lift name', 'aria-label': 'New lift name', autocomplete: 'off' });
      const create = () => {
        const n = nameIn.value.trim();
        if (!n) return;
        showNew = false;
        addLift(n);
      };
      nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
      list.append(el('div', { class: 'food-newform' },
        nameIn,
        el('button', { class: 'btn primary sr-goalbtn', onclick: create }, 'Add'),
        el('button', { class: 'btn', onclick: () => { showNew = false; renderAdd(); } }, 'Cancel'),
      ));
      setTimeout(() => nameIn.focus(), 50);
    } else {
      list.append(el('button', {
        class: 'pick-row pick-new',
        onclick: () => { showNew = true; renderAdd(); },
      }, '＋ New lift…'));
    }

    addWrap.append(
      el('div', { class: 'wo-seg-label' }, 'All lifts'),
      list,
    );
  };

  renderSegs();
  renderRows();
  renderAdd();

  const body = el('div', { class: 'wo-body' },
    el('div', { class: 'wo-class-row' },
      el('div', { class: 'wo-class-col' }, el('div', { class: 'wo-seg-label' }, 'Split'), splitSeg),
      el('div', { class: 'wo-class-col' }, el('div', { class: 'wo-seg-label' }, 'Day type'), focusSeg),
    ),
    rows,
    addWrap,
    !locked && existing && el('button', {
      class: 'btn danger wo-delete',
      onclick: () => {
        if (confirm('Delete this workout?')) {
          deleteWorkout(iso);
          dirty = false;
          overlay.remove();
          if (onClose) onClose();
        }
      },
    }, 'Delete workout'),
  );

  overlay.append(
    el('div', { class: 'wo-head' },
      el('div', {},
        el('div', { class: 'eyebrow' }, `${weekdayName(iso)}, ${fmt(iso, { month: 'short', day: 'numeric' })}`),
        el('h2', {}, 'Workout'),
      ),
      el('button', { class: 'btn primary', onclick: close }, locked ? 'Close' : 'Done'),
    ),
    body,
  );

  document.body.append(overlay);
}
