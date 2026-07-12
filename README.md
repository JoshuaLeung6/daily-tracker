# Daily Tracker

A personal daily-tracking calendar PWA: log calories, protein, workouts — or any
tracker you define — against a day/week/month calendar. Built as plain
HTML/CSS/JS with zero dependencies and no build step; the repo root **is** the
deployed site.

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
js/store.js           localStorage document + debounced autosave (only module touching storage)
js/trackers.js        tracker CRUD
js/dates.js           local-date helpers (never UTC for day keys)
js/backup.js          export (iOS share sheet) / import with undo
js/views/*.js         day / week / month / settings
icons/                app icons (regenerate via dev/make-icons.html)
```

## Reminders (optional)

iOS PWAs can't schedule local notifications. Workaround: iPhone **Shortcuts**
app → Automation → "At 9:00 PM" → Open App → choose the installed Tracker web
app. That gives a nightly nudge with the app one tap away.
