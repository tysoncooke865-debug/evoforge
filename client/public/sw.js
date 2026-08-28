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
// v4: bumped with the /lab navigation bypass (2026-08-28) to evict every v3
// cache still holding the shell those deep links were being answered from.
// (v3 was the rest alarm; v2 was the poisoned-asset healing.)
const SHELL_CACHE = 'evoforge-shell-v4';

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

// ---- THE REST ALARM (2026-08-10). ----
//
// The page hands this worker an absolute instant and it fires the "rest is
// over" notification on its own clock. It lives HERE rather than in the page
// for the obvious reason: a frozen tab has no timers, and a frozen tab is
// exactly when the athlete has put the phone down between sets.
//
// EXACTLY ONE REST TIMEOUT EXISTS AT A TIME. `restTimer` is a single slot and
// scheduling always clears it first, which is what makes every cancellation
// case in the spec — skip, restart, duration change, a second timer replacing
// the first, the workout ending — collapse into one rule and makes a
// duplicate notification structurally impossible. The shared `tag` is the
// belt to that braces: even if two ever raced, the browser collapses them.
//
// HONEST LIMIT: iOS may terminate this worker while the PWA is backgrounded,
// and a terminated worker has no timers either. There is no client-side fix —
// the only delivery iOS guarantees to a suspended PWA is a remote push. The
// app therefore also catches up on resume (ui/train/rest-timer.tsx): an
// expired rest buzzes and says so the moment EvoForge is looked at again.
let restTimer = null;

function clearRestTimer() {
  if (restTimer !== null) {
    clearTimeout(restTimer);
    restTimer = null;
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'evoforge-rest-cancel') {
    clearRestTimer();
    return;
  }
  if (data.type !== 'evoforge-rest-schedule') return;

  clearRestTimer();
  const delay = Number(data.at) - Date.now();
  if (!isFinite(delay)) return;
  // A rest that is already over fires immediately rather than never: the page
  // only reaches this path when it believes a rest is running, and setTimeout
  // with a negative delay is a zero-delay timeout anyway. Guard the far side
  // too — a corrupt timestamp must not arm a notification for next year.
  if (delay > 1000 * 60 * 60) return;

  restTimer = setTimeout(() => {
    restTimer = null;
    self.registration.showNotification('EvoForge', {
      body: data.body || 'Rest complete. Time for your next set.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'evoforge-rest',
      // One pulse, not a pattern that nags. Ignored where unsupported.
      vibrate: [180, 90, 180],
      data: { url: '/workout' },
    });
  }, Math.max(0, delay));
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

  // THE PAGE LAB IS NOT THE APP (2026-08-28). Cache-first-from-'/' answers
  // every navigation with the HOME shell, so a deep link to /lab painted the
  // real Home page before the router had any say — the dev lab looked like an
  // exact copy of the live site, which is precisely what a design lab must
  // never look like. Straight to the network here: Cloudflare answers any
  // path with the current build's HTML, and the lab is a dev tool that owes
  // nobody an offline launch.
  var labPath = new URL(req.url).pathname;
  if (labPath === '/lab' || labPath.indexOf('/lab/') === 0) return;

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
