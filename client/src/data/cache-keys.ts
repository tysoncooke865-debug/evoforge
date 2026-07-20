/**
 * THE DEVICE-CACHE KEYS (2026-07-20, the lockout postmortem).
 *
 * Constants only, ZERO imports — ui/core/error-screen.tsx must be able to
 * import these while the rest of the module graph is broken, and nothing
 * here may drag app code into that path.
 *
 * These localStorage keys survive HARD refresh; that is what made the
 * "SOMETHING BROKE" lockout permanent (a poisoned persisted query cache
 * re-crashed every render, and no refresh clears localStorage). Every
 * escape path — sign-out, the error screen's CLEAR CACHE, the per-build
 * buster — names them from here, one source of truth.
 */

/** The persisted TanStack query cache. Purged on sign-out (auth-context)
 *  and busted per deploy (domain/build-id.ts ⟶ app/_layout.tsx). */
export const QUERY_CACHE_KEY = 'evoforge-query-cache-v1';

/** error-screen.tsx's one-auto-reload-per-window guard for chunk 404s. */
export const CHUNK_RELOAD_AT_KEY = 'evoforge-chunk-reload-at';

/** version-guard.ts's one-reload-per-window guard for stale shells. */
export const VERSION_GUARD_AT_KEY = 'evoforge-version-guard-at';
