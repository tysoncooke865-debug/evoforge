import { describe, expect, it } from 'vitest';

import {
  ineligibilityNote,
  trialCeiling,
  trialEligibility,
  type TrialAllowance,
  type TrialIneligibility,
} from '../forge-trial';

const planned = { added: false, skipped: false, target: 3 };
const at = (o: Partial<{ restDay: boolean; setsDone: number }> = {}) =>
  ({ restDay: false, setsDone: 0, ...o });

describe('only programmed work carries a Golden Dot (v5 §4)', () => {
  it('a planned exercise with sets left is eligible', () => {
    expect(trialEligibility(planned, at())).toEqual({ eligible: true, reason: null });
  });

  /**
   * AN ADDED EXERCISE IS STILL YOUR TRAINING (reported from production,
   * 2026-08-09: a mate added a lift and the Dot vanished).
   *
   * This used to assert the opposite, on the reasoning that the database has no
   * copy of a built-in split so only the client can know an exercise is ad-hoc.
   * True, and beside the point — the SERVER NEVER REFUSED IT. The client was not
   * mirroring a server rule, it was inventing one, and the only thing it achieved
   * was hiding a working feature from anyone who trains off-script.
   */
  it('an athlete-added exercise IS eligible', () => {
    expect(trialEligibility({ ...planned, added: true }, at()))
      .toEqual({ eligible: true, reason: null });
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
    const reasons: TrialIneligibility[] = ['rest-day', 'skipped', 'finished'];
    for (const r of reasons) {
      const note = ineligibilityNote(r);
      expect(note.length, r).toBeGreaterThan(0);
      // §3 and the physiotherapist test: never suggest making it eligible.
      expect(note.toLowerCase(), r).not.toMatch(/add |try |go for|instead you|why not/);
    }
  });
});

describe('the tray never offers what the server will refuse (trialCeiling)', () => {
  const allowance = (over: Partial<TrialAllowance>): TrialAllowance => ({
    max_stake: null,
    reason: null,
    message: '',
    ...over,
  });

  it('falls back to the wallet when the allowance has not loaded', () => {
    // "Unknown" must never render as "blocked" — that would hide a live feature
    // behind a slow query, and the server is still the authority either way.
    expect(trialCeiling(300, undefined)).toEqual({ max: 300, blocked: false, note: null });
    expect(trialCeiling(300, null)).toEqual({ max: 300, blocked: false, note: null });
  });

  it('treats a null ceiling as unbounded, NOT as zero', () => {
    // 170 removed the daily cap, so null is the ordinary case for a first pledge.
    // Reading it as 0 would refuse every opening pledge.
    const c = trialCeiling(240, allowance({ max_stake: null, message: 'Pledge whatever you can back.' }));
    expect(c.blocked).toBe(false);
    expect(c.max).toBe(240);
  });

  it('narrows to the ramp when the ramp is the smaller number, and says so', () => {
    const c = trialCeiling(400, allowance({ max_stake: 120, message: 'Up to 120 per pledge today.' }));
    expect(c.max).toBe(120);
    expect(c.blocked).toBe(false);
    expect(c.note).toBe('Up to 120 per pledge today.');
  });

  it('stays quiet when the wallet is the binding constraint', () => {
    // Quoting a 500 limit to someone holding 40 coins is noise dressed as information.
    const c = trialCeiling(40, allowance({ max_stake: 500, message: 'Up to 500 per pledge today.' }));
    expect(c.max).toBe(40);
    expect(c.note).toBeNull();
  });

  it('blocks outright on zero, and carries the reason', () => {
    // 178 removed the miss rule, so a rest day is now the live example of a hard
    // zero. The BEHAVIOUR under test is unchanged: 0 blocks and the server's own
    // sentence is what gets shown.
    const c = trialCeiling(400, allowance({
      max_stake: 0, reason: 'rest_day', message: 'Today is a rest day. Rest is part of the plan.',
    }));
    expect(c).toEqual({
      max: 0, blocked: true, note: 'Today is a rest day. Rest is part of the plan.',
    });
  });

  it('can only ever narrow — an allowance cannot raise the wallet ceiling', () => {
    expect(trialCeiling(50, allowance({ max_stake: 9999 })).max).toBe(50);
  });

  it('blocks when the wallet is empty even with room on the ramp', () => {
    expect(trialCeiling(0, allowance({ max_stake: 200 }))).toMatchObject({ max: 0, blocked: true });
  });
});
