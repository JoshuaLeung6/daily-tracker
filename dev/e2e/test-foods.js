// E2E v2.9.0: food library — tap-to-log, undo, new foods, ideas, settings
// management, locked days, export inclusion.
const puppeteer = require('puppeteer-core');
const path = require('path');

const results = [];
function check(name, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
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
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const clickByText = (sel, text) => page.evaluate(({ s, t }) => {
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent.trim() === t);
    if (!eln) throw new Error(`no ${s} "${t}"`);
    eln.click();
  }, { s: sel, t: text });
  const getTotals = () => page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    const cal = doc.trackers.find((t) => t.name === 'Calories');
    const pro = doc.trackers.find((t) => t.name === 'Protein');
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = doc.entries[iso] || {};
    return { kcal: day[cal.id] ?? null, protein: day[pro.id] ?? null, foods: doc.foods };
  });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card');

  // ---- 1. + food button opens the sheet ----
  check('calories card has + food button', (await page.$('.food-btn')) !== null);
  await page.click('.food-btn');
  await page.waitForSelector('.sheet .food-footer');
  check('empty library shows ideas', await page.$eval('.pick-head', (e) => /Ideas/.test(e.textContent)));

  // ---- 2. save an idea to the library, then log it twice ----
  await page.evaluate(() => [...document.querySelectorAll('.food-idea .icon-btn')]
    .find((b) => /Whey scoop/.test(b.getAttribute('aria-label'))).click());
  await page.waitForSelector('.food-row');
  check('idea saved becomes a tappable food', await page.$eval('.food-row', (e) => /Whey scoop/.test(e.textContent)));
  await page.click('.food-row');
  await page.click('.food-row');
  let t = await getTotals();
  check('two taps: +240 kcal, +48 g', t.kcal === 240 && t.protein === 48, JSON.stringify(t));
  check('footer running total', await page.$eval('.food-footer', (e) => /2 added · \+240 kcal · \+48 g/.test(e.textContent)),
    await page.$eval('.food-footer', (e) => e.textContent));
  check('uses counted', t.foods.find((f) => f.name === 'Whey scoop').uses === 2);

  // ---- 3. undo removes the last serving ----
  await clickByText('.food-footer .btn', 'Undo');
  t = await getTotals();
  check('undo: back to 120 kcal / 24 g', t.kcal === 120 && t.protein === 24, JSON.stringify(t));

  // ---- 4. create a custom food in the sheet and log it ----
  await clickByText('.pick-row.pick-new', '＋ New food');
  await page.type('input[aria-label="Food name"]', 'Chicken & rice bowl');
  await page.type('input[aria-label="Food kcal"]', '650');
  await page.type('input[aria-label="Food protein"]', '45');
  await page.evaluate(() => [...document.querySelectorAll('.food-newform .btn')].find((b) => b.textContent === 'Add').click());
  await page.evaluate(() => [...document.querySelectorAll('.food-row')]
    .find((r) => /Chicken & rice bowl/.test(r.textContent)).click());
  t = await getTotals();
  check('custom food logged: 770 kcal / 69 g', t.kcal === 770 && t.protein === 69, JSON.stringify(t));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'food-sheet.png') });
  await clickByText('.food-head .btn.primary', 'Done');

  // day view refreshed with new totals
  const calVal = await page.$eval('.card input[aria-label="Calories"]', (e) => e.value);
  check('day view shows updated calories after Done', calVal === '770', calVal);

  // ---- 5. settings: library management (edit + delete) ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  const settingsText = await page.$eval('#view-settings', (e) => e.textContent);
  check('settings lists foods with usage', /Whey scoop/.test(settingsText) && /used 2×|used 1×/.test(settingsText));
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')]
    .find((b) => b.getAttribute('aria-label') === 'Edit Whey scoop').click());
  await page.waitForSelector('input[aria-label="Calories per serving"]');
  await page.evaluate(() => {
    const i = document.querySelector('input[aria-label="Calories per serving"]');
    i.value = '130';
  });
  await clickByText('.sheet .btn.primary', 'Save');
  await new Promise((r) => setTimeout(r, 200));
  t = await getTotals();
  check('edit updates kcal', t.foods.find((f) => f.name === 'Whey scoop').kcal === 130);

  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')]
    .find((b) => b.getAttribute('aria-label') === 'Edit Chicken & rice bowl').click());
  await page.waitForSelector('.sheet .btn.danger');
  await page.click('.sheet .btn.danger');
  await new Promise((r) => setTimeout(r, 200));
  t = await getTotals();
  check('delete removes food, totals untouched', !t.foods.some((f) => f.name === 'Chicken & rice bowl') && t.kcal === 770,
    JSON.stringify({ foods: t.foods.length, kcal: t.kcal }));

  // ---- 6. locked past day: no + food button ----
  await page.click('.tab[data-tab="day"]');
  await page.click('.nav-arrow[aria-label="Previous day"]');
  await page.waitForSelector('.lock-pill');
  check('locked day has no + food button', (await page.$('.food-btn')) === null);
  await page.click('.lock-pill'); // unlock
  await page.waitForSelector('.food-btn');
  check('unlocked past day gets + food button', (await page.$('.food-btn')) !== null);
  await page.click('.today-pill');

  // ---- 7. exports include foods ----
  const payloads = await page.evaluate(async () => {
    const b = await import('./js/backup.js');
    return { analysis: b.buildAnalysisPayload().foods };
  });
  check('analysis export includes foods', Array.isArray(payloads.analysis)
    && payloads.analysis.some((f) => f.name === 'Whey scoop' && f.kcal === 130), JSON.stringify(payloads.analysis));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
