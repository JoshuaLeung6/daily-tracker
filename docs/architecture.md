# Architecture & invariants

Read this before editing. Every rule below exists because breaking it caused a
real bug — the "why" lines are the actual failures, not hypotheticals.

## Shape of the app

Vanilla ES modules, no build step, no dependencies. The repo root **is** the
deployed site (GitHub Pages).

```
config.js  sprints.js     ← personal configuration: the source of truth
     ↓
store.js                  ← the single localStorage doc (pcal:data)
trackers.js  workouts.js  ← domain reads/writes over that doc
     ↓
insights.js               ← all analysis. Computes, never renders.
     ↓
views/*.js                ← render only. No math that belongs upstream.
app.js                    ← tab switching, shared date context, SW registration
```

The layering has held up well. When a number looks wrong, fix it in
`insights.js`/`sprints.js`, not in the view that displays it.

---

## Release convention

**Bump BOTH on every deploy:**
- `APP_VERSION` in `js/app.js`
- `CACHE` in `sw.js`

The service worker is cache-first; without a new `CACHE` name the phone keeps
serving the old bundle. GitHub Pages' CDN can also serve a stale `sw.js` for
~10 minutes after a push, so "it didn't update" is expected briefly.

New JS files must be added to the `ASSETS` array in `sw.js` or they will not
be cached offline.

---

## Configuration invariants

**Goals and targets are set in code, never in the UI.**
`js/config.js` (trackers, targets, bands, flags) and `js/sprints.js` (sprint
dates, weight goal, lift PR goals) are the only places these change. The
Progress/Lifts panes are read-only surfaces.
*Why: the UI used to write goals too, so a stale in-app goal of 150 silently
outranked the configured sprint goal of 145 for weeks.*

**`applyConfig` is non-destructive and idempotent.** It reconciles config into
stored data on every startup. Semantics that matter:
- `target: null` / `goal: null` → **leave whatever is stored alone**
- `clearGoalIfTarget: N` → delete the stored goal **only if** its target is N
- `from:` on a target backdates it; without `from`, history is preserved

*Why: a blunt "clear the goal" flag also wiped goals set deliberately for
other purposes. Targeted cleanup is the safe form.*

**Goal precedence: a tracker goal that exists wins; the sprint goal is the
default.** Do not invert this. Stale tracker goals are removed by
`clearGoalIfTarget`, not by changing precedence.
*Why: inverting it made a deliberately-set 175 lb tracker goal display as the
sprint's 145.*

---

## Cross-module dependencies that bite

**`rateBand()` needs a goal from somewhere.** It reads `tracker.goal`, and
falls back to the sprint's weight goal. It returns `null` if neither exists —
and a null band silently removes the weight verdict, the week grading, and
every diet suggestion.
*Why: clearing the tracker goal killed all weight feedback with no error.*

**`insights.js` ↔ `sprints.js` is a real import cycle.** `sprints.js` imports
computed helpers from `insights.js`; `insights.js` imports **only the `SPRINTS`
constant** back. Keep it that way — importing anything computed from
`sprints.js` into `insights.js` will deadlock module init.

**Sprint dates are pinned, not derived.** `SPRINTS[0].start` is a literal date.
`start: null` means "first logged day", which silently moves the whole sprint
(week N of M, start weight, adherence window) if anything is ever backdated
earlier.

**Sprint length is counted inclusively.** `daysBetween(start, end) + 1`, so
16 weeks = 112 days. Jul 13 → Nov 1 is exactly 16 weeks; an end date one day
later makes it 113 days, which `Math.ceil(days / 7)` renders as "of 17".

**Weeks run MONDAY→SUNDAY.** `startOfWeek()` in `dates.js` is
`(d.getDay() + 6) % 7`, which maps Monday→0. A sprint must start on a Monday
or its first week is a stub.
*Why: the sprint start was twice moved to the "clean" boundary of a Sun–Sat
grid that does not exist. Check `startOfWeek()` before reasoning about week
alignment — do not assume.*

