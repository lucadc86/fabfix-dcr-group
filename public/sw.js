// sw.js — DCR GROUP gestionale service worker
// Strategy:
//   - Static assets (CSS, JS, fonts): cache-first (stale-while-revalidate)
//   - HTML pages: network-first (fallback to cache for offline)
//   - Firestore/Firebase API calls: network-only (no cache)

const CACHE_VERSION = 'dcr-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;

// Pre-cache critical shell assets on install
const PRECACHE_ASSETS = [
  '/styles.css',
  '/mobile.css',
  '/incassi.css',
  '/login.html',
  '/index.html',
  '/offline.html',
];

// These URL patterns bypass the service worker entirely (always network)
const BYPASS_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /gstatic\.com\/firebasejs/,
  /googleapis\.com/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== 'GET') return;
  if (BYPASS_PATTERNS.some((p) => p.test(request.url))) return;

  const isNavigation = request.mode === 'navigate';
  const isStaticAsset = /\.(css|js|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|ico|webp)(\?.*)?$/.test(url.pathname);

  if (isStaticAsset) {
    // Cache-first for static assets
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        }).catch(() => null);
        return cached || network;
      })
    );
  } else if (isNavigation || url.pathname.endsWith('.html')) {
    // Network-first for HTML pages with cache fallback
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(PAGES_CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/offline.html'))
        )
    );
  }
});
