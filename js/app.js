// App entry — storage init, tab navigation, shared date context,
// saved-flash, resume-to-today, service worker registration.
//
// Release convention: bump APP_VERSION here AND the CACHE name in sw.js
// on every deploy.

export const APP_VERSION = '2.2.2';

import { init as initStore } from './store.js';
import { applyTheme } from './theme.js';
import { todayISO } from './dates.js';
import * as dayView from './views/day.js';
import * as weekView from './views/week.js';
import * as monthView from './views/month.js';
import * as statsView from './views/stats.js';
import * as settingsView from './views/settings.js';

const sections = {
  day: document.getElementById('view-day'),
  week: document.getElementById('view-week'),
  month: document.getElementById('view-month'),
  stats: document.getElementById('view-stats'),
  settings: document.getElementById('view-settings'),
};
const views = { day: dayView, week: weekView, month: monthView, stats: statsView, settings: settingsView };

const state = {
  tab: 'day',
  date: todayISO(),
  followToday: true, // true until the user navigates away from today
};

const banner = document.getElementById('storage-banner');
initStore({
  onStorageError(err) {
    if (err) {
      banner.textContent = 'Saving failed — storage may be full. Export your data from Settings.';
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  },
});

applyTheme();

const ctx = {
  get date() { return state.date; },
  setDate(iso) {
    state.date = iso;
    state.followToday = iso === todayISO();
    renderActive();
  },
  openDay(iso) {
    state.date = iso;
    state.followToday = iso === todayISO();
    switchTab('day');
  },
  version: APP_VERSION,
};

function renderActive() {
  views[state.tab].render(sections[state.tab], ctx);
}

function switchTab(tab) {
  state.tab = tab;
  for (const [name, section] of Object.entries(sections)) section.hidden = name !== tab;
  for (const btn of document.querySelectorAll('.tab')) {
    if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  renderActive();
  sections[tab].scrollTop = 0;
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

// autosave confirmation flash
const flash = document.getElementById('saved-flash');
let flashTimer = null;
document.addEventListener('pcal:saved', () => {
  flash.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flash.classList.remove('show'), 900);
});

// iOS resumes the PWA where it was suspended; if that was "today" and the
// date has rolled over since, jump to the new today.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.followToday && state.date !== todayISO()) {
    state.date = todayISO();
    renderActive();
  }
});

switchTab('day');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // iOS resumes the PWA without a page load, which skips the normal
      // update check — so also check whenever the app comes to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
      // When a new service worker takes over, reload once so the new
      // version applies immediately instead of on the next launch.
      let hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) location.reload();
        hadController = true;
      });
    } catch { /* offline still works next visit */ }
  });
}
