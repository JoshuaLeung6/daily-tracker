// Week view — seven ledger rows plus totals, weekly goals, and streaks.

import { el, checkIcon } from '../ui.js';
import { todayISO, addDays, startOfWeek, weekLabel, fmt } from '../dates.js';
import { getEntry } from '../store.js';
import { activeTrackers, targetFor, weekStreakFor, weekMeets, dayAllMet, dayMeets } from '../trackers.js';
import { getWorkout, SPLIT_LABELS, SPLITS, liftStats } from '../workouts.js';
import { weekReport, weekSuggestions, weeksOverview, weekLineStatus, verdictBadge, isCardioDay } from '../insights.js';
import { currentSprint, strengthTotalInWeek, mainLiftNames } from '../sprints.js';
import { CALORIE_BANDS } from '../config.js';
// one commit rule and one page transition for both views, so "armed" always
// matches what happens and every swipe moves the same way
import { willCommit, willCommitPull, slidePage, settleSlide, EDGE_ZONE } from './day.js';

// The tab opens zoomed out: every week graded green/yellow/red; tapping a
// week drills into its report card. Switching away and back resets to the
// overview.
let mode = 'overview';

// Live swipe-gesture state, shared between the per-render on* handlers and
// the once-bound non-passive touchmove listener. `live` is false on the
// overview, which has no gestures.
const g = { hint: null, canNext: false, live: false, gx: null, gy: null, startScroll: 0, axis: null };

export function enter() {
  mode = 'overview';
}

// Open the week containing a date directly (day view pull-down).
export function openWeekDetail() {
  mode = 'detail';
}

export function render(container, ctx) {
  if (mode === 'overview') renderOverview(container, ctx);
  else renderDetail(container, ctx);
}

function renderOverview(container, ctx) {
  const sprint = currentSprint();
  const weeks = weeksOverview(sprint ? { start: sprint.start, end: sprint.end } : null);
  const cur = weeks.find((w) => w.isCurrent);

  // sprint progress in the masthead: "Week 6 of 17" + a slim bar
  let progress = null;
  if (sprint && cur && cur.totalWeeks) {
    const fill = el('i', { class: 'goal-fill' });
    fill.style.width = Math.round((cur.index / cur.totalWeeks) * 100) + '%';
    progress = el('div', { class: 'wk-progress' },
      el('span', { class: 'wk-progress-label' }, `Week ${cur.index} of ${cur.totalWeeks}`),
      el('span', { class: 'wt-bar gc-bar wk-progress-bar' }, fill),
    );
  }

  const head = el('header', { class: 'view-head' },
    el('span'),
    el('div', { class: 'masthead' },
      el('div', { class: 'eyebrow' }, sprint ? sprint.name : 'Week by week'),
      el('h1', {}, 'Weeks'),
      progress,
    ),
    el('span'),
  );

  const list = el('div', { class: 'week-rows' });
  if (weeks.length === 0) {
    list.append(el('div', { class: 'empty-state' }, 'Nothing logged yet — weeks appear here as you log.'));
  }
  let currentRow = null;
  const liftNames = mainLiftNames();
  for (const wk of weeks) {
    const edgeNum = wk.index ? el('span', { class: 'wk-num' }, String(wk.index)) : null;
    const r = wk.report;
    const st = weekLineStatus(r);
    const daysSoFar = r.daysDone;
    const cell = (label, value, status) => el('span', { class: 'wk-cell' + (status ? ' st-' + status : '') },
      el('span', { class: 'wk-cell-v' }, value),
      el('span', { class: 'wk-cell-l' }, label),
    );
    const w = r.weight;
    // strength score for THIS week: within-week best e1RM per main lift,
    // summed (same number as the Progress strength chart's dot for the week)
    const strength = strengthTotalInWeek(wk.ws, liftNames);
    // colour vs the previous week that HAS a score: green if it went up, red
    // if it went down. Skip weeks with no score rather than treating a gap as
    // a drop. Equal is neutral.
    let strengthStatus = null;
    if (strength) {
      let prev = null;
      for (let ws = addDays(wk.ws, -7); ws >= (sprint ? sprint.start : ws) && !prev; ws = addDays(ws, -7)) {
        prev = strengthTotalInWeek(ws, liftNames);
        if (ws === (sprint ? sprint.start : ws)) break;
      }
      if (prev) strengthStatus = strength.total > prev.total + 0.5 ? 'good' : strength.total < prev.total - 0.5 ? 'bad' : 'neutral';
    }
    const cells = el('span', { class: 'wk-cells' },
      cell('weight', w && w.weekAvg != null ? fmtN(w.weekAvg) : '—', st.weight),
      cell('kcal', r.intake && r.intake.avg != null ? Math.round(r.intake.avg).toLocaleString() : '—', st.calories),
      // protein is judged daily, so show days hit (calories shows the avg it is judged on)
      cell('protein', r.protein && r.protein.of > 0 ? `${r.protein.hit}/${r.protein.of}`
        : (r.protein && r.protein.avg != null ? Math.round(r.protein.avg) : '—'), st.protein),
      cell('lifts', r.training ? `${r.training.days}/${daysSoFar}` : '—', st.workouts),
      cell('strength', strength ? Math.round(strength.total).toLocaleString() : '—', strengthStatus),
    );

    const row = el('button', {
      class: 'wk-row wk-row-ledger' + (wk.isCurrent ? ' is-current' : ''),
      onclick: () => { mode = 'detail'; ctx.setDate(wk.ws); },
    },
      edgeNum,
      el('span', { class: 'wk-main' },
        el('span', { class: 'wk-title' },
          el('span', {
            class: 'wk-dot ' + (wk.isCurrent ? 'current' : (wk.grade || 'none')),
            'aria-label': wk.isCurrent ? 'in progress' : (wk.grade || 'no data'),
          }),
          el('b', {}, wk.isCurrent ? 'This week' : weekLabel(wk.ws)),
          wk.isCurrent ? el('span', { class: 'rp-dim wk-inprog' }, 'in progress') : null,
        ),
        cells,
      ),
    );
    if (wk.isCurrent) currentRow = row;
    list.append(row);
  }

  container.replaceChildren(head, el('div', { class: 'ledger-rule' }), list);
  // no dismiss gesture on the overview (g.live also gates the once-bound
  // non-passive touchmove listener, which cannot be un-assigned)
  g.live = false;
  container.ontouchstart = null;
  container.ontouchend = null;
  container.ontouchcancel = null;
  container.classList.remove('gesture-live', 'gesture-lock');
  // the hint is shared on <body>, so hide it explicitly when leaving detail
  const sharedHint = document.getElementById('swipe-hint');
  if (sharedHint) sharedHint.className = 'swipe-hint';
  container.style.transform = '';
  // returning from a scrolled detail view must land at the top
  container.scrollTop = 0;
  requestAnimationFrame(() => { container.scrollTop = 0; });
}

