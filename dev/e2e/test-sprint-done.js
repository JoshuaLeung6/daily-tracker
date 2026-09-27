// E2E: the INACTIVE sprint view + between-sprints quiet mode. Boots the app
// with the page clock shifted to Oct 10, 2026 — six days after Sprint 1
// ends — so the done state renders without waiting for the calendar.
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

  // clock shim: installed before any app script runs
  await page.evaluateOnNewDocument(() => {
    const Real = Date;
    const offset = new Real('2026-10-10T12:00:00').getTime() - Real.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
      static now() { return Real.now() + offset; }
    };
  });
  // in-sprint data: a week of late-September weigh-ins + one workout
  await page.evaluateOnNewDocument(() => {
    const entries = {};
    const w = [138.2, 138.6, 138.4, 139.0, 138.8, 139.4];
    for (let i = 0; i < 6; i++) entries[`2026-09-2${i + 1}`] = { t_wt: w[i], t_cal: 3000, t_pro: 130 };
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
        { id: 't_pro', name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false },
        { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 2, archived: false },
      ],
      entries,
      workouts: { '2026-09-22': { split: 'push', focus: 'weight', lifts: [{ name: 'Flat dumbbell press', weight: 50, reps: 8, sets: 3, rir: 2, locked: false }] } },
      liftGoals: {}, profile: {}, foods: [], notes: {},
    }));
  });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.card');

  // ---- 1. day view: no nags in the gap ----
  const dayText = await page.$eval('#view-day', (e) => e.textContent);
  check('gap: no monthly-photo-due tag on the day view', !/monthly photo due/.test(dayText));

  // ---- 2. Progress renders the INACTIVE view ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#view-stats .seg-btn');
  const spText = await page.$eval('#view-stats', (e) => e.textContent);
  check('inactive view: Sprint complete header', /Sprint complete/.test(spText));
  check('inactive view: Outcomes + Sprint totals', /Outcomes/.test(spText) && /Sprint totals/.test(spText), spText.slice(0, 260));
  check('inactive view: no pacing demands', !/need [+-]/.test(spText) && !/Trending/.test(spText));
  check('inactive view: weight outcome vs goal', /goal 145/.test(spText), spText.slice(0, 400));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'sprint-done.png') });

  // ---- 3. Coach goes quiet ----
  await page.evaluate(() => [...document.querySelectorAll('#view-stats .seg-btn:not(.range-btn)')].find((b) => b.textContent === 'Coach').click());
  await new Promise((r) => setTimeout(r, 300));
  const coachText = await page.$eval('#view-stats', (e) => e.textContent);
  check('gap: Coach shows the between-sprints note', /Between sprints/.test(coachText));
  check('gap: no suggestion or nag cards', (await page.$$('#view-stats .suggest-card, #view-stats .rx-card')).length === 0);
  check('gap: no plan section, reference cards stay', !/Process goals/.test(coachText) && /Reference/.test(coachText));

  // ---- 4. Settings shelf: Complete row opens the report overlay ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.sprint-row');
  const rowText = await page.$eval('.sprint-row', (e) => e.textContent);
  check('shelf: Sprint 1 listed as Complete', /Sprint 1/.test(rowText) && /Complete/.test(rowText), rowText);
  await page.click('.sprint-row');
  await page.waitForSelector('.workout-overlay');
  const ovText = await page.$eval('.workout-overlay', (e) => e.textContent);
  check('shelf: overlay shows the sprint report', /Sprint 1/.test(ovText) && /complete/.test(ovText) && /Outcomes/.test(ovText), ovText.slice(0, 200));
  await page.evaluate(() => document.querySelector('.workout-overlay .btn.primary').click());
  await new Promise((r) => setTimeout(r, 200));
  check('shelf: overlay closes', (await page.$('.workout-overlay')) === null);

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
