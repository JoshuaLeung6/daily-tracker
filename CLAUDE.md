# Daily Tracker — working notes

Personal fitness PWA. Vanilla ES modules, no build step, no dependencies.
The repo root **is** the deployed site (GitHub Pages).

**Read [docs/architecture.md](docs/architecture.md) before editing.** It lists
the invariants that have actually caused bugs — goal precedence, the
insights↔sprints import cycle, view state, gesture binding, CSS traps.

## Non-negotiables

1. **Bump BOTH `APP_VERSION` (js/app.js) and `CACHE` (sw.js) on every deploy.**
   Cache-first service worker: without a new CACHE name the phone keeps the old
   bundle. Add new JS files to `ASSETS` in sw.js too.

2. **Goals and targets are configured in code, never in the UI.**
   `js/config.js` (trackers, targets, bands) and `js/sprints.js` (sprint dates,
   weight goal, lift goals). Views are read-only surfaces for these.

3. **Run the suite before deploying:**
   ```
   python -m http.server 8080          # from repo root, in the background
   cd dev/e2e && node run-all.js       # 11 suites, ~2 min
   ```

4. **When changing a shared value, grep for every reader first.**
   Most bugs here came from editing one thing and missing a dependent — a pane
   guard, a null goal, an inherited CSS rule.

5. **The data lives only on the phone.** It cannot be read from this repo. To
   inspect real data, ask for a backup export from Settings.

## Layering

`config.js`/`sprints.js` → `store.js` → `trackers.js`/`workouts.js` →
`insights.js` (computes, never renders) → `views/*` (renders, no analysis).

When a number is wrong, fix it upstream in `insights.js`/`sprints.js`, not in
the view that shows it.

## Device debugging

Settings → About → **Layout info** prints real on-device geometry (viewport,
safe-area insets, tab bar rect, space under icons). Use it instead of reasoning
about what iOS might be doing — three footer "fixes" made things worse before
anyone measured.

## Working style

Batch requests where possible. The suite costs the same for one change or ten,
one deploy means one version bump, and batching leaves room to check what each
change touches.
