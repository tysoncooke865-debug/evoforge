import { Platform } from 'react-native';

import { VERSION_GUARD_AT_KEY } from './cache-keys';
import { supabase } from './supabase';

/**
 * STALE-SHELL GUARD (Tyson 2026-07-18: "still doing the same thing on the
 * phone"). Installed iOS PWAs have repeatedly kept running an OLD cached shell
 * after deploys — mixed old/new code, flashing — even with the shell served
 * no-store. This closes the loop from INSIDE the app: compare the entry bundle
 * this session is actually running against the one the server's current shell
 * references; if they differ, reload once. Loop-proof: after a reload they
 * match by construction, and a localStorage timestamp caps reloads to one per
 * 10 minutes even if a proxy serves nonsense.
 */
export function initVersionGuard(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const RELOADED_KEY = VERSION_GUARD_AT_KEY; // shared: the error screen re-arms it
  // Expo's client render can leave the document untitled (a11y + tab name).
  if (!document.title) document.title = 'EvoForge — The Fitness RPG';
  const check = async () => {
    try {
      const mine = Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src.match(/entry-([a-f0-9]+)\.js/)?.[1])
        .find(Boolean);
      if (!mine) return;
      const res = await fetch('/', { cache: 'no-store' });
      if (!res.ok) return;
      const live = (await res.text()).match(/entry-([a-f0-9]+)\.js/)?.[1];
      if (!live || live === mine) return;
      const last = Number(localStorage.getItem(RELOADED_KEY) ?? 0);
      if (Date.now() - last < 10 * 60 * 1000) return;
      localStorage.setItem(RELOADED_KEY, String(Date.now()));
      location.reload();
    } catch {
      /* offline or blocked — never an error surface */
    }
  };
  // Shell service worker: cache-first launches (the grey-screen cure) — the
  // guard above stays the freshness authority.
  try {
    void navigator.serviceWorker?.register('/sw.js');
  } catch {
    /* unsupported — launches stay network-dependent as before */
  }
  void check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });

  // PWA BOOT BEACON (Tyson 2026-07-18: "still glitching as an app, fine on
  // web" after clean reinstalls — stop guessing, instrument). Once per boot,
  // ~8s in (auth restored by then), report what THIS device is actually
  // running: display mode, the executing entry hash vs the server's, and any
  // early errors. Read back via analytics_events (owner-RLS, migration 029).
  const early: string[] = [];
  window.addEventListener('error', (e) => { if (early.length < 6) early.push(String(e?.message ?? 'err')); }, true);
  window.addEventListener('unhandledrejection', (e) => {
    if (early.length < 6) early.push('rej:' + String((e as PromiseRejectionEvent)?.reason ?? '').slice(0, 120));
  });
  setTimeout(() => {
    void (async () => {
      try {
        const mine = Array.from(document.querySelectorAll('script[src]'))
          .map((s) => (s as HTMLScriptElement).src.match(/entry-([a-f0-9]+)\.js/)?.[1])
          .find(Boolean);
        let live: string | undefined;
        try {
          const res = await fetch('/', { cache: 'no-store' });
          live = (await res.text()).match(/entry-([a-f0-9]+)\.js/)?.[1];
        } catch { /* offline */ }
        const nav = window.navigator as Navigator & { standalone?: boolean };
        // PRIVACY: never store the raw userAgent or exact viewport — that's a
        // device fingerprint, and analytics props carry NO PII (analytics.ts's
        // contract + the Privacy Policy). A coarse platform/browser label keeps
        // the only signal this diagnostic needs (which cohort hits a boot bug).
        const ua = String(navigator.userAgent).toLowerCase();
        const platform = /iphone|ipad|ipod/.test(ua) ? 'ios' : /android/.test(ua) ? 'android' : /macintosh|mac os/.test(ua) ? 'mac' : /windows/.test(ua) ? 'windows' : 'other';
        const browser = /crios/.test(ua) ? 'chrome-ios' : /fxios|firefox/.test(ua) ? 'firefox' : /edg\//.test(ua) ? 'edge' : /chrome/.test(ua) ? 'chrome' : /safari/.test(ua) ? 'safari' : 'other';
        await supabase.from('analytics_events').insert({
          event_name: 'pwa_boot_diag',
          props: {
            standalone: window.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone === true,
            entry_running: mine ?? null,
            entry_live: live ?? null,
            stale: Boolean(mine && live && mine !== live),
            errors: early,
            platform,
            browser,
          },
        });
      } catch { /* signed out or offline — silent */ }
    })();
  }, 8000);
}

