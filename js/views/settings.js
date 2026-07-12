// Settings — manage trackers, back up data, app info.

import { el } from '../ui.js';
import { loggedDayCount } from '../store.js';
import {
  allTrackers, addTracker, updateTracker, moveTracker,
  deleteTracker, daysWithValue, TYPES,
} from '../trackers.js';
import {
  exportData, readBackupFile, applyImport,
  canUndoImport, undoImport, lastExportDays,
} from '../backup.js';

let editingId = null;

const TYPE_LABELS = { number: 'Number', text: 'Text', checkbox: 'Checkbox' };

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  const trackers = allTrackers();

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, 'Daily Tracker'),
      el('h1', {}, 'Settings'),
    ),
    el('span'),
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
    addForm(rerender),
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
  const aboutSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'About'),
    el('div', { class: 'about-line' }, 'Version ', el('b', {}, ctx.version)),
    el('div', { class: 'about-line' }, el('b', {}, String(loggedDayCount())), ' days logged'),
    el('div', { class: 'settings-note' },
      'All data lives on this phone. Export a backup now and then — it saves a file you can restore from.'),
  );

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }),
    trackerSection, backupSection, aboutSection);
}

function viewRow(t, index, total, rerender) {
  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-main' },
      el('div', { class: 'tr-info' },
        el('div', { class: 'name' }, t.name, t.archived ? ' · archived' : ''),
        el('div', { class: 'meta' }, TYPE_LABELS[t.type] || t.type, t.unit ? ` · ${t.unit}` : ''),
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

function editRow(t, rerender) {
  const nameInput = el('input', { type: 'text', value: t.name, 'aria-label': 'Tracker name' });
  const unitInput = el('input', { type: 'text', value: t.unit || '', placeholder: 'kcal, g, km…', 'aria-label': 'Unit' });

  const save = () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Give the tracker a name.'); return; }
    updateTracker(t.id, { name, unit: unitInput.value.trim() || null });
    editingId = null;
    rerender();
  };

  const days = daysWithValue(t.id);

  return el('div', { class: 'tracker-row' },
    el('div', { class: 'tr-edit' },
      el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
      t.type === 'number' && el('div', { class: 'field' }, el('label', {}, 'Unit (optional)'), unitInput),
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

function addForm(rerender) {
  const nameInput = el('input', { type: 'text', placeholder: 'e.g. Weight, Sleep, Steps', 'aria-label': 'New tracker name' });
  const typeSelect = el('select', { 'aria-label': 'Tracker type' },
    ...TYPES.map((v) => el('option', { value: v }, TYPE_LABELS[v])),
  );
  const unitField = el('div', { class: 'field' },
    el('label', {}, 'Unit (optional)'),
    el('input', { type: 'text', placeholder: 'kcal, g, km…', 'aria-label': 'Unit' }),
  );
  typeSelect.addEventListener('change', () => { unitField.hidden = typeSelect.value !== 'number'; });

  return el('div', { class: 'add-form' },
    el('div', { class: 'field' }, el('label', {}, 'Name'), nameInput),
    el('div', { class: 'field' }, el('label', {}, 'Type'), typeSelect),
    unitField,
    el('button', {
      class: 'btn primary',
      onclick: () => {
        const name = nameInput.value.trim();
        if (!name) { alert('Give the tracker a name.'); return; }
        addTracker({ name, type: typeSelect.value, unit: unitField.querySelector('input').value });
        rerender();
      },
    }, 'Add tracker'),
  );
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
