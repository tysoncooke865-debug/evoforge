import { describe, expect, it } from 'vitest';

import {
  NO_TRAIN_DOOR,
  TRAIN_DOORS,
  TTI_CEILING_MS,
  deviceClass,
  deviceTier,
  interactiveOutcome,
  interactiveSpanMs,
  isHomeHandoff,
  reportedTrainDoor,
  type DeviceInput,
} from '../activation-tti';

/** Only the field under test needs stating; the rest read as "not reported". */
const device = (over: Partial<DeviceInput> = {}): DeviceInput => ({
  coarsePointer: null,
  maxTouchPoints: null,
  memoryGb: null,
  ...over,
});

describe('activation TTI — a span it can trust', () => {
  it('measures a plain span', () => {
    expect(interactiveSpanMs({ startedAt: 1_000, now: 3_400, hiddenDuringSpan: false })).toBe(2_400);
  });

  it('reports a genuinely instant span as 0, not as unknown', () => {
    // The funnel's "never 0" rule is about UNKNOWN. A warm cache that settled
    // inside the same millisecond really did take 0 ms, and reporting that as
    // null would delete every fast device from the average.
    expect(interactiveSpanMs({ startedAt: 1_000, now: 1_000, hiddenDuringSpan: false })).toBe(0);
  });

  it('accepts the span right up to the ceiling', () => {
    expect(
      interactiveSpanMs({ startedAt: 0, now: TTI_CEILING_MS, hiddenDuringSpan: false })
    ).toBe(TTI_CEILING_MS);
  });
});

describe('activation TTI — the refusals', () => {
  it('refuses a span that was never stamped', () => {
    // A cold boot or a deep link. Unknown, not instant.
    expect(interactiveSpanMs({ startedAt: null, now: 3_000, hiddenDuringSpan: false })).toBeNull();
  });

  it('refuses any span that touched a hidden document', () => {
    // THE nav-stall lesson (2026-07-25): 74.5% of every "freeze" that beacon
    // ever reported was a backgrounded tab's throttled timer. A span across a
    // hidden document measures the athlete's phone call, not this app.
    expect(interactiveSpanMs({ startedAt: 1_000, now: 3_000, hiddenDuringSpan: true })).toBeNull();
  });

  it('refuses a backwards device clock rather than reporting 0', () => {
    expect(interactiveSpanMs({ startedAt: 9_000, now: 4_000, hiddenDuringSpan: false })).toBeNull();
  });

  it('refuses anything past the ceiling — that is a suspended tab', () => {
    expect(
      interactiveSpanMs({ startedAt: 0, now: TTI_CEILING_MS + 1, hiddenDuringSpan: false })
    ).toBeNull();
    // 10 hours: iOS PWAs suspend without always firing pagehide.
    expect(
      interactiveSpanMs({ startedAt: 0, now: 36_000_000, hiddenDuringSpan: false })
    ).toBeNull();
  });

  it('refuses non-finite clocks', () => {
    expect(interactiveSpanMs({ startedAt: NaN, now: 1_000, hiddenDuringSpan: false })).toBeNull();
    expect(interactiveSpanMs({ startedAt: 1_000, now: Infinity, hiddenDuringSpan: false })).toBeNull();
  });
});

describe('activation TTI — the span only starts when onboarding hands off to Home', () => {
  it('starts on the Home hand-off', () => {
    expect(isHomeHandoff('/')).toBe(true);
  });

  it('refuses the routine builder — that tap was promised somewhere else', () => {
    // Act I step 6: BUILD MY OWN and SCAN MY PLAN land in the builder, so
    // `home_reached` fires however many minutes of plan-building later. A span
    // stamped for them reports HUMAN time as `ms_to_mount`, which is the exact
    // conflation this module exists to refuse — and it does it invisibly.
    expect(isHomeHandoff('/routine')).toBe(false);
    expect(isHomeHandoff('/routine?import=1')).toBe(false);
  });

  it('reads Home as Home even carrying a query or a hash', () => {
    // The destination is the path. A later '/?from=onboarding' must not turn
    // the stopwatch off by accident — silence is the failure mode that looks
    // identical to a fast app.
    expect(isHomeHandoff('/?from=onboarding')).toBe(true);
    expect(isHomeHandoff('/#top')).toBe(true);
  });

  it('refuses an empty or unrecognised destination rather than assuming Home', () => {
    // Same asymmetry as every rule above: a missed span costs one data point,
    // a false one poisons the only performance signal the app has.
    expect(isHomeHandoff('')).toBe(false);
    for (const href of ['/today', '/workout', '/onboarding', '/sign-in', '/fuel']) {
      expect(isHomeHandoff(href), href).toBe(false);
    }
  });
});

describe('activation TTI — phone or desktop, the split the work order names', () => {
  it('reads a coarse primary pointer as a phone', () => {
    expect(deviceClass(device({ coarsePointer: true }))).toBe('mobile');
  });

  it('reads a fine primary pointer as a desktop', () => {
    expect(deviceClass(device({ coarsePointer: false }))).toBe('desktop');
  });

  it('calls a TOUCH-SCREEN LAPTOP a desktop, unlike pad-env', () => {
    // The whole reason the media query takes precedence instead of being ORed
    // with the touch count (ui/core/pad-env.ts does OR them, for a decision
    // where a false positive is just a spurious keypad). A desktop filed as a
    // phone moves the percentile this work order is judged on.
    expect(deviceClass(device({ coarsePointer: false, maxTouchPoints: 10 }))).toBe('desktop');
  });

  it('falls back to the digitiser only when there is no media query', () => {
    expect(deviceClass(device({ maxTouchPoints: 5 }))).toBe('mobile');
    expect(deviceClass(device({ maxTouchPoints: 0 }))).toBe('desktop');
  });

  it('refuses rather than guessing when nothing is reported', () => {
    // A native build, or a test with no DOM. `unknown` is filterable; a wrong
    // guess is not distinguishable from a real reading afterwards.
    expect(deviceClass(device())).toBe('unknown');
  });
});