/**
 * NAV FREEZE BEACON (Tyson 2026-07-18: page changes still freeze/flash on the
 * phone with a clean boot beacon — instrument navigation itself). A 250ms
 * heartbeat measures main-thread stalls; any gap ≥ 700ms within 4s of a URL
 * change is recorded and shipped (max 3 reports per session) as
 * pwa_nav_diag: {stall_ms, path, secs_after_nav}.
 */
export function initNavFreezeBeacon(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let lastBeat = Date.now();
  let lastNavAt = Date.now();
  let lastPath = location.pathname;
  let sent = 0;
  const startedAt = Date.now();
  // AUDIT B5 (2026-07-19): this heartbeat used to run 4×/sec FOREVER. The
  // diagnostic served its purpose (the iOS-18 freeze hunt); it now stops
  // after its 3 reports or 10 minutes of clean running, whichever first.
  const timer = setInterval(() => {
    const now = Date.now();
    const gap = now - lastBeat;
    lastBeat = now;
    if (sent >= 3 || now - startedAt > 10 * 60 * 1000) {
      clearInterval(timer);
      return;
    }
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      lastNavAt = now;
    }
    if (gap >= 700) {
      sent += 1;
      void supabase.from('analytics_events').insert({
        event_name: 'pwa_nav_diag',
        props: {
          stall_ms: gap,
          path: lastPath,
          secs_after_nav: Math.round((now - lastNavAt) / 1000),
          standalone: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
        },
      }).then(undefined, () => undefined);
    }
  }, 250);
}

/**
 * SCENE JANITOR (Tyson's iOS 18 PWA, 2026-07-18 — the combined/flashing
 * pages). Inactive tab scenes are absolutely-positioned and STILL PAINT
 * (children's explicit visibility punches through the wrappers); desktop
 * engines cover them by paint order, but iOS 18's compositor drops tiles and
 * the scene underneath shows through — blended, flickering pages. The fix
 * with no compositor left to glitch: display:none the inactive scenes
 * (aria-hidden, scene-sized, absolutely-wrapped), restore the moment
 * react-navigation removes aria-hidden on refocus.
 */
export function initSceneJanitor(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const hiddenByUs = new Set<HTMLElement>();
  const tick = () => {
    // restore anything we hid that is active again
    for (const el of Array.from(hiddenByUs)) {
      if (!el.isConnected || el.getAttribute('aria-hidden') !== 'true') {
        el.style.removeProperty('display');
        hiddenByUs.delete(el);
      }
    }
    // hide inactive scenes: aria-hidden, taller than half the viewport,
    // inside an absolutely-positioned wrapper (the scene stack signature —
    // modal backdrops and small aria-hidden decorations never match).
    document.querySelectorAll<HTMLElement>('[aria-hidden="true"]').forEach((el) => {
      if (hiddenByUs.has(el)) return;
      const parent = el.parentElement;
      if (!parent) return;
      if (el.offsetHeight < window.innerHeight * 0.5 && !hiddenByUs.has(el)) {
        // display:none'd elements report 0 height — only size-check new ones
        if (el.style.display !== 'none' && el.offsetHeight < window.innerHeight * 0.5) return;
      }
      if (getComputedStyle(parent).position !== 'absolute') return;
      el.style.setProperty('display', 'none', 'important');
      hiddenByUs.add(el);
    });
  };
  // AUDIT B5 (2026-07-19): the 250ms forever-poll (querySelectorAll +
  // getComputedStyle 4×/sec) becomes EVENT-DRIVEN — react-navigation flips
  // aria-hidden when scenes change focus, and a MutationObserver fires the
  // same tick only then (debounced a frame). A slow 5s sweep stays as the
  // safety net for anything the observer misses.
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      tick();
    });
  };
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName === 'aria-hidden') {
        schedule();
        return;
      }
      if (m.type === 'childList') {
        schedule();
        return;
      }
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-hidden'], childList: true });
  setInterval(tick, 5000);
  tick();
}
