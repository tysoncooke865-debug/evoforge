import { describe, expect, it } from 'vitest';

import { BATTLE_OBJECTS, CARDIO_CHALLENGES } from '../engine';

/**
 * IMPROVEMENT_PLAN #4: round titles must render complete on a 320px phone.
 * ScreenHeader wraps battle titles to two lines and steps >14-char titles
 * down to text-2xl; at that size two lines hold 24 characters comfortably
 * at 320px. The catalogs are closed, so this pins every present AND future
 * entry to the rule — a new object with a marathon name fails here, not on
 * an athlete's phone.
 */
describe('battle titles fit the header rule', () => {
  const titles = [
    ...BATTLE_OBJECTS.map((o) => `LIFT THE ${o.name.toUpperCase()}`),
    ...CARDIO_CHALLENGES.map((c) => c.name.toUpperCase()),
  ];

  it('the catalogs are non-empty (a vacuous guard is not a guard)', () => {
    expect(titles.length).toBeGreaterThanOrEqual(12);
  });

  it.each(titles.map((t) => [t]))('"%s" fits within 24 characters', (title) => {
    expect(title.length).toBeLessThanOrEqual(24);
  });

  it('the size-step threshold catches the longest titles', () => {
    // >14 chars → text-2xl. The longest catalog titles must trip the step.
    const longest = titles.reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length).toBeGreaterThan(14);
  });
});