describe('activation TTI — the mid-range half', () => {
  it('buckets the deviceMemory spec values', () => {
    // The thresholds ARE the spec buckets (0.25|0.5|1|2|4|8) — nothing invented
    // here. 4 GiB is where a mid-range phone lands.
    expect(deviceTier(device({ memoryGb: 4 }))).toBe('mid');
    expect(deviceTier(device({ memoryGb: 8 }))).toBe('high');
    for (const gb of [0.25, 0.5, 1, 2]) {
      expect(deviceTier(device({ memoryGb: gb })), String(gb)).toBe('low');
    }
  });

  it('is unknown wherever the browser does not report it', () => {
    // iOS Safari and Firefox never do. `device_class` still splits phone from
    // desktop there, which is the question that was actually asked — inferring
    // a tier from core counts instead would call an iPhone low-end.
    expect(deviceTier(device())).toBe('unknown');
  });

  it('refuses nonsense rather than bucketing it', () => {
    for (const bad of [0, -4, NaN, Infinity]) {
      expect(deviceTier(device({ memoryGb: bad })), String(bad)).toBe('unknown');
    }
  });
});

describe('activation TTI — which door the hand-off came through', () => {
  it('files each of the three doors under its own name', () => {
    // They stamp ONE span on purpose, but they are not one population: the tab
    // belongs to an athlete with a plan, TRAIN ANYWAY only renders on a rest
    // day, QUICK WORKOUT only with no plan. Pooled, one percentile covers all
    // three — the `device_class` failure, one dimension over.
    for (const door of TRAIN_DOORS) expect(reportedTrainDoor(door), door).toBe(door);
    // The set itself is the contract the SQL reads — adding a door without
    // updating docs/ACTIVATION_ANALYTICS.md should go red here.
    expect([...TRAIN_DOORS]).toEqual(['tab', 'home_rest', 'home_quick']);
  });

  it('reports no press at all as `none`, which is a reading and not a gap', () => {
    // A deep link, a cold boot straight into Train, the mid-workout resume
    // redirect. This is the prop that separates a REFUSED span from one that was
    // never started: both report `ms_to_interactive` null, and until now they
    // landed in the same bucket. A door with a null span is a refusal.
    expect(reportedTrainDoor(null)).toBe(NO_TRAIN_DOOR);
    expect(reportedTrainDoor(undefined)).toBe(NO_TRAIN_DOOR);
    expect(reportedTrainDoor('')).toBe(NO_TRAIN_DOOR);
  });

  it('refuses a door it does not recognise rather than passing it through', () => {
    // Same asymmetry as every other rule here: a door invented by a future
    // caller would be indistinguishable from a real one in the column, and the
    // whole value of the column is that each bucket means exactly one thing.
    for (const bad of ['home', 'Tab', 'mission-quick', 'workout']) {
      expect(reportedTrainDoor(bad), bad).toBe(NO_TRAIN_DOOR);
    }
    // `none` is the ABSENCE bucket, so it must never also be a door — a door
    // that collided with it would make "never pressed" unreadable.
    expect((TRAIN_DOORS as readonly string[]).includes(NO_TRAIN_DOOR)).toBe(false);
  });
});

describe('activation TTI — a screen that errored never became interactive', () => {
  it('measures once the screen has settled', () => {
    expect(interactiveOutcome({ interactive: true, failed: false })).toBe('measure');
  });

  it('waits while it is still settling', () => {
    expect(interactiveOutcome({ interactive: false, failed: false })).toBe('pending');
  });

  it('REFUSES a screen whose queries failed, even though it stopped loading', () => {
    // Home's `missionLoading` goes false when its four queries fail as surely as
    // when they succeed, and what renders then is a RETRY card. Timing that and
    // filing it as time-to-interactive reports a BROKEN Home as a fast one — the
    // flattering number this module exists to refuse, aimed at the athlete on the
    // bad connection the work order is about.
    expect(interactiveOutcome({ interactive: true, failed: true })).toBe('refuse');
    expect(interactiveOutcome({ interactive: false, failed: true })).toBe('refuse');
  });

  it('never reports `measure` for a failure, so a caller cannot park a number', () => {
    // The refusal is FINAL for the mount, and this is the half that is easy to
    // get wrong: waiting for the error to clear looks right, but the RETRY card
    // needs a TAP, so a late measurement would fold the athlete's own decision
    // time into a span built to keep human time out of the number. There is no
    // honest reading available after an error — only null.
    for (const interactive of [true, false]) {
      expect(interactiveOutcome({ interactive, failed: true }), String(interactive)).not.toBe(
        'measure'
      );
    }
  });
});

describe('activation TTI — the ceiling is the work order window', () => {
  it('is 60 seconds', () => {
    // "the first 60 seconds after onboarding completes" (WO-006). Changing it
    // changes what every historical row meant — pin it.
    expect(TTI_CEILING_MS).toBe(60_000);
  });
});
