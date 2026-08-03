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
  await page.click('.wk-row');
  await page.waitForSelector('.week-totals');
  const wkText = await page.$eval('.week-totals', (e) => e.textContent);
  const weightLine = /Weight/.test(wkText);
  check('week totals include weight line', weightLine, wkText);
  check('weight shows latest, not sum', /186 lb/.test(wkText) && !/372|374\.5/.test(wkText), wkText);
  check('weight line shows avg', /avg/.test(wkText));

  // ---- 4. settings: measurement has no target editor; kind switch works ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('.tracker-row');
  const metaText = await page.evaluate(() => [...document.querySelectorAll('.tr-info .meta')].map((m) => m.textContent).join(' | '));
  check('settings meta: Weight is Measurement with goal', /Measurement.*goal 175/.test(metaText), metaText);
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('aria-label') === 'Edit Weight').click());
  await page.waitForSelector('.tr-edit');
  check('no target editor for measurement', (await page.$('select[aria-label="Target period"]')) === null);
  check('kind selector present', (await page.$('select[aria-label="Number kind"]')) !== null);

  // switch Weight -> amount (should confirm + drop goal)
  await page.select('select[aria-label="Number kind"]', 'number');
  await clickByText('.btn.primary', 'Save');
  await new Promise((r) => setTimeout(r, 200));
  let doc2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  let wt2 = doc2.trackers.find((t) => t.name === 'Weight');
  check('switch to amount: confirm shown + goal dropped', dialogs.length === 1 && wt2.type === 'number' && !wt2.goal,
    `dialogs: ${dialogs.length}, type: ${wt2.type}`);

  // switch back to measurement
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].find((b) => b.getAttribute('aria-label') === 'Edit Weight').click());
  await page.waitForSelector('select[aria-label="Number kind"]');
  await page.select('select[aria-label="Number kind"]', 'measurement');
  await clickByText('.btn.primary', 'Save');
  await new Promise((r) => setTimeout(r, 200));
  doc2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')));
  wt2 = doc2.trackers.find((t) => t.name === 'Weight');
  check('switch back to measurement', wt2.type === 'measurement');

  // ---- 5. add-tracker popup offers Measurement with unit field ----
  await clickByText('.ghost-btn', '+ Add tracker');
  await page.waitForSelector('.sheet.add-form');
  const typeOptions = await page.$$eval('.add-form select[aria-label="Tracker type"] option', (els) => els.map((e) => e.textContent));
  check('add form lists Measurement type', typeOptions.some((o) => /Measurement/.test(o)), typeOptions.join(','));
  await page.select('.add-form select[aria-label="Tracker type"]', 'measurement');
  const unitHidden = await page.$eval('.add-form .field:has(input[aria-label="Unit"])', (e) => e.hidden).catch(() => null);
  check('unit field visible for measurement', unitHidden === false, String(unitHidden));
  await page.evaluate(() => document.querySelector('.sheet-backdrop').click());

  // ---- 6. goal picker only lists measurements ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.ghost-btn');
  await clickByText('.ghost-btn', '+ Add goal');
  await page.waitForSelector('select[aria-label="Goal tracker"]');
  const goalOptions = await page.$$eval('select[aria-label="Goal tracker"] option', (els) => els.map((e) => e.textContent));
  check('goal picker lists Weight but not Calories',
    goalOptions.includes('Weight') && !goalOptions.includes('Calories'), goalOptions.join(','));

  // ---- 7. attainment: only Calories (weight has no targets) ----
  const attNames = await page.$$eval('.att-card .gc-name', (els) => els.map((e) => e.textContent));
  check('attainment cards only for target-able trackers', JSON.stringify(attNames) === JSON.stringify(['Calories']), attNames.join(','));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
