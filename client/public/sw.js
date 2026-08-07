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
 * then the fresh shell is already in this cache.
 *
 * SECOND JOB (2026-08-07): heal a CDN-poisoned hashed asset. See the fetch
 * handler — an /_expo/static/* response that arrives as text/html is always
 * wrong, and a reload cannot fix it because the URL is unchanged.
 */
// v2: bumped with the poisoned-asset healing so the new worker takes over
// and the old shell cache is dropped on activate.
const SHELL_CACHE = 'evoforge-shell-v2';

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

// ---- WEB PUSH (2026-07-19): the installed PWA receives notifications even
// when closed. The payload is JSON { title, body, url }; a tap focuses an open
// EvoForge window or opens one at the deep link. ----
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'EvoForge', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'EvoForge';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.tag || 'evoforge',
        data: { url: data.url || '/' },
      }),
      // Nudge any open window so a foreground app can refresh its badge/feed.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        for (const c of list) c.postMessage({ type: 'evoforge-push', payload: data });
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

/**
 * POISONED-ASSET HEALING (2026-08-07, the SECOND time this took the site out).
 *
 * `public/_headers` marks `/_expo/static/*` immutable for a year BY PATH, not
 * by whether a file exists. When a request slips through a deploy window,
 * Cloudflare Pages answers with the SPA shell (index.html, 200) and the edge
 * freezes that HTML under the ASSET's URL. The browser then refuses to execute
 * it — "MIME type ('text/html') is not executable" — and that route is dead.
 *
 * A RELOAD CANNOT FIX IT: it re-requests the same poisoned URL and gets the
 * same HTML. `+html.tsx`'s boot guard already retries a failed <script> past
 * it with `?cb=`, which is what keeps the app booting — but a DYNAMIC IMPORT
 * (every async route chunk) fails as a module load, not a script error, so the
 * guard never sees it and the route stays broken. That is the gap this closes.
 *
 * Here we can see the response itself. An `/_expo/static/*` request that comes
 * back as HTML is ALWAYS wrong — those are JavaScript and CSS — so we retry
 * once with a cache-busting query. A different URL is a different edge cache
 * key, therefore a miss, therefore the real file.
 *
 * WHAT THIS DOES AND DOES NOT COVER — stated precisely, because a mitigation
 * believed to be broader than it is, is worse than none:
 *
 *   COVERS   the INSTALLED PWA and any repeat visit, where this worker is
 *            already active and controlling the page when the chunk is
 *            requested. That is Tyson's own iPhone case and the one that
 *            produced the original outage report.
 *   DOES NOT the very first load in a fresh browser. A service worker does not
 *            control the page that registers it, so the first document's
 *            module fetches happen before this handler exists. `+html.tsx`'s
 *            boot guard still covers the <script> tags on that path; a
 *            dynamically imported ROUTE chunk on a first-ever load is not
 *            recoverable client-side and needs the server fix.
 *
 * THE REAL FIX IS SERVER-SIDE: purge the zone after each deploy, or stop the
 * SPA fallback answering /_expo/static/* at all. Both need Cloudflare access
 * this repo does not have.
 */
function looksPoisoned(res) {
  if (!res) return false;
  const type = res.headers.get('content-type') || '';
  return type.indexOf('text/html') > -1;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // ---- Hashed assets: heal a poisoned response, otherwise stay out of the way.
  if (req.method === 'GET' && req.url.indexOf('/_expo/static/') > -1 && req.url.indexOf('cb=') === -1) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (!looksPoisoned(res)) return res;
          const sep = req.url.indexOf('?') > -1 ? '&' : '?';
          // `reload` bypasses the local HTTP cache too, so a poisoned copy the
          // browser already stored cannot answer the retry either.
          return fetch(req.url + sep + 'cb=' + Date.now(), { cache: 'reload' }).catch(() => res);
        })
        .catch(() => fetch(req))
    );
    return;
  }

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
