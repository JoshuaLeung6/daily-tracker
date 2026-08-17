// Theme switching. Preference is 'system' | 'light' | 'dark'; the resolved
// value lands on <html data-theme> which styles.css keys off. The meta
// theme-color follows so the iOS status bar area matches.

import { getTheme, setTheme } from './store.js';

const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

// The meta theme-color must match --bg for the ACTIVE palette (each sprint
// has its own), so read it back from the resolved CSS rather than hard-code
// espresso's values.
function currentBg() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return v || '#16130e';
}

export function themePref() {
  return getTheme();
}

export function setThemePref(v) {
  setTheme(v);
  applyTheme();
}

export function applyTheme() {
  const pref = getTheme();
  const resolved = pref === 'system' ? (lightQuery.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = currentBg();
}

lightQuery.addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme();
});
