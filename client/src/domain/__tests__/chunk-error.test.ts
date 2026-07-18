import { describe, expect, it } from 'vitest';

import { isChunkLoadError } from '../chunk-error';

describe('isChunkLoadError', () => {
  // The positive control: every message shape the bundlers actually emit.
  it.each([
    // The message Metro actually emits (captured live, 2026-07-19):
    'Loading module http://localhost:4173/_expo/static/js/web/schedule-abc.js failed.',
    'AsyncRequireError: Loading module https://x/_expo/static/js/web/workout-abc.js failed.',
    'Loading chunk 42 failed. (error: https://x/_expo/static/js/web/workout-abc.js)',
    'ChunkLoadError: Loading chunk workout failed',
    'Failed to fetch dynamically imported module: https://x/workout-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
  ])('matches the real failure shape: %s', (msg) => {
    expect(isChunkLoadError(msg)).toBe(true);
  });

  // The negative control: ordinary render errors must NEVER auto-reload —
  // a reload loop on a real bug would make the app unusable.
  it.each([
    "Cannot read properties of undefined (reading 'stage')",
    'Maximum update depth exceeded',
    'Network request failed',
    'TypeError: x is not a function',
    '',
  ])('does not match an ordinary error: %s', (msg) => {
    expect(isChunkLoadError(msg)).toBe(false);
  });
});
