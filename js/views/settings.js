// Settings — appearance, manage trackers (with targets), back up data, app info.

import { el } from '../ui.js';
import { loggedDayCount } from '../store.js';
import { todayISO } from '../dates.js';
import {
  allTrackers, addTracker, updateTracker, moveTracker,
  deleteTracker, daysWithValue, targetFor, setTarget, clearGoal, TYPES,
} from '../trackers.js';
import {
  exportData, readBackupFile, applyImport,
  canUndoImport, undoImport, lastExportDays,
} from '../backup.js';
import { themePref, setThemePref } from '../theme.js';

let editingId = null;

const TYPE_LABELS = {
  number: 'Amount (adds up daily)',
  measurement: 'Measurement (point-in-time)',
  text: 'Text',
  checkbox: 'Checkbox',
  select: 'Pick one',
  multiselect: 'Pick many',
};
const OPTION_TYPES = ['select', 'multiselect'];
const UNIT_TYPES = ['number', 'measurement'];
// recurring targets make sense for amounts and habits, not measurements/notes
const TARGET_TYPES = ['number', 'checkbox', 'select', 'multiselect'];

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  const trackers = allTrackers();

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'Personal Fitness Tracker'),
      el('h1', {}, 'Settings'),
    ),
    el('span'),
  );

  // ----- appearance -----
  const pref = themePref();
  const appearanceSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'Appearance'),
    el('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' },
      [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) =>
        el('button', {
          class: 'seg-btn',
          'aria-pressed': String(pref === value),
          onclick: () => { setThemePref(value); rerender(); },
        }, label)),
    ),
    el('div', { class: 'settings-note' }, 'Auto follows your phone’s appearance.'),
  );

  // ----- trackers -----
  const list = el('div', { class: 'tracker-list' });
  trackers.forEach((t, i) => {
    list.append(t.id === editingId
      ? editRow(t, rerender)
      : viewRow(t, i, trackers.length, rerender));
  });

  const trackerSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'Trackers'),
    list,
    el('button', { class: 'ghost-btn', onclick: () => openAddSheet(rerender) }, '+ Add tracker'),
  );

  // ----- backup -----
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const result = await readBackupFile(file);
    if (!result.ok) {
      alert(result.error);
      return;
    }
    const msg = `Replace your current data (${trackers.length} trackers, ${loggedDayCount()} logged days) `
      + `with this backup (${result.trackerCount} trackers, ${result.dayCount} logged days)?`;
    if (!confirm(msg)) return;
    applyImport(result.data);
    editingId = null;
    rerender();
  });

  const backupSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'Backup'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', onclick: async () => { await exportData(); rerender(); } }, 'Export data'),
      el('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import backup'),
    ),
    fileInput,
    exportStatusLine(),
    canUndoImport() && el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn danger',
        onclick: () => {
          if (confirm('Restore the data you had before the last import?')) {
            undoImport();
            editingId = null;
            rerender();
          }
        },
      }, 'Undo last import'),
    ),
  );

  // ----- about -----
  const updateStatus = el('div', { class: 'settings-note', 'aria-live': 'polite' }, '');
  const checkUpdates = async () => {
    updateStatus.textContent = 'Checking…';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { updateStatus.textContent = 'Updates unavailable in this browser.'; return; }
      await reg.update();
      if (reg.installing || reg.waiting) {
        updateStatus.textContent = 'Update found — installing. The app will refresh itself in a moment.';
      } else {
        updateStatus.textContent = `Up to date (${ctx.version}). New releases can take ~10 minutes to reach the server.`;
      }
    } catch {
      updateStatus.textContent = 'Couldn’t check — are you offline?';
    }
  };

  const aboutSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'About'),
    el('div', { class: 'about-line' }, 'Version ', el('b', {}, ctx.version)),
    el('div', { class: 'about-line' }, el('b', {}, String(loggedDayCount())), ' days logged'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: checkUpdates }, 'Check for updates'),
    ),
    updateStatus,
  );

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }),
    appearanceSection, trackerSection, backupSection, aboutSection);
}

function targetDesc(t) {
  const tgt = targetFor(t, todayISO());
  if (!tgt) return '';
  if (t.type === 'number') {
    return ` · target ${tgt.dir === 'atmost' ? '≤' : '≥'} ${tgt.value.toLocaleString()}`
      + `${t.unit ? ' ' + t.unit : ''}/${tgt.period === 'day' ? 'day' : 'wk'}`;
  }
  if (tgt.period === 'day') {
    return t.type === 'multiselect' && tgt.value > 1 ? ` · target ${tgt.value}/day` : ' · target: every day';
  }
  return ` · target ${tgt.value} days/wk`;
}

