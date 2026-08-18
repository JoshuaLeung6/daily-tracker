// Cache-first service worker. Bump CACHE on EVERY deploy (and APP_VERSION
// in js/app.js) — that byte change is what triggers the update.

const CACHE = 'pcal-v65';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './js/theme.js',
  './js/store.js',
  './js/trackers.js',
  './js/workouts.js',
  './js/charts.js',
  './js/insights.js',
  './js/photos.js',
  './js/sprints.js',
  './js/dates.js',
  './js/backup.js',
  './js/ui.js',
  './js/views/day.js',
  './js/views/week.js',
  './js/views/workout.js',
  './js/views/stats.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // ?reset must ALWAYS reach the network: it is the escape hatch that clears
  // this very worker, and ignoreSearch would otherwise hand it the cached
  // index.html — an old copy without the escape hatch in it.
  if (url.searchParams.has('reset')) {
    e.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
