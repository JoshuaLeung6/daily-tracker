// Workout editor — a full-screen sheet over the day view.
// Numbers are NEVER pre-filled: every row starts empty and shows what you
// did last time as a reference to beat. Lift names come from one-tap
// suggestion chips (last same-classification workout) or a picker sheet
// with your full lift history.

import { el } from '../ui.js';
import { fmt, weekdayName } from '../dates.js';
import {
  SPLITS, SPLIT_LABELS, FOCUSES, FOCUS_LABELS,
  getWorkout, saveWorkout, deleteWorkout, templateFor, suggestedClass,
  liftsBySplit, lastLiftOfFocus, repRange, suggestedNextLoad,
} from '../workouts.js';

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

  const addLift = (name) => {
    if (!name || !name.trim()) return;
    draft.lifts.push({ name: name.trim(), weight: null, reps: null, sets: null });
    touch();
    renderRows();
    renderSuggestions();
    // no auto-focus: raising the keyboard uninvited is exactly the annoyance
    // we're avoiding — tap a cell when ready
  };

  // classification segments
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
    }, f === 'weight' ? 'Weight' : 'Volume')));
  };
  const setClass = (patch) => {
    Object.assign(draft, patch);
    if (dirty) persist();
    renderSegs();
    renderRows();          // previews depend on focus
    renderSuggestions();   // suggestions depend on classification
  };

  // one-tap suggestions: lift names from the last same-classification workout
  const suggestWrap = el('div', { class: 'suggest-wrap' });
  const renderSuggestions = () => {
    suggestWrap.replaceChildren();
    if (locked) return;
    const added = new Set(draft.lifts.map((l) => (l.name || '').trim().toLowerCase()));
    const names = templateFor(draft.split, draft.focus, iso)
      .map((l) => l.name)
      .filter((n) => !added.has(n.trim().toLowerCase()));
    if (names.length === 0) return;
    suggestWrap.append(
      el('div', { class: 'wo-seg-label' }, `Last ${SPLIT_LABELS[draft.split]} · ${FOCUS_LABELS[draft.focus]}`),
      el('div', { class: 'chips' }, ...names.map((n) =>
        el('button', { class: 'chip chip-suggest', onclick: () => addLift(n) }, `+ ${n}`))),
    );
  };

  // lift rows
  const rows = el('div', { class: 'lift-rows' });
  const renderRows = () => {
    rows.replaceChildren();
    draft.lifts.forEach((lift, i) => rows.append(liftRow(lift, i)));
    if (draft.lifts.length === 0) {
      rows.append(el('div', { class: 'empty-state' },
        locked ? 'No lifts logged.' : 'No lifts yet — tap a suggestion or add one below.'));
    }
  };

  const numInput = (lift, key, label, integer) => {
    const input = el('input', {
      type: 'text',
      inputmode: integer ? 'numeric' : 'decimal',
      autocomplete: 'off',
      enterkeyhint: 'next',
      class: 'lift-num',
      'aria-label': label,
      readonly: locked,
      value: lift[key] != null ? String(lift[key]) : '',
    });
    input.addEventListener('input', () => {
      const cleaned = input.value.replace(integer ? /[^0-9]/g : /[^0-9.,]/g, '');
      if (cleaned !== input.value) input.value = cleaned;
      const num = integer ? parseInt(cleaned, 10) : parseFloat(cleaned.replace(',', '.'));
      lift[key] = Number.isFinite(num) ? num : null;
      touch();
    });
    // keep the focused cell above the iOS keyboard
    input.addEventListener('focus', () => {
      setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    });
    return input;
  };

  const previewText = (name) => {
    if (!name || !name.trim()) return '';
    const same = lastLiftOfFocus(name, draft.focus, iso);
    const any = same || lastLiftOfFocus(name, null, iso);
    if (!any) return 'first time — no previous sessions';
    const setStr = [any.weight, any.reps, any.sets].filter((v) => v != null)
      .map((v) => v.toLocaleString()).join(' × ') || '—';
    const label = same ? `last ${FOCUS_LABELS[any.focus].toLowerCase()}` : `last (${FOCUS_LABELS[any.focus].toLowerCase()})`;
    let text = `${label}: ${setStr} · ${fmt(any.date, { month: 'short', day: 'numeric' })}`;
    // double progression: rep ceiling filled last time -> nudge the load up
    if (same && same.reps != null && same.weight != null && same.reps >= repRange(name, draft.focus).hi) {
      text += ` · ready: try ${suggestedNextLoad(same.weight).toLocaleString()}`;
    }
    return text;
  };

  // A log row: the lift NAME is a fixed label (names are chosen in the picker,
  // never typed here) — the row is just three number cells + remove.
  const liftRow = (lift, index) => {
    const preview = el('div', { class: 'lift-preview' }, previewText(lift.name));
    const remove = el('button', {
      class: 'row-x',
      'aria-label': `Remove ${lift.name || 'lift'}`,
      hidden: locked,
      onclick: () => {
        draft.lifts.splice(index, 1);
        touch();
        renderRows();
        renderSuggestions();
      },
    }, '✕');

    return el('div', { class: 'lift-block' },
      el('div', { class: 'lift-row' },
        el('span', { class: 'lift-label', 'aria-label': 'Lift name' }, lift.name || '—'),
        numInput(lift, 'weight', 'Weight', false),
        numInput(lift, 'reps', 'Reps', true),
        numInput(lift, 'sets', 'Sets', true),
        remove,
      ),
      preview,
    );
  };

  // lift picker sheet — no keyboard: lifts grouped by Push / Pull / Legs in
  // collapsible sections (current split open), tap to add. "New lift…" at
  // the bottom reveals a text field only when actually creating one.
  const openSections = new Set([draft.split]);
  const openPicker = () => {
    const backdrop = el('div', { class: 'sheet-backdrop' });
    const closePicker = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePicker(); });

    const listEl = el('div', { class: 'pick-list' });
    const added = new Set(draft.lifts.map((l) => (l.name || '').trim().toLowerCase()));
    const groups = liftsBySplit();
    let showNew = false;

    const renderList = () => {
      listEl.replaceChildren();
      let anyLift = false;
      for (const sp of SPLITS) {
        const items = groups[sp];
        const open = openSections.has(sp);
        listEl.append(el('button', {
          class: 'pick-section' + (open ? ' open' : ''),
          'aria-expanded': String(open),
          onclick: () => { if (open) openSections.delete(sp); else openSections.add(sp); renderList(); },
        },
          el('span', {}, SPLIT_LABELS[sp]),
          el('span', { class: 'pick-count' }, `${items.length}`),
          el('span', { class: 'wo-chevron' }, open ? '⌄' : '›'),
        ));
        if (!open) continue;
        if (items.length === 0) {
          listEl.append(el('div', { class: 'pick-empty' }, `No ${SPLIT_LABELS[sp].toLowerCase()} lifts yet.`));
        }
        for (const it of items) {
          anyLift = true;
          const isAdded = added.has(it.name.toLowerCase());
          listEl.append(el('button', {
            class: 'pick-row', disabled: isAdded,
            onclick: () => { addLift(it.name); closePicker(); },
          },
            el('span', {}, it.name),
            el('span', { class: 'pick-hint' }, isAdded ? 'added' : previewText(it.name).replace(/^last [^:]*: /, '').replace(/^first time.*/, 'new')),
          ));
        }
      }
      if (!anyLift && SPLITS.every((s) => groups[s].length === 0)) {
        listEl.append(el('div', { class: 'empty-state' }, 'No lifts yet — create your first below.'));
      }

      // new lift (typed) — only shows a field when asked for
      if (showNew) {
        const nameIn = el('input', { type: 'text', placeholder: 'Lift name', 'aria-label': 'New lift name', autocomplete: 'off' });
        const create = () => {
          const n = nameIn.value.trim();
          if (!n) return;
          addLift(n);
          closePicker();
        };
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
        listEl.append(el('div', { class: 'food-newform' },
          nameIn,
          el('button', { class: 'btn primary sr-goalbtn', onclick: create }, 'Add'),
        ));
        setTimeout(() => nameIn.focus(), 50);
      } else {
        listEl.append(el('button', {
          class: 'pick-row pick-new',
          onclick: () => { showNew = true; renderList(); },
        }, '＋ New lift…'));
      }
    };
    renderList();

    backdrop.append(el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add lift' },
      el('div', { class: 'food-head' },
        el('h2', {}, 'Add lift'),
        el('button', { class: 'btn', onclick: closePicker }, 'Close'),
      ),
      listEl,
    ));
    document.body.append(backdrop);
  };

  renderSegs();
  renderRows();
  renderSuggestions();

  const body = el('div', { class: 'wo-body' },
    // split + day type side by side
    el('div', { class: 'wo-class-row' },
      el('div', { class: 'wo-class-col' }, el('div', { class: 'wo-seg-label' }, 'Split'), splitSeg),
      el('div', { class: 'wo-class-col' }, el('div', { class: 'wo-seg-label' }, 'Day type'), focusSeg),
    ),
    suggestWrap,
    el('div', { class: 'lift-labels' },
      el('span', { class: 'll-name' }, 'Lift'),
      el('span', {}, 'Weight'),
      el('span', {}, 'Reps'),
      el('span', {}, 'Sets'),
      el('span', { class: 'll-x' }),
    ),
    rows,
    !locked && el('button', { class: 'ghost-btn', onclick: openPicker }, '+ Add lift'),
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
