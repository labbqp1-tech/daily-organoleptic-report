/* Daily Organoleptic Report — service worker v15.2.
   Pages/JSON: network first, but a page navigation waits at most 3 s before the saved copy is shown
   (the network answer still refreshes the cache in the background). PNG: cache first.
   Only successful same-origin GETs are cached. Apps Script writes and all cross-origin traffic pass straight through. */
const CACHE = 'daily-organoleptic-report-v15.2';
const PREFIX = 'daily-organoleptic-report-';
const SHELL = ['./', 'index.html'];                       // must install, or the update is abandoned and the old version keeps working
const EXTRA = ['manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const NAV_TIMEOUT_MS = 3000;

const abs = (url) => new URL(url, self.registration.scope).href;
const fresh = (url) => new Request(abs(url), { cache: 'reload' });   // bypass the browser HTTP cache when installing

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(SHELL.map(fresh)); }        // rejects on any failure -> install fails -> old worker and cache stay
    catch (err) { await caches.delete(CACHE); throw err; }
    await Promise.all(EXTRA.map((u) => cache.add(fresh(u)).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Pages are stored under one key: "?perf=1" etc. must not create extra copies of the 240 KB page.
function cacheKey(req, isHtml) {
  if (!isHtml) return req;
  return abs('index.html');
}

async function cachePut(key, res) {
  if (res && res.ok && res.type === 'basic') {
    try { await (await caches.open(CACHE)).put(key, res.clone()); } catch (_) {}
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
    return;
  }
  if (!isHtml && !isJson) return;

  const key = cacheKey(req, isHtml);
  const network = fetch(req).then((res) => cachePut(key, res));
  event.waitUntil(network.catch(() => null));            // keep refreshing the cache even after a timeout answer

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fallback = async () => {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      if (isHtml) { const page = await cache.match(abs('index.html')); if (page) return page; }
      return null;
    };
    if (isHtml) {
      // Weak Wi-Fi: do not leave the operator on a blank screen. After 3 s show the saved copy (if there is one).
      const timed = new Promise((resolve) => setTimeout(() => resolve('timeout'), NAV_TIMEOUT_MS));
      try {
        const first = await Promise.race([network, timed]);
        if (first !== 'timeout') {
          if (first && !first.ok) { const saved = await fallback(); if (saved) return saved; }   // 404/5xx from the host: keep the working copy
          return first;
        }
        const saved = await fallback();
        if (saved) return saved;
        return await network;                            // nothing saved yet (first ever visit): keep waiting for the network
      } catch (_) {
        const saved = await fallback();
        if (saved) return saved;
        return new Response('Offline — open the app once with internet so it can be saved on this tablet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }
    try { const res = await network; if (res.ok) return res; const hit = await cache.match(key); return hit || res; }
    catch (_) {
      const hit = await cache.match(key);
      if (hit) return hit;
      // JSON must never receive an HTML fallback.
      return new Response('Offline — resource not cached', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
