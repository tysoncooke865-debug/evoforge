/**
 * Chunk-load failure detection (2026-07-19, the blank-screen fix). With
 * asyncRoutes on web every route is a lazily-fetched chunk; a deploy that
 * replaces hashed chunk files (or a flaky network) makes that fetch fail and
 * the route renders NOTHING — the screen is just the background colour.
 * These failures are transient by nature (the reload gets the new shell), so
 * the error boundary auto-reloads exactly once for them and never for
 * ordinary render errors.
 */
const CHUNK_PATTERNS = [
  // Metro / expo asyncRoutes — the shape this app ACTUALLY emits (captured
  // live 2026-07-19 by deleting a route chunk from a served dist):
  //   "AsyncRequireError: Loading module <url> failed."
  /asyncrequireerror/i,
  /loading module .* failed/i,
  // Other bundlers' shapes, kept for native/webview surfaces:
  /loading chunk .* failed/i,
  /chunkloaderror/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

export function isChunkLoadError(message: string): boolean {
  if (!message) return false;
  return CHUNK_PATTERNS.some((p) => p.test(message));
}
