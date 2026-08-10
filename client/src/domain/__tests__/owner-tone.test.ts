import { describe, expect, it } from 'vitest';

import { ownerTone } from '../forge-pool';

/**
 * OWNER IDENTIFICATION IS A COMPLIANCE REQUIREMENT, not decoration (§5: every
 * ingot in a shared pool identifies whose it is, "no anonymous tokens"). The tint
 * is derived from the user id, so these are the properties it must have.
 */
describe('owner tones identify a person, stably', () => {
  it('is stable for the same id', () => {
    // Across renders, across devices, across sessions — an ingot that changes
    // colour identifies nobody.
    const a = ownerTone('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1');
    expect(ownerTone('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1')).toBe(a);
  });

  it('separates the people who actually share a pool', () => {
    // Eight is the maximum (§4), and the two principals matter most. These are the
    // real smoke-account ids, so the assertion is about ids that co-occur.
    const ids = [
      '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1',
      '699ddb56-69b5-4070-854b-df73f578f19b',
      '493924db-0000-0000-0000-000000000000',
      'e95e773a-0000-0000-0000-000000000000',
    ];
    const tones = ids.map(ownerTone);
    expect(new Set(tones).size).toBeGreaterThanOrEqual(3);
  });

  it('always returns a real colour', () => {
    for (const id of ['', 'x', 'a-very-long-uuid-like-string-0000-1111']) {
      expect(ownerTone(id)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('never uses the side colours', () => {
    // success/danger already mean BACK/PUSH. A person tinted with a side colour
    // would read as being on the wrong pan.
    const sideColours = ['#34d399', '#fb7185'];
    for (let i = 0; i < 40; i++) {
      expect(sideColours).not.toContain(ownerTone(`user-${i}`).toLowerCase());
    }
  });
});
