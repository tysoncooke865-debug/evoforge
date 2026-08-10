import { describe, expect, it } from 'vitest';

import { REST_LINGER_SECONDS, restAlarmBody, restClockView } from '../rest-clock';

/**
 * §13 / §25 — THE REST CLOCK'S ARITHMETIC.
 *
 * The whole point of the design is that remaining time is DERIVED from two
 * absolute instants, so there is no state that can drift while the app is
 * suspended and nothing to resynchronise on resume. That claim is only worth
 * anything if it is tested the way it is used: by moving `now`, not by
 * pretending a JS interval kept running.
 *
 * So every case below is "the clock said X, the phone came back at time T,
 * what should the athlete see" — including the case the old implementation
 * got wrong, which is opening the app long after a rest ended.
 */

const at = (endAt: number | null, isActive = true) => ({ isActive, endAt });
const T0 = 1_700_000_000_000; // an arbitrary fixed instant; nothing here uses Date.now()

describe('restClockView', () => {
  it('shows nothing when no rest is running', () => {
    expect(restClockView(at(null, false), T0)).toBeNull();
    expect(restClockView(at(T0 + 60_000, false), T0)).toBeNull();
    expect(restClockView(at(null, true), T0)).toBeNull();
  });

  it('counts down from an absolute end instant', () => {
    const end = T0 + 120_000;
    expect(restClockView(at(end), T0)).toMatchObject({ remaining: 120, over: false, mm: 2, ss: '00' });
    expect(restClockView(at(end), T0 + 45_000)).toMatchObject({ remaining: 75, mm: 1, ss: '15' });
    expect(restClockView(at(end), T0 + 119_000)).toMatchObject({ remaining: 1, mm: 0, ss: '01' });
  });

  it('SURVIVES A SUSPENSION BY CONSTRUCTION — no ticks needed', () => {
    // The phone was locked for ninety seconds. Nothing ran. The answer is
    // still exactly right, because it was never a counter.
    const end = T0 + 120_000;
    expect(restClockView(at(end), T0 + 90_000)).toMatchObject({ remaining: 30, mm: 0, ss: '30' });
  });

  it('goes over at zero and lingers so REST OVER is seen', () => {
    const end = T0 + 120_000;
    expect(restClockView(at(end), end)).toMatchObject({ over: true, expired: false });
    expect(restClockView(at(end), end + 1000)).toMatchObject({ over: true, expired: false });
    expect(restClockView(at(end), end + (REST_LINGER_SECONDS - 1) * 1000)?.expired).toBe(false);
  });

  it('EXPIRES rather than showing a stale REST OVER from breakfast', () => {
    // Reopening the app an hour later must show no timer at all. The old
    // implementation's linger check ran only while a subscriber was mounted
    // and ticking, so a long suspension came back to "REST OVER".
    const end = T0 + 120_000;
    expect(restClockView(at(end), end + REST_LINGER_SECONDS * 1000)?.expired).toBe(true);
    expect(restClockView(at(end), end + 3_600_000)?.expired).toBe(true);
  });

  it('never renders a negative clock face', () => {
    const end = T0 + 120_000;
    const v = restClockView(at(end), end + 3000);
    expect(v?.mm).toBe(0);
    expect(v?.ss).toBe('00');
  });

  it('pads the seconds so the readout never jumps width', () => {
    const end = T0 + 65_000;
    expect(restClockView(at(end), T0)?.ss).toBe('05');
  });
});

describe('the alarm copy', () => {
  it('is short, and names what is next when it knows', () => {
    expect(restAlarmBody(null)).toBe('Rest complete. Time for your next set.');
    expect(restAlarmBody('Incline DB Press')).toBe('Rest complete. Next: Incline DB Press.');
  });
});
