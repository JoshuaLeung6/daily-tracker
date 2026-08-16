// E2E v2.7.0: adaptive TDEE, suggested intake, one-tap calorie target,
// pace bands, e1RM high-rep filter.
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

  // 28 days: calories 2900 every day, weight rising exactly 1/3 lb/wk, gain goal
  // -> TDEE = 2900 - (0.3333*3500)/7 = 2900 - 166.7 ≈ 2733
  const inject = (opts) => page.evaluateOnNewDocument(({ isoOf, calSkip, wSkip, band, bench }) => {
    const entries = {};
    for (let i = 0; i < 28; i++) {
      const iso = isoOf[i];
      entries[iso] = {};
      if (!calSkip || i % calSkip !== 0) entries[iso].t_cal = 2900;
      if (!wSkip || i % wSkip === 0) entries[iso].t_wt = 185 - (1 / 3 / 7) * i;
    }
    const goal = { from: isoOf[27], startValue: 183.5, target: 195, deadline: null };
    if (band) goal.band = band;
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
        { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 1, archived: false, goal },
      ],
      entries,
      workouts: bench ? { [isoOf[0]]: { split: 'push', focus: 'volume', lifts: [bench] } } : {},
      liftGoals: {}, profile: {},
    }));
  }, opts);

  // ---- 1. unlocked TDEE + suggestion + one-tap target ----
  const injA = await inject({ isoOf: Array.from({ length: 28 }, (_, i) => localISO(-i)), calSkip: 0, wSkip: 0, band: null, bench: null });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injA.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.gc-tdee');
  const tdeeText = await page.$eval('.gc-tdee', (e) => e.textContent);
  check('TDEE ≈ 2,733 measured', /maintenance ≈ 2,73\d kcal/.test(tdeeText), tdeeText);
  check('suggested bulk range ≈ 2,930–3,030', /2,9[123]0–3,0[123]0 kcal\/day/.test(tdeeText), tdeeText);
  const btnText = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.gc-setbtn')][0];
    return b ? b.textContent : null;
  });
  check('set-target button offered', btnText && /Set 2,9[89]0 .*calorie target/.test(btnText), String(btnText));
  await page.click('.gc-setbtn');
  await new Promise((r) => setTimeout(r, 300));
  const calTarget = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    const cal = doc.trackers.find((t) => t.name === 'Calories');
    return cal.targets && cal.targets[cal.targets.length - 1];
  });
  check('one tap sets effective-dated at-least target', calTarget && calTarget.period === 'day'
    && calTarget.dir === 'atleast' && calTarget.from === localISO(0) && Math.abs(calTarget.value - 2980) <= 10,
    JSON.stringify(calTarget));
  const btnGone = await page.evaluate(() => document.querySelectorAll('.gc-setbtn').length === 0);
  check('button disappears once target matches', btnGone);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'tdee-card.png') });

  // ---- 2. locked TDEE with sparse intake logging ----
  const injB = await inject({ isoOf: Array.from({ length: 28 }, (_, i) => localISO(-i)), calSkip: 2, wSkip: 0, band: null, bench: null });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injB.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.gc-tdee');
  const lockedText = await page.$eval('.gc-tdee', (e) => e.textContent);
  check('sparse logging locks TDEE with reason', /needs ~4 weeks of logs/.test(lockedText), lockedText);
  check('no set-target button when locked', (await page.$('.gc-setbtn')) === null);

  // ---- 3. aggressive pace band changes the weekly verdict ----
  // +0.18%/wk rate is IN standard band but BELOW aggressive (0.25-0.5)
  const injC = await inject({
    isoOf: Array.from({ length: 28 }, (_, i) => localISO(-i)),
    calSkip: 0, wSkip: 0, band: { lo: 0.25, hi: 0.5 }, bench: null,
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injC.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  const wkText = await page.$eval('.report-card', (e) => e.textContent);
  check('custom aggressive band -> +0.18%/wk reads slow', /slow/.test(wkText) && !/in band/.test(wkText), wkText.slice(0, 140));

  // pace select prefills from stored band
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.goal-card');
  await page.evaluate(() => [...document.querySelectorAll('.icon-btn')].find((b) => /Edit .* goal/.test(b.getAttribute('aria-label') || '')).click());
  await page.waitForSelector('select[aria-label="Pace"]');
  const paceVal = await page.$eval('select[aria-label="Pace"]', (e) => e.value);
  check('pace select prefills aggressive from stored band', paceVal === 'aggressive', paceVal);

  // ---- 4. e1RM filtered for >10-rep sets ----
  const injD = await inject({
    isoOf: Array.from({ length: 28 }, (_, i) => localISO(-i)),
    calSkip: 0, wSkip: 0, band: null,
    bench: { name: 'Bench press', weight: 135, reps: 12, sets: 3 },
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(injD.identifier);
  await page.waitForSelector('.card');
  const benchStats = await page.evaluate(async () => {
    const mod = await import('./js/workouts.js');
    const s = mod.liftStats().find((x) => x.name === 'Bench press');
    return { e1rm: s.history[0].e1rm, vol: s.history[0].vol, bestE1rm: s.bestE1rm };
  });
  check('12-rep set: e1RM null, volume kept', benchStats.e1rm === null && benchStats.vol === 4860 && benchStats.bestE1rm === null,
    JSON.stringify(benchStats));

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
