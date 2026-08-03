import { describe, expect, it } from 'vitest';

import { MUSCLE_IDS, type MuscleId } from '../muscle-map';
import {
  MUSCLE_FUNCTION,
  THEME_OBJECTIVE,
  difficultyFor,
  missionObjectiveFor,
  missionThemeFor,
} from '../mission-brief';

/**
 * The objective is the first sentence an athlete reads about today's session,
 * so what it says about the REAL splits matters more than its internals. Each
 * case below is a day an actual plan produces.
 */

describe('missionThemeFor — the real splits', () => {
  const cases: [name: string, muscles: MuscleId[], theme: string][] = [
    ['pull (the screenshot)', ['lats', 'upperBack', 'shoulders'], 'width'],
    ['pull with biceps', ['lats', 'upperBack', 'biceps'], 'width'],
    ['push', ['chest', 'shoulders', 'triceps'], 'push'],
    ['chest only', ['chest'], 'push'],
    ['arms', ['biceps', 'triceps', 'forearms'], 'arms'],
    ['legs', ['quads', 'hamstrings', 'glutes', 'calves'], 'legs'],
    ['legs plus core', ['quads', 'hamstrings', 'glutes', 'abs'], 'legs'],
    ['posterior chain', ['glutes', 'hamstrings'], 'legs'],
    ['core', ['abs', 'obliques'], 'core'],
    ['back thickness', ['traps', 'upperBack'], 'width'],
    ['calves alone', ['calves'], 'legs'],
  ];
  for (const [name, muscles, theme] of cases) {
    it(`${name} → ${theme}`, () => {
      expect(missionThemeFor(muscles)).toBe(theme);
    });
  }

  it('an upper-body day that ties resolves to upper, not to a half of itself', () => {
    // chest+triceps (push 2) vs lats+upperBack (width 2): neither defines it.
    expect(missionThemeFor(['chest', 'triceps', 'lats', 'upperBack'])).toBe('upper');
  });

  it('a tie that spans both halves resolves to full body', () => {
    // push 2 (chest, shoulders) vs legs 2 (quads, glutes).
    expect(missionThemeFor(['chest', 'shoulders', 'quads', 'glutes'])).toBe('full');
  });

  it('duplicates cannot vote twice', () => {
    // Three chest exercises must not outrank a genuinely two-region day.
    expect(missionThemeFor(['chest', 'chest', 'chest', 'lats', 'upperBack'])).toBe('width');
  });

  it('refuses an empty day rather than inventing an objective', () => {
    expect(missionThemeFor([])).toBeNull();
    expect(missionObjectiveFor([])).toBeNull();
  });

  it('every theme has an objective, and none of them shout', () => {
    for (const muscles of [['lats'], ['chest'], ['biceps'], ['quads'], ['abs']] as MuscleId[][]) {
      const objective = missionObjectiveFor(muscles);
      expect(objective).toBeTruthy();
      // Sentence case: it renders as prose beside the target glyph.
      expect(objective).not.toBe(objective!.toUpperCase());
      expect(objective!.endsWith('.')).toBe(false);
    }
    expect(new Set(Object.values(THEME_OBJECTIVE)).size).toBe(Object.keys(THEME_OBJECTIVE).length);
  });
});

describe('difficultyFor — planned set volume, banded', () => {
  it('refuses zero and negative rather than calling an empty day light', () => {
    expect(difficultyFor(0)).toBeNull();
    expect(difficultyFor(-3)).toBeNull();
    expect(difficultyFor(Number.NaN)).toBeNull();
  });

  it('bands at the documented boundaries', () => {
    expect(difficultyFor(1)!.key).toBe('light');
    expect(difficultyFor(11)!.key).toBe('light');
    expect(difficultyFor(12)!.key).toBe('normal');
    expect(difficultyFor(20)!.key).toBe('normal');
    expect(difficultyFor(21)!.key).toBe('hard');
    expect(difficultyFor(28)!.key).toBe('hard');
    expect(difficultyFor(29)!.key).toBe('brutal');
  });

  it('bars rise with the band and stay inside 1–4', () => {
    const bands = [6, 16, 24, 40].map((n) => difficultyFor(n)!);
    expect(bands.map((b) => b.bars)).toEqual([1, 2, 3, 4]);
    expect(bands.map((b) => b.label)).toEqual(['LIGHT', 'NORMAL', 'HARD', 'BRUTAL']);
  });

  it('truncates a fractional set count the way the plan does', () => {
    expect(difficultyFor(11.9)!.key).toBe('light');
  });
});

describe('MUSCLE_FUNCTION', () => {
  it('covers every region the map can light — a tap must never open a blank', () => {
    for (const id of MUSCLE_IDS) {
      expect(MUSCLE_FUNCTION[id], id).toBeTruthy();
      expect(MUSCLE_FUNCTION[id].length).toBeGreaterThan(20);
    }
  });

  it('promises no growth figure — the sheet shows planned sets and real volume', () => {
    for (const line of Object.values(MUSCLE_FUNCTION)) {
      expect(line).not.toMatch(/\d+\s*(%|kg|lb|cm|mm)/i);
      expect(line.toLowerCase()).not.toContain('estimated growth');
    }
  });
});
