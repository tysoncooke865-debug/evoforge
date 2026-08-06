import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE WORDS THE APP IS ALLOWED TO SAY (Tyson, 2026-08-06).
 *
 * Two separate complaints, one root cause — the same thing called different
 * names on different screens:
 *
 *   "Rename Reforge Day consistently. Replace all user-facing uses of Evo
 *    Review, EvoGuide, Review where it refers to this same event."
 *
 *   "The app currently shows contradictory-looking values such as LV.1,
 *    Level 35, and Level 35 → 36. Never show a standalone ambiguous LV.
 *    unless the label identifies which progression system it belongs to."
 *
 * A one-off grep fixes it today and it drifts back next week. This scans the
 * shipped source on every run.
 *
 * INTERNAL NAMES ARE DELIBERATELY EXEMPT. `useRunEvoReview`, `evo-review.ts`,
 * `evoReviewsEnabled` and `next_review_at` are the ENGINE — renaming a hook, a
 * module or a database column to fix a caption is how you break stored records
 * to win an argument about vocabulary. Only strings an athlete can read count.
 */

const SRC = path.resolve(__dirname, '../..');

/** Files a user can see the output of. src/lab is the Dev Lab harness. */
function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'lab') continue;
      shippedFiles(full, out);
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so the ban applies to COPY, not to the notes explaining it. */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = shippedFiles(SRC);

describe('the shipped source is scanned at all', () => {
  it('found the screens — an empty sweep would pass every ban below', () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.endsWith(path.join('(main)', 'reforge.tsx')))).toBe(true);
  });
});

describe('retired names never reach an athlete', () => {
  const RETIRED = [
    { term: 'EvoGuide', why: 'retired 2026-08-06 — the feature is Reforge Day' },
    { term: 'Evo Review', why: 'the athlete-facing event is Reforge Day; the engine has no name' },
    { term: 'EVO REVIEW', why: 'the athlete-facing event is Reforge Day; the engine has no name' },
  ];

  for (const { term, why } of RETIRED) {
    it(`"${term}" appears in no user-facing string (${why})`, () => {
      const offenders: string[] = [];
      for (const file of FILES) {
        const code = codeWithoutComments(fs.readFileSync(file, 'utf8'));
        if (code.includes(term)) offenders.push(path.relative(SRC, file));
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe('no ambiguous level label', () => {
  /**
   * "LV." on its own is the complaint: LV.1 beside Level 35 beside
   * Level 35 → 36 reads like three broken numbers instead of three different
   * progression systems. A level must say WHICH system it belongs to —
   * FORGE LV. 35 is fine, LV.35 is not.
   */
  const QUALIFIERS = ['FORGE', 'Forge', 'EVOLUTION', 'Evolution', 'RIVAL', 'Rival'];

  it('every "LV." in shipped copy is qualified by its progression system', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = codeWithoutComments(fs.readFileSync(file, 'utf8'));
      for (const line of code.split('\n')) {
        if (!/\bLV\.?\s*\{?/i.test(line)) continue;
        if (!/LV\./i.test(line)) continue;
        if (QUALIFIERS.some((q) => line.includes(q))) continue;
        offenders.push(`${path.relative(SRC, file)}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the duplicated-denominator bug', () => {
  /**
   * Tyson: "Never render duplicated formats such as `46 / 100 /100`." That
   * shape comes from a value that ALREADY carries its denominator being
   * dropped into a template that adds one.
   */
  /**
   * The signature is a REPEATED denominator: `… / 100 /100`. The first
   * fraction is spaced (it was formatted), the second is jammed on (a caller
   * appended it). A weighting ratio like `40/30/30` is unspaced throughout and
   * is NOT this bug — requiring the whitespace is what tells them apart.
   */
  const DOUBLED = /\/\s*(\d+)\s+\/\s*(\d+)(?!\d)/;

  it('the pattern recognises the reported bug and spares a weighting ratio', () => {
    expect(DOUBLED.test('46 / 100 /100')).toBe(true);
    expect(DOUBLED.test('40/30/30 with bench and squat')).toBe(false);
    expect(DOUBLED.test('16 / 200 sets')).toBe(false);
  });

  it('no shipped template renders a doubled denominator', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const code = codeWithoutComments(fs.readFileSync(file, 'utf8'));
      for (const line of code.split('\n')) {
        if (DOUBLED.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
