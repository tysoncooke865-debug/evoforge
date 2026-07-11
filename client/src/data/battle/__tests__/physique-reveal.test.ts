import { describe, expect, it } from 'vitest';

import { isFinal, revealReady, sideState, type MediaLite } from '../physique-reveal';

const media = (confidence: string, compliant = true): MediaLite => ({
  user_id: 'u',
  confidence,
  compliant,
  created_at: '2026-07-12T10:00:00',
});

describe('isFinal — mirrors battle-settle, in lockstep', () => {
  it('no submission is never final', () => {
    expect(isFinal([])).toBe(false);
  });
  it('a confident verdict is final on the first attempt', () => {
    expect(isFinal([media('high')])).toBe(true);
    expect(isFinal([media('medium')])).toBe(true);
  });
  it('a low verdict with a retake left is NOT final', () => {
    expect(isFinal([media('low')])).toBe(false);
  });
  it('two attempts exhaust the retake whatever the confidence', () => {
    expect(isFinal([media('low'), media('low')])).toBe(true);
  });
});

describe('revealReady — no first-mover disadvantage', () => {
  it('nothing reveals while either side may still retake', () => {
    expect(revealReady([media('high')], [media('low')], false)).toBe(false);
    expect(revealReady([media('high')], [], false)).toBe(false);
  });
  it('both final reveals; scoring reveals regardless', () => {
    expect(revealReady([media('high')], [media('medium')], false)).toBe(true);
    expect(revealReady([media('low')], [], true)).toBe(true);
  });
});

describe('sideState', () => {
  it('walks waiting → judging → locked → revealed', () => {
    expect(sideState([], false, false)).toBe('waiting');
    expect(sideState([], false, true)).toBe('judging');
    expect(sideState([media('high')], false, false)).toBe('locked');
    expect(sideState([media('high')], true, false)).toBe('revealed');
  });
  it('a non-compliant final verdict reveals as noncompliant', () => {
    expect(sideState([media('medium', false)], true, false)).toBe('noncompliant');
  });
});
