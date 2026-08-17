// AURA - Service Worker
// Handles offline caching for PWA

const CACHE_NAME = 'musica-libre-v6';
const STATIC_CACHE = 'ml-static-v6';
const DATA_CACHE = 'ml-data-v3';
const IMAGE_CACHE = 'ml-images-v5';
const SAVED_CACHE = 'ml-saved-v1';

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
        keys.filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE && key !== IMAGE_CACHE && key !== SAVED_CACHE)
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

  // Portadas servidas por nuestro proxy: cache primero, así se ven sin
  // internet (incluida la carátula de la pantalla de bloqueo).
  if (url.pathname.startsWith('/api/proxy')) {
    event.respondWith(cacheFirstWithNetwork(event, IMAGE_CACHE));
    return;
  }

  /* ── AUDIO: manejo de Range (esto es lo que arregla el iPhone) ──
     Safari/iOS pide "Range: bytes=0-1" y EXIGE un 206 Partial Content.
     Si le devolvemos el archivo entero con 200, no reproduce: barra de
     progreso muerta y duración 0:00. Es un bug viejo de WebKit.
     Chrome/Android lo toleran, iPhone no.

     Además el Cache API se niega a guardar respuestas 206, así que
     guardamos SIEMPRE la respuesta completa (200) y recortamos nosotros
     el pedacito que pidieron. */
  if (request.destination === 'audio' || /\.(m4a|mp3|webm|opus|aac)$/i.test(url.pathname)) {
    event.respondWith(audioConRange(event));
    return;
  }

  // API requests: network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(event, DATA_CACHE));
    return;
  }

  // Images and audio from external sources: cache first (serve offline)
  if (request.destination === 'image' || url.pathname.startsWith('/api/proxy')) {
    event.respondWith(cacheFirstWithNetwork(event, IMAGE_CACHE));
    return;
  }

  /* NAVEGACIÓN (el HTML de la página): SIEMPRE red primero.
     Antes usábamos staleWhileRevalidate, que servía la copia vieja y
     recién después buscaba la nueva: por eso las actualizaciones podían
     tardar días en verse. Ahora, con internet siempre ves lo último;
     sin internet cae a la copia guardada. */
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresca = await fetch(request);
        if (fresca && fresca.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, fresca.clone());
          return fresca;
        }
        return fresca;
      } catch {
        const guardada = await caches.match(request);
        if (guardada) return guardada;
        const inicio = await caches.match('/spotify');
        if (inicio) return inicio;
        return new Response('Sin conexión', { status: 503 });
      }
    })());
    return;
  }

  // Check saved offline cache first for any URL we cached manually
  event.respondWith((async () => {
    try {
      const savedCache = await caches.open(SAVED_CACHE);
      const savedMatch = await savedCache.match(event.request);
      if (savedMatch) return savedMatch;
    } catch {}
    // Not in saved cache — continue with normal strategy
    if (STATIC_ASSETS.includes(url.pathname) || 
        url.pathname.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/)) {
      return cacheFirstWithNetwork(event, STATIC_CACHE);
    }
    return staleWhileRevalidate(event, STATIC_CACHE);
  })());
  return;
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


/* ── Audio con soporte de Range ────────────────────────────────
   Devuelve 206 cuando el navegador lo pide, sirviendo desde caché
   si ya lo tenemos (eso es lo que hace que suene sin internet). */
async function audioConRange(event) {
  const request = event.request;
  const rango = request.headers.get('range');
  const cache = await caches.open(SAVED_CACHE);

  // Buscamos la versión COMPLETA guardada (ignorando el header Range)
  let completa = await cache.match(request, { ignoreVary: true, ignoreSearch: false });

  if (!completa) {
    // No la tenemos: la pedimos entera (sin Range) para poder guardarla.
    try {
      const limpia = new Request(request.url, {
        method: 'GET',
        headers: new Headers({ Accept: 'audio/*,*/*' }),
        mode: request.mode === 'navigate' ? 'cors' : request.mode,
        credentials: request.credentials,
      });
      const resp = await fetch(limpia);
      if (resp && resp.status === 200) {
        try { await cache.put(request.url, resp.clone()); } catch {}
        completa = resp;
      } else if (resp) {
        // 206 u otra cosa: la pasamos tal cual, sin cachear.
        return resp;
      }
    } catch {
      // Sin internet y sin copia guardada: no hay nada que hacer.
      return new Response('Audio no disponible sin conexión', {
        status: 504, statusText: 'Sin conexión',
      });
    }
  }

  if (!completa) return new Response('No disponible', { status: 504 });
  if (!rango) return completa;

  // Recortamos el pedazo pedido y respondemos 206, como espera Safari.
  try {
    const buf = await completa.arrayBuffer();
    const total = buf.byteLength;
    const m = /bytes=(\d*)-(\d*)/.exec(rango);
    let inicio = m && m[1] ? parseInt(m[1], 10) : 0;
    let fin = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(inicio) || inicio < 0) inicio = 0;
    if (isNaN(fin) || fin >= total) fin = total - 1;

    if (inicio > fin || inicio >= total) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */' + total },
      });
    }

    return new Response(buf.slice(inicio, fin + 1), {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': completa.headers.get('Content-Type') || 'audio/mp4',
        'Content-Range': 'bytes ' + inicio + '-' + fin + '/' + total,
        'Content-Length': String(fin - inicio + 1),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return completa;
  }
}


/* El aviso de "versión nueva" manda este mensaje al tocar Actualizar. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
