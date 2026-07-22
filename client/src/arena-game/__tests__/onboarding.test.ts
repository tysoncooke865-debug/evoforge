/**
 * M10 tests — pure onboarding helpers: the title-screen entry-route decision
 * and display-name sanitisation.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_DISPLAY_NAME_LENGTH,
  resolveEntryRoute,
  sanitizeDisplayName,
} from '../services/onboarding/onboarding';
import { createDefaultSave } from '../services/persistence/save';

describe('resolveEntryRoute', () => {
  it('routes a fresh save (onboarding not complete) to /onboarding', () => {
    const save = createDefaultSave();
    expect(save.player.onboardingComplete).toBe(false);
    expect(resolveEntryRoute(save)).toBe('/forge-arena/onboarding');
  });

  it('routes a player who completed onboarding straight to /lobby', () => {
    const save = createDefaultSave();
    save.player.onboardingComplete = true;
    expect(resolveEntryRoute(save)).toBe('/forge-arena/lobby');
  });
});

describe('sanitizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeDisplayName('  Iron   Tyson  ', 'Challenger')).toBe('Iron Tyson');
    expect(sanitizeDisplayName('\tTab\nNewline ', 'Challenger')).toBe('Tab Newline');
  });

  it('falls back to the previous name for empty / whitespace-only input', () => {
    expect(sanitizeDisplayName('', 'Challenger')).toBe('Challenger');
    expect(sanitizeDisplayName('   \n\t ', 'Challenger')).toBe('Challenger');
  });

  it('caps at MAX_DISPLAY_NAME_LENGTH without leaving trailing whitespace', () => {
    const long = 'A'.repeat(MAX_DISPLAY_NAME_LENGTH) + ' overflow tail';
    expect(sanitizeDisplayName(long, 'x')).toBe('A'.repeat(MAX_DISPLAY_NAME_LENGTH));
    // A space landing exactly on the cut boundary is trimmed, not kept.
    const boundary = 'B'.repeat(MAX_DISPLAY_NAME_LENGTH - 1) + '  C';
    const result = sanitizeDisplayName(boundary, 'x');
    expect(result).toBe('B'.repeat(MAX_DISPLAY_NAME_LENGTH - 1));
    expect(result.endsWith(' ')).toBe(false);
  });

  it('keeps a normal name unchanged', () => {
    expect(sanitizeDisplayName('Challenger', 'x')).toBe('Challenger');
  });
});
