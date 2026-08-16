// Settings — appearance, profile, backup, app info. Trackers and targets are
// configured in code (with Claude), not here: this screen only shows them.

import { el } from '../ui.js';
import { loggedDayCount, getProfile, setProfile } from '../store.js';
import { todayISO } from '../dates.js';
import { allTrackers, targetFor } from '../trackers.js';
import {
  exportData, exportAnalysis, exportPhotos, readBackupFile, applyImport,
  canUndoImport, undoImport, lastExportDays,
} from '../backup.js';
import { themePref, setThemePref } from '../theme.js';

const TYPE_LABELS = {
  number: 'Amount',
  measurement: 'Measurement',
  text: 'Text',
  checkbox: 'Checkbox',
  select: 'Pick one',
  multiselect: 'Pick many',
};

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  const trackers = allTrackers().filter((t) => !t.archived);

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

  // ----- trackers (read-only summary) -----
  const list = el('div', { class: 'tracker-list' });
  for (const t of trackers) {
    let meta = TYPE_LABELS[t.type] || t.type;
    if (t.unit) meta += ` · ${t.unit}`;
    if (t.options && t.options.length) meta += ` · ${t.options.join(', ')}`;
    meta += targetDesc(t);
    if (t.goal) meta += ` · goal ${t.goal.target.toLocaleString()}`;
    list.append(el('div', { class: 'tracker-row' },
      el('div', { class: 'tr-main' },
        el('div', { class: 'tr-info' },
          el('div', { class: 'name' }, t.name),
          el('div', { class: 'meta' }, meta),
        ),
      ),
    ));
  }
  const trackerSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'Trackers'),
    list,
    el('div', { class: 'settings-note' },
      'Trackers, targets and goals are set up in code with Claude so the app stays simple. Ask to change any of them.'),
  );

  // ----- profile (optional; travels with exports for analysis) -----
  const profile = getProfile();
  const profileField = (label, key, attrs = {}) => {
    const input = el('input', {
      type: 'text', 'aria-label': label,
      value: profile[key] != null ? String(profile[key]) : '',
      ...attrs,
    });
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      setProfile({ [key]: attrs.inputmode === 'numeric' ? (parseInt(raw, 10) || '') : raw });
    });
    return el('div', { class: 'field' }, el('label', {}, label), input);
  };
  const sexSel = el('select', { 'aria-label': 'Sex' },
    el('option', { value: '' }, '—'),
    el('option', { value: 'male' }, 'Male'),
    el('option', { value: 'female' }, 'Female'),
    el('option', { value: 'other' }, 'Other'),
  );
  sexSel.value = profile.sex || '';
  sexSel.addEventListener('change', () => setProfile({ sex: sexSel.value }));
  const unitsSel = el('select', { 'aria-label': 'Preferred units' },
    el('option', { value: 'lb' }, 'Pounds (lb)'),
    el('option', { value: 'kg' }, 'Kilograms (kg)'),
  );
  unitsSel.value = profile.units || 'lb';
  unitsSel.addEventListener('change', () => setProfile({ units: unitsSel.value }));

  const profileSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'Profile'),
    profileField('Birth year', 'birthYear', { inputmode: 'numeric', placeholder: 'e.g. 1998' }),
    profileField('Height', 'height', { placeholder: 'e.g. 5\'10" or 178 cm' }),
    el('div', { class: 'field' }, el('label', {}, 'Sex'), sexSel),
    el('div', { class: 'field' }, el('label', {}, 'Units'), unitsSel),
    el('div', { class: 'settings-note' },
      'Optional — included in exports so future analysis has context. Leave anything blank.'),
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
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: () => exportAnalysis() }, 'Export for analysis'),
      el('button', {
        class: 'btn',
        onclick: async () => {
          const r = await exportPhotos();
          if (r === 'none') alert('No progress photos yet.');
        },
      }, 'Export photos'),
    ),
    el('div', { class: 'settings-note' },
      'Analysis export uses tracker names and includes precomputed stats — the file to hand to Claude for advice. Photos are stored separately and exported as image files; neither is a restorable backup.'),
    canUndoImport() && el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn danger',
        onclick: () => {
          if (confirm('Restore the data you had before the last import?')) {
            undoImport();
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
    appearanceSection, trackerSection, profileSection, backupSection, aboutSection);
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
