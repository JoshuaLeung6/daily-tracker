# Personal Fitness Tracker

A low-pressure personal fitness PWA: log calories, protein, workouts — or any
tracker you define — against a day/week/month calendar. Tracker types: number,
text, checkbox, pick-one and pick-many lists. Targets can be daily or weekly,
"reach at least" or "stay under", and are effective-dated (changing a target
applies from today; past days keep the target they had). Daily and weekly
streaks are tracked against targets. Light/dark/auto theme in Settings.

Each day also has an optional weightlifting log: a workout is classified by
PPL split (Push/Pull/Legs) and day type (Weight/Volume), with one row per
lift (name × weight × reps × sets). Rows always start empty — the last
same-classification workout appears as one-tap suggestion chips, lifts come
from a searchable picker over your history, and each row previews your last
session ("last weight day: 185 × 8 × 3"). Progress trends use estimated 1RM
(Epley) on weight days and total volume on volume days, compared only within
the same day type. The Progress tab charts body weight against its goal line,
per-lift e1RM over time, and weekly training volume (SVG, no dependencies).
An optional profile (birth year, height, sex, units) rides along in exports
for analysis. Logging a workout auto-checks the Weightlifting tracker.

Built as plain HTML/CSS/JS with zero dependencies and no build step; the repo
root **is** the deployed site.

All data lives on the phone in `localStorage` (key `pcal:data`). Nothing is
sent anywhere. Use **Settings → Export data** for backups.

## Run locally

Service workers and ES modules need a real server (not `file://`):

```
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy (GitHub Pages)

1. Push this repo to GitHub (public repo, branch `main`).
2. Repo → Settings → Pages → "Deploy from a branch" → `main` / `/ (root)`.
3. The app is served at `https://<username>.github.io/<repo>/` in about a minute.

### Install on the iPhone

Open the URL in Safari → Share → **Add to Home Screen**. Launch from the icon:
full-screen, offline-capable, opens straight to today's entry form.

## Releasing a change — IMPORTANT convention

On **every** deploy, bump both:

- `CACHE` in `sw.js` (`pcal-v1` → `pcal-v2` → …)
- `APP_VERSION` in `js/app.js` (shown in Settings, to confirm what's running)

The changed service-worker bytes are what trigger the update. On the phone, the
new version installs on the next app open and takes effect the launch after
that (open the app twice).

## Files

```
index.html            app shell + iOS meta tags
styles.css            all styling (dark "ledger" theme)
sw.js                 cache-first service worker (bump CACHE per deploy)
manifest.webmanifest  PWA manifest
js/app.js             entry point, tabs, date context, APP_VERSION
js/theme.js           light/dark/auto switching (bootstrap copy inline in index.html)
js/store.js           localStorage document + debounced autosave (only module touching storage)
js/trackers.js        tracker CRUD, effective-dated targets, streaks
js/workouts.js        workout log: PPL classification, template/lift memory, stats
js/dates.js           local-date helpers (never UTC for day keys)
js/backup.js          export (iOS share sheet) / import with undo
js/views/*.js         day / week / month / settings
icons/                app icons (regenerate via dev/make-icons.html)
```

## Reminders (optional)

iOS PWAs can't schedule local notifications. Workaround: iPhone **Shortcuts**
app → Automation → "At 9:00 PM" → Open App → choose the installed Tracker web
app. That gives a nightly nudge with the app one tap away.
