/* Daily Organoleptic Report — service worker v11.
   Network-first HTML/JSON, cache-first PNG. Only successful same-origin GETs.
   Never intercept Apps Script writes or any cross-origin traffic. */
const CACHE = 'daily-organoleptic-report-v11';
const PREFIX = 'daily-organoleptic-report-';
const PRECACHE = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(new URL(url, self.registration.scope).href).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function cachePut(req, res) {
  if (res && res.ok) {
    try { await (await caches.open(CACHE)).put(req, res.clone()); } catch (_) {}
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Development tooling and unrelated same-origin API calls are never cached.
  if (url.pathname.startsWith('/@') || url.pathname.startsWith('/__') || url.pathname.startsWith('/api/')) return;
  const isPng = /\.png$/i.test(url.pathname);
  const isHtml = req.mode === 'navigate' || /\.html$/i.test(url.pathname) || url.pathname.endsWith('/');
  const isJson = /\.json$/i.test(url.pathname);
  if (isPng) {
    event.respondWith(caches.open(CACHE).then(async (cache) =>
      (await cache.match(req)) || cachePut(req, await fetch(req))
    ));
  } else if (isHtml || isJson) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { return await cachePut(req, await fetch(req)); }
      catch (_) {
        const hit = await cache.match(req);
        if (hit) return hit;
        // JSON must never receive an HTML fallback.
        if (isHtml) {
          const page = await cache.match(new URL('index.html', self.registration.scope).href);
          if (page) return page;
        }
        return new Response('Offline — resource not cached', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
  }
});
