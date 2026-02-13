// Service Worker — Health Tracker PWA
const CACHE_NAME = 'health-tracker-v15';

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

// Fetch — network-first for HTML (ensures updates arrive), cache-first for assets
self.addEventListener('fetch', (e) => {
  const isHTML = e.request.destination === 'document' || e.request.url.endsWith('/');

  if (isHTML) {
    // Network-first for HTML — always try to get fresh page
    e.respondWith(
      fetch(e.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => caches.match(e.request) || caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for JS/CSS/images (versioned via cache name)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      });
    }).catch(() => null)
  );
});
