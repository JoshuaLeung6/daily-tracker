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
//
// Target shape:  { period: 'day'|'week', value, dir?: 'atleast'|'atmost', from?: 'YYYY-MM-DD' }
//   `from` backdates the target: it becomes the ONLY target from that date on
//   (older effective-dated entries before it are kept; ones on/after are replaced).
//   Without `from`, a changed target is stamped today and history is preserved.
// Goal shape:    { startValue, target, deadline?: 'YYYY-MM-DD', pace?: 'conservative'|'standard'|'aggressive' }

// Main lifts whose best e1RMs are summed into the sprint's strength total.
// Names must match how they are logged (case-insensitive). Empty = the app
// picks the 3 most-logged lifts automatically.
export const MAIN_LIFTS = ['Flat dumbbell press', 'Lat pulldown', 'Leg press'];

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
export const CARDIO_COUNTS = ['run', 'squash', 'bike'];

// NOTE: every target/goal below is `null` = "keep whatever is already stored
// on the phone" (the values Joshua set in-app before this switch). Change a
// null to a concrete target here to make it the source of truth from then on.
export const TRACKERS = [
  { name: 'Calories', type: 'number', unit: 'kcal',
    target: null },   // the in-app target (≥3,000 since Aug 8) stays; grading below
  { name: 'Protein', type: 'number', unit: 'g',
    // 120 g/day (~2 g/kg at ~135 lb), backdated to the start of the data so
    // every past week is graded against it (was 110 in-app)
    target: { period: 'day', value: 120, dir: 'atleast', from: '2026-07-11' } },
  { name: 'Cardio', type: 'multiselect', options: ['run', 'squash', 'bike'],
    // real cardio only, once a week minimum — backdated to the sprint start
    target: { period: 'week', value: 1, from: '2026-07-11' } },
  { name: '10k steps', type: 'checkbox',
    target: { period: 'day', value: 1 } },   // daily habit; walking = NEAT floor
  { name: 'Weightlifting', type: 'checkbox',
    // 6 sessions/week (PPL x2) — backdated to the sprint start
    target: { period: 'week', value: 6, from: '2026-07-11' } },
  { name: 'Weight', type: 'measurement', unit: 'lb',
    goal: null },     // e.g. { startValue: 185, target: 195, pace: 'standard' }
];
