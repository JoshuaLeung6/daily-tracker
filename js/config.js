// ================================================================
//  PERSONAL CONFIG — edit here (with Claude), not in the app.
// ================================================================
//
// Applied at startup and reconciled into stored data NON-DESTRUCTIVELY:
// - trackers are matched by name; new ones are created, existing ones
//   have type/unit/options/order updated, logged values are never touched
// - stored trackers not listed here are archived (hidden), not deleted
// - a target/goal is only (re)written when it differs from what is in
//   force today, so past effective-dated targets keep their history
// - `null` target/goal = leave whatever is stored alone
// - `clearGoalIfTarget: N` = delete the stored goal ONLY if its target is N
//   (targeted cleanup for a goal that has since moved to the sprint)
//
// Target shape:  { period: 'day'|'week', value, dir?: 'atleast'|'atmost', from?: 'YYYY-MM-DD' }
//   `from` backdates the target: it becomes the ONLY target from that date on
//   (older effective-dated entries before it are kept; ones on/after are replaced).
//   Without `from`, a changed target is stamped today and history is preserved.
// Goal shape:    { startValue, target, deadline?: 'YYYY-MM-DD', pace?: 'conservative'|'standard'|'aggressive' }

// Main lifts whose best e1RMs are summed into the sprint's strength total.
// Names must match how they are logged (case-insensitive). Empty = the app
// picks the 3 most-logged lifts automatically.
// Named as they are LOGGED. Matching is exact-first, then word-containment,
// case-insensitive — but the more exactly these match the logged names, the
// less the fuzzy rule has to guess. "Leg press" alone did not match a lift
// logged as "Machine leg press" under the old prefix rule, and the score
// quietly fell back to the 3 most-logged lifts.
export const MAIN_LIFTS = ['Flat dumbbell press', 'Lat pulldown', 'Machine leg press'];

// Weekly-average calorie grading (kcal/day): >= good is green, >= ok is
// yellow, below that is red. Tune as the bulk progresses.
export const CALORIE_BANDS = { good: 3000, ok: 2800 };

// Behavior flags — personal judgment calls, revisit as the phase changes.
export const FLAGS = {
  // He's lightweight and bulking: gaining faster than the band is NOT a
  // concern right now, so don't paint it red or suggest trimming calories.
  // Flip to true later in the bulk (or on a cut) to re-enable.
  warnFastGain: false,
};

// Backdated values, applied at startup ONLY where the day has no value for
// that tracker yet — never overwrites anything logged in the app. Applied
// only to the real dataset (one whose history reaches SEED_ANCHOR), so a
// fresh/imported doc is untouched.
// { trackerName: { 'YYYY-MM-DD': value, ... } }
export const SEED_ANCHOR = '2026-07-11';
export const SEED_VALUES = {
  '10k steps': Object.fromEntries([
    '2026-08-14', '2026-08-13', '2026-08-12', '2026-08-09', '2026-08-08',
    '2026-08-05', '2026-08-04', '2026-08-03', '2026-08-01',
    '2026-07-31', '2026-07-29', '2026-07-21', '2026-07-19', '2026-07-12',
    '2026-07-11', '2026-07-08',
  ].map((d) => [d, true])),
};

// One-time cleanups of stored values, keyed by tracker name: options listed
// here are stripped from that tracker's history (walk is now the 10k-steps
// habit, not cardio). Idempotent — safe to leave in place.
export const STRIP_OPTIONS = {
  Cardio: ['walk'],
};

// Cardio picks that count as a "cardio day". Walking is tracked separately
// as the "10k steps" habit (NEAT floor), not as conditioning.
export const CARDIO_COUNTS = ['run', 'squash', 'bike', 'kayak', 'tennis', 'swim', 'climb'];

// Day-view grouping: group is one of movement | intake | recovery; the
// Day tab renders collapsible sections in that order. No group (Weight) =
// ungrouped at the top — the goal instrument leads the day.
// The Manual (footer tab): the standing plan for each zone, written HERE
// (with Claude) like every other plan in this app. The free-text notes on
// each Manual page live in the data document, not here.
export const MANUAL = {
  movement: {
    text: 'Lift on the push/pull/legs rotation, everything at 8–15 reps — weight days push load, volume days push sets. Take the last set of each lift to 0–2 reps in reserve, and when every set hits the top of the range two sessions running, add load and reset to ~10.',
    rows: [
      ['Lifting', '5–6 sessions/week'],
      ['Main lifts', 'DB press · Lat pulldown · Leg press'],
      ['Cardio', '1×/week minimum, any sport'],
      ['Mobility', '2×/week, 10+ minutes'],
      ['When stuck', 'eating? sleep? → add a set → change range → deload'],
    ],
  },
  intake: {
    text: 'The bulk is won at the table. Calories every single day — weekends are the historical failure mode, and the sprint goal needs the surplus to be boringly consistent. Protein is the one number to log tightly; it has no self-correcting signal.',
    rows: [
      ['Calories', '≥ 3,000 kcal/day, every day'],
      ['Protein', '≥ 120 g/day, logged carefully'],
      ['Alcohol · caffeine · cannabis', 'log by exception — night caffeine is the sleep killer'],
      ['Weekends', 'anchor breakfast; do not let Saturday erase the week'],
    ],
  },
  recovery: {
    text: 'Muscle is built between sessions. Sleep is the strongest lever in the log; a poor night means cap the top set, not skip the session.',
    rows: [
      ['Sleep', 'aim 7h+ — good / okay / poor, logged with the morning weigh-in'],
      ['Mental health', '0–5 slider, honest, no target on purpose'],
      ['Deload', 'one easy week every 4–8 weeks, or after two declining sessions'],
    ],
  },
  maintenance: {
    text: 'Scheduled upkeep — the appointments that silently lapse for years because nothing tracks them. The reminder calendar lands here once the last-visit dates are in.',
    rows: [
      ['Dentist', 'every 6 months'],
      ['Physical', 'yearly'],
      ['Skin check', 'yearly'],
      ['Physio', 'as needed — via Repair'],
    ],
  },
  repair: {
    text: 'Whatever is broken right now and needs a professional. Empty is the goal state. When something hurts beyond normal soreness: write it down here, book the appointment, train around it. While this page is not empty, it comes first.',
    rows: [],
  },
};

