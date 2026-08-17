// Música Libre - Service Worker
// Handles offline caching for PWA

const CACHE_NAME = 'musica-libre-v2';
const STATIC_CACHE = 'ml-static-v2';
const DATA_CACHE = 'ml-data-v2';
const IMAGE_CACHE = 'ml-images-v2';

// Static assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/spotify',
  '/profile',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE && key !== IMAGE_CACHE)
            .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // API requests: network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(event, DATA_CACHE));
    return;
  }

  // Images from external sources: cache first
  if (request.destination === 'image' && url.origin !== self.location.origin) {
    event.respondWith(cacheFirstWithNetwork(event, IMAGE_CACHE));
    return;
  }

  // Static assets: cache first, then network
  if (STATIC_ASSETS.includes(url.pathname) || 
      url.pathname.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/)) {
    event.respondWith(cacheFirstWithNetwork(event, STATIC_CACHE));
    return;
  }

  // Everything else: stale while revalidate
  event.respondWith(staleWhileRevalidate(event, STATIC_CACHE));
});

// ── Strategies ──

async function networkFirstWithCache(event, cacheName) {
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(event.request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Sin conexión', offline: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 503,
    });
  }
}

async function cacheFirstWithNetwork(event, cacheName) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  try {
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(event.request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 404 });
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cached = await caches.match(event.request);
  const fetchPromise = fetch(event.request).then((response) => {
    if (response.ok) {
      const cache = caches.open(cacheName);
      cache.then(c => c.put(event.request, response.clone()));
    }
    return response;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls;
    caches.open(IMAGE_CACHE).then((cache) => {
      cache.addAll(urls.filter(u => u && u.startsWith('http')));
    });
  }
});
