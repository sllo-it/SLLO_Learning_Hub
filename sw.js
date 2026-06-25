const CACHE_NAME = 'game-hub-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './games.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
});

// Fetch: cache-first for hub assets, network fallback
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests; let others pass through
  if (url.origin !== location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(resp => {
      return resp || fetch(event.request);
    })
  );
});
