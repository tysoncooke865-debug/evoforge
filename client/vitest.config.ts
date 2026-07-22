/**
 * Vitest config — added 2026-07-23 (arena five-champion pass) solely to give
 * tests the same `@/` → `src/` path alias tsconfig declares, so the arena
 * provider tests can import (and vi.mock) `@/data/supabase`-style modules.
 * Test discovery and every other option stay at vitest defaults.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
