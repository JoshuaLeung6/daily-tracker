// E2E for v2.1.0: value goals, target attainment, PR goals, attainment colors,
// locked-day filled-only view.
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

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });

  // Inject a full doc before app boot:
  // calories: daily <=3000 target from 10 days ago; met d-3, d-2, today; missed d-1 (3200)
  // weightlifting: 4 days/week target; checked on 4 days this week
  // bench workout today for PR goal testing
  const inject = await page.evaluateOnNewDocument(() => {
    const iso = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = new Date();
    const monOffset = -((today.getDay() + 6) % 7); // offset to Monday of this week
    const doc = {
      schemaVersion: 4,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false,
          targets: [{ from: iso(-10), value: 3000, period: 'day', dir: 'atmost' }] },
        { id: 't_pro', name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false },
        { id: 't_lift', name: 'Weightlifting', type: 'checkbox', unit: null, order: 2, archived: false,
          targets: [{ from: iso(-30), value: 4, period: 'week' }] },
      ],
      entries: {
        [iso(-3)]: { t_cal: 2500 },
        [iso(-2)]: { t_cal: 2800 },
        [iso(-1)]: { t_cal: 3200 },
        [iso(0)]: { t_cal: 2500 },
      },
      workouts: {
        [iso(0)]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 135, reps: 8, sets: 3 }] },
      },
      liftGoals: {},
    };
    // 4 lifting days this week (Mon..Thu or fewer if early in week — pad backward)
    let added = 0;
    for (let i = 0; added < 4 && i < 7; i++) {
      const off = monOffset + i;
      if (off > 0) break;
      const key = iso(off);
      doc.entries[key] = { ...(doc.entries[key] || {}), t_lift: true };
      added++;
    }
    // if week too young for 4 days, extend into today anyway (off<=0 guaranteed above)
    localStorage.setItem('pcal:theme', 'dark');
    localStorage.setItem('pcal:data', JSON.stringify(doc));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inject.identifier);
  await page.waitForSelector('.card');

  const liftDays = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    return Object.values(doc.entries).filter((d) => d.t_lift).length;
  });

  // ---- 1. day view: calories met today -> green ----
  const tlClass = await page.$eval('.card .tl-text', (e) => e.className);
  const fillClass = await page.$eval('.card .target-line .bar i', (e) => e.className);
  check('calories met today: text green', /met/.test(tlClass), tlClass);
  check('calories met today: bar green', /met/.test(fillClass), fillClass);

  // ---- 2. Progress tab: Goals pane attainment ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.att-card');
  let paneText = await page.$eval('#view-stats', (e) => e.textContent);
  check('attainment card shows streak 1 (missed yesterday)', /streak/.test(paneText));
  const attVals = await page.$$eval('.att-card .as-v', (els) => els.map((e) => e.textContent));
  check('calories: streak=1, best=2, 30-day=3/11',
    attVals[0] === '1' && attVals[1] === '2' && attVals[2] === '3/11', attVals.join(','));
  const dotStates = await page.$$eval('.dstrip i', (els) => els.map((e) => e.className));
  check('dot strip: 14 dots, 3 met', dotStates.length === 14 && dotStates.filter((c) => c === 'met').length === 3,
    `${dotStates.length} dots, ${dotStates.filter((c) => c === 'met').length} met`);
  const greenStreak = await page.$eval('.att-card .as-v', (e) => e.className);
  check('streak number green when met today', /met-day-text on/.test(greenStreak), greenStreak);

  // weightlifting weekly card
  const wkCards = await page.$$eval('.att-card', (els) => els.map((e) => e.textContent));
  const liftCard = wkCards.find((t) => t.includes('Weightlifting'));
  check(`weightlifting card shows ${liftDays}/4 this week`, liftCard && liftCard.includes(`${liftDays}/4`), liftCard);

  // ---- 3. add a body-weight goal via code config (creates the Weight tracker) ----
  await page.evaluate(async (deadline) => {
    const t = await import('./js/trackers.js');
    const ins = await import('./js/insights.js');
    t.applyConfig([
      { name: 'Calories', type: 'number', unit: 'kcal' },
      { name: 'Protein', type: 'number', unit: 'g' },
      { name: 'Weightlifting', type: 'checkbox' },
      { name: 'Weight', type: 'measurement', unit: 'lb', goal: { startValue: 190, target: 175, deadline, pace: 'standard' } },
    ], (phase, pace) => ins.PACE_PRESETS[phase][pace]);
  }, localISO(70));
  await page.click('.tab[data-tab="day"]');
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.goal-card');
  let goalText = await page.$eval('.goal-card', (e) => e.textContent);
  check('goal card: 190 -> 175 lb', /190 → 175 lb/.test(goalText), goalText);
  check('goal card: 70 days left + pace -1.5/wk', /70 days left/.test(goalText) && /-1\.5 lb\/wk/.test(goalText), goalText);
  const weightCreated = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    return doc.trackers.some((t) => t.name === 'Weight' && t.goal && t.goal.target === 175);
  });
  check('Weight tracker created by config with goal', weightCreated);

  // log a weight and see progress move
  await page.click('.tab[data-tab="day"]');
  await page.waitForSelector('.card input[aria-label="Weight"]');
  await page.type('.card input[aria-label="Weight"]', '185');
  await new Promise((r) => setTimeout(r, 500));
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.goal-card');
  goalText = await page.$eval('.goal-card', (e) => e.textContent);
  check('goal card updates: now 185 (-5)', /now 185 \(-5\)/.test(goalText), goalText);
  const goalPct = await page.$eval('.goal-card .goal-fill', (e) => e.style.width);
  check('goal progress ~33%', goalPct === '33%', goalPct);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'goals-pane.png') });

  // ---- 4. lifting pane: PR goal ----
  await clickByText('#view-stats .seg-btn', 'Lifting');
  await page.waitForSelector('.stat-row');
  await page.evaluate(() => [...document.querySelectorAll('.stat-row')].find((r) => r.textContent.includes('Bench press')).click());
  await page.waitForSelector('.sr-goalrow input');
  await page.type('.sr-goalrow input', '225');
  await clickByText('.sr-goalbtn', 'Save');
  await new Promise((r) => setTimeout(r, 200));
  const liftText = await page.$eval('#view-stats', (e) => e.textContent);
  check('bench shows goal 225 · 60%', /goal 225 · 60%/.test(liftText), liftText.slice(0, 250));
  const violetBar = await page.$('.stat-row .goal-fill, .stat-block .goal-fill');
  check('violet goal bar on lift row', violetBar !== null);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'lifting-goals.png') });

  // ---- 5. week + month coloring ----
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  const wkCard = await page.$eval('.report-card', (e) => e.textContent);
  // workout days = checkbox days ∪ logged-workout days (today has a workout too)
  check('week card workouts line shows N/days', /Workouts\d\/\d days/.test(wkCard), wkCard.slice(0, 200));
  const greenDays = await page.$$eval('.wr-date .dn.all-met', (els) => els.length);
  const monOffset = -((new Date().getDay() + 6) % 7);
  const expectedGreen = [-3, -2, 0].filter((off) => off >= monOffset).length;
  check(`week rows: ${expectedGreen} green day number(s) in current week`, greenDays === expectedGreen, `got ${greenDays}`);

  check('month tab removed from tab bar', (await page.$('.tab[data-tab="month"]')) === null);

  // ---- 6. locked day shows only filled fields ----
  await page.click('.tab[data-tab="day"]');
  await page.click('.nav-arrow[aria-label="Previous day"]'); // yesterday: calories 3200 (+ maybe lifting)
  await page.waitForSelector('.lock-pill');
  const lockedNames = await page.$$eval('.card .t-name', (els) => els.map((e) => e.textContent));
  check('locked yesterday hides empty trackers', !lockedNames.includes('Protein') && !lockedNames.includes('Weight'), lockedNames.join(','));
  // find the first past day with nothing logged, mirroring the injection
  // (calories on -3..0, weightlifting on up to 4 days from this week's Monday)
  const filled = new Set([0, -1, -2, -3]);
  {
    const monOff = -((new Date().getDay() + 6) % 7);
    let added = 0;
    for (let i = 0; added < 4 && i < 7; i++) {
      const off = monOff + i;
      if (off > 0) break;
      filled.add(off);
      added++;
    }
  }
  let emptyOff = -1;
  while (filled.has(emptyOff)) emptyOff--;
  for (let i = 0; i < -emptyOff - 1; i++) await page.click('.nav-arrow[aria-label="Previous day"]');
  const emptyText = await page.$eval('#view-day', (e) => e.textContent);
  check(`locked empty day (${emptyOff}) says nothing logged`, /Nothing logged this day/.test(emptyText), emptyText.slice(0, 120));

  // ---- 7. About note removed ----
  await page.click('.tab[data-tab="settings"]');
  const settingsText = await page.$eval('#view-settings', (e) => e.textContent);
  check('"All data lives on this phone" note removed', !/All data lives on this phone/.test(settingsText));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
