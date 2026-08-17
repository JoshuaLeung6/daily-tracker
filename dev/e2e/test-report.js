// E2E v2.5.0: Week Report Card — trend weight, rate vs band, if-then
// suggestions with two-week confirmation lag.
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

// Scenario builder injected before app boot.
// weightFn(i) gives weight at offset -i days (i=0 is today).
const inject = (page, { weightFn, calDaily, proteinDaily, proteinTarget, goal, workouts }) =>
  page.evaluateOnNewDocument(({ isoOf, weights, calDaily, proteinDaily, proteinTarget, goal, workouts }) => {
    const entries = {};
    for (let i = 0; i < isoOf.length; i++) {
      const iso = isoOf[i];
      entries[iso] = {};
      if (weights[i] != null) entries[iso].t_wt = weights[i];
      if (calDaily != null) entries[iso].t_cal = calDaily;
      if (proteinDaily && proteinDaily[i] != null) entries[iso].t_pro = proteinDaily[i];
    }
    const trackers = [
      { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
      { id: 't_pro', name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false,
        targets: proteinTarget ? [{ from: isoOf[isoOf.length - 1], value: proteinTarget, period: 'day', dir: 'atleast' }] : [] },
      { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 2, archived: false, goal },
    ];
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5, trackers, entries, workouts: workouts || {}, liftGoals: {}, profile: {},
    }));
  }, {
    isoOf: Array.from({ length: 30 }, (_, i) => localISO(-i)),
    weights: Array.from({ length: 30 }, (_, i) => weightFn(i)),
    calDaily, proteinDaily, proteinTarget, goal, workouts,
  });

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

  // ---- scenario A: bulk gaining in band (+0.18%/wk at ~185 lb) ----
  // weight rises 0.0475 lb/day -> ~0.333 lb/wk -> ~0.18%/wk
  const injA = await inject(page, {
    weightFn: (i) => 185 - 0.0475 * i,
    calDaily: 2900,
    proteinDaily: Array.from({ length: 30 }, (_, i) => (i % 7 < 6 ? 160 : 120)),
    proteinTarget: 150,
    goal: { from: localISO(-29), startValue: 183.5, target: 195, deadline: null },
    // keep sessions inside the CURRENT week regardless of weekday: one today,
    // one yesterday only if yesterday is still this week (i.e. not Monday)
    workouts: {
      [localISO(0)]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench', weight: 185, reps: 5, sets: 3 }] },
      ...(((new Date().getDay() + 6) % 7) >= 1
        ? { [localISO(-1)]: { split: 'pull', focus: 'weight', lifts: [{ name: 'Row', weight: 155, reps: 6, sets: 3 }] } }
        : {}),
      [localISO(-8)]: { split: 'legs', focus: 'weight', lifts: [{ name: 'Squat', weight: 225, reps: 5, sets: 3 }] },
    },
  });
  // completed days only: today's session is excluded, so only the yesterday one counts (if in-week)
  const expectedSessions = (((new Date().getDay() + 6) % 7) >= 1 ? 1 : 0);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injA.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  // Open the LAST COMPLETE week, not the current one. On a Monday the current
  // week has zero completed days, so its calorie/protein lines correctly have
  // nothing to average and the assertions below would be testing an empty week.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.wk-row')];
    const cur = rows.findIndex((r) => r.classList.contains('is-current'));
    // rows are newest-first, so the week after the current one is the previous week
    const target = rows[cur + 1] || rows[cur];
    target.click();
  });
  await page.waitForSelector('.report-card');

  let cardText = await page.$eval('.report-card', (e) => e.textContent);
  check('A: weight line shows avg + trend rate', /lb avg/.test(cardText) && /trend \+0\.1[678]%\/wk/.test(cardText), cardText.slice(0, 200));
  check('A: in-band badge (0.18 in 0.1–0.25)', /in band/.test(cardText), cardText);
  check('A: calories avg 2,900', /2,900 kcal avg/.test(cardText), cardText);
  check('A: protein line has hit/days', /g avg · \d\/\d days/.test(cardText), cardText);
  check(`A: workouts line shows ${expectedSessions} completed day(s)`,
    new RegExp(`Workouts${expectedSessions}/\\d days`).test(cardText)
    && (expectedSessions < 1 || /Pull 1/.test(cardText)), cardText);
  const suggCountA = (await page.$$('.suggest-card')).length;
  check('A: no rate suggestion when in band', suggCountA === 0 || !(await page.$eval('#view-week', (e) => /kcal\/day\b.*add|trim/.test(e.textContent))), `cards: ${suggCountA}`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'report-inband.png') });

  // ---- overview: tab away and back resets to the zoomed-out graded list ----
  await page.click('.tab[data-tab="day"]');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  check('A: week tab reopens on overview', (await page.$('.report-card')) === null);
  const firstRow = await page.$eval('.wk-row.is-current', (e) => e.textContent);
  check('A: current overview row is This week (in progress)', /This week/.test(firstRow) && /in progress/.test(firstRow), firstRow);
  check('A: overview row carries weight/kcal/protein/lifts cells',
    /\d{3}(\.\d)?weight/.test(firstRow) && /kcal/.test(firstRow) && /protein/.test(firstRow) && /lifts/.test(firstRow), firstRow);
  const gradedDots = await page.$$eval('.wk-row .wk-dot', (els) => els.map((e) => e.className));
  check('A: past weeks carry graded dots', gradedDots.some((c) => /green|yellow|red/.test(c)), gradedDots.join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'weeks-overview.png') });

  // ---- scenario B: bulk stalled two weeks (flat weight) -> add-calories suggestion ----
  const injB = await inject(page, {
    weightFn: () => 185,
    calDaily: 2700,
    proteinDaily: Array.from({ length: 30 }, () => 160),
    proteinTarget: 150,
    goal: { from: localISO(-29), startValue: 183, target: 195, deadline: null },
    workouts: {},
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injB.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  cardText = await page.$eval('#view-week', (e) => e.textContent);
  check('B: flat trend rate ~+0.00%/wk shown', /trend [+-]?0\.00%\/wk/.test(cardText), cardText.slice(0, 200));
  check('B: slow badge (below gain band)', /slow/.test(cardText));
  check('B: two-week lag satisfied -> add 100–150 kcal suggestion', /add 100–150 kcal\/day/.test(cardText), cardText.slice(0, 400));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'report-stalled.png') });

  // ---- scenario C: only 8 days of data -> NO suggestion (confirmation lag gate) ----
  const injC = await inject(page, {
    weightFn: (i) => (i < 8 ? 185 : null),
    calDaily: 2700,
    proteinDaily: Array.from({ length: 30 }, () => 160),
    proteinTarget: 150,
    goal: { from: localISO(-7), startValue: 185, target: 195, deadline: null },
    workouts: {},
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injC.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  cardText = await page.$eval('#view-week', (e) => e.textContent);
  check('C: 8 days of data -> no intake suggestion yet', !/add 100–150 kcal|trim 100–150 kcal/.test(cardText), cardText.slice(0, 300));

  // ---- scenario D: gaining too fast two weeks -> trim suggestion ----
  // +0.12 lb/day -> ~0.84 lb/wk -> ~0.45%/wk (above 0.25 ceiling)
  const injD = await inject(page, {
    weightFn: (i) => 186 - 0.12 * i,
    calDaily: 3400,
    proteinDaily: Array.from({ length: 30 }, () => 160),
    proteinTarget: 150,
    goal: { from: localISO(-29), startValue: 182, target: 195, deadline: null },
    workouts: {},
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injD.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  cardText = await page.$eval('#view-week', (e) => e.textContent);
  // fast gain is deliberately NOT a concern (config FLAGS.warnFastGain=false)
  check('D: above-band gain reads "ahead of band" (not a warning)', /ahead of band/.test(cardText) && !/fat risk/.test(cardText), cardText.slice(0, 200));
  check('D: no trim suggestion while fast gain is not a concern', !/trim 100–150 kcal\/day/.test(cardText), cardText.slice(0, 400));

  // ---- past week (via the overview: back arrow, then the second row) ----
  await page.click('.nav-arrow[aria-label="All weeks"]');
  await page.waitForSelector('.wk-row');
  const rowsAll = await page.$$('.wk-row');
  check('back arrow returns to overview', rowsAll.length >= 2);
  await rowsAll[1].click();
  await page.waitForSelector('.report-card');
  const pastText = await page.$eval('#view-week', (e) => e.textContent);
  check('past week: report shows but no suggestions', /lb avg/.test(pastText) && !/trim 100–150|add 100–150/.test(pastText));
  check('past week eyebrow shows Week N of M', await page.$eval('#view-week .eyebrow', (e) => /Week \d+ of \d+/.test(e.textContent)));

  // ---- cannot navigate into the future ----
  await page.click('.nav-arrow[aria-label="Next week"]'); // -> current week
  const nextDisabled = await page.$eval('.nav-arrow[aria-label="Next week"]', (e) => e.disabled);
  check('next-week arrow disabled on the current week', nextDisabled === true);

  // ---- scenario E: sparse weigh-ins (1/week) -> no rate, no badge, no suggestion ----
  const injE = await inject(page, {
    weightFn: (i) => (i % 7 === 0 ? 185 + (i === 0 ? 1 : 0) : null), // weekly readings, noisy jump today
    calDaily: 2700,
    proteinDaily: Array.from({ length: 30 }, () => 160),
    proteinTarget: 150,
    goal: { from: localISO(-29), startValue: 183, target: 195, deadline: null },
    workouts: {},
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injE.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  cardText = await page.$eval('#view-week', (e) => e.textContent);
  check('E: sparse weigh-ins -> no rate/badge', !/in band|fast|slow|trend [+-]/.test(cardText) && /lb avg/.test(cardText),
    cardText.slice(0, 200));
  check('E: sparse weigh-ins -> no intake suggestion', !/add 100–150 kcal|trim 100–150 kcal/.test(cardText));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