function viewRow(t, index, total, rerender) {
  let meta = TYPE_LABELS[t.type] || t.type;
  if (t.unit) meta += ` · ${t.unit}`;
  if (OPTION_TYPES.includes(t.type)) meta += ` · ${(t.options || []).join(', ')}`;
  meta += targetDesc(t);
  if (t.goal) meta += ` · goal ${t.goal.target.toLocaleString()}`;

  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-main' },
      el('div', { class: 'tr-info' },
        el('div', { class: 'name' }, t.name, t.archived ? ' · archived' : ''),
        el('div', { class: 'meta' }, meta),
      ),
      el('button', {
        class: 'icon-btn', 'aria-label': `Move ${t.name} up`, disabled: index === 0,
        onclick: () => { moveTracker(t.id, -1); rerender(); },
      }, '↑'),
      el('button', {
        class: 'icon-btn', 'aria-label': `Move ${t.name} down`, disabled: index === total - 1,
        onclick: () => { moveTracker(t.id, 1); rerender(); },
      }, '↓'),
      el('button', {
        class: 'icon-btn', 'aria-label': `Edit ${t.name}`,
        onclick: () => { editingId = t.id; rerender(); },
      }, '✎'),
    ),
  );
}

// Builds the target fieldset for a tracker type; returns elements + reader.
function targetEditor(t) {
  const current = targetFor(t, todayISO());
  const isNumber = t.type === 'number';

  const periodSel = el('select', { 'aria-label': 'Target period' },
    el('option', { value: 'none' }, 'No target'),
    el('option', { value: 'day' }, isNumber ? 'Per day' : 'Every day'),
    el('option', { value: 'week' }, isNumber ? 'Per week' : 'Days per week'),
  );
  periodSel.value = current ? current.period : 'none';

  const amountField = el('div', { class: 'field' },
    el('label', {}, 'Amount'),
    el('input', {
      type: 'text', inputmode: 'decimal', 'aria-label': 'Target amount',
      value: current && current.value != null ? String(current.value) : '',
    }),
  );

  const dirSel = el('select', { 'aria-label': 'Target direction' },
    el('option', { value: 'atleast' }, 'Reach at least'),
    el('option', { value: 'atmost' }, 'Stay under'),
  );
  dirSel.value = current && current.dir === 'atmost' ? 'atmost' : 'atleast';
  const dirField = el('div', { class: 'field' }, el('label', {}, 'Kind'), dirSel);

  const sync = () => {
    const period = periodSel.value;
    const amountLabel = amountField.querySelector('label');
    if (isNumber) {
      amountField.hidden = period === 'none';
      amountLabel.textContent = 'Amount';
      dirField.hidden = period === 'none';
    } else {
      dirField.hidden = true;
      if (period === 'week') {
        amountField.hidden = false;
        amountLabel.textContent = 'Days per week (1–7)';
      } else if (period === 'day' && t.type === 'multiselect') {
        amountField.hidden = false;
        amountLabel.textContent = 'How many per day';
      } else {
        amountField.hidden = true;
      }
    }
  };
  periodSel.addEventListener('change', sync);
  sync();

  const wrap = el('div', { class: 'tr-edit' },
    el('div', { class: 'field' }, el('label', {}, 'Target'), periodSel),
    amountField,
    dirField,
    el('div', { class: 'settings-note' },
      'Targets remember their history: changing one applies from today on, past days keep the target they had.'),
  );

  const save = () => {
    const period = periodSel.value;
    if (period === 'none') {
      if (current) setTarget(t.id, { value: null, period: current.period });
      return true;
    }
    let value;
    if (isNumber) {
      value = parseFloat(amountField.querySelector('input').value.replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) { alert('Enter a target amount.'); return false; }
    } else if (period === 'week') {
      value = parseInt(amountField.querySelector('input').value, 10);
      if (!Number.isFinite(value) || value < 1 || value > 7) { alert('Weekly target must be 1–7 days.'); return false; }
    } else if (t.type === 'multiselect') {
      value = parseInt(amountField.querySelector('input').value, 10);
      if (!Number.isFinite(value) || value < 1) value = 1;
    } else {
      value = 1;
    }
    const dir = isNumber ? dirSel.value : undefined;
    const changed = !current || current.value !== value || current.period !== period
      || (isNumber && (current.dir || 'atleast') !== dir);
    if (changed) setTarget(t.id, { value, period, dir });
    return true;
  };

  return { wrap, save };
}

