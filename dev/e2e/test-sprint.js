// E2E v2.10.0: five-line week card, sprint timeline overview, sprint pane,
// day notes, progress photos.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

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
  page.on('dialog', (d) => d.accept());
  const clickByText = (sel, text) => page.evaluate(({ s, t }) => {
    const eln = [...document.querySelectorAll(s)].find((c) => c.textContent.trim() === t);
    if (!eln) throw new Error(`no ${s} "${t}"`);
    eln.click();
  }, { s: sel, t: text });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle0' });

  // 21 days of data: weight 185→186 (rising), calories 2900 w/ target ≥2800 (hit all),
  // protein 160 w/ target ≥150 hit 5 of 7 (skip i%7==0,1), cardio on i%2==0,
  // workouts on 4 days this week + earlier
  const monOff = -((new Date().getDay() + 6) % 7);
  const inj = await page.evaluateOnNewDocument(({ isoOf, monOff }) => {
    const entries = {};
    for (let i = 0; i < 21; i++) {
      const iso = isoOf[i];
      entries[iso] = { t_cal: 2900, t_wt: 186 - (1 / 21) * i };
      if (i % 7 >= 2) entries[iso].t_pro = 160; else entries[iso].t_pro = 120;
      if (i % 2 === 0) entries[iso].t_cardio = ['run'];
    }
    const workouts = {};
    // this week: Mon.. up to 4 sessions that have happened
    let added = 0;
    for (let i = 0; added < 4 && i < 7; i++) {
      const off = monOff + i;
      if (off > 0) break;
      const iso = isoOf[-off];
      workouts[iso] = { split: ['push', 'pull', 'legs'][i % 3], focus: 'weight', lifts: [{ name: 'Bench', weight: 180 + i * 5, reps: 5, sets: 3 }] };
      added++;
    }
    workouts[isoOf[20]] = { split: 'push', focus: 'weight', lifts: [{ name: 'Bench', weight: 170, reps: 5, sets: 3 }] };
    localStorage.setItem('pcal:data', JSON.stringify({
      schemaVersion: 5,
      trackers: [
        { id: 't_cal', name: 'Calories', type: 'number', unit: 'kcal', order: 0, archived: false,
          targets: [{ from: isoOf[20], value: 2800, period: 'day', dir: 'atleast' }] },
        { id: 't_pro', name: 'Protein', type: 'number', unit: 'g', order: 1, archived: false,
          targets: [{ from: isoOf[20], value: 150, period: 'day', dir: 'atleast' }] },
        { id: 't_cardio', name: 'Cardio', type: 'multiselect', options: ['walk', 'run'], order: 2, archived: false },
        { id: 't_lift', name: 'Weightlifting', type: 'checkbox', unit: null, order: 3, archived: false },
        { id: 't_wt', name: 'Weight', type: 'measurement', unit: 'lb', order: 4, archived: false,
          goal: { from: isoOf[20], startValue: 185, target: 195, deadline: null } },
      ],
      entries, workouts, liftGoals: {}, profile: {}, foods: [], notes: {},
    }));
  }, { isoOf: Array.from({ length: 21 }, (_, i) => localISO(-i)), monOff });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.removeScriptToEvaluateOnNewDocument(inj.identifier);
  await page.waitForSelector('.card');
  // completed days only: today is excluded from denominators
  const daysSoFar = -monOff;
  if (daysSoFar === 0) {
    console.log('PASS  (Monday: no completed days this week — week-card denominators skipped)');
  }

  // ---- 1. five-line week card ----
  await page.click('.tab[data-tab="week"]');
  await page.waitForSelector('.wk-row');
  const overviewText = await page.$eval('#view-week', (e) => e.textContent);
  check('overview titled by sprint', /Sprint 1/.test(overviewText));
  check('no future placeholder rows', (await page.$$('.wk-row.is-future')).length === 0);
  const progressText = await page.$eval('.wk-progress-label', (e) => e.textContent);
  check('masthead shows Week N of M', /^Week \d+ of \d+$/.test(progressText), progressText);
  const firstRowText = await page.$eval('.wk-row', (e) => e.textContent);
  check('newest week (This week) is at the top', /This week/.test(firstRowText), firstRowText.slice(0, 60));
  const cellLabels = await page.$$eval('.wk-row.is-current .wk-cell-l', (els) => els.map((e) => e.textContent));
  check('overview cells: weight, kcal, protein, lifts (no cardio)',
    JSON.stringify(cellLabels) === JSON.stringify(['weight', 'kcal', 'protein', 'lifts']), cellLabels.join(','));
  await page.click('.wk-row.is-current');
  await page.waitForSelector('.report-card');
  const labels = await page.$$eval('.report-card .rp-label', (els) => els.map((e) => e.textContent));
  check('five lines: Weight, Calories, Protein, Cardio, Workouts',
    JSON.stringify(labels) === JSON.stringify(['Weight', 'Calories', 'Protein', 'Cardio', 'Workouts']), labels.join(','));
  const rows = await page.$$eval('.report-card .rp-row', (els) => els.map((e) => e.textContent));
  check('weight line: avg · % vs last wk (no weigh-in count)', /avg · [+-]\d\.\d\d% vs last wk/.test(rows[0]) && !/weigh-in/.test(rows[0]), rows[0]);
  if (daysSoFar > 0) {
    check(`calories line: avg · ${daysSoFar}/${daysSoFar} days`, new RegExp(`2,900 kcal avg · ${daysSoFar}/${daysSoFar} days`).test(rows[1]) && !/aim/.test(rows[1]), rows[1]);
    check('protein line: avg · hit/days', /g avg · \d\/\d days/.test(rows[2]), rows[2]);
    check(`cardio line: N/${daysSoFar} (walk-only excluded)`, new RegExp(`\\d/${daysSoFar} days`).test(rows[3]), rows[3]);
    check(`workouts line: N/${daysSoFar} + splits`, new RegExp(`\\d/${daysSoFar} days`).test(rows[4]) && /Push|Pull|Legs/.test(rows[4]), rows[4]);
  }
  await page.screenshot({ path: path.join(__dirname, 'shots', 'week-five-lines.png') });

  // ---- 2. sprint pane ----
  await page.click('.tab[data-tab="stats"]');
  await page.waitForSelector('#view-stats .seg-btn');
  await clickByText('#view-stats .seg-btn:not(.range-btn)', 'Progress');
  await page.waitForSelector('.hero-card');
  const spText = await page.$eval('#view-stats', (e) => e.textContent);
  check('dashboard header: sprint name, dates, week N of M',
    /Sprint 1/.test(spText) && /→ Oct 31/.test(spText) && /Week \d+ of \d+/.test(spText), spText.slice(0, 200));
  check('heroes: weight + strength', /Weight/.test(spText) && /Strength/.test(spText) && /lifts up/.test(spText));
  check('sprint consistency block', /Sprint consistency/.test(spText) && /protein/.test(spText));
  // the lift ledger lives in the Lifts subtab now, not on Progress
  const hasLiftRows = await page.evaluate(() => document.querySelectorAll('#view-stats .stat-row').length);
  check('lift ledger is NOT on the Progress pane (it moved to Lifts)', hasLiftRows === 0, `rows: ${hasLiftRows}`);
  // the injected doc carries its own tracker goal (195), which wins over the
  // sprint default — the hero shows a target and a required pace either way
  check('weight hero: trend + required pace', /trending/.test(spText) && /need [+-][\d.]+/.test(spText),
    spText.slice(0, 320));
  check('sprint totals: workouts + PRs + logged', /Workouts/.test(spText) && /PRs/.test(spText) && /Logged/.test(spText));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'sprint-pane.png') });

  // ---- 3. day note (ensure we're on today — the week drill-in moved the date) ----
  await page.click('.tab[data-tab="day"]');
  await page.waitForSelector('#view-day');
  const pill = await page.$('.today-pill');
  if (pill) { await pill.click(); }
  await page.waitForSelector('.journal-actions');
  await clickByText('.journal-btn', '+ Note');
  await page.waitForSelector('textarea[aria-label="Day note"]');
  await page.type('textarea[aria-label="Day note"]', 'Slept badly, still hit bench.');
  await new Promise((r) => setTimeout(r, 500));
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')).notes);
  check('note saved under today', notes[localISO(0)] === 'Slept badly, still hit bench.', JSON.stringify(notes));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('textarea[aria-label="Day note"]');
  const noteBack = await page.$eval('textarea[aria-label="Day note"]', (e) => e.value);
  check('note reopens expanded after reload', noteBack === 'Slept badly, still hit bench.', noteBack);
  check('+ Note button gone once a note exists', !(await page.evaluate(() => [...document.querySelectorAll('.journal-btn')].some((b) => b.textContent === '+ Note'))));
  // clear it and blur -> reverts to no note + button returns
  await page.evaluate(() => {
    const ta = document.querySelector('textarea[aria-label="Day note"]');
    ta.focus();
    ta.value = '';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
  });
  await new Promise((r) => setTimeout(r, 300));
  const notesAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')).notes);
  check('emptied note reverts to no note', !notesAfter[localISO(0)] && (await page.$('textarea[aria-label="Day note"]')) === null
    && await page.evaluate(() => [...document.querySelectorAll('.journal-btn')].some((b) => b.textContent === '+ Note')),
    JSON.stringify(notesAfter));

  // backdated config target: protein 120 from data start replaces the injected one
  const proTargets = await page.evaluate(() => JSON.parse(localStorage.getItem('pcal:data')).trackers.find((t) => t.name === 'Protein').targets);
  check('protein target backdated to 120 from 2026-07-11', proTargets && proTargets.length === 1
    && proTargets[0].value === 120 && proTargets[0].from === '2026-07-11', JSON.stringify(proTargets));

  // ---- 4. photo upload (real PNG through the file input) ----
  const pngPath = path.join(__dirname, 'shots', 'lock-locked.png');
  if (fs.existsSync(pngPath)) {
    const input = await page.$('.journal-section input[type="file"]');
    await input.uploadFile(pngPath);
    await page.waitForSelector('.photo-tile', { timeout: 15000 });
    const tiles = await page.$$eval('.photo-tile', (els) => els.length);
    check('photo stored + thumbnail shown', tiles === 1, `tiles: ${tiles}`);
    const size = await page.evaluate(async () => {
      const m = await import('./js/photos.js');
      const all = await m.allPhotos();
      return all[0].blob.size;
    });
    check('photo downscaled to a small JPEG', size > 1000 && size < 400000, `bytes: ${size}`);
    // lightbox + delete
    await page.waitForSelector('.photo-tile');
    await page.click('.photo-tile');
    await page.waitForSelector('.lightbox');
    await page.click('.lightbox .btn.danger');
    await new Promise((r) => setTimeout(r, 400));
    check('lightbox delete removes photo', (await page.$$('.photo-tile')).length === 0);
  } else {
    check('photo test skipped (no fixture png)', true);
  }

  // ---- 5. locked past day: no note/photo buttons ----
  await page.click('.nav-arrow[aria-label="Previous day"]');
  await page.waitForSelector('.lock-pill');
  check('locked day: no journal buttons', (await page.$$('.journal-btn')).length === 0);

  check('no console/page errors', errors.length === 0, errors.join(' | ').slice(0, 400));

  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
