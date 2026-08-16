// E2E v2.3.0: within-focus trend isolation, weight trendline chart, profile.
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

  // bench: weight day 185x6x3 (d-10), VOLUME day 150x10x3 (d-7), weight day 185x8x3 (d-4)
  // weight measurements for the chart: 190 (d-9), 187 (d-5), 185.5 (d-1); goal 175
  const inj = await page.evaluateOnNewDocument((iso) => {
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 0, archived: false,
          goal: { from: iso.d9, startValue: 190, target: 175, deadline: null } },
      ],
      entries: {
        [iso.d9]: { t_wt: 190 },
        [iso.d5]: { t_wt: 187 },
        [iso.d1]: { t_wt: 185.5 },
      },
      workouts: {
        [iso.d10]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 185, reps: 6, sets: 3 }] },
        [iso.d7]: { split: 'push', focus: 'volume', lifts: [{ name: 'Bench press', weight: 150, reps: 10, sets: 3 }] },
        [iso.d4]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 185, reps: 8, sets: 3 }] },
      },
      liftGoals: {},
      profile: {},
    }));
  }, { d10: localISO(-10), d9: localISO(-9), d7: localISO(-7), d5: localISO(-5), d4: localISO(-4), d1: localISO(-1) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj.identifier);
  await page.waitForSelector('.card');

  // ---- 1. trend ignores the volume day: weight-day e1RM 222 -> 234.3 = up ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#view-stats .seg-btn');
  await clickByText('#view-stats .seg-btn', 'Progress');
  await page.waitForSelector('.stat-row');
  const statsText = await page.$eval('#view-stats', (e) => e.textContent);
  check('latest weight day trends on e1RM 234.3', /e1RM 234\.3/.test(statsText), statsText.slice(0, 240));
  const trendClass = await page.evaluate(() => {
    const t = document.querySelector('.stat-row .trend');
    return t ? t.className : null;
  });
  check('same-weight-more-reps = UP arrow', /up/.test(trendClass || ''), String(trendClass));

  // ---- 2. same reps/weight on a volume day trends volume separately ----
  // add today's volume day 155x10x3 (4650 vs previous volume day 4500 = up)
  const inj2 = await page.evaluateOnNewDocument((today) => {
    const doc = JSON.parse(localStorage.getItem('pcal:data'));
    doc.workouts[today] = { split: 'push', focus: 'volume', lifts: [{ name: 'Bench press', weight: 155, reps: 10, sets: 3 }] };
    localStorage.setItem('pcal:data', JSON.stringify(doc));
  }, localISO(0));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj2.identifier);
  await page.waitForSelector('.card');
  await page.click('.tab[data-tab="stats"]');
  await clickByText('#view-stats .seg-btn', 'Progress');
  await page.waitForSelector('.stat-row');
  const statsText2 = await page.$eval('#view-stats', (e) => e.textContent);
  check('latest volume day trends on vol 4,650', /vol 4,650/.test(statsText2), statsText2.slice(0, 240));
  const trendClass2 = await page.evaluate(() => {
    const t = document.querySelector('.stat-row .trend');
    return t ? t.className : null;
  });
  check('volume day compared to previous volume day = UP', /up/.test(trendClass2 || ''), String(trendClass2));

  // ---- 3. weight trendline chart with goal reference line ----
  await clickByText('#view-stats .seg-btn', 'Progress');
  await page.waitForSelector('.chart-card svg.chart');
  const chartInfo = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.chart-card')].find((c) => /Weight/.test(c.textContent));
    const svg = card && card.querySelector('svg.chart');
    return svg ? {
      dots: svg.querySelectorAll('.ch-dot').length,
      goalLine: svg.querySelector('.ch-goal') !== null,
      goalLabel: svg.textContent.includes('goal 175'),
      lastLabel: /185\.5/.test(svg.textContent),
    } : null;
  });
  check('weight chart: 3 dots', chartInfo && chartInfo.dots === 3, JSON.stringify(chartInfo));
  check('weight chart: dashed goal line + label', chartInfo && chartInfo.goalLine && chartInfo.goalLabel);
  check('weight chart: latest value direct-labeled', chartInfo && chartInfo.lastLabel);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'weight-chart.png') });

  // ---- 4. profile persists and rides in the doc ----
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('input[aria-label="Birth year"]');
  await page.type('input[aria-label="Birth year"]', '1998');
  await page.type('input[aria-label="Height"]', '178 cm');
  await page.select('select[aria-label="Sex"]', 'male');
  await page.select('select[aria-label="Preferred units"]', 'lb');
  await new Promise((r) => setTimeout(r, 500));
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')).profile);
  check('profile saved', profile.birthYear === 1998 && profile.height === '178 cm' && profile.sex === 'male' && profile.units === 'lb',
    JSON.stringify(profile));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('input[aria-label="Birth year"]');
  const byVal = await page.$eval('input[aria-label="Birth year"]', (e) => e.value);
  check('profile survives reload', byVal === '1998', byVal);

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
