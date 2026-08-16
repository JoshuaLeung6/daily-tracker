// E2E for v1.1.0: picklists, theme toggle, migration, dated targets, streaks.
// localStorage injections use evaluateOnNewDocument so they land AFTER the
// old page's pagehide flush and BEFORE the app boots.
const puppeteer = require('puppeteer-core');
const path = require('path');

const URL = 'http://localhost:8080/';
const SHOTS = path.join(__dirname, 'shots');
const results = [];
function check(name, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}
const localISO = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function setNumberInput(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel);
    input.value = val;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
  }, { sel: selector, val: value });
  await new Promise((r) => setTimeout(r, 100));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--disable-gpu'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const clickByText = (sel, text) => page.evaluate(({ s, t }) => {
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent === t);
    if (!eln) throw new Error(`no ${s} with text ${t}`);
    eln.click();
  }, { s: sel, t: text });

  // ---- 1. fresh seeds ----
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card');
  const names = await page.$$eval('.card .t-name', (els) => els.map((e) => e.childNodes[0].textContent.trim()));
  check('seeds are Calories, Protein, Cardio, Weightlifting',
    JSON.stringify(names) === JSON.stringify(['Calories', 'Protein', 'Cardio', 'Weightlifting']), names.join(','));
  const chips = await page.$$eval('.chip', (els) => els.map((e) => e.textContent));
  check('Cardio has 4 chips', JSON.stringify(chips) === JSON.stringify(['walk', 'run', 'squash', 'bike']), chips.join(','));

  // ---- 2. multiselect chips ----
  await clickByText('.chip', 'run');
  await clickByText('.chip', 'bike');
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const cardioId = stored.trackers.find((t) => t.name === 'Cardio').id;
  const today = localISO(0);
  let v = (stored.entries[today] || {})[cardioId];
  check('multiselect stores [run, bike]', JSON.stringify(v) === JSON.stringify(['run', 'bike']), JSON.stringify(v));
  await clickByText('.chip', 'run');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  v = (stored.entries[today] || {})[cardioId];
  check('deselecting run leaves [bike]', JSON.stringify(v) === JSON.stringify(['bike']), JSON.stringify(v));

  // ---- 3. theme toggle ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.seg');
  await clickByText('.seg-btn', 'Light');
  let theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('Light button switches html[data-theme]', theme === 'light', theme);
  const metaColor = await page.$eval('meta[name="theme-color"]', (m) => m.content);
  check('meta theme-color follows light', metaColor === '#f6f0e3', metaColor);
  await page.screenshot({ path: path.join(SHOTS, 'v2-settings-light.png') });
  await page.reload({ waitUntil: 'networkidle0' });
  theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('light theme survives reload (no-flash bootstrap)', theme === 'light', theme);

  // ---- 4. targets via settings UI: Calories ≤ 3000/day ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('aria-label') === 'Edit Calories').click());
  await page.waitForSelector('.tr-edit');
  await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Target period"]');
    sel.value = 'day';
    sel.dispatchEvent(new Event('change'));
    document.querySelector('select[aria-label="Target direction"]').value = 'atmost';
    document.querySelector('input[aria-label="Target amount"]').value = '3000';
  });
  await clickByText('.btn.primary', 'Save');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const cal = stored.trackers.find((t) => t.name === 'Calories');
  check('calorie target saved with from=today, atmost',
    cal.targets && cal.targets.length === 1 && cal.targets[0].from === today
    && cal.targets[0].value === 3000 && cal.targets[0].dir === 'atmost',
    JSON.stringify(cal.targets));

  // ---- 5. weightlifting 4 days/week target ----
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('aria-label') === 'Edit Weightlifting').click());
  await page.waitForSelector('.tr-edit');
  await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Target period"]');
    sel.value = 'week';
    sel.dispatchEvent(new Event('change'));
    document.querySelector('input[aria-label="Target amount"]').value = '4';
  });
  await clickByText('.btn.primary', 'Save');
  const metaLine = await page.evaluate(() => [...document.querySelectorAll('.tr-info .meta')].map((m) => m.textContent).join(' | '));
  check('settings meta shows targets', /≤ 3,000 kcal\/day/.test(metaLine) && /4 days\/wk/.test(metaLine), metaLine);

  // ---- 6. streaks: inject history before app boot ----
  const isoList = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10].map(localISO);
  const streakScript = await page.evaluateOnNewDocument(({ isoList, todayKey }) => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    const cardio = doc.trackers.find((t) => t.name === 'Cardio');
    const calories = doc.trackers.find((t) => t.name === 'Calories');
    const lifting = doc.trackers.find((t) => t.name === 'Weightlifting');
    cardio.targets = [{ from: isoList[9], value: 1, period: 'day' }];
    calories.targets = [{ from: isoList[9], value: 3000, period: 'day', dir: 'atmost' }];
    for (let i = 0; i < 4; i++) {
      const iso = isoList[i];
      doc.entries[iso] = { [cardio.id]: ['run'], [calories.id]: 2500, ...(i < 2 ? { [lifting.id]: true } : {}) };
    }
    doc.entries[todayKey] = doc.entries[todayKey] || {};
    doc.entries[todayKey][cardio.id] = ['bike'];
    doc.entries[todayKey][calories.id] = 2500;
    doc.entries[todayKey][lifting.id] = true;
    localStorage.setItem('pcal:data', JSON.stringify(doc));
  }, { isoList, todayKey: today });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(streakScript.identifier);
  await page.waitForSelector('.card');
  const dayText = await page.$eval('#view-day', (e) => e.textContent);
  check('calories card shows 5-day streak + ≤ target', /target ≤ 3,000 kcal · 5-day streak/.test(dayText), dayText.slice(0, 300));
  check('cardio card shows 5-day streak', (dayText.match(/5-day streak/g) || []).length >= 2);
  await page.screenshot({ path: path.join(SHOTS, 'v2-day-streaks.png') });

  // over-target: set 3500 calories -> bar .over, streak falls back to yesterday's 4
  await setNumberInput(page, '.card input[type="text"]', '3500');
  const overBar = await page.$eval('.target-line .bar i', (e) => e.className);
  const textAfterBust = await page.$eval('#view-day', (e) => e.textContent);
  check('exceeding at-most target marks bar .over', /over/.test(overBar), overBar);
  check('busting today falls back to 4-day streak', /target ≤ 3,000 kcal · 4-day streak/.test(textAfterBust));
  await setNumberInput(page, '.card input[type="text"]', '2500');

  // ---- 7. week view: totals, weekly goal, days count ----
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.week-totals');
  const weekText = await page.$eval('.week-totals', (e) => e.textContent);
  check('week totals show weightlifting days vs 4/week target', /\d \/ 4 days/.test(weekText), weekText.slice(0, 200));
  check('week totals show calories goal', /≤ 3,000 kcal\/day/.test(weekText));
  const rowText = await page.$eval('.week-rows', (e) => e.textContent);
  check('week rows show multiselect values', /run|bike/.test(rowText));
  await page.screenshot({ path: path.join(SHOTS, 'v2-week-light.png') });

  // ---- 8. migration from v1 (unused Workout removed, entries preserved) ----
  const mig1 = await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 1,
      trackers: [
        { id: 't_a', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
        { id: 't_b', name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false },
        { id: 't_c', name: 'Workout', type: 'text', unit: null, order: 2, archived: false },
      ],
      entries: { '2026-07-10': { t_a: 2000 } },
    }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(mig1.identifier);
  await page.waitForSelector('.card');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const migNames = stored.trackers.map((t) => t.name);
  check('migration removes unused Workout, adds Cardio + Weightlifting',
    !migNames.includes('Workout') && migNames.includes('Cardio') && migNames.includes('Weightlifting')
    && stored.schemaVersion >= 2, migNames.join(','));
  check('migration preserves existing entries', stored.entries['2026-07-10'] && stored.entries['2026-07-10'].t_a === 2000);

  // migration keeps Workout when it has data
  const mig2 = await page.evaluateOnNewDocument(() => {
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 1,
      trackers: [{ id: 't_c', name: 'Workout', type: 'text', unit: null, order: 0, archived: false }],
      entries: { '2026-07-10': { t_c: 'bench day' } },
    }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(mig2.identifier);
  await page.waitForSelector('.card');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  check('migration keeps Workout that has logged notes',
    stored.trackers.some((t) => t.name === 'Workout') && stored.entries['2026-07-10'].t_c === 'bench day',
    stored.trackers.map((t) => t.name).join(','));

  // ---- 9. single-select tracker type (add-tracker popup) ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  check('add form hidden until button pressed', (await page.$('.add-form')) === null);
  await clickByText('.ghost-btn', '+ Add tracker');
  await page.waitForSelector('.sheet.add-form');
  // backdrop click dismisses without adding
  await page.evaluate(() => document.querySelector('.sheet-backdrop').click());
  check('backdrop click closes sheet', (await page.$('.sheet-backdrop')) === null);
  await clickByText('.ghost-btn', '+ Add tracker');
  await page.waitForSelector('.add-form');
  await page.type('.add-form input[aria-label="New tracker name"]', 'Mood');
  await page.select('.add-form select[aria-label="Tracker type"]', 'select');
  await page.type('.add-form input[aria-label="Options"]', 'great, ok, rough');
  await clickByText('.add-form .btn.primary', 'Add tracker');
  await page.click('.tab[data-tab="day"]');
  await page.waitForSelector('.chip');
  await clickByText('.chip', 'great');
  await clickByText('.chip', 'rough');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const moodId = stored.trackers.find((t) => t.name === 'Mood').id;
  const moodVal = (stored.entries[localISO(0)] || {})[moodId];
  check('single-select keeps one value (rough replaces great)', moodVal === 'rough', JSON.stringify(moodVal));

  check('no console/page errors during whole run', errors.length === 0, errors.join(' | ').slice(0, 300));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
