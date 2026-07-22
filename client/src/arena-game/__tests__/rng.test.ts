import { describe, expect, it } from 'vitest';
import { SeededRng, seedFromString } from '../game-engine/random/rng';

describe('SeededRng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new SeededRng(12345);
    const b = new SeededRng(12345);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays in [0, 1)', () => {
    const rng = new SeededRng(999);
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt respects inclusive bounds and covers the range', () => {
    const rng = new SeededRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('nextInt throws when max < min', () => {
    const rng = new SeededRng(1);
    expect(() => rng.nextInt(5, 4)).toThrow();
  });

  it('shuffle is deterministic per seed and does not mutate input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new SeededRng(7).shuffle(input);
    const b = new SeededRng(7).shuffle(input);
    expect(a).toEqual(b);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...a].sort((x, y) => x - y)).toEqual(input);
  });

  it('pick throws on empty array', () => {
    const rng = new SeededRng(1);
    expect(() => rng.pick([])).toThrow();
  });

  it('chance handles extremes', () => {
    const rng = new SeededRng(1);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });

  it('seedFromString is stable and uint32', () => {
    const s1 = seedFromString('player-abc');
    const s2 = seedFromString('player-abc');
    const s3 = seedFromString('player-abd');
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s1).toBeLessThanOrEqual(0xffffffff);
  });
});
