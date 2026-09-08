// BUMP THIS VERSION NUMBER whenever you make changes to force a cache reset
const CACHE_NAME = 'sllo-ai-learning-hub'; 

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './games.json',
  './icon-192.png',
  './icon-512.png'
];

// Install: Cache core assets and force the new service worker to take over
self.addEventListener('install', event => {
  self.skipWaiting(); // Forces this new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activate: Clean out any old, outdated caches
self.addEventListener('activate', event => {
  event.waitUntil(clients.claim()); // Take control of all pages immediately
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
});

// Fetch: Network-First, Cache-Fallback strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests; let others pass through natively
  if (url.origin !== location.origin) {
    return;
  }

  // Handle requests: try network first, then fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Network is available: update the cache with the fresh response
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Network failed (disconnected): pull from the saved cache
        return caches.match(event.request);
      })
  );
});