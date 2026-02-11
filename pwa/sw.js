// Service Worker — Health Tracker PWA
const CACHE_NAME = 'health-tracker-v6';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles/theme.css',
  './styles/main.css',
  './styles/components.css',
  './scripts/db.js',
  './scripts/ui.js',
  './scripts/app.js',
  './scripts/log.js',
  './scripts/camera.js',
  './scripts/sync.js',
  './scripts/calendar.js',
  './scripts/goals.js',
];

// Install — cache all assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for assets, network-first for everything else
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Don't cache non-GET or cross-origin
        if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (e.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
