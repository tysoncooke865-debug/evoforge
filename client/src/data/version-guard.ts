import { Platform } from 'react-native';

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
}
