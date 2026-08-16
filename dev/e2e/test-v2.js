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
  // config trackers; Weightlifting has no day card (derived from the workout log)
  // weight (measurement) sorts first
  check('day cards are Weight, Calories, Protein, Cardio, 10k steps',
    JSON.stringify(names) === JSON.stringify(['Weight', 'Calories', 'Protein', 'Cardio', '10k steps']), names.join(','));
  const chips = await page.$$eval('.chip', (els) => els.map((e) => e.textContent));
  check('Cardio has 3 chips (walk removed)', JSON.stringify(chips) === JSON.stringify(['run', 'squash', 'bike']), chips.join(','));

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

  // ---- 4/5. targets via the code-config path (applyConfig): Calories ≤ 3000/day,
  //         Weightlifting 4 days/wk. Settings shows them read-only.
  await page.evaluate(async () => {
    const t = await import('./js/trackers.js');
    const ins = await import('./js/insights.js');
    t.applyConfig([
      { name: 'Calories', type: 'number', unit: 'kcal', target: { period: 'day', value: 3000, dir: 'atmost' } },
      { name: 'Protein', type: 'number', unit: 'g', target: null },
      { name: 'Cardio', type: 'multiselect', options: ['walk', 'run', 'squash', 'bike'], target: null },
      { name: 'Weightlifting', type: 'checkbox', target: { period: 'week', value: 4 } },
    ], (phase, pace) => ins.PACE_PRESETS[phase][pace]);
  });
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const cal = stored.trackers.find((t) => t.name === 'Calories');
  check('config sets calorie target from=today, atmost',
    cal.targets && cal.targets.length === 1 && cal.targets[0].from === today
    && cal.targets[0].value === 3000 && cal.targets[0].dir === 'atmost',
    JSON.stringify(cal.targets));
  // idempotent: re-applying the same config writes nothing new
  const changedAgain = await page.evaluate(async () => {
    const t = await import('./js/trackers.js');
    return t.applyConfig([
      { name: 'Calories', type: 'number', unit: 'kcal', target: { period: 'day', value: 3000, dir: 'atmost' } },
      { name: 'Protein', type: 'number', unit: 'g', target: null },
      { name: 'Cardio', type: 'multiselect', options: ['walk', 'run', 'squash', 'bike'], target: null },
      { name: 'Weightlifting', type: 'checkbox', target: { period: 'week', value: 4 } },
    ]);
  });
  check('config re-apply is a no-op', changedAgain === false);
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  const metaLine = await page.evaluate(() => [...document.querySelectorAll('.tr-info .meta')].map((m) => m.textContent).join(' | '));
  check('settings shows targets read-only', /≤ 3,000 kcal\/day/.test(metaLine) && /4 days\/wk/.test(metaLine), metaLine);
  check('settings has no tracker editing controls', (await page.$('.icon-btn[aria-label^="Edit"]')) === null
    && !(await page.evaluate(() => [...document.querySelectorAll('.ghost-btn')].some((b) => /Add tracker/.test(b.textContent)))));

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
  // config backdates Cardio to a WEEKLY target, so it no longer carries a daily streak line
  check('cardio has no daily streak (weekly target from config)', (dayText.match(/5-day streak/g) || []).length === 1);
  await page.screenshot({ path: path.join(SHOTS, 'v2-day-streaks.png') });

  // over-target: set 3500 calories -> bar .over, streak falls back to yesterday's 4
  await setNumberInput(page, '.card input[aria-label="Calories"]', '3500');
  const overBar = await page.$eval('.target-line .bar i', (e) => e.className);
  const textAfterBust = await page.$eval('#view-day', (e) => e.textContent);
  check('exceeding at-most target marks bar .over', /over/.test(overBar), overBar);
  check('busting today falls back to 4-day streak', /target ≤ 3,000 kcal · 4-day streak/.test(textAfterBust));
  await setNumberInput(page, '.card input[aria-label="Calories"]', '2500');

  // ---- 7. week view: totals, weekly goal, days count ----
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  const weekText = await page.$eval('.report-card', (e) => e.textContent);
  check('week card shows workouts days', /Workouts\d\/\d days/.test(weekText), weekText.slice(0, 200));
  check('week card shows calories line', /Calories/.test(weekText));
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

  // ---- 9. single-select tracker type (added via code config) ----
  await page.evaluate(async () => {
    const t = await import('./js/trackers.js');
    t.applyConfig([
      { name: 'Workout', type: 'text' },
      { name: 'Cardio', type: 'multiselect', options: ['walk', 'run', 'squash', 'bike'] },
      { name: 'Weightlifting', type: 'checkbox' },
      { name: 'Mood', type: 'select', options: ['great', 'ok', 'rough'] },
    ]);
  });
  await page.click('.tab[data-tab="settings"]');
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