---

## View invariants

**Module-level view state must be listed in one place.** `views/stats.js` has
`pane`, `openSplit`, `expandedLift`, `weightScale`; `views/week.js` has `mode`;
`views/day.js` has `unlockedISO`. When you add a value to one of these, grep
for every read of that variable.
*Why: `render()` had `if (pane !== 'coach') pane = 'sprint'` — correct for two
panes. Adding a third made the Lifts tab literally unopenable.*

**Gesture state lives in a module-level `g` object, and the `touchmove`
listener is bound once per container.** `touchmove` must be non-passive, so it
needs `addEventListener` — which *stacks* on every re-render, unlike `on*`
assignment. The bind is guarded by `container.dataset.gestureBound`.
Per-render values (hint element, current date, ctx) are refreshed into `g` so
the once-bound listener never reads a stale closure.

**One commit rule for swipes.** `willCommit(delta, velocity)` in
`views/day.js` is shared by the live preview and by `touchend`. Never compute
the threshold separately in the two places, or the "armed" indicator will
promise something that does not happen.

**No navigation into the future.** Day and week views both refuse forward
navigation past today — swipe resists and never arms, and the next arrow is
`disabled`. Any new navigation path must respect this.

---

## CSS traps

**`.gc-window` is `white-space: nowrap`.** It is meant for short suffixes. Put
a sentence in it and the pane scrolls sideways. Override with
`white-space: normal` (see `.mt-aim .gc-window`).

**The tab bar must NOT add `env(safe-area-inset-bottom)` padding.** The bar
already reaches the bottom of the viewport, so inset padding does not close a
gap — it adds ~34px of dead space under the icons.

**The viewport meta is order-sensitive: `viewport-fit=cover` must come right
after `initial-scale`.** Never reinstate `maximum-scale` / `user-scalable=no`
between them — iOS ignores those for accessibility anyway, pinch-zoom is
already blocked by `touch-action: pan-y`, and their presence can cause the
rest of the string (including `cover`) to be dropped.

