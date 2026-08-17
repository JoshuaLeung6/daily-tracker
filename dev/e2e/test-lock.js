// E2E: past days read-only with per-day unlock; locked days show only
// filled fields.
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

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card');

  check('today has no lock pill', (await page.$('.lock-pill')) === null);
  check('today input is editable', await page.$eval('.card input[type="text"]', (i) => !i.readOnly));

  await page.click('.nav-arrow[aria-label="Previous day"]');
  await page.waitForSelector('.lock-pill');
  check('yesterday shows lock pill (locked)', await page.$eval('.lock-pill', (p) => p.textContent.includes('Locked')));
  const lockedCards = await page.$$eval('.cards .card', (els) => els.length);
  check('locked empty day shows no tracker cards', lockedCards === 0, `cards: ${lockedCards}`);
  check('locked empty day says nothing logged',
    await page.$eval('#view-day', (e) => /Nothing logged this day/.test(e.textContent)));

  await page.click('.lock-pill');
  await page.waitForSelector('.lock-pill.unlocked');
  check('pill flips to Editing', await page.$eval('.lock-pill', (p) => p.textContent.includes('Editing')));
  const unlockedCards = await page.$$eval('.cards .card', (els) => els.length);
  // config trackers minus the Weightlifting checkbox (derived from the workout log):
  // Calories, Protein, Cardio, 10k steps, Weight
  check('unlocking reveals the 6 loggable trackers (incl. Waist)', unlockedCards === 6, `cards: ${unlockedCards}`);
  await page.click('.card input[type="text"]');
  await page.keyboard.type('1800');
  await new Promise((r) => setTimeout(r, 500));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  check('edit on unlocked past day saved', Object.keys(stored.entries).length === 1,
    `days: ${Object.keys(stored.entries).length}`);

  await page.click('.nav-arrow[aria-label="Previous day"]');
  await page.click('.nav-arrow[aria-label="Next day"]');
  check('returning to the day re-locks it', await page.$eval('.lock-pill', (p) => p.textContent.includes('Locked')));
  const relockedNames = await page.$$eval('.card .t-name', (els) => els.map((e) => e.textContent));
  // (weight sorts first, so the typed value landed in the Weight card)
  // the first card is Waist now (measurements sort first, Waist before Weight)
  check('re-locked day shows only the filled tracker', JSON.stringify(relockedNames) === JSON.stringify(['Waist']), relockedNames.join(','));
  check('value shown readonly', await page.$eval('.card input[type="text"]', (i) => i.readOnly && i.value === '1800'));
  await page.click('.card input[type="text"]');
  await page.keyboard.type('9');
  const afterType = await page.$eval('.card input[type="text"]', (i) => i.value);
  check('typing while locked is ignored', afterType === '1800', `got "${afterType}"`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'lock-locked.png') });

  await page.click('.today-pill');
  check('back on today: no pill, editable', (await page.$('.lock-pill')) === null
    && await page.$eval('.card input[type="text"]', (i) => !i.readOnly));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
