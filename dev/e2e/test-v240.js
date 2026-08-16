// E2E: intake<->weight insight, pace projection, days-since tiles,
// PR stars, analysis export.
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

  // weight falls exactly 0.5/wk over 28d; calories 2400 daily; bench PRs
  const inj = await page.evaluateOnNewDocument(({ isoOf, today }) => {
    const entries = {};
    for (let i = 27; i >= 0; i--) {
      const iso = isoOf[i];
      entries[iso] = { t_cal: 2400 };
      if (i % 3 === 0) entries[iso].t_wt = 189.5 + (0.5 / 7) * i;
    }
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false },
        { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 1, archived: false,
          goal: { from: isoOf[27], startValue: 191.5, target: 180, deadline: null } },
      ],
      entries,
      workouts: {
        [isoOf[9]]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 175, reps: 8, sets: 3 }] },
        [isoOf[5]]: { split: 'pull', focus: 'weight', lifts: [{ name: 'Row', weight: 155, reps: 8, sets: 3 }] },
        [isoOf[2]]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 180, reps: 8, sets: 3 }] },
        [today]: { split: 'push', focus: 'weight', lifts: [{ name: 'Bench press', weight: 185, reps: 8, sets: 3 }] },
      },
      liftGoals: {},
      profile: {},
    }));
  }, { isoOf: Array.from({ length: 28 }, (_, i) => localISO(-i)), today: localISO(0) });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj.identifier);
  await page.waitForSelector('.card');

  const daySummary = await page.$eval('.workout-card', (e) => e.textContent);
  check('day summary shows ★ PR (bench e1RM record today)', /★ PR/.test(daySummary), daySummary);

  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('.card.dash-insight');
  const insight = await page.$eval('.card.dash-insight', (e) => e.textContent);
  // this fixture logs only 10 weigh-ins in 28 days; the gate needs 12, so
  // maintenance must REFUSE to estimate and say exactly what is missing
  check('maintenance locked below the weigh-in gate', /Not enough data yet/.test(insight), insight.slice(0, 200));
  check('locked reason names the shortfall', /10\/12 weigh-ins/.test(insight), insight.slice(0, 200));
  const heroPace = await page.$eval('.hero-pace', (e) => e.textContent);
  check('weight hero shows required vs trending pace', /need [+-][\d.]+/.test(heroPace), heroPace);

  await clickByText('#view-stats .seg-btn:not(.range-btn)', 'Progress');
  await openLifts();
  await page.waitForSelector('.stat-tile');
  const tiles = await page.$$eval('.stat-tile', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  check('push tile shows today', tiles.some((t) => /push.*today/i.test(t)), tiles.join(' | '));
  check('pull tile shows 5d ago', tiles.some((t) => /pull.*5d ago/i.test(t)), tiles.join(' | '));
  const legsDash = await page.evaluate(() =>
    [...document.querySelectorAll('.stat-tile')].some((e) => /legs/i.test(e.textContent) && e.querySelector('.st-sub') && e.querySelector('.st-sub').textContent === '—'));
  check('legs tile shows — (never trained)', legsDash);

  await openLifts();
  const benchName = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stat-row')].find((x) => x.textContent.includes('Bench press'));
    return r ? r.querySelector('.sr-name').textContent : '';
  });
  check('bench row has ★ (latest session was PR)', /★/.test(benchName), benchName);
  await page.evaluate(() => {
    const r = [...document.querySelectorAll('.stat-row')].find((x) => x.textContent.includes('Bench press'));
    if (r) r.click();
  });
  await page.waitForSelector('.sr-history');
  const starRows = await page.$$eval('.sr-hrow .pr-star', (els) => els.length);
  check('history: 2 PR stars (first session is not a PR)', starRows === 2, `stars: ${starRows}`);

  const payload = await page.evaluate(async () => {
    const mod = await import('./js/backup.js');
    return mod.buildAnalysisPayload();
  });
  check('analysis: app tag + profile + note', payload.app === 'pcal-analysis' && 'profile' in payload && /Epley/.test(payload.note));
  const todayKey = localISO(0);
  check('analysis: days keyed by tracker NAME', payload.days[todayKey] && 'Calories' in payload.days[todayKey],
    JSON.stringify(payload.days[todayKey]));
  check('analysis: intake avg28d = 2400', payload.stats.intake && Math.round(payload.stats.intake.avg28d.avg) === 2400);
  const wtStat = payload.stats.measurements.find((m) => m.name === 'Weight');
  check('analysis: weight rate ≈ -0.5/wk', wtStat && Math.abs(wtStat.ratePerWeek28d + 0.5) < 0.05, JSON.stringify(wtStat));
  const benchStat = payload.stats.lifts.find((l) => l.name === 'Bench press');
  check('analysis: bench stats present with trend', benchStat && benchStat.sessions === 3 && benchStat.trend === 'up',
    JSON.stringify(benchStat));
  check('analysis: weeklyVolume 12 weeks', payload.stats.weeklyVolume.length === 12);

  await page.click('.tab[data-tab="settings"]');
  const hasBtn = await page.evaluate(() => [...document.querySelectorAll('.btn')].some((b) => b.textContent === 'Export for analysis'));
  check('settings: Export for analysis button', hasBtn);

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