**`body` must be sized with `height: 100vh`.** Not `inset: 0`
([WebKit 237961](https://bugs.webkit.org/show_bug.cgi?id=237961): standalone +
cover leaves a bottom gap), not `100dvh`
([WebKit 254868](https://bugs.webkit.org/show_bug.cgi?id=254868): wrong on PWA
cold start, self-corrects only after a rotation), not `100%` (breaks cover).

*Why these three exist: five "fix the footer" attempts failed because the gap
was diagnosed as bottom padding when the arithmetic was `874 − 62 = 812` — the
62px **top** Dynamic Island inset being carved out of the viewport because
cover was not applying. Symptom presents at the bottom; cause was at the top.*

**Diagnosing viewport problems:** Settings → About → **Layout info** reads
`--sat`/`--sab` back from `:root`. If both are `0px`, `viewport-fit=cover` is
not applying. With cover working on a Dynamic Island phone, expect
`--sat 62px`, `--sab 34px`, and `innerHeight === screen.height`. Measure
against `screen.height`, never `innerHeight` alone — `innerHeight` cannot see
a band that iOS never gave the page.

**The 62px band below the tab bar is WebKit bug 301994 — an iOS bug, NOT
fixable from page code.** [bugs.webkit.org/301994](https://bugs.webkit.org/show_bug.cgi?id=301994),
REOPENED 2026-08-04, live on iOS 26.5.2 and iOS 27 beta (fixed in 26.2,
regressed in 26.5.2). On affected builds iOS hands the page a layout viewport
already shortened by the top inset — `innerHeight = screen.height − 62` —
while `env(safe-area-inset-top)` still reports 62. The withheld strip is
"drawn by the system above the web layer and unreachable by any DOM element"
(comment 12, which measured 874/812/62 on device — our exact numbers).
Nothing inside the viewport can enlarge it: not status-bar-style, meta order,
`html{height:100%}`, `-webkit-fill-available`, avoiding `position:fixed`, or a
JS resize. **Do not attempt another CSS fix for this.** Two things that ARE
right: (1) `applyTopInset()` in app.js pads `body` by `--sat` ONLY when
`innerHeight === screen.height`, because on buggy builds padding would
double-count the inset; (2) `body`/`html` background and the `theme-color`
meta match the tab bar so the band blends. The manifest `theme_color` is
static (dark) and cannot follow the light theme.

**The bottom 34px is the home indicator and is NOT removable.** Verified
against primary sources (WebKit blog, Apple DevForums, caniuse, mdn) — do not
re-investigate this:
- `innerHeight === screen.height` proves iOS reserves **no** Safari-toolbar
  space in standalone. The 34px is the same 34pt inset native apps get.
- No web equivalent of `prefersHomeIndicatorAutoHidden` (UIKit-only; even
  natively it only dims the indicator, the inset stays reserved).
- Fullscreen API works on iPhone since 17.2 but is non-functional inside
  installed PWAs and would not reclaim the inset anyway.
- Safari 26 made manifest `display: fullscreen` vs `standalone` explicitly
  moot ("UI is always consistent, no matter how the site's code is configured").
- Backgrounds may extend under the indicator (intended pattern). **Tap targets
  must not** — iOS edge-swipe takes precedence in that strip.
The `.tabbar` therefore pads by exactly `--sab` with its background running to
the edge. **This is the floor**: with padding == the inset, the tab tap-targets
already sit flush against the gesture band. A "tight" mode was built and
measured — it could only reclaim space by moving tap targets *into* the swipe
zone — so it was removed rather than shipped.

**Theme colors come from CSS custom properties** defined for both light and
dark. Never hard-code a hex value in a rule.

---

## Data

Single localStorage doc `pcal:data`, `SCHEMA_VERSION = 5`. Migrations in
`store.js` run in order and must stay idempotent. Photos live separately in
IndexedDB (`pcal-photos`).

**The data lives only on the phone.** It cannot be read from this repo. To
inspect real data, export a backup from Settings and share the file.

---

## Testing

`dev/e2e/` — 11 puppeteer suites at 390×844. Run all of them:

```
cd dev/e2e && node run-all.js
```

Run one: `node test-sprint.js`. Screenshots land in `dev/e2e/shots/`.

**Suites need a local server:** `python -m http.server 8080` from the repo root.

Notes that save time:
- Tests seed `localStorage` via `evaluateOnNewDocument`, then reload. Writing
  `localStorage` directly after load gets clobbered by the app's in-memory doc.
- Use **local** date strings, never `toISOString()` (UTC can land a day off and
  make a doc look empty).
- Past days render read-only — click `.lock-pill` before editing them.
- Lift rows live in the Lifts subtab behind collapsed PPL groups; open the pane
  and expand groups before querying `.stat-row`.
- The chart range toggle uses `.seg-btn.range-btn`. Scope pane-segment clicks
  with `.seg-btn:not(.range-btn)`.

**A failing suite after a deliberate UI change is usually a stale expectation,
not a bug** — but confirm which before editing the test. Today three real
regressions hid among ~20 stale expectations.

---

## Known dead code

`js/views/month.js` and `js/views/foodsheet.js` are unreachable (the month tab
and food library were removed). `js/foods.js` is kept alive only by
`foodsheet.js`. None are in `sw.js`'s `ASSETS`, so they cost nothing at
runtime. Safe to delete when convenient — not urgent.

---

## Working process

Batch requests. The suite takes ~2 minutes whether it covers one change or
ten, and one deploy means one version bump. More importantly, a batch leaves
room to check what each change touches — most bugs here came from changing one
thing mid-flow without grepping for its other readers.
