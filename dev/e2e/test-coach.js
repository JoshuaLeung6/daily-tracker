// E2E v2.8.0: lifting hierarchy (verdict, badges), ready-to-load, plateau
// prescriptions, rep-range editor, Coach pane, editor ready hints.
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

  // Lift rows live in the Lifts subtab now (grouped by PPL, collapsed).
  // Open that pane and expand every group so .stat-row is reachable.
  const openLifts = async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#view-stats .seg-btn:not(.range-btn)')].find((x) => x.textContent === 'Lifts');
      if (b) b.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    await page.evaluate(() => {
      for (const g of document.querySelectorAll('.lift-group:not(.open)')) g.click();
    });
    await new Promise((r) => setTimeout(r, 250));
  };
  const clickByText = (sel, text) => page.evaluate(({ s, t }) => {
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent.trim() === t);
    if (!eln) throw new Error(`no ${s} "${t}"`);
    eln.click();
  }, { s: sel, t: text });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });

  // Bench: 4 weight-day sessions over 3 weeks, e1RM flat (185x5 each) -> stalled.
  // Row: last weight-day session hit rep ceiling (155x6) -> ready to load.
  // Curl: progressing (up).
  const inj = await page.evaluateOnNewDocument(({ iso }) => {
    const wd = (date, lifts) => [date, { split: 'push', focus: 'weight', lifts }];
    // bench: the 3 most recent sessions must span >=14 days for the stall rule
    const workouts = Object.fromEntries([
      wd(iso[24], [{ name: 'Bench', weight: 180, reps: 5, sets: 3 }, { name: 'Curl', weight: 60, reps: 6, sets: 3 }]),
      wd(iso[20], [{ name: 'Bench', weight: 185, reps: 5, sets: 3 }]),
      wd(iso[16], [{ name: 'Bench', weight: 185, reps: 5, sets: 3 }, { name: 'Row', weight: 155, reps: 5, sets: 3 }]),
      wd(iso[8], [{ name: 'Bench', weight: 185, reps: 5, sets: 3 }, { name: 'Curl', weight: 65, reps: 6, sets: 3 }]),
      // Row at 15 reps = the top of the uniform 8-15 range -> ready to load
      wd(iso[1], [{ name: 'Bench', weight: 185, reps: 5, sets: 3 }, { name: 'Row', weight: 155, reps: 15, sets: 3 }]),
    ]);
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_lift', name: 'Weightlifting', type: 'checkbox', unit: null, order: 0, archived: false },
      ],
      entries: {},
      workouts,
      liftGoals: {},
      profile: {},
    }));
  }, { iso: Array.from({ length: 28 }, (_, i) => localISO(-i)) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj.identifier);
  await page.waitForSelector('.card');

  // ---- 1. lifting pane: verdict + badges ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#view-stats .seg-btn');
  await clickByText('#view-stats .seg-btn:not(.range-btn)', 'Progress');
  await openLifts();
  await page.waitForSelector('.verdict-card');
  const verdict = await page.$eval('.verdict-card', (e) => e.textContent);
  check('verdict counts progressing lifts', /\d of \d lifts progressing/.test(verdict), verdict);
  check('verdict mentions ready + stalled', /1 ready to load/.test(verdict) && /1 stalled/.test(verdict), verdict);

  const benchRow = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stat-row')].find((x) => x.textContent.includes('Bench'));
    return r ? r.textContent : '';
  });
  check('bench row has stalled badge', /stalled/.test(benchRow), benchRow.slice(0, 120));
  const rowRow = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stat-row')].find((x) => x.textContent.includes('Row'));
    return r ? r.textContent : '';
  });
  check('row (15 reps at ceiling) has ready badge', /ready to load/.test(rowRow), rowRow.slice(0, 120));
  check('collapsed rows are slim (no sessions count)', !/sessions/.test(benchRow), benchRow.slice(0, 160));

  // ---- 2. expanded: prescription + detail + rep-range editor ----
  await page.evaluate(() => [...document.querySelectorAll('.stat-row')].find((r) => r.textContent.includes('Bench')).click());
  await page.waitForSelector('.sr-history');
  const expText = await page.$eval('.sr-history', (e) => e.textContent);
  check('stalled prescription with ordered fixes', /Stalled: no e1RM PR/.test(expText) && /deload/.test(expText), expText.slice(0, 240));
  check('detail line moved into expansion', /session/.test(expText) && /last 185/.test(expText));

  // rep range is fixed at 8–15 for every lift and NOT editable from the UI
  check('rep range shown read-only as 8–15', /8–15/.test(expText), expText.slice(0, 240));
  check('no rep-range inputs in the UI', (await page.$('input[aria-label$="rep range low"]')) === null);

  // ---- 3. Coach pane ----
  await clickByText('#view-stats .seg-btn:not(.range-btn)', 'Coach');
  await page.waitForSelector('.ref-card');
  const coachText = await page.$eval('#view-stats', (e) => e.textContent);
  check('coach: ready-to-load card lists Row', /Ready to add weight: Row \(try 160\)/.test(coachText), coachText.slice(0, 400));
  check('coach: bench stall card', /Bench has stalled/.test(coachText));
  check('coach: reference cards present', /Rep ranges/.test(coachText) && /Weekly volume/.test(coachText) && /reps in reserve|Effort/.test(coachText));
  const diagrams = await page.$$eval('#view-stats svg.diagram', (els) => els.length);
  check('coach: 3+ diagrams render', diagrams >= 3, `diagrams: ${diagrams}`);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'coach-pane.png') });

  // ---- 4. editor preview shows ready hint ----
  await page.click('.tab[data-tab="day"]');
  await page.waitForSelector('.ghost-btn');
  await page.click('.ghost-btn'); // + Log workout
  await page.waitForSelector('.workout-overlay');
  // classification: suggested split rotates from push (last) -> pull; switch to Push for history
  await clickByText('.workout-overlay .seg-btn', 'Push');
  await page.waitForSelector('.chip-suggest');
  await clickByText('.chip-suggest', '+ Row');
  await page.waitForSelector('.lift-preview');
  const preview = await page.$eval('.lift-preview', (e) => e.textContent);
  check('editor preview: ready hint with next load', /ready: try 160/.test(preview), preview);
  await clickByText('.wo-head .btn.primary', 'Done');

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
