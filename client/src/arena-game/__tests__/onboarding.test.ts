/**
 * M10 tests — pure onboarding helpers: the title-screen entry-route decision
 * and display-name sanitisation. P11 additions: provider identity sync
 * (audit #9 — EvoForge's name is canonical, Origin prefills the champion)
 * and the first-battle difficulty gate.
 */
import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../integration/evoforge/types';
import {
  applyProviderIdentity,
  isDifficultyUnlocked,
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

describe('applyProviderIdentity (P11 — audit #9)', () => {
  function profile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
    return {
      playerId: 'user-1',
      displayName: 'Iron Tyson',
      championId: 'champion-shredder',
      rankPoints: 0,
      ...overrides,
    };
  }

  it('syncs the EvoForge display name into the save', () => {
    const save = createDefaultSave();
    const next = applyProviderIdentity(save, profile());
    expect(next.player.displayName).toBe('Iron Tyson');
  });

  it('adopts the Origin-derived champion while onboarding is incomplete', () => {
    const save = createDefaultSave();
    expect(save.player.onboardingComplete).toBe(false);
    const next = applyProviderIdentity(save, profile());
    expect(next.player.championId).toBe('champion-shredder');
  });

  it('never overrides the champion once onboarding is complete', () => {
    const save = createDefaultSave();
    save.player.onboardingComplete = true;
    save.player.championId = 'champion-mass';
    const next = applyProviderIdentity(save, profile());
    expect(next.player.championId).toBe('champion-mass');
    expect(next.player.displayName).toBe('Iron Tyson'); // name still syncs
  });

  it('ignores unknown champion ids and blank names', () => {
    const save = createDefaultSave();
    save.player.displayName = 'Kept';
    const next = applyProviderIdentity(
      save,
      profile({ displayName: '   ', championId: 'champion-nope' })
    );
    expect(next.player.displayName).toBe('Kept');
    expect(next.player.championId).toBe(save.player.championId);
  });

  it('returns the SAME object when nothing changes (no-op persist skip)', () => {
    const save = createDefaultSave();
    save.player.displayName = 'Iron Tyson';
    save.player.championId = 'champion-shredder';
    expect(applyProviderIdentity(save, profile())).toBe(save);
  });

  it('touches no other save fields', () => {
    const save = createDefaultSave();
    save.player.rankPoints = 77;
    const next = applyProviderIdentity(save, profile());
    expect(next.player.rankPoints).toBe(77);
    expect(next.stats).toBe(save.stats);
    expect(next.decks).toBe(save.decks);
    expect(next.settings).toBe(save.settings);
  });
});

describe('isDifficultyUnlocked (P11 first-battle gate)', () => {
  it('training is always available', () => {
    const save = createDefaultSave();
    expect(isDifficultyUnlocked(save, 'training')).toBe(true);
  });

  it('standard and advanced are locked until the first win', () => {
    const save = createDefaultSave();
    expect(isDifficultyUnlocked(save, 'standard')).toBe(false);
    expect(isDifficultyUnlocked(save, 'advanced')).toBe(false);
  });

  it('one win on any tier unlocks the harder tiers', () => {
    const save = createDefaultSave();
    save.stats = { battlesPlayed: 1, wins: 1, losses: 0, draws: 0 };
    expect(isDifficultyUnlocked(save, 'standard')).toBe(true);
    expect(isDifficultyUnlocked(save, 'advanced')).toBe(true);
  });

  it('losses and draws alone unlock nothing', () => {
    const save = createDefaultSave();
    save.stats = { battlesPlayed: 5, wins: 0, losses: 3, draws: 2 };
    expect(isDifficultyUnlocked(save, 'standard')).toBe(false);
  });
});
