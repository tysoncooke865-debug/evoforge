/**
 * Golden-fixture parity: the TS engine must reproduce every case in
 * contracts/fixtures/origin_candidates.json EXACTLY. Phase 3 replays the
 * same file against the production SQL engine — together they pin the
 * TS↔SQL twins (the glicko byte-pin philosophy at case granularity).
 *
 * Regenerate after any intentional engine change:
 *   node_modules/.bin/jiti scripts/gen-origin-fixtures.ts   (from client/)
 */

import { describe, expect, it } from 'vitest';

import fixtures from '../../../../../contracts/fixtures/origin_candidates.json';

import { generateCandidates } from '../candidates';
import type { CalibrationInput } from '../types';

interface FixtureCase {
  input: CalibrationInput;
  expected: ReturnType<typeof generateCandidates>;
}

describe('origin candidate goldens', () => {
  it('the fixture file is non-empty (a guard that cannot fail is not a guard)', () => {
    expect(Object.keys(fixtures.cases).length).toBeGreaterThanOrEqual(15);
    expect(fixtures.version).toBe(5);
  });

  for (const [name, c] of Object.entries(fixtures.cases) as [string, FixtureCase][]) {
    it(`case ${name}`, () => {
      expect(generateCandidates(c.input)).toEqual(c.expected);
    });
  }
});
