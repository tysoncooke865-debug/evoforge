import { describe, expect, it } from 'vitest';

import {
  REFORGE_CYCLE_DAYS,
  reforgeCadence,
  reforgeOutcomeCopy,
} from '../progression/reforge-day';

const at = (anchor: string | null, last: string | null, today: string) =>
  reforgeCadence({ anchorIso: anchor, lastReforgeIso: last, todayIso: today });

describe('the 28-day clock', () => {
  it('does not start until the athlete has actually trained', () => {
    const c = at(null, null, '2026-08-05');
    expect(c.started).toBe(false);
    expect(c.due).toBe(false);
    expect(c.daysUntil).toBe(REFORGE_CYCLE_DAYS);
  });

  it('counts up to the first Reforge and comes due on day 28', () => {
    expect(at('2026-07-01', null, '2026-07-01').dayOfCycle).toBe(0);
    expect(at('2026-07-01', null, '2026-07-01').daysUntil).toBe(28);
    // 2026-07-27 is day 26 of the cycle — two to go.
    expect(at('2026-07-01', null, '2026-07-27').due).toBe(false);
    expect(at('2026-07-01', null, '2026-07-27').daysUntil).toBe(2);
    expect(at('2026-07-01', null, '2026-07-28').daysUntil).toBe(1);
    expect(at('2026-07-01', null, '2026-07-29').due).toBe(true);
    expect(at('2026-07-01', null, '2026-07-29').daysUntil).toBe(0);
  });

  it('is FORTNIGHTLY-proof: day 14 is not a Reforge Day', () => {
    expect(at('2026-07-01', null, '2026-07-15').due).toBe(false);
  });

  it('restarts from the last Reforge, not from the anchor', () => {
    // Reforged on day 28; the day after must not be due again.
    expect(at('2026-07-01', '2026-07-29', '2026-07-30').due).toBe(false);
    expect(at('2026-07-01', '2026-07-29', '2026-07-30').daysUntil).toBe(27);
    expect(at('2026-07-01', '2026-07-29', '2026-08-26').due).toBe(true);
  });

  it('numbers the cycles so the second Reforge knows it is the second', () => {
    expect(at('2026-07-01', null, '2026-07-29').cycleNumber).toBe(1);
    expect(at('2026-07-01', null, '2026-07-29').isFirst).toBe(true);
    const second = at('2026-07-01', '2026-07-29', '2026-08-26');
    expect(second.cycleNumber).toBe(2);
    expect(second.isFirst).toBe(false);
  });

  it('reviews a FULL 28 days even when the Reforge is opened late', () => {
    // 50 days since the anchor: the window is the last 28, not all 50.
    const late = at('2026-07-01', null, '2026-08-20');
    expect(late.due).toBe(true);
    expect(late.fromIso).toBe('2026-07-23');
  });

  it('survives a clock that has gone backwards instead of reporting a huge cycle', () => {
    const c = at('2026-08-05', null, '2026-08-01');
    expect(c.started).toBe(false);
    expect(c.due).toBe(false);
  });

  it('survives unparseable dates', () => {
    expect(at('not-a-date', null, '2026-08-05').due).toBe(false);
    expect(at('2026-07-01', 'rubbish', '2026-08-05').started).toBe(true);
  });
});

describe('the ceremony completes either way', () => {
  it('says so plainly when no photos were added', () => {
    const c = reforgeOutcomeCopy({ withPhotos: false, hasBaseline: false });
    expect(c.title).toBe('REFORGE COMPLETE');
    expect(c.body).toContain('training and performance data have been updated');
    expect(c.body).toContain('physique calibration was not refreshed');
  });

  it('never scolds, blocks or implies the Reforge failed', () => {
    for (const withPhotos of [true, false]) {
      for (const hasBaseline of [true, false]) {
        const c = reforgeOutcomeCopy({ withPhotos, hasBaseline });
        expect(c.title).toBe('REFORGE COMPLETE');
        expect(c.body.toLowerCase()).not.toContain('incomplete');
        expect(c.body.toLowerCase()).not.toContain('failed');
        expect(c.body.toLowerCase()).not.toContain('missing');
      }
    }
  });

  it('a first baseline is framed as the start of a comparison, not a catch-up', () => {
    const c = reforgeOutcomeCopy({ withPhotos: true, hasBaseline: false });
    expect(c.body).toContain('next Reforge can show visual change');
  });
});
