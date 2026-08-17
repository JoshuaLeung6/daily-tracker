// E2E: the tab bar is the ONLY way to change tabs, so it must never be able
// to leave the screen. v2.18.0 pushed it off the bottom and stranded the app
// with no navigation at all — including no way to reach Settings to diagnose.
// Covers: no insets, iPhone-17 safe areas, and an oversized shell (the exact
// v2.18.0 failure mode).
const puppeteer = require('puppeteer-core');
const CHROME = ['C:', 'Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'].join('\\');

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 402, height: 874, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
  await p.waitForSelector('.card');

  const check = async (label) => {
    const m = await p.evaluate(() => {
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.tab')].map((t) => {
        const r = t.getBoundingClientRect();
        return { visible: r.top >= 0 && r.bottom <= window.innerHeight + 1 && r.width > 0 };
      });
      // is the Settings tab actually tappable at its centre point?
      const st = document.querySelector('.tab[data-tab="settings"]');
      const sr = st.getBoundingClientRect();
      const cx = sr.left + sr.width / 2;
      const cy = sr.top + sr.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        barTop: Math.round(bar.top),
        barBottom: Math.round(bar.bottom),
        innerH: window.innerHeight,
        barFullyVisible: bar.top >= 0 && bar.bottom <= window.innerHeight + 1,
        allTabsVisible: tabs.every((t) => t.visible),
        settingsTappable: !!(hit && (hit.closest('.tab[data-tab="settings"]'))),
      };
    });
    const ok = m.barFullyVisible && m.allTabsVisible && m.settingsTappable;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`, JSON.stringify(m));
    return ok;
  };

  let allOk = true;
  allOk = (await check('no insets')) && allOk;

  await p.addStyleTag({ content: ':root { --sat: 62px !important; --sab: 34px !important; }' });
  await new Promise((r) => setTimeout(r, 150));
  allOk = (await check('iPhone 17 insets (62/34)')) && allOk;

  // the v2.18.0 failure mode: shell taller than the visible area
  await p.addStyleTag({ content: 'body { height: 200vh !important; }' });
  await new Promise((r) => setTimeout(r, 150));
  allOk = (await check('SHELL OVERSIZED (v2.18.0 failure mode)')) && allOk;

  console.log('');
  console.log(allOk ? 'SAFETY NET HOLDS' : 'SAFETY NET FAILED');
  console.log('ERRORS', errs.length ? errs.slice(0, 3) : 'none');
  await b.close();
  if (!allOk || errs.length) process.exit(1);
})();
