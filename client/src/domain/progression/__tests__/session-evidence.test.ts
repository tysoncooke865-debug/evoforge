import { describe, expect, it } from 'vitest';

import { evoEvidenceFor, evoEvidenceLabel } from '../session-evidence';

/**
 * The claim the mission card makes ("this session builds STRENGTH & SIZE") is
 * the only Evo statement Home is allowed to make in advance, so it is pinned:
 * a change here is a change to what the app promises about its own headline
 * number.
 */
describe('evoEvidenceFor', () => {
  it('a resistance session is Strength and Size evidence, in that order', () => {
    expect(evoEvidenceFor({ sets: 12, cardioMinutes: 0 })).toEqual(['strength', 'size']);
  });

  it('cardio alone is Cardio evidence only', () => {
    expect(evoEvidenceFor({ sets: 0, cardioMinutes: 30 })).toEqual(['cardio']);
  });

  it('a mixed session claims all three', () => {
    expect(evoEvidenceFor({ sets: 8, cardioMinutes: 20 })).toEqual(['strength', 'size', 'cardio']);
  });

  it('claims NOTHING when there is nothing to log', () => {
    expect(evoEvidenceFor({ sets: 0, cardioMinutes: 0 })).toEqual([]);
  });

  it('never claims Physique — that pillar moves on scans, never on a workout', () => {
    expect(evoEvidenceFor({ sets: 40, cardioMinutes: 90 })).not.toContain('aesthetics');
  });

  it('treats garbage input as no claim rather than a claim about NaN', () => {
    expect(evoEvidenceFor({ sets: Number.NaN, cardioMinutes: Number.NaN })).toEqual([]);
    expect(evoEvidenceFor({ sets: -3, cardioMinutes: -1 })).toEqual([]);
    expect(evoEvidenceFor({ sets: Number.POSITIVE_INFINITY, cardioMinutes: 0 })).toEqual([]);
  });

  it('a fractional set count still counts once it truncates to a whole set', () => {
    expect(evoEvidenceFor({ sets: 1.9, cardioMinutes: 0 })).toEqual(['strength', 'size']);
    expect(evoEvidenceFor({ sets: 0.9, cardioMinutes: 0 })).toEqual([]);
  });
});

describe('evoEvidenceLabel', () => {
  it('reads as a sentence fragment, not a list', () => {
    expect(evoEvidenceLabel(['strength', 'size'])).toBe('STRENGTH & SIZE');
    expect(evoEvidenceLabel(['strength', 'size', 'cardio'])).toBe('STRENGTH, SIZE & CARDIO');
  });

  it('one pillar needs no conjunction', () => {
    expect(evoEvidenceLabel(['cardio'])).toBe('CARDIO');
  });

  it('no pillars means no pill — never an empty one', () => {
    expect(evoEvidenceLabel([])).toBeNull();
  });
});
