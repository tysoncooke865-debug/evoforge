import { Platform } from 'react-native';

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
  const RELOADED_KEY = 'evoforge-version-guard-at';
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
        await supabase.from('analytics_events').insert({
          event_name: 'pwa_boot_diag',
          props: {
            standalone: window.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone === true,
            entry_running: mine ?? null,
            entry_live: live ?? null,
            stale: Boolean(mine && live && mine !== live),
            errors: early,
            ua: String(navigator.userAgent).slice(0, 140),
            vh: window.innerHeight,
            vw: window.innerWidth,
          },
        });
      } catch { /* signed out or offline — silent */ }
    })();
  }, 8000);
}
