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
// Target shape:  { period: 'day'|'week', value, dir?: 'atleast'|'atmost' }
// Goal shape:    { startValue, target, deadline?: 'YYYY-MM-DD', pace?: 'conservative'|'standard'|'aggressive' }

// Behavior flags — personal judgment calls, revisit as the phase changes.
export const FLAGS = {
  // He's lightweight and bulking: gaining faster than the band is NOT a
  // concern right now, so don't paint it red or suggest trimming calories.
  // Flip to true later in the bulk (or on a cut) to re-enable.
  warnFastGain: false,
};

// Cardio picks that count as a "cardio day". Walking stays in the picker
// for logging but is background activity (NEAT), not conditioning — a
// walk-only day is not a cardio day.
export const CARDIO_COUNTS = ['run', 'squash', 'bike'];

// NOTE: every target/goal below is `null` = "keep whatever is already stored
// on the phone" (the values Joshua set in-app before this switch). Change a
// null to a concrete target here to make it the source of truth from then on.
export const TRACKERS = [
  { name: 'Calories', type: 'number', unit: 'kcal',
    target: null },   // set from the measured TDEE (Goals pane one-tap)
  { name: 'Protein', type: 'number', unit: 'g',
    target: null },   // e.g. { period: 'day', value: 150, dir: 'atleast' }
  { name: 'Cardio', type: 'multiselect', options: ['walk', 'run', 'squash', 'bike'],
    target: null },
  { name: 'Weightlifting', type: 'checkbox',
    target: null },   // e.g. { period: 'week', value: 4 }
  { name: 'Weight', type: 'measurement', unit: 'lb',
    goal: null },     // e.g. { startValue: 185, target: 195, pace: 'standard' }
];