function renderDetail(container, ctx) {
  // entering a week (or switching weeks) starts at the top
  container.scrollTop = 0;
  const today = todayISO();
  const start = startOfWeek(ctx.date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const trackers = activeTrackers();
  const inWeek = days.includes(today);

  // header: back-to-all-weeks on the left, next week on the right; the
  // masthead's eyebrow doubles as the week number in the sprint
  const sprint = currentSprint();
  const weeksList = weeksOverview(sprint ? { start: sprint.start, end: sprint.end } : null);
  const thisWk = weeksList.find((w) => w.ws === start);
  const head = el('header', { class: 'view-head' },
    el('button', {
      class: 'nav-arrow', 'aria-label': 'All weeks',
      onclick: () => { mode = 'overview'; render(container, ctx); },
    }, '‹'),
    // the current week is marked with a live dot + accent eyebrow, so it is
    // obvious at a glance whether you are looking at now or at history
    el('div', { class: 'masthead' + (inWeek ? ' is-now' : '') },
      el('div', { class: 'eyebrow' + (inWeek ? ' eyebrow-now' : '') },
        inWeek ? el('i', { class: 'now-dot' }) : null,
        inWeek ? 'This week' : (thisWk && thisWk.totalWeeks ? `Week ${thisWk.index} of ${thisWk.totalWeeks}` : fmt(start, { year: 'numeric' }))),
      el('h1', {}, weekLabel(ctx.date)),
    ),
    el('button', {
      class: 'nav-arrow', 'aria-label': 'Next week',
      // never navigate into weeks that have not started
      disabled: addDays(start, 7) > startOfWeek(today),
      onclick: () => ctx.setDate(addDays(ctx.date, 7)),
    }, '›'),
  );

  // Day rows are a fixed-column mini-ledger so every day aligns regardless of
  // what was logged: weight · kcal · protein · cardio · lift split.
  const wtT = trackers.find((t) => t.type === 'measurement' && /weight/i.test(t.name));
  const calT = trackers.find((t) => t.type === 'number' && /calorie/i.test(t.name));
  const proT = trackers.find((t) => t.type === 'number' && /protein/i.test(t.name));
  const cardioT = trackers.find((t) => /cardio/i.test(t.name));
  const stepsT = trackers.find((t) => t.type === 'checkbox' && /step/i.test(t.name));
  const cellV = (v) => (v == null || v === '' ? '—' : v);

  const rows = el('div', { class: 'week-rows' });
  const colHead = el('div', { class: 'wr-cols wr-colhead' },
    el('span', {}, ''), el('span', {}, 'lb'), el('span', {}, 'kcal'), el('span', {}, 'protein'),
    el('span', {}, 'cardio'), el('span', {}, 'lift'));
  rows.append(colHead);
  for (const iso of days) {
    const entry = getEntry(iso);
    const wo = getWorkout(iso);
    const isFuture = iso > today;
    const cardioV = cardioT ? entry[cardioT.id] : null;
    const cardioTxt = Array.isArray(cardioV) ? cardioV.join('/') : (cardioV ? String(cardioV) : null);
    const stepsDone = stepsT && entry[stepsT.id] === true;
    const wt = wtT ? entry[wtT.id] : null;
    const cal = calT ? entry[calT.id] : null;
    const pro = proT ? entry[proT.id] : null;

    // per-day R/Y/G: kcal by the calorie bands, protein vs its daily target,
    // cardio green when real cardio logged, lift green when a workout exists.
    // Weight is a reading, not a judgment — left neutral. Today is still in
    // progress, so it is not judged either.
    const judged = !isFuture && iso !== today;
    const calCls = !judged || typeof cal !== 'number' ? ''
      : cal >= CALORIE_BANDS.good ? ' st-good' : cal >= CALORIE_BANDS.ok ? ' st-neutral' : ' st-bad';
    const proCls = !judged || typeof pro !== 'number' ? ''
      : (proT && dayMeets(proT, iso)) ? ' st-good' : ' st-bad';
    const cardioCls = judged && isCardioDay(cardioV) ? ' st-good' : '';
    const liftCls = judged && wo ? ' st-good' : '';

    rows.append(el('button', {
      class: 'week-row wr-ledger' + (iso === today ? ' is-today' : '') + (isFuture ? ' is-future' : ''),
      disabled: isFuture,
      onclick: () => ctx.openDay(iso),
    },
      el('span', { class: 'wr-cols' },
        el('span', { class: 'wr-date' },
          el('span', { class: 'wd' }, fmt(iso, { weekday: 'short' })),
          el('span', { class: 'dn' + (dayAllMet(iso) ? ' all-met' : '') }, String(Number(iso.slice(8)))),
        ),
        el('span', { class: 'wr-c' }, cellV(typeof wt === 'number' ? fmtN(wt) : null)),
        el('span', { class: 'wr-c' + calCls }, cellV(typeof cal === 'number' ? Math.round(cal).toLocaleString() : null)),
        el('span', { class: 'wr-c' + proCls }, cellV(typeof pro === 'number' ? Math.round(pro) : null)),
        el('span', { class: 'wr-c wr-small' + cardioCls }, cellV(cardioTxt)),
        el('span', { class: 'wr-c wr-small' + (wo ? ' wr-workout' : '') + liftCls },
          wo ? SPLIT_LABELS[wo.split] : (stepsDone ? '' : '—')),
      ),
    ));
  }

  const { card, tips } = buildReportCard(ctx);
  container.replaceChildren(
    head, el('div', { class: 'ledger-rule' }),
    ...(card ? [card] : []),
    el('div', { class: 'wk-section-label' }, 'Days'),
    rows,
    ...(tips.length ? [el('div', { class: 'wk-section-label' }, 'Coach'), ...tips] : []),
  );

  // Gestures with live feedback (assignment keeps one handler per render):
  //  - pull down while already at the top -> back to the overview
  //  - horizontal swipe -> previous / next week (never past the current week)
  // The content follows the finger and a hint pill appears once the gesture
  // has passed its threshold, so the outcome is visible before releasing.
  const HINT_W = 30; // .swipe-hint width (26) + its 2px edge offset, both sides
  // The hint lives on <body>, NOT inside the view: a transformed ancestor
  // makes position:fixed resolve against that ancestor, so a hint inside the
  // view would slide along with the content and always overlap it.
  const hint = document.getElementById('swipe-hint')
    || el('div', { class: 'swipe-hint', id: 'swipe-hint' });
  if (hint.parentElement !== document.body) document.body.append(hint);
  // refresh the shared gesture state for this render (see `g` at module scope)
  g.hint = hint;
  g.canNext = addDays(start, 7) <= startOfWeek(today);
  g.live = true;
  g.gx = g.gy = null;
  g.axis = null;

  const resetGesture = () => {
    container.classList.remove('gesture-live', 'gesture-armed');
    container.style.transform = '';
    // reset the WHOLE class list. touchmove writes className wholesale
    // ('swipe-hint top show roomy armed'), and .armed sets opacity:1
    // explicitly — so removing only 'show' left an armed chevron visible.
    // That was the chevron that "sometimes doesn't disappear".
    g.hint.className = 'swipe-hint';
    g.gx = g.gy = null;
    g.axis = null;
  };

  container.ontouchstart = (e) => {
    settleSlide();   // a touch mid-transition takes over from a resting page
    g.gx = e.touches[0].clientX;
    g.gy = e.touches[0].clientY;
    g.startScroll = container.scrollTop;
    g.axis = null;
    // velocity tracking so a fast flick commits like a native pager
    g.lastX = g.gx; g.lastY = g.gy; g.lastT = e.timeStamp; g.vx = 0; g.vy = 0;
  };
  // non-passive so a committed side swipe can preventDefault() and stop the
  // page scrolling vertically at the same time. Bound once per container;
  // g.live gates it off while the overview (which has no gestures) is showing.
  if (!container.dataset.gestureBound) {
    container.dataset.gestureBound = '1';
    container.addEventListener('touchmove', (e) => {
      if (!g.live || g.gy === null) return;
      const dx = e.touches[0].clientX - g.gx;
      const dy = e.touches[0].clientY - g.gy;
      const dt = e.timeStamp - g.lastT;
      if (dt > 0) {
        g.vx = g.vx * 0.7 + ((e.touches[0].clientX - g.lastX) / dt) * 0.3;
        g.vy = g.vy * 0.7 + ((e.touches[0].clientY - g.lastY) / dt) * 0.3;
        g.lastX = e.touches[0].clientX; g.lastY = e.touches[0].clientY; g.lastT = e.timeStamp;
      }
      if (!g.axis && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
        // strict vertical claim: only a clearly-downward drag from the top is
        // the pull-down; anything else is a scroll (see day.js for why —
        // eager 'y' capture was the "stuck" / "can't swipe up" bug)
        const fromEdge = g.gx <= EDGE_ZONE || g.gx >= window.innerWidth - EDGE_ZONE;
        if (fromEdge && Math.abs(dx) > Math.abs(dy) * 1.4) g.axis = 'x';
        else if (g.startScroll <= 0 && dy > 0 && dy > Math.abs(dx) * 1.4) g.axis = 'y';
        else g.axis = 'scroll';
        if (g.axis !== 'scroll') container.classList.add('gesture-live');
      }
      // Once committed to a SIDE swipe, own the gesture: preventDefault stops
      // the page scrolling vertically underneath the horizontal drag, which
      // otherwise reads as the content sliding two ways at once. Only for
      // 'x' — a pull-down or a plain scroll must never be blocked.
      // Own the gesture once an axis is claimed:
      //  - 'x': stops the page scrolling vertically under a side swipe
      //  - 'y': stops iOS's OWN top rubber-band running at the same time as
      //    our damped pull-down. With the pane now genuinely scrollable, a
      //    downward drag at scrollTop 0 is also a native overscroll bounce
      //    (1:1) — two motions at once, which is why the pull-down felt
      //    fast some of the time and right the rest. One motion only.
      if ((g.axis === 'x' || g.axis === 'y') && e.cancelable) e.preventDefault();
      if (g.axis === 'x') {
        const blocked = dx < 0 && !g.canNext;
        // 1:1 with the finger; a blocked direction rubber-bands instead
        // 0.6x the finger, not 1:1: with the commit distance at 160px a 1:1
        // page felt like it was flying. Still direct enough to read as the
        // page under your thumb; the blocked direction rubber-bands harder.
        const shift = blocked
          ? Math.sign(dx) * Math.pow(Math.abs(dx), 0.6) * 1.2
          : dx * 0.6;
        container.style.transform = `translateX(${shift}px)`;
        const armed = !blocked && willCommit(dx, g.vx);
        g.hint.textContent = dx < 0 ? '›' : '‹';
        // centre the glyph in the strip the view vacated
        g.hint.style.setProperty('--hint-gap', Math.abs(shift) + 'px');
        g.hint.className = 'swipe-hint ' + (dx < 0 ? 'right' : 'left') + ' show'
          + (Math.abs(shift) >= HINT_W ? ' roomy' : '')
          + (armed ? ' armed' : '') + (blocked ? ' blocked' : '');
        container.classList.toggle('gesture-armed', armed);
      } else if (g.axis === 'y') {
        // pull-down has RESISTANCE, like pull-to-refresh: the page moves at
        // roughly half the finger and eases off further out, so it reads as
        // stretching toward the zoom-out rather than flinging the whole page.
        // (1:1 tracking is right for a side swipe, wrong here — it felt fast.)
        // Never moves the page UP.
        const pull = Math.max(0, dy);
        // heavier than before: ~0.45x the finger from the very first pixel and
        // easing further out, so it never feels like the page is running away
        const shift = pull <= 0 ? 0 : pull * 0.45 * (1 / (1 + pull / 400));
        container.style.transform = `translateY(${shift}px)`;
        const armed = dy > 0 && willCommitPull(dy, g.vy);
        g.hint.textContent = '⌄';
        g.hint.style.setProperty('--hint-gap', shift + 'px');
        // gate on FINGER travel, not page shift: the pull-down is heavily
        // damped, so keying "roomy" off the page kept the chevron faint for
        // most of the gesture. 40px of finger is a deliberate pull.
        g.hint.className = 'swipe-hint top show'
          + (dy >= 40 ? ' roomy' : '') + (armed ? ' armed' : '');
        container.classList.toggle('gesture-armed', armed);
      }
    }, { passive: false });
  }
  container.ontouchend = (e) => {
    if (g.gy === null) return;
    const dx = e.changedTouches[0].clientX - g.gx;
    const dy = e.changedTouches[0].clientY - g.gy;
    const usedAxis = g.axis;
    const vx = g.vx; const vy = g.vy;
    if (usedAxis === 'x' && willCommit(dx, vx)) {
      const forward = dx < 0;
      if (forward && !g.canNext) { resetGesture(); return; }
      // continue the motion in the swipe direction rather than springing
      // back; the content swaps while the page is off-screen (slidePage)
      // reset the WHOLE class list. touchmove writes className wholesale
    // ('swipe-hint top show roomy armed'), and .armed sets opacity:1
    // explicitly — so removing only 'show' left an armed chevron visible.
    // That was the chevron that "sometimes doesn't disappear".
    g.hint.className = 'swipe-hint';
      container.classList.remove('gesture-armed');
      const target = addDays(ctx.date, forward ? 7 : -7);
      g.gx = g.gy = null; g.axis = null;
      slidePage(container, forward ? -1 : 1, () => ctx.setDate(target));
      return;
    }
    resetGesture();
    if (usedAxis === 'y' && g.startScroll <= 0 && container.scrollTop <= 0 && dy > 0 && willCommitPull(dy, vy)) {
      mode = 'overview';
      render(container, ctx);
    }
  };
  container.ontouchcancel = resetGesture;
}

// The report card: the week's verdict — rate vs band, intake, training —
// plus any triggered if-then suggestions. This is the weekly review surface.
function buildReportCard(ctx) {
  const r = weekReport(ctx.date);
  const card = el('div', { class: 'card report-card' });
  let any = false;

  // completed days in the week (7 for past weeks; today excluded for the current)
  const daysSoFar = r.daysDone;
  const outOf = (n) => el('span', { class: 'rp-dim' }, ` · ${n}/${daysSoFar} days`);
  const st = weekLineStatus(r);
  const rpRowC = (label, valueEl, status) => {
    const row = rpRow(label, valueEl);
    if (status) row.classList.add('st-' + status);
    return row;
  };

  // 1. weight: avg · % vs previous week · weigh-in count (+ band badge)
  if (r.weight) {
    const w = r.weight;
    const unit = w.tracker.unit ? ` ${w.tracker.unit}` : '';
    if (w.weekAvg != null) {
      const badge = verdictBadge(w.band, w.verdict);
      card.append(rpRowC(w.tracker.name,
        el('span', {},
          el('b', {}, `${fmtN(w.weekAvg)}${unit}`), ' avg',
          w.pctVsPrev != null
            ? ` · ${w.pctVsPrev > 0 ? '+' : ''}${w.pctVsPrev.toFixed(2)}% vs last wk `
            : el('span', { class: 'rp-dim' }, ' · no prior week '),
          badge,
          // trend rate drives the band verdict; keep it visible when known
          w.rate ? el('span', { class: 'rp-dim' }, ` · trend ${w.rate.pct > 0 ? '+' : ''}${w.rate.pct.toFixed(2)}%/wk`) : null,
        ), st.weight));
    } else {
      card.append(rpRow(w.tracker.name, el('span', { class: 'rp-dim' }, 'no weigh-ins this week')));
    }
    any = true;
  }

  // 2. calories: weekly avg against the grading bands · target days as context
  if (r.intake) {
    card.append(rpRowC('Calories',
      el('span', {},
        r.intake.avg != null ? el('b', {}, Math.round(r.intake.avg).toLocaleString()) : el('span', { class: 'rp-dim' }, '—'),
        r.intake.avg != null ? ` ${r.intake.unit} avg` : '',
        r.intake.of > 0 ? outOf(r.intake.hit) : null,
      ), st.calories));
    any = true;
  }

  // 3. protein: avg · target days
  if (r.protein) {
    card.append(rpRowC('Protein',
      el('span', {},
        r.protein.avg != null ? el('b', {}, fmtN(r.protein.avg)) : el('span', { class: 'rp-dim' }, '—'),
        r.protein.avg != null ? ` ${r.protein.unit} avg` : '',
        r.protein.of > 0 ? outOf(r.protein.hit) : el('span', { class: 'rp-dim' }, ' · no target set'),
      ), st.protein));
    any = true;
  }

  // 4. cardio: days done
  if (r.cardio) {
    card.append(rpRowC('Cardio', el('span', {}, el('b', {}, `${r.cardio.days}/${daysSoFar}`), ' days'), st.cardio));
    any = true;
  }

  // 5. workouts: days trained (+ split breakdown when there is one)
  if (r.training) {
    const t = r.training;
    const splitBits = SPLITS.filter((s) => t.bySplit[s])
      .map((s) => `${SPLIT_LABELS[s]} ${t.bySplit[s]}`).join(' · ');
    card.append(rpRowC('Workouts',
      el('span', {},
        el('b', {}, `${t.days}/${daysSoFar}`), ' days',
        splitBits ? el('span', { class: 'rp-dim' }, ` · ${splitBits}`) : null,
      ), st.workouts));
    any = true;
  }

  // 6. strength: this week's score, with the three lifts behind it — the
  // same within-week best-e1RM-per-lift sum the Progress chart plots.
  // Coloured vs the previous scored week, like the overview row.
  {
    const ws = startOfWeek(ctx.date);
    const names = mainLiftNames();
    const cur = strengthTotalInWeek(ws, names);
    if (cur) {
      let prev = null;
      const sp = currentSprint();
      for (let p = addDays(ws, -7); p >= (sp ? sp.start : p); p = addDays(p, -7)) {
        prev = strengthTotalInWeek(p, names);
        if (prev || p === (sp ? sp.start : p)) break;
      }
      const status = !prev ? null : cur.total > prev.total + 0.5 ? 'good' : cur.total < prev.total - 0.5 ? 'bad' : 'neutral';
      // per-lift bests within this week, in the order they were configured
      const wkEnd = addDays(ws, 6);
      const parts = names.map((n) => {
        const s = liftStats().find((x) => x.name.toLowerCase() === n.toLowerCase());
        const inWk = s ? s.history.filter((h) => h.date >= ws && h.date <= wkEnd && h.e1rm != null) : [];
        const best = inWk.length ? Math.max(...inWk.map((h) => h.e1rm)) : null;
        return `${shortLift(n)} ${best != null ? Math.round(best) : '—'}`;
      });
      card.append(rpRowC('Strength',
        el('span', {},
          el('b', {}, Math.round(cur.total).toLocaleString()),
          prev ? el('span', { class: 'rp-dim' }, ` · ${cur.total - prev.total >= 0 ? '+' : ''}${Math.round(cur.total - prev.total)} vs last wk`) : null,
          el('span', { class: 'rp-dim rp-sub' }, parts.join(' + ')),
        ), status));
      any = true;
    }
  }

  const tips = weekSuggestions(r).map((s) => el('div', { class: 'card suggest-card' },
    el('div', { class: 'sg-text' }, s.text),
    el('div', { class: 'sg-why' }, s.why),
  ));
  return { card: any ? card : null, tips };
}

// Short form of a main-lift name for the tight strength calc line.
function shortLift(n) {
  return n.replace(/flat dumbbell press/i, 'DB press')
    .replace(/machine leg press/i, 'Leg press')
    .replace(/lat pulldown/i, 'Pulldown');
}

function rpRow(label, valueEl) {
  return el('div', { class: 'rp-row' },
    el('span', { class: 'rp-label' }, label),
    el('span', { class: 'rp-value' }, valueEl),
  );
}

function buildSummary(trackers, days) {
  const endOfWeek = days[6];
  const items = [];

  for (const t of trackers) {
    const tgt = targetFor(t, endOfWeek);

    if (t.type === 'number') {
      const logged = days.map((iso) => getEntry(iso)[t.id]).filter((v) => typeof v === 'number');
      if (logged.length === 0 && !tgt) continue;
      const sum = logged.reduce((a, b) => a + b, 0);
      const avg = logged.length ? sum / logged.length : 0;
      const item = { name: t.name, main: fmtN(sum) + (t.unit ? ` ${t.unit}` : ''), sub: logged.length ? `avg ${fmtN(avg)}/day` : 'nothing logged' };
      if (tgt) {
        const goal = tgt.period === 'week' ? tgt.value : tgt.value * 7;
        const atMost = tgt.dir === 'atmost';
        item.goalText = `${atMost ? '≤' : '≥'} ${fmtN(tgt.value)}${t.unit ? ' ' + t.unit : ''}${tgt.period === 'day' ? '/day' : '/week'}`;
        item.ratio = goal > 0 ? sum / goal : 0;
        item.over = atMost && item.ratio > 1;
        if (tgt.period === 'week') {
          item.wkMet = weekMeets(t, days[0]);
          const streak = weekStreakFor(t, endOfWeek);
          if (streak >= 2) item.streak = `${streak}-week streak`;
        }
      }
      items.push(item);
    } else if (t.type === 'measurement') {
      // no totals for measurements — show latest and average instead
      const logged = days
        .map((iso) => ({ iso, v: getEntry(iso)[t.id] }))
        .filter((x) => typeof x.v === 'number');
      if (logged.length === 0) continue;
      const latest = logged[logged.length - 1].v;
      const avg = logged.reduce((a, b) => a + b.v, 0) / logged.length;
      items.push({
        name: t.name,
        main: `${fmtN(latest)}${t.unit ? ' ' + t.unit : ''}`,
        sub: logged.length > 1 ? `avg ${fmtN(avg)}` : 'latest',
      });
    } else if (t.type !== 'text' && tgt && tgt.period === 'week') {
      const count = days.filter((iso) => t.id in getEntry(iso)).length;
      const item = {
        name: t.name,
        main: `${count} / ${tgt.value} days`,
        ratio: tgt.value > 0 ? count / tgt.value : 0,
        goalText: `${tgt.value} days/week`,
        wkMet: count >= tgt.value,
      };
      const streak = weekStreakFor(t, endOfWeek);
      if (streak >= 2) item.streak = `${streak}-week streak`;
      items.push(item);
    }
  }

  if (items.length === 0) return null;

  const box = el('div', { class: 'week-totals' }, el('h2', {}, 'Week totals'));
  for (const item of items) {
    box.append(el('div', { class: 'wt-row' },
      el('span', {}, item.name, item.goalText ? el('span', { class: 'wt-goal' }, `  ·  ${item.goalText}`) : null),
      el('span', {}, el('b', item.wkMet ? { class: 'wk-met' } : {}, item.main), item.sub ? el('span', { class: 'avg' }, item.sub) : null),
    ));
    if (item.ratio !== undefined) {
      const fill = el('i', { class: (item.over ? 'over' : '') + (item.wkMet ? ' wk-met' : '') });
      fill.style.width = Math.min(100, item.ratio * 100) + '%';
      box.append(el('div', { class: 'wt-bar' }, fill));
    }
    if (item.streak) {
      box.append(el('div', { class: 'wt-goal' }, item.streak));
    }
  }
  return box;
}

function fmtN(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
