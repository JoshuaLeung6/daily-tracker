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
      // Ask the SERVER what version it has, bypassing every cache, so the
      // answer is about reality and not about what this phone last saw.
      let serverVersion = null;
      try {
        const res = await fetch(`./js/app.js?nocache=${Date.now()}`, { cache: 'no-store' });
        const m = (await res.text()).match(/APP_VERSION\s*=\s*'([^']+)'/);
        serverVersion = m ? m[1] : null;
      } catch { /* fall through */ }

      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { updateStatus.textContent = 'Updates unavailable in this browser.'; return; }
      await reg.update();

      if (reg.installing || reg.waiting) {
        updateStatus.textContent = `Update found (server has ${serverVersion || 'newer'}) — installing. The app will refresh itself in a moment.`;
      } else if (serverVersion && serverVersion !== ctx.version) {
        // the server is ahead but the worker did not pick it up: the sw.js
        // fetch is being answered from an HTTP cache. Force it.
        updateStatus.textContent = `Server has ${serverVersion}, this phone has ${ctx.version}. Forcing a refresh…`;
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
        location.reload();
      } else {
        updateStatus.textContent = `Up to date (${ctx.version} on both this phone and the server).`;
      }
    } catch {
      updateStatus.textContent = 'Couldn’t check — are you offline?';
    }
  };

  // layout diagnostics (for debugging the tab-bar gap on device)
  const diag = el('div', { class: 'settings-note', style: 'font-family: ui-monospace, monospace; font-size: 11px; white-space: pre-wrap;' });
  const fillDiag = () => {
    const tab = document.querySelector('.tabbar');
    const r = tab ? tab.getBoundingClientRect() : null;
    const cs = tab ? getComputedStyle(tab) : null;
    const measureInset = (side) => {
      const probe = document.createElement('div');
      probe.style.cssText = `position:fixed;${side}:0;height:env(safe-area-inset-${side},0px);width:1px;visibility:hidden`;
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    };
    const sab = measureInset('bottom');
    const sat = measureInset('top');
    // Measure against the PHYSICAL SCREEN, not just innerHeight. Everything
    // inside the web view can look perfect while iOS withholds a band below
    // it — innerHeight-based numbers cannot see that band at all, which is
    // what made four earlier "fixes" chase the wrong space.
    const dpr = window.devicePixelRatio || 1;
    const screenCss = Math.round(screen.height);          // CSS px, portrait
    const viewH = window.innerHeight;
    const withheld = screenCss - viewH;                   // band OUTSIDE the view
    const svg = document.querySelector('.tab svg');
    const lbl = document.querySelector('.tab span');
    const sr = svg ? svg.getBoundingClientRect() : null;
    const lr = lbl ? lbl.getBoundingClientRect() : null;
    const lowest = lr ? lr.bottom : (sr ? sr.bottom : null);
    const insideGap = lowest != null ? Math.round(viewH - lowest) : null;

    diag.textContent =
      `v${ctx.version}\n`
      + `standalone: ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true}\n`
      + `innerH ${viewH} · docH ${document.documentElement.clientHeight} · screenH ${screenCss} · dpr ${dpr}\n`
      + `visualViewport ${window.visualViewport ? Math.round(window.visualViewport.height) : 'n/a'}`
      + `${window.visualViewport ? ` offsetTop ${Math.round(window.visualViewport.offsetTop)}` : ''}\n`
      + `safe-area top ${sat}px · bottom ${sab}px · sum ${sat + sab}px\n`
      + `screenY of view top: ${(() => {
        // where the web view sits on the physical screen: if the withheld band
        // is entirely ABOVE us, this equals the withheld amount
        try { return Math.round(window.screenY !== undefined ? window.screenY : -1); } catch { return -1; }
      })()}\n`
      + `tabbar top ${r ? Math.round(r.top) : '?'} bottom ${r ? Math.round(r.bottom) : '?'} h ${r ? Math.round(r.height) : '?'} · pad-b ${cs ? cs.paddingBottom : '?'}\n`
      + `tab h ${(() => { const t = document.querySelector('.tab'); return t ? Math.round(t.getBoundingClientRect().height) : '?'; })()}`
      + ` · icon-b ${sr ? Math.round(sr.bottom) : '?'} · label-b ${lr ? Math.round(lr.bottom) : '?'}\n`
      + `--- the two gaps ---\n`
      + `A inside view (icons->innerH): ${insideGap}px\n`
      + `B withheld by iOS (screenH-innerH): ${withheld}px\n`
      + `TOTAL below icons: ${insideGap != null ? insideGap + withheld : '?'}px\n`
      + `--- is viewport-fit=cover applying? ---\n`
      + (() => {
        // Read the insets from :root. If cover is NOT applying, BOTH resolve
        // to 0px. Cover applying on a Dynamic Island phone = top 62, bot 34.
        const rs = getComputedStyle(document.documentElement);
        const vTop = rs.getPropertyValue('--sat').trim();
        const vBot = rs.getPropertyValue('--sab').trim();
        // The env() vars populating does NOT mean the viewport was extended:
        // on device they read 62/34 while innerH was still 62 short. The only
        // signal that matters is whether the layout viewport spans the screen.
        const envOk = parseFloat(vTop) > 0;
        const viewportFull = Math.abs(viewH - screenCss) <= 1;
        let verdict;
        if (viewportFull) verdict = 'viewport spans the full screen — nothing withheld';
        else if (envOk) verdict = `env() insets populate BUT viewport is ${screenCss - viewH}px short — iOS is withholding the top inset from the layout viewport (WebKit 254868)`;
        else verdict = 'cover NOT applying (env() insets are 0)';
        return `--sat ${vTop || '?'} · --sab ${vBot || '?'}\n`
          + `screen ${screen.width}x${screen.height}\n`
          + `VERDICT: ${verdict}`;
      })();
  };

  // Temporary: paint the very bottom of the WEB VIEW bright red. If you see
  // red touching the screen bottom, the gap is inside our CSS. If there is
  // dark space BELOW the red, iOS is withholding that band and no CSS of ours
  // can reach it (the fix is then a manifest/viewport change, not padding).
  const markerBtn = el('button', {
    class: 'btn',
    onclick: () => {
      const existing = document.getElementById('edge-marker');
      if (existing) { existing.remove(); return; }
      const m = el('div', { id: 'edge-marker' });
      m.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:6px;'
        + 'background:#ff0000;z-index:9999;pointer-events:none';
      document.body.appendChild(m);
    },
  }, 'Mark view bottom');

  const aboutSection = el('div', { class: 'settings-section' },
    el('h2', {}, 'About'),
    el('div', { class: 'about-line' }, 'Version ', el('b', {}, ctx.version)),
    el('div', { class: 'about-line' }, el('b', {}, String(loggedDayCount())), ' days logged'),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn', onclick: checkUpdates }, 'Check for updates'),
      el('button', { class: 'btn', onclick: fillDiag }, 'Layout info'),
      markerBtn,
      // one tap to copy the readout, so it can be pasted rather than retyped
      el('button', {
        class: 'btn',
        onclick: async () => {
          if (!diag.textContent) fillDiag();
          try {
            await navigator.clipboard.writeText(diag.textContent);
            updateStatus.textContent = 'Layout info copied.';
          } catch {
            updateStatus.textContent = 'Couldn’t copy — long-press the text below to select it.';
          }
        },
      }, 'Copy'),
    ),
    updateStatus,
    diag,
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
