import { describe, expect, it } from 'vitest';

import { formatFraction, pathGuidance, type PathNodeLike } from '../path-guidance';

/**
 * FORGE CLARITY (Tyson, 2026-08-06): "Every path should display current
 * progress, the next actionable requirement, how the user can improve it, and
 * which exercises or measurements contribute" — plus "use `46 / 100`, use
 * `16 / 200 sets`, never render duplicated formats such as `46 / 100 /100`."
 */

const node = (over: Partial<PathNodeLike>): PathNodeLike => ({
  name: 'Bench Press',
  current: 76,
  target: 87.5,
  unit: 'kg',
  pct: 76 / 87.5,
  nextAction: 'Log heavier or higher-rep bench sets on Today.',
  ...over,
});

describe('formatFraction', () => {
  it('is `46 / 100` for a bare count', () => {
    expect(formatFraction(46, 100)).toBe('46 / 100');
  });

  it('is `16 / 200 sets` when a unit is given', () => {
    expect(formatFraction(16, 200, 'sets')).toBe('16 / 200 sets');
  });

  it('THE BUG: the unit rides WITH the fraction, so /100 cannot be doubled', () => {
    // `46 / 100 /100` came from a caller appending its own denominator to a
    // string that already had one. There is now nowhere to append it.
    expect(formatFraction(46, 100, '%')).toBe('46 / 100 %');
    expect(formatFraction(46, 100)).not.toContain('/100');
  });

  it('never shows a trailing .0', () => {
    expect(formatFraction(80.0, 87.5, 'kg')).toBe('80 / 87.5 kg');
    expect(formatFraction(76.04, 100)).toBe('76 / 100');
  });

  it('an untracked value is an em-dash, never a zero', () => {
    // Rendering 0 would claim the athlete measured zero, not that nothing
    // has been measured.
    expect(formatFraction(null, 50, 'km total')).toBe('— / 50 km total');
  });

  it('is idempotent for the same inputs', () => {
    expect(formatFraction(46, 100, 'sets')).toBe(formatFraction(46, 100, 'sets'));
  });
});

describe('pathGuidance', () => {
  it('reads like the brief: percentage, then the next action', () => {
    const g = pathGuidance(56, [node({}), node({ name: 'Squat', current: 140, target: 150, pct: 0.93 })]);
    expect(g.headline).toBe('56% complete');
    expect(g.measure).toBe('Bench Press · 76 / 87.5 kg');
    expect(g.action).toBe('Log heavier or higher-rep bench sets on Today.');
  });

  it('focuses the node FURTHEST from its target — where effort pays most', () => {
    const g = pathGuidance(50, [
      node({ name: 'Squat', current: 140, target: 150, pct: 0.93 }),
      node({ name: 'Deadlift', current: 60, target: 200, pct: 0.3 }),
    ]);
    expect(g.focus?.name).toBe('Deadlift');
  });

  it('a completed node is never the next action', () => {
    const g = pathGuidance(90, [
      node({ name: 'Squat', current: 200, target: 150, pct: 1 }),
      node({ name: 'Deadlift', current: 60, target: 200, pct: 0.3 }),
    ]);
    expect(g.focus?.name).toBe('Deadlift');
  });

  it('every node complete: no action to invent', () => {
    const g = pathGuidance(100, [node({ pct: 1 }), node({ name: 'Squat', pct: 1 })]);
    expect(g.focus).toBeNull();
    expect(g.action).toBeNull();
    expect(g.headline).toBe('100% complete');
  });

  it('a tracked node outranks an untracked one', () => {
    // "Set your deadlift e1RM in Profile" is a real action, but it must not
    // outrank "you are 30% of the way to the bench standard".
    const g = pathGuidance(30, [
      node({ name: 'Military Press', current: null, pct: null, untrackedHint: 'Not in the catalog yet.' }),
      node({ name: 'Bench Press', current: 60, target: 200, pct: 0.3 }),
    ]);
    expect(g.focus?.name).toBe('Bench Press');
    expect(g.untracked).toBe(false);
  });

  it('an untracked node is offered once everything tracked is done', () => {
    const g = pathGuidance(75, [
      node({ pct: 1 }),
      node({
        name: 'Deadlift',
        current: null,
        pct: null,
        untrackedHint: 'Set your deadlift e1RM in Profile to light this node.',
      }),
    ]);
    expect(g.untracked).toBe(true);
    expect(g.measure).toBeNull(); // no number to show — saying "— / 200" here helps nobody
    expect(g.action).toBe('Set your deadlift e1RM in Profile to light this node.');
  });

  it('rounds the headline, never invents precision', () => {
    expect(pathGuidance(56.4, [node({})]).headline).toBe('56% complete');
    expect(pathGuidance(0, [node({})]).headline).toBe('0% complete');
  });

  it('an empty path does not crash', () => {
    const g = pathGuidance(0, []);
    expect(g.focus).toBeNull();
    expect(g.headline).toBe('0% complete');
  });
});