// NOTE: every target/goal below is `null` = "keep whatever is already stored
// on the phone" (the values Joshua set in-app before this switch). Change a
// null to a concrete target here to make it the source of truth from then on.
export const TRACKERS = [
  { name: 'Calories', type: 'number', unit: 'kcal', group: 'intake',
    target: null },   // the in-app target (≥3,000 since Aug 8) stays; grading below
  { name: 'Protein', type: 'number', unit: 'g', group: 'intake',
    // 120 g/day (~2 g/kg at ~135 lb), backdated to the start of the data so
    // every past week is graded against it (was 110 in-app)
    target: { period: 'day', value: 120, dir: 'atleast', from: '2026-07-11' } },
  // EXCEPTION-LOGGED intake pair: an untouched card = none today, zero
  // taps. Alcohol is a dose category, not a drink count; caffeine tracks
  // WHEN (the sleep-relevant fact), not how much. No targets — these are
  // correlation instruments (alcohol/late caffeine vs sleep vs session
  // quality), not graded habits.
  { name: 'Alcohol', type: 'select', options: ['low', 'moderate', 'high'], group: 'intake',
    target: null },
  { name: 'Caffeine', type: 'multiselect', options: ['morning', 'afternoon', 'night'], group: 'intake',
    target: null },
  { name: 'Cannabis', type: 'checkbox', group: 'intake',
    // exception-logged like alcohol: unchecked = none, zero taps. No
    // target — a correlation instrument (sleep, mental health, training).
    target: null },
  { name: 'Cardio', type: 'multiselect', options: ['run', 'squash', 'bike', 'kayak', 'tennis', 'swim', 'climb'], group: 'movement',
    // real cardio only, once a week minimum — backdated to the sprint start
    target: { period: 'week', value: 1, from: '2026-07-11' } },
  // ('10k steps' was removed 2026-10-25: unlisting archives it — history
  // kept, hidden everywhere. SEED_VALUES above stays as a historical record.)
  { name: 'Mobility', type: 'checkbox', group: 'movement',
    // ≥10 min of mobility/stretch/posture work counts; gentle 2×/week so it
    // grades without nagging. Target stamps the day it was added.
    target: { period: 'week', value: 2 } },
  { name: 'Mental health', type: 'number', unit: '/5', group: 'recovery',
    // subjective 0–5, halves welcome (type 3.5). range clamps typos so a
    // stray "35" can't poison averages. No target on purpose: a graded mood
    // is a guilt machine — this is a correlation instrument (sleep, alcohol,
    // training load vs how you actually feel).
    // renders as a SLIDER (number + range + step): 0.5 notches, no keyboard
    range: [0, 5],
    step: 0.5,
    target: null },
  { name: 'Sleep', type: 'select', options: ['poor', 'okay', 'good'], group: 'recovery',
    // CONVENTION: a day's pick = the night you WOKE UP FROM that morning.
    // Log it with the morning weigh-in. Rough guide: good = 7h+ and rested,
    // okay = adequate, poor = short or broken (the day to cap the top set).
    // (Replaced the 'Sleep 7h+' checkbox 2026-10-25 — that tracker is
    // archived; old checked days still count as hits in the consistency
    // ring, which grades okay/good as hit and poor as the flag.)
    // Daily target = "log it every day", which also dates the ring.
    target: { period: 'day', value: 1 } },
  { name: 'Weightlifting', type: 'checkbox', group: 'movement',
    // 6 sessions/week (PPL x2) — backdated to the sprint start
    target: { period: 'week', value: 6, from: '2026-07-11' } },
  { name: 'Weight', type: 'measurement', unit: 'lb',
    // The weight target lives on the SPRINT (js/sprints.js -> goals.weight).
    // This clears only the specific stale tracker goal left over from the
    // in-app days (target 150) so it cannot compete with the sprint's 145;
    // it deliberately does NOT wipe every goal, which would also delete one
    // deliberately set for another purpose. (`null` = keep whatever is stored.)
    clearGoalIfTarget: 150,
    goal: null },
];
