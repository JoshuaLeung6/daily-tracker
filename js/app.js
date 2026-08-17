// App entry — storage init, tab navigation, shared date context,
// saved-flash, resume-to-today, service worker registration.
//
// Release convention: bump APP_VERSION here AND the CACHE name in sw.js
// on every deploy.

export const APP_VERSION = '2.25.0';

import { init as initStore } from './store.js';
import { applyTheme } from './theme.js';
import { todayISO } from './dates.js';
import { applyConfig, applySeedValues, stripOptions } from './trackers.js';
import { TRACKERS, SEED_VALUES, SEED_ANCHOR, STRIP_OPTIONS } from './config.js';
import { PACE_PRESETS } from './insights.js';
import * as dayView from './views/day.js';
import * as weekView from './views/week.js';
import * as statsView from './views/stats.js';
import * as settingsView from './views/settings.js';

const sections = {
  day: document.getElementById('view-day'),
  week: document.getElementById('view-week'),
  stats: document.getElementById('view-stats'),
  settings: document.getElementById('view-settings'),
};
const views = { day: dayView, week: weekView, stats: statsView, settings: settingsView };

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

// Top safe-area handling has to be decided at runtime, because iOS is
// inconsistent about it (WebKit bug 301994, live on iOS 26.5.2 / 27 beta):
//  - buggy builds hand the page a viewport ALREADY shortened by the top inset
//    (innerHeight = screen.height − 62). Padding by env(safe-area-inset-top)
//    on top of that double-counts and wastes 62px of content area.
//  - fixed builds hand the page the FULL screen; then content would run under
//    the Dynamic Island unless we pad.
// So: pad only when the viewport genuinely spans the screen.
// The same logic applies at the BOTTOM. The tab bar pads by --sab to keep its
// icons off the home indicator, which lives in the last 34px of the SCREEN.
// On a buggy build the viewport ends 62px above the screen bottom, so the
// indicator sits entirely inside the iOS-owned band, BELOW the viewport —
// padding for it inside the viewport clears an indicator that is not there
// and just lifts the icons 34px for nothing. Pad only when the viewport
// actually reaches the screen bottom.
function applyInsets() {
  const full = Math.abs(window.innerHeight - screen.height) <= 1;
  const root = document.documentElement.style;
  root.setProperty('--top-pad', full ? 'var(--sat)' : '0px');
  root.setProperty('--bottom-pad', full ? 'var(--sab)' : '0px');
}
applyInsets();
window.addEventListener('resize', applyInsets);
window.addEventListener('orientationchange', () => setTimeout(applyInsets, 100));

// reconcile the code-level personal config into stored data (non-destructive)
try {
  applyConfig(TRACKERS, (phase, pace) => PACE_PRESETS[phase][pace]);
  applySeedValues(SEED_VALUES, SEED_ANCHOR);
  stripOptions(STRIP_OPTIONS);
} catch (e) {
  console.error('config apply failed', e);
}

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
  // let a view hand off to another tab (day pull-down -> that day's week)
  goTab(tab, opts = {}) {
    if (tab === 'week' && opts.detail) weekView.openWeekDetail();
    switchTab(tab, { keepMode: tab === 'week' && opts.detail });
  },
};

function renderActive() {
  views[state.tab].render(sections[state.tab], ctx);
}

function switchTab(tab, opts = {}) {
  state.tab = tab;
  // the swipe hint lives on <body> (outside the transformed views), so it
  // must be cleared by hand when the view it belonged to goes away
  const hint = document.getElementById('swipe-hint');
  if (hint) hint.className = 'swipe-hint';
  if (views[tab].enter && !opts.keepMode) views[tab].enter();
  for (const [name, section] of Object.entries(sections)) section.hidden = name !== tab;
  for (const btn of document.querySelectorAll('.tab')) {
    if (btn.dataset.tab === tab) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  renderActive();
  sections[tab].scrollTop = 0;
}

for (const btn of document.querySelectorAll('.tab')) {
  btn.addEventListener('click', () => {
    // Tapping the Day tab always lands on today. Only explicit "open this
    // day" actions (from the week detail) carry a different date across.
    if (btn.dataset.tab === 'day') {
      state.date = todayISO();
      state.followToday = true;
    }
    switchTab(btn.dataset.tab);
  });
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
      // updateViaCache: 'none' — always fetch sw.js from the network when
      // checking for updates. GitHub Pages serves it with max-age=600, so
      // the default lets the HTTP cache answer "unchanged" for up to 10 min
      // after every deploy, which is why updates looked like they were not
      // arriving. The service worker script itself must never be cached.
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
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
