import { describe, expect, it } from 'vitest';

import { ineligibilityNote, trialEligibility, type TrialIneligibility } from '../forge-trial';

const planned = { added: false, skipped: false, target: 3 };
const at = (o: Partial<{ restDay: boolean; setsDone: number }> = {}) =>
  ({ restDay: false, setsDone: 0, ...o });

describe('only programmed work carries a Golden Dot (v5 §4)', () => {
  it('a planned exercise with sets left is eligible', () => {
    expect(trialEligibility(planned, at())).toEqual({ eligible: true, reason: null });
  });

  /**
   * THE CHECK THE SERVER CANNOT MAKE. Migration 163 enforces rest days, the
   * scheduled workout and above-program loads — but the database has no copy of a
   * built-in split's exercise list, so "is this exercise in the plan at all" is the
   * client's to answer. If this is wrong, an ad-hoc stunt set gets a Dot.
   */
  it('an athlete-added exercise is NOT eligible', () => {
    expect(trialEligibility({ ...planned, added: true }, at()))
      .toEqual({ eligible: false, reason: 'ad-hoc' });
  });

  it('a rest day beats everything else', () => {
    // Even a perfectly planned exercise. Rest is a mechanic, not an absence.
    expect(trialEligibility(planned, at({ restDay: true })).reason).toBe('rest-day');
    expect(trialEligibility({ ...planned, added: true }, at({ restDay: true })).reason)
      .toBe('rest-day');
  });

  it('a skipped exercise is not eligible', () => {
    expect(trialEligibility({ ...planned, skipped: true }, at()).reason).toBe('skipped');
    // target 0 is the same state by another route
    expect(trialEligibility({ ...planned, target: 0 }, at()).reason).toBe('skipped');
  });

  it('a finished exercise has nothing left to pledge on', () => {
    expect(trialEligibility(planned, at({ setsDone: 3 })).reason).toBe('finished');
    expect(trialEligibility(planned, at({ setsDone: 4 })).reason).toBe('finished');
    // …but one set short is still eligible
    expect(trialEligibility(planned, at({ setsDone: 2 })).eligible).toBe(true);
  });

  it('every reason has a note, and none of them solicit', () => {
    const reasons: TrialIneligibility[] = ['rest-day', 'ad-hoc', 'skipped', 'finished'];
    for (const r of reasons) {
      const note = ineligibilityNote(r);
      expect(note.length, r).toBeGreaterThan(0);
      // §3 and the physiotherapist test: never suggest making it eligible.
      expect(note.toLowerCase(), r).not.toMatch(/add |try |go for|instead you|why not/);
    }
  });
});
