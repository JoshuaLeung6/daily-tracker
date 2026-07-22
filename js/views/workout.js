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
  liftNames, lastLiftOfFocus,
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
    draft.lifts.push({ name, weight: null, reps: null, sets: null });
    if (name) touch();
    renderRows();
    renderSuggestions();
    if (!name) {
      const inputs = rows.querySelectorAll('.lift-name');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
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
      onclick: () => setClass({ focus: f }),
    }, FOCUS_LABELS[f])));
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
    return `${label}: ${setStr} · ${fmt(any.date, { month: 'short', day: 'numeric' })}`;
  };

  const liftRow = (lift, index) => {
    const name = el('input', {
      type: 'text',
      class: 'lift-name',
      placeholder: 'Lift',
      autocomplete: 'off',
      'aria-label': 'Lift name',
      readonly: locked,
      value: lift.name || '',
    });
    const preview = el('div', { class: 'lift-preview' }, previewText(lift.name));
    name.addEventListener('input', () => {
      lift.name = name.value;
      touch();
      preview.textContent = previewText(lift.name);
      renderSuggestions();
    });

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
        name,
        numInput(lift, 'weight', 'Weight', false),
        numInput(lift, 'reps', 'Reps', true),
        numInput(lift, 'sets', 'Sets', true),
        remove,
      ),
      preview,
    );
  };

  // lift picker sheet — full history, search, add-new
  const openPicker = () => {
    const backdrop = el('div', { class: 'sheet-backdrop' });
    const closePicker = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePicker(); });

    const search = el('input', { type: 'text', placeholder: 'Search or type a new lift…', 'aria-label': 'Search lifts' });
    const listEl = el('div', { class: 'pick-list' });
    const added = new Set(draft.lifts.map((l) => (l.name || '').trim().toLowerCase()));
    const splitNames = liftNames(draft.split);
    const otherNames = liftNames().filter((n) => !splitNames.includes(n));

    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      listEl.replaceChildren();
      const match = (n) => !q || n.toLowerCase().includes(q);
      const pickRow = (n) => el('button', {
        class: 'pick-row', disabled: added.has(n.toLowerCase()),
        onclick: () => { addLift(n); closePicker(); },
      },
        el('span', {}, n),
        el('span', { class: 'pick-hint' }, added.has(n.toLowerCase()) ? 'added' : previewText(n).replace(/^last [^:]*: /, '')),
      );
      const inSplit = splitNames.filter(match);
      const others = otherNames.filter(match);
      if (q && ![...splitNames, ...otherNames].some((n) => n.toLowerCase() === q)) {
        listEl.append(el('button', {
          class: 'pick-row pick-new',
          onclick: () => { addLift(search.value.trim()); closePicker(); },
        }, `＋ New lift “${search.value.trim()}”`));
      }
      if (inSplit.length) listEl.append(el('div', { class: 'pick-head' }, `${SPLIT_LABELS[draft.split]} lifts`), ...inSplit.map(pickRow));
      if (others.length) listEl.append(el('div', { class: 'pick-head' }, 'Other lifts'), ...others.map(pickRow));
      if (!inSplit.length && !others.length && !q) {
        listEl.append(el('div', { class: 'empty-state' }, 'No lifts logged yet — type a name above.'));
      }
    };
    search.addEventListener('input', renderList);
    renderList();

    backdrop.append(el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add lift' },
      el('h2', {}, 'Add lift'),
      el('div', { class: 'field' }, search),
      listEl,
    ));
    document.body.append(backdrop);
    search.focus();
  };

  renderSegs();
  renderRows();
  renderSuggestions();

  const body = el('div', { class: 'wo-body' },
    el('div', { class: 'wo-seg-label' }, 'Split'),
    splitSeg,
    el('div', { class: 'wo-seg-label' }, 'Day type'),
    focusSeg,
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
