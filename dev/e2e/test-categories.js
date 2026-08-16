// E2E for v2.2.0: measurement vs amount categorization.
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
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const clickByText = (sel, text) => page.evaluate(({ s, t }) => {
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent.trim() === t);
    if (!eln) throw new Error(`no ${s} "${t}"`);
    eln.click();
  }, { s: sel, t: text });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });

  // ---- 1. migration: v4 doc with number Weight (goal + bogus daily target) ----
  const inj = await page.evaluateOnNewDocument((isos) => {
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 4,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false,
          targets: [{ from: isos.d10, value: 3000, period: 'day', dir: 'atmost' }] },
        { id: 't_wt', name: 'Weight', type: 'number', unit: 'lb', order: 1, archived: false,
          targets: [{ from: isos.d10, value: 175, period: 'day', dir: 'atmost' }],
          goal: { from: isos.d10, startValue: 190, target: 175, deadline: null } },
      ],
      entries: {
        [isos.d3]: { t_wt: 188, t_cal: 2500 },
        [isos.d1]: { t_wt: 186.5 },
        [isos.d0]: { t_cal: 2400 },
      },
      workouts: {},
      liftGoals: {},
    }));
  }, { d10: localISO(-10), d3: localISO(-3), d1: localISO(-1), d0: localISO(0) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj.identifier);
  await page.waitForSelector('.card');

  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  const wt = doc.trackers.find((t) => t.name === 'Weight');
  check('migration: Weight becomes measurement', wt.type === 'measurement', wt.type);
  check('migration: bogus daily target on Weight removed', !wt.targets || wt.targets.length === 0);
  check('migration: goal preserved', wt.goal && wt.goal.target === 175);
  check('migration: schemaVersion 5', doc.schemaVersion === 5);

  // ---- 2. day view: Weight card shows last reading, no target bar ----
  const dayText = await page.$eval('#view-day', (e) => e.textContent);
  check('weight card shows last reading (186.5, yesterday)', /last 186\.5 lb/.test(dayText), dayText.slice(0, 200));
  const wtBars = await page.$$eval('.card', (els) =>
    els.filter((c) => c.textContent.includes('Weight')).map((c) => c.querySelector('.bar') !== null));
  check('weight card has no target bar', wtBars.length === 1 && wtBars[0] === false);
  check('calories card still has target bar', (await page.$('.card .bar')) !== null);

  // ---- 3. week totals: weight shows latest + avg, never a sum ----
  await page.type('.card input[aria-label="Weight"]', '186');
  await new Promise((r) => setTimeout(r, 400));
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  const wkText = await page.$eval('.report-card', (e) => e.textContent);
  check('week card includes weight line', /Weight/.test(wkText), wkText);
  check('weight shows an average, never a sum', /lb avg/.test(wkText) && !/372|374\.5/.test(wkText), wkText);

  // ---- 4. settings: read-only summary shows kind + goal ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  const metaText = await page.evaluate(() => [...document.querySelectorAll('.tr-info .meta')].map((m) => m.textContent).join(' | '));
  check('settings meta: Weight is Measurement with goal', /Measurement.*goal 175/.test(metaText), metaText);
  check('settings is read-only (no edit buttons)', (await page.$('.icon-btn[aria-label^="Edit"]')) === null);

  // ---- 5. code config: switching kind via applyConfig; goal via config ----
  await page.evaluate(async () => {
    const t = await import('./js/trackers.js');
    const ins = await import('./js/insights.js');
    t.applyConfig([
      { name: 'Calories', type: 'number', unit: 'kcal' },
      { name: 'Weight', type: 'measurement', unit: 'lb', goal: { startValue: 190, target: 175, pace: 'standard' } },
    ], (phase, pace) => ins.PACE_PRESETS[phase][pace]);
  });
  let doc2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  let wt2 = doc2.trackers.find((t) => t.name === 'Weight');
  check('config goal applied with loss band', wt2.goal && wt2.goal.target === 175 && wt2.goal.band && wt2.goal.band.lo === -1.0,
    JSON.stringify(wt2.goal));

  // ---- 6. goals pane: no add-goal UI, goal card present ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.hero-card');
  check('goals pane has no + Add goal button',
    !(await page.evaluate(() => [...document.querySelectorAll('.ghost-btn')].some((b) => /Add goal/.test(b.textContent)))));
  // the hero states pace, not the target: 175 is the tracker goal, so the
  // required weekly rate is derived from it
  check('weight hero shows the required pace', await page.$eval('#view-stats', (e) => /need [+-][\d.]+/.test(e.textContent)));

  // ---- 7. attainment: only Calories (weight has no targets) ----
  const attNames = await page.$$eval('.att-card .gc-name', (els) => els.map((e) => e.textContent));
  check('attainment cards only for target-able trackers', JSON.stringify(attNames) === JSON.stringify(['Calories']), attNames.join(','));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
