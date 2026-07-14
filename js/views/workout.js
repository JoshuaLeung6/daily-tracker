// Workout editor — a full-screen sheet over the day view. New workouts start
// from the last workout of the same classification; nothing is saved until
// the user actually touches a lift.

import { el } from '../ui.js';
import { fmt, weekdayName } from '../dates.js';
import {
  SPLITS, SPLIT_LABELS, FOCUSES, FOCUS_LABELS,
  getWorkout, saveWorkout, deleteWorkout, templateFor, suggestedClass,
  liftNames, lastLift,
} from '../workouts.js';

export function openWorkout(iso, { locked = false, onClose } = {}) {
  const existing = getWorkout(iso);
  const draft = existing
    ? { split: existing.split, focus: existing.focus, lifts: existing.lifts.map((l) => ({ ...l })) }
    : (() => {
        const cls = suggestedClass(iso);
        return { ...cls, lifts: templateFor(cls.split, cls.focus, iso) };
      })();

  let dirty = Boolean(existing);
  const persist = () => { if (dirty && !locked) saveWorkout(iso, draft); };
  const touch = () => { dirty = true; persist(); };

  const overlay = el('div', { class: 'workout-overlay' });
  const close = () => {
    persist();
    overlay.remove();
    if (onClose) onClose();
  };

  const datalist = el('datalist', { id: 'wo-lift-names' });
  const refreshNames = () => {
    datalist.replaceChildren(...liftNames(draft.split).map((n) => el('option', { value: n })));
  };
  refreshNames();

  // classification segments
  const splitSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Split' });
  const focusSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Day type' });
  const renderSegs = () => {
    splitSeg.replaceChildren(...SPLITS.map((s) => el('button', {
      class: 'seg-btn',
      'aria-pressed': String(draft.split === s),
      disabled: locked,
      onclick: () => setClass({ split: s }),
    }, SPLIT_LABELS[s])));
    focusSeg.replaceChildren(...FOCUSES.map((f) => el('button', {
      class: 'seg-btn',
      'aria-pressed': String(draft.focus === f),
      disabled: locked,
      onclick: () => setClass({ focus: f }),
    }, FOCUS_LABELS[f])));
  };
  const setClass = (patch) => {
    Object.assign(draft, patch);
    // untouched drafts re-template from the new classification's history
    if (!dirty) draft.lifts = templateFor(draft.split, draft.focus, iso);
    else persist();
    refreshNames();
    renderSegs();
    renderRows();
  };

  // lift rows
  const rows = el('div', { class: 'lift-rows' });
  const renderRows = () => {
    rows.replaceChildren();
    draft.lifts.forEach((lift, i) => rows.append(liftRow(lift, i)));
    if (draft.lifts.length === 0) {
      rows.append(el('div', { class: 'empty-state' },
        locked ? 'No lifts logged.' : 'No lifts yet — add your first below.'));
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

  const liftRow = (lift, index) => {
    const name = el('input', {
      type: 'text',
      class: 'lift-name',
      list: 'wo-lift-names',
      placeholder: 'Lift',
      autocomplete: 'off',
      'aria-label': 'Lift name',
      readonly: locked,
      value: lift.name || '',
    });
    name.addEventListener('input', () => {
      lift.name = name.value;
      touch();
    });
    // picking a known lift fills in its last numbers
    name.addEventListener('change', () => {
      if (lift.weight != null || lift.reps != null || lift.sets != null) return;
      const prev = lastLift(name.value, iso);
      if (!prev) return;
      Object.assign(lift, { weight: prev.weight, reps: prev.reps, sets: prev.sets });
      touch();
      renderRows();
    });

    const remove = el('button', {
      class: 'row-x',
      'aria-label': `Remove ${lift.name || 'lift'}`,
      hidden: locked,
      onclick: () => {
        draft.lifts.splice(index, 1);
        touch();
        renderRows();
      },
    }, '✕');

    return el('div', { class: 'lift-row' },
      name,
      numInput(lift, 'weight', 'Weight', false),
      numInput(lift, 'reps', 'Reps', true),
      numInput(lift, 'sets', 'Sets', true),
      remove,
    );
  };

  renderSegs();
  renderRows();

  const body = el('div', { class: 'wo-body' },
    el('div', { class: 'wo-seg-label' }, 'Split'),
    splitSeg,
    el('div', { class: 'wo-seg-label' }, 'Day type'),
    focusSeg,
    el('div', { class: 'lift-labels' },
      el('span', { class: 'll-name' }, 'Lift'),
      el('span', {}, 'Weight'),
      el('span', {}, 'Reps'),
      el('span', {}, 'Sets'),
      el('span', { class: 'll-x' }),
    ),
    rows,
    !locked && el('button', {
      class: 'ghost-btn',
      onclick: () => {
        draft.lifts.push({ name: '', weight: null, reps: null, sets: null });
        dirty = true;
        renderRows();
        const inputs = rows.querySelectorAll('.lift-name');
        if (inputs.length) inputs[inputs.length - 1].focus();
      },
    }, '+ Add lift'),
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
    datalist,
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
