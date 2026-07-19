import { describe, expect, it } from 'vitest';

import { currentBodyweightKg } from '../bodyweight-current';

describe('currentBodyweightKg — one chain everywhere (A6)', () => {
  it('latest positive log entry wins', () => {
    expect(currentBodyweightKg([{ bodyweight: 80 }, { bodyweight: 82.5 }], 90)).toBe(82.5);
  });
  it('skips trailing garbage/zero log rows to the last REAL reading', () => {
    expect(currentBodyweightKg([{ bodyweight: 81 }, { bodyweight: 0 }, { bodyweight: 'x' }], 90)).toBe(81);
  });
  it('empty log falls back to a positive profile weight', () => {
    expect(currentBodyweightKg([], 77.2)).toBe(77.2);
    expect(currentBodyweightKg(null, '77.2')).toBe(77.2);
  });
  it('nothing anywhere → null (callers own their defaults)', () => {
    expect(currentBodyweightKg([], null)).toBeNull();
    expect(currentBodyweightKg([{ bodyweight: 0 }], 0)).toBeNull();
    expect(currentBodyweightKg(undefined, undefined)).toBeNull();
  });
});