function editRow(t, rerender) {
  const nameInput = el('input', { type: 'text', value: t.name, 'aria-label': 'Tracker name' });
  const unitInput = el('input', { type: 'text', value: t.unit || '', placeholder: 'kcal, g, km…', 'aria-label': 'Unit' });
  const optionsInput = el('input', {
    type: 'text',
    value: (t.options || []).join(', '),
    placeholder: 'walk, run, squash, bike',
    'aria-label': 'Options',
  });
  const target = TARGET_TYPES.includes(t.type) ? targetEditor(t) : null;

  // numeric trackers can switch between "adds up" and "measurement"
  const kindSel = UNIT_TYPES.includes(t.type)
    ? el('select', { 'aria-label': 'Number kind' },
        el('option', { value: 'number' }, TYPE_LABELS.number),
        el('option', { value: 'measurement' }, TYPE_LABELS.measurement))
    : null;
  if (kindSel) kindSel.value = t.type;

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Give the tracker a name.'); return; }
    const patch = { name, unit: unitInput.value.trim() || null };
    if (OPTION_TYPES.includes(t.type)) {
      const options = parseOptions(optionsInput.value);
      if (options.length === 0) { alert('Add at least one option.'); return; }
      patch.options = options;
    }
    const newKind = kindSel ? kindSel.value : t.type;
    if (newKind !== t.type) {
      if (newKind === 'measurement' && (t.targets || []).length > 0) {
        if (!confirm('Daily/weekly targets don’t apply to measurements and will be removed. Continue?')) return;
        patch.targets = [];
      }
      if (newKind === 'number' && t.goal) {
        if (!confirm('Destination goals don’t apply to daily amounts — the goal will be removed. Continue?')) return;
      }
      patch.type = newKind;
    }
    if (newKind === t.type && target && !target.save()) return;
    if (patch.type === 'number' && t.goal) clearGoal(t.id);
    updateTracker(t.id, patch);
    editingId = null;
    rerender();
  };

  const days = daysWithValue(t.id);

  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-edit' },
      el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
      kindSel && el('div', { class: 'field' }, el('label', {}, 'Counts as'), kindSel),
      UNIT_TYPES.includes(t.type) && el('div', { class: 'field' }, el('label', {}, 'Unit (optional)'), unitInput),
      OPTION_TYPES.includes(t.type) && el('div', { class: 'field' }, el('label', {}, 'Options (comma separated)'), optionsInput),
      target && target.wrap,
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn primary', onclick: save }, 'Save'),
        el('button', { class: 'btn', onclick: () => { editingId = null; rerender(); } }, 'Cancel'),
      ),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn',
          onclick: () => { updateTracker(t.id, { archived: !t.archived }); editingId = null; rerender(); },
        }, t.archived ? 'Unarchive' : 'Archive'),
        el('button', {
          class: 'btn danger',
          onclick: () => {
            const msg = days > 0
              ? `Delete "${t.name}" and its values on ${days} day${days === 1 ? '' : 's'}? This cannot be undone.`
              : `Delete "${t.name}"?`;
            if (confirm(msg)) { deleteTracker(t.id); editingId = null; rerender(); }
          },
        }, 'Delete'),
      ),
      el('div', { class: 'settings-note' },
        t.archived
          ? 'Archived trackers are hidden from the day form; old values stay visible on their days.'
          : 'Archive hides a tracker from the day form without losing any logged values.'),
    ),
  );
}

function openAddSheet(rerender) {
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Weight, Sleep, Steps', 'aria-label': 'New tracker name' });
  const typeSelect = el('select', { 'aria-label': 'Tracker type' },
    ...TYPES.map((v) => el('option', { value: v }, TYPE_LABELS[v])),
  );
  const unitField = el('div', { class: 'field' },
    el('label', {}, 'Unit (optional)'),
    el('input', { type: 'text', placeholder: 'kcal, g, km…', 'aria-label': 'Unit' }),
  );
  const optionsField = el('div', { class: 'field', hidden: true },
    el('label', {}, 'Options (comma separated)'),
    el('input', { type: 'text', placeholder: 'walk, run, squash, bike', 'aria-label': 'Options' }),
  );
  typeSelect.addEventListener('change', () => {
    unitField.hidden = !UNIT_TYPES.includes(typeSelect.value);
    optionsField.hidden = !OPTION_TYPES.includes(typeSelect.value);
  });

  const backdrop = el('div', { class: 'sheet-backdrop' });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const add = () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Give the tracker a name.'); return; }
    const type = typeSelect.value;
    const options = parseOptions(optionsField.querySelector('input').value);
    if (OPTION_TYPES.includes(type) && options.length === 0) {
      alert('Add at least one option, separated by commas.');
      return;
    }
    addTracker({ name, type, unit: unitField.querySelector('input').value, options });
    close();
    rerender();
  };

  backdrop.append(el('div', { class: 'sheet add-form', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add tracker' },
    el('h2', {}, 'New tracker'),
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Type'), typeSelect),
    unitField,
    optionsField,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', onclick: add }, 'Add tracker'),
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
    ),
    el('div', { class: 'settings-note' }, 'Set a target from the tracker’s ✎ edit screen after adding it.'),
  ));
  document.body.append(backdrop);
  nameInput.focus();
}

function parseOptions(str) {
  return [...new Set(str.split(',').map((s) => s.trim()).filter(Boolean))];
}

function exportStatusLine() {
  const days = lastExportDays();
  const logged = loggedDayCount();
  if (days === null) {
    return el('div', { class: 'settings-note' + (logged > 0 ? ' warn' : '') },
      logged > 0 ? 'No backup yet — export once you have data you would miss.' : 'No backup yet.');
  }
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return el('div', { class: 'settings-note' + (days > 30 ? ' warn' : '') },
    `Last export: ${when}.`, days > 30 ? ' Time for a fresh backup.' : '');
}
