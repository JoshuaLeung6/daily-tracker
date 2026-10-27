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

// Staple foods seeded into the on-phone food library at startup (matched by
// name, created only if missing — foods added in-app are never touched; a
// seeded food's numbers follow this list until it is edited in-app). All
// values are PER-SERVING estimates from standard references; correct any
// with Claude and the fix lands on the next launch.
export const FOOD_SEEDS = [
  { name: 'Egg (1 large)', kcal: 70, protein: 6 },
  { name: 'Bread (1 slice)', kcal: 80, protein: 3 },
  { name: 'Rice (1 cup uncooked)', kcal: 680, protein: 13 },
  { name: 'Hashbrown (1 patty)', kcal: 130, protein: 2 },
  { name: 'Bacon (1 strip)', kcal: 45, protein: 3 },
  { name: 'Banana', kcal: 105, protein: 1 },
  { name: 'Frozen fruit (1 cup)', kcal: 70, protein: 1 },
  { name: 'Avocado (whole)', kcal: 240, protein: 3 },
  { name: 'Yogurt (¾ cup Greek)', kcal: 150, protein: 15 },
  { name: 'Milk (1 cup, 2%)', kcal: 120, protein: 8 },
  { name: 'Peanut butter (2 tbsp)', kcal: 190, protein: 7 },
  { name: 'Smoothie (fruit, yogurt, milk, honey, PB)', kcal: 590, protein: 30 },
  { name: 'Almonds (¼ cup)', kcal: 170, protein: 6 },
  { name: 'Chocolate almonds (¼ cup)', kcal: 210, protein: 5 },
  { name: 'Beer (1 can)', kcal: 150, protein: 2 },
  { name: 'Pasta (85 g dry)', kcal: 300, protein: 11 },
  { name: 'Pasta sauce, tomato (½ cup)', kcal: 70, protein: 2 },
  { name: 'Pasta sauce, cream (½ cup)', kcal: 220, protein: 4 },
  { name: 'Ice cream (½ cup)', kcal: 140, protein: 2 },
  { name: 'Salmon (6 oz)', kcal: 350, protein: 34 },
  { name: 'Ground beef (¼ lb, 80/20)', kcal: 290, protein: 19 },
  { name: 'Chicken thigh (1, boneless)', kcal: 180, protein: 22 },
  { name: 'Cheese (1 oz)', kcal: 110, protein: 7 },
];

// Day-view grouping: group is one of movement | intake | recovery; the
// Day tab renders collapsible sections in that order. No group (Weight) =
// ungrouped at the top — the goal instrument leads the day.
// Maintenance reminders (Manual → Maintain). `last` is the last visit,
// YYYY-MM-DD, set HERE (tell Claude the date); null = unarmed, the page
// asks for it. Due = last + months; overdue past that, "soon" within 30d.
export const MAINTENANCE = [
  { id: 'dentist', label: 'Dentist cleaning', months: 6, last: null },
  { id: 'physical', label: 'Physical + bloodwork', months: 12, last: null },
  { id: 'skin', label: 'Skin check', months: 12, last: null },
  { id: 'eyes', label: 'Optometrist', months: 24, last: null },
];

// The Manual (footer tab): the standing plan for each zone, written HERE
// (with Claude) like every other plan in this app. The free-text notes on
// each Manual page live in the data document, not here.
export const MANUAL = {
  movement: {
    text: 'Lift on the push/pull/legs rotation, everything at 8–15 reps — weight days push load, volume days push sets. Take the last set of each lift to 0–2 reps in reserve, and when every set hits the top of the range two sessions running, add load and reset to ~10.',
    rows: [
      ['Lifting', '5–6 sessions/week'],
      ['Main lifts', 'DB press · Lat pulldown · Leg press'],
      ['Cardio', '2×/week, any sport (1 = yellow, 0 = red)'],
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
    text: 'The upkeep encyclopedia: habits, cadences, and who to see for what. Scan it now and then and ask one question — is anything here missing from my life right now?',
    sections: [
      ['Daily', [
        ['Teeth', 'brush 2× with fluoride · floss once, evenings'],
        ['Skin', 'cleanse + moisturize; SPF 30 on the face when outdoors'],
        ['Sunlight', '10–30 min outside, ideally before noon'],
        ['Vitamin D', '1,000–2,000 IU/day through the dark months (Oct–Apr)'],
        ['After training', 'shower soon; rinse the face after heavy sweat'],
      ]],
      ['Monthly', [
        ['Skin self-check', 'scan moles — asymmetry, border, colour, diameter, evolving'],
        ['This Manual', 'reread this page; update what changed'],
      ]],
      ['Scheduled', [
        ['Dentist', 'cleaning every 6 months'],
        ['Physical + bloodwork', 'yearly — lipids, A1c, vitamin D'],
        ['Skin check (professional)', 'yearly, GP or dermatologist'],
        ['Eyes', 'optometrist every 2 years — you work on screens'],
      ]],
      ['Who to see for what', [
        ['Joint or muscle pain > 2 weeks', 'physiotherapist — and log it in Repair'],
        ['A mole that changed', 'dermatologist, soon'],
        ['Bleeding gums', 'dentist'],
        ['Eye strain, headaches', 'optometrist'],
        ['Persistent fatigue or low mood', 'GP + bloodwork before guessing'],
      ]],
      ['Supplements', [
        ['Worth it', 'creatine 5 g/day · vitamin D in winter · omega-3 if you rarely eat fish'],
        ['Skip', 'almost everything else; protein powder is food, not a supplement'],
      ]],
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
    // 2×/week from Sprint 2 (owner's call 2026-10-26; grading: 2 green,
    // 1 yellow, 0 red — see weekLineStatus). Sprint 1 history keeps its
    // 1×/week target: the `from` date scopes the new bar to the new sprint.
    target: { period: 'week', value: 2, from: '2026-10-25' } },
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
