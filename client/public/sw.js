/**
 * EvoForge shell service worker (2026-07-18). ONE JOB: make standalone
 * launches never depend on a live network fetch. Every "frozen grey screen"
 * on the installed iOS app happened when the launcher had to fetch a CHANGED
 * shell over the network at startup (beacon-proven: Safari boots every build;
 * standalone dies exactly at build transitions).
 *
 * Strategy: navigations are served CACHE-FIRST from the last known-good shell
 * (instant, offline-safe), while the network copy is fetched behind and
 * stored for next launch. Freshness is owned by the IN-APP version guard,
 * which reloads when the running entry hash differs from the live one — by
 * then the fresh shell is already in this cache. Hashed /_expo and /assets
 * stay on plain HTTP caching (immutable), untouched here.
 */
const SHELL_CACHE = 'evoforge-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.add('/').catch(() => undefined)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return; // shell only
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match('/');
      const refresh = fetch('/', { cache: 'no-store' })
        .then((res) => {
          if (res && res.ok) void cache.put('/', res.clone());
          return res;
        })
        .catch(() => undefined);
      if (cached) {
        // Serve instantly; refresh lands behind for the next launch.
        void refresh;
        return cached;
      }
      const fresh = await refresh;
      if (fresh) return fresh;
      return new Response('EvoForge is offline. Reconnect and reopen.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })
  );
});
