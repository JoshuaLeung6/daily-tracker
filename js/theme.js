// Theme switching. Preference is 'system' | 'light' | 'dark'; the resolved
// value lands on <html data-theme> which styles.css keys off. The meta
// theme-color follows so the iOS status bar area matches.

import { getTheme, setTheme } from './store.js';

const BG = { light: '#f6f0e3', dark: '#16130e' };
const lightQuery = window.matchMedia('(prefers-color-scheme: light)');

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
  if (meta) meta.content = BG[resolved];
}

lightQuery.addEventListener('change', () => {
  if (getTheme() === 'system') applyTheme();
});
