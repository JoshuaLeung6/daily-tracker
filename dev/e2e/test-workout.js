// E2E: workout editor v2.3 — empty start, picker sheet, suggestion chips,
// last-session previews, no number prefill; e1RM trend in stats.
const puppeteer = require('puppeteer-core');
const path = require('path');

const results = [];
function check(name, ok, extra = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}
const localISO = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent.trim() === t);
    if (!eln) throw new Error(`no ${s} "${t}"`);
    eln.click();
  }, { s: sel, t: text });

  const addLiftViaPicker = async (name) => {
    await clickByText('.workout-overlay .ghost-btn', '+ Add lift');
    await page.waitForSelector('.sheet input[aria-label="Search lifts"]');
    await page.type('.sheet input[aria-label="Search lifts"]', name);
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.pick-row')];
      (rows.find((r) => !r.disabled) || rows[0]).click();
    });
  };
  const fillRow = async (index, w, r, s2) => {
    const set = async (label, val) => {
      await page.evaluate(({ i, l, v }) => {
        const row = document.querySelectorAll('.lift-row')[i];
        const input = row.querySelector(`input[aria-label="${l}"]`);
        input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, { i: index, l: label, v: val });
    };
    await set('Weight', w); await set('Reps', r); await set('Sets', s2);
  };

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card');
  const today = localISO(0);

  // ---- 1. new workout starts EMPTY ----
  await page.click('.ghost-btn');
  await page.waitForSelector('.workout-overlay');
  const cls = await page.$$eval('.workout-overlay .seg-btn[aria-pressed="true"]', (els) => els.map((e) => e.textContent));
  check('first workout defaults to Push + Weight day', JSON.stringify(cls) === JSON.stringify(['Push', 'Weight day']), cls.join(','));
  check('no lift rows auto-added', (await page.$$('.lift-row')).length === 0);
  check('no suggestion chips (no history)', (await page.$$('.chip-suggest')).length === 0);

  // ---- 2. add lifts via picker; numbers empty; first-time preview ----
  await addLiftViaPicker('Bench press');
  await page.waitForSelector('.lift-row');
  const nameVal = await page.$eval('.lift-row .lift-name', (e) => e.value);
  const weightVal = await page.$eval('.lift-row input[aria-label="Weight"]', (e) => e.value);
  check('picker adds named row with EMPTY numbers', nameVal === 'Bench press' && weightVal === '');
  check('first-time preview', await page.$eval('.lift-preview', (e) => /first time/.test(e.textContent)));
  await fillRow(0, '135', '8', '3');
  await addLiftViaPicker('Overhead press');
  await fillRow(1, '95', '10', '3');
  await page.screenshot({ path: path.join(__dirname, 'shots', 'wo3-editor.png') });
  await clickByText('.wo-head .btn.primary', 'Done');

  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const wo = stored.workouts[today];
  check('workout saved with 2 lifts + numbers', wo && wo.lifts.length === 2 && wo.lifts[0].weight === 135, JSON.stringify(wo && wo.lifts));
  const liftingId = stored.trackers.find((t) => t.name === 'Weightlifting').id;
  check('Weightlifting auto-checked', stored.entries[today] && stored.entries[today][liftingId] === true);

  // ---- 3. next day: chips suggest last same-class lifts, tap-to-add name only ----
  await page.click('.nav-arrow[aria-label="Next day"]');
  await page.waitForSelector('.ghost-btn');
  await page.click('.ghost-btn');
  await page.waitForSelector('.workout-overlay');
  const cls2 = await page.$$eval('.workout-overlay .seg-btn[aria-pressed="true"]', (els) => els.map((e) => e.textContent));
  check('rotation suggests Pull', cls2[0] === 'Pull', cls2.join(','));
  check('Pull: no chips (no pull history)', (await page.$$('.chip-suggest')).length === 0);
  await clickByText('.workout-overlay .seg-btn', 'Push');
  await page.waitForSelector('.chip-suggest');
  const chips = await page.$$eval('.chip-suggest', (els) => els.map((e) => e.textContent));
  check('Push chips = last Push lifts', JSON.stringify(chips) === JSON.stringify(['+ Bench press', '+ Overhead press']), chips.join(','));
  check('still no rows auto-added', (await page.$$('.lift-row')).length === 0);

  await clickByText('.chip-suggest', '+ Bench press');
  await page.waitForSelector('.lift-row');
  const w2 = await page.$eval('.lift-row input[aria-label="Weight"]', (e) => e.value);
  check('chip adds name-only row (weight empty)', w2 === '');
  check('preview shows last weight day 135 × 8 × 3',
    await page.$eval('.lift-preview', (e) => /last weight day: 135 × 8 × 3/.test(e.textContent)),
    await page.$eval('.lift-preview', (e) => e.textContent));
  const chipsAfter = await page.$$eval('.chip-suggest', (els) => els.map((e) => e.textContent));
  check('used chip disappears', !chipsAfter.includes('+ Bench press'), chipsAfter.join(','));
  await fillRow(0, '140', '8', '3');
  await clickByText('.wo-head .btn.primary', 'Done');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  check('tomorrow saved: bench 140', stored.workouts[localISO(1)].lifts[0].weight === 140);

  // ---- 4. open-and-close leaves no trace; removing rows deletes ----
  await page.click('.nav-arrow[aria-label="Next day"]');
  await page.waitForSelector('.ghost-btn');
  await page.click('.ghost-btn');
  await page.waitForSelector('.workout-overlay');
  await clickByText('.wo-head .btn.primary', 'Done');
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  check('closing untouched editor saves nothing', !(localISO(2) in stored.workouts));

  // ---- 5. lifting stats: e1RM trend ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#view-stats .seg-btn');
  await clickByText('#view-stats .seg-btn', 'Lifting');
  await page.waitForSelector('.stat-row');
  const statsText = await page.$eval('#view-stats', (e) => e.textContent);
  check('bench shows e1RM 177.3 (140x8)', /e1RM 177\.3/.test(statsText), statsText.slice(0, 260));
  const benchRow = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stat-row')].find((x) => x.textContent.includes('Bench press'));
    return r ? r.querySelector('.trend') && r.querySelector('.trend').className : null;
  });
  check('bench trend up (e1RM 171→177)', /up/.test(benchRow || ''), String(benchRow));
  check('weekly volume chart present', (await page.$('.chart-card .chart')) !== null);
  await page.evaluate(() => [...document.querySelectorAll('.stat-row')].find((r) => r.textContent.includes('Bench press')).click());
  await page.waitForSelector('.sr-history');
  const chartDots = await page.$$eval('.sr-history .chart .ch-dot', (els) => els.length);
  check('lift e1RM chart has 2 points', chartDots === 2, `dots: ${chartDots}`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'wo3-stats.png') });

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
