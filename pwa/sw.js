// Service Worker — Health Tracker PWA
const CACHE_NAME = 'coach-v208';

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
  './scripts/fitness.js',
  './scripts/skincare.js',
  './scripts/goals.js',
  './scripts/plan.js',
  './scripts/progress.js',
  './scripts/coach.js',
  './scripts/score.js',
  './scripts/challenges.js',
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
  // Dynamic manifest: if manifest.json is requested with ?key= param,
  // return a modified manifest with start_url including the key.
  // This is same-origin (served from our SW), so start_url passes the spec check.
  if (e.request.destination === 'manifest' || (e.request.url.includes('manifest.json') && e.request.url.includes('key='))) {
    const url = new URL(e.request.url);
    const key = url.searchParams.get('key');
    if (key) {
      e.respondWith(
        caches.match('./manifest.json').then(cached => {
          const source = cached || fetch('./manifest.json');
          return Promise.resolve(source).then(r => r.json()).then(manifest => {
            // Rebuild the query string from the manifest request params
            const relay = url.searchParams.get('relay') || '';
            let qs = '?key=' + encodeURIComponent(key);
            if (relay) qs += '&relay=' + encodeURIComponent(relay);
            manifest.start_url = './' + qs;
            return new Response(JSON.stringify(manifest), {
              headers: { 'Content-Type': 'application/manifest+json' }
            });
          });
        }).catch(() => fetch(e.request))
      );
      return;
    }
  }

  const isHTML = e.request.destination === 'document' || e.request.url.endsWith('/');

  if (isHTML) {
    // Network-first for HTML — always try to get fresh page
    e.respondWith(
      fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request) || caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for JS/CSS/images (versioned via cache name)
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Only return cached response if it's valid (200-299 status range)
      if (cached && cached.status >= 200 && cached.status < 300) return cached;
      return fetch(e.request).then(response => {
        if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) {
          return response;
        }
        // Only cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    }).catch(() => null)
  );
});
