import { describe, expect, it } from 'vitest';

import { formatCompact } from '../format';

describe('formatCompact', () => {
  it('leaves sub-thousand values whole', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(7)).toBe('7');
    expect(formatCompact(225)).toBe('225');
    expect(formatCompact(999)).toBe('999');
  });

  it('abbreviates thousands at the boundary', () => {
    expect(formatCompact(1000)).toBe('1K');
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(13000)).toBe('13K'); // the doc's example
    expect(formatCompact(13120)).toBe('13.1K'); // the doc's example
  });

  it('trims the trailing .0', () => {
    expect(formatCompact(13040)).toBe('13K');
    expect(formatCompact(2000)).toBe('2K');
  });

  it('caps at 3 significant digits', () => {
    expect(formatCompact(131_200)).toBe('131K');
    expect(formatCompact(999_400)).toBe('999K');
  });

  it('carries rounding into the next unit', () => {
    expect(formatCompact(999_950)).toBe('1M');
    expect(formatCompact(1_250_000)).toBe('1.3M');
    expect(formatCompact(999_950_000)).toBe('1B');
  });

  it('handles negatives and garbage', () => {
    expect(formatCompact(-13120)).toBe('-13.1K');
    expect(formatCompact(Number.NaN)).toBe('0');
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
