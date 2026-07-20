/**
 * THE RUNNING BUILD'S IDENTITY (2026-07-20, the lockout postmortem).
 *
 * The persisted query cache used a STATIC buster ('v1'), so a deploy never
 * invalidated it — data normalized by an OLD bundle rehydrated into a NEW
 * bundle whose render assumed fields the old shape lacked (`post.tagged`),
 * and the throw was permanent because localStorage survives hard refresh.
 *
 * The cure is to bust per deploy: the web bundle's identity is the hashed
 * entry script (`entry-<hash>.js`) already trusted by data/version-guard.ts
 * for stale-shell detection. Same regex, same source of truth.
 *
 * Pure and dependency-free on purpose (the chunk-error.ts precedent): the
 * extraction is unit-testable without a DOM.
 */

const ENTRY_RE = /entry-([a-f0-9]+)\.js/;

/** The first `entry-<hash>.js` hash among script srcs, or null. */
export function entryHashFromSrcs(srcs: readonly string[]): string | null {
  for (const src of srcs) {
    const m = ENTRY_RE.exec(src);
    if (m) return m[1];
  }
  return null;
}

/**
 * The running bundle's build id on web; `fallback` everywhere the hashed
 * entry script doesn't exist — native builds, static render (no document),
 * and the dev server. The fallback keeps dev's warm cache across reloads;
 * on native a deploy can't strand a device (the bundle ships with the app).
 */
export function runningBuildId(fallback = 'v1'): string {
  if (typeof document === 'undefined') return fallback;
  try {
    const srcs = Array.from(document.querySelectorAll('script[src]')).map(
      (s) => (s as HTMLScriptElement).src
    );
    return entryHashFromSrcs(srcs) ?? fallback;
  } catch {
    return fallback;
  }
}
