import { describe, expect, it } from 'vitest';

import { ROUTINE } from '../../domain/catalogs';
import { schemeSentence } from '../scheme-sentence';

describe('schemeSentence', () => {
  it('bare number', () => {
    expect(schemeSentence('8')).toBe('Aim for 8 reps');
  });
  it('range', () => {
    expect(schemeSentence('8-12')).toBe('Aim for 8–12 reps');
  });
  it('AMRAP', () => {
    expect(schemeSentence('AMRAP')).toBe('As many reps as possible');
  });
  it('anything else passes through verbatim', () => {
    const long = 'Top set 3-5 + 3 back-off sets 5-8';
    expect(schemeSentence(long)).toBe(long);
  });

  it('every scheme in the GENERATED catalog yields non-empty output', () => {
    // Pins against catalogs.ts without touching it. A guard that cannot
    // fail is not a guard: assert the catalog is non-empty first.
    const schemes = Object.values(ROUTINE).flatMap((day) => day.map(([, , scheme]) => scheme));
    expect(schemes.length).toBeGreaterThan(0);
    for (const s of schemes) {
      expect(schemeSentence(s).length).toBeGreaterThan(0);
    }
  });
});
