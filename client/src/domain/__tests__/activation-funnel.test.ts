import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_EVENT,
  ACTIVATION_STEPS,
  activationStepIndex,
  activationStepProps,
  isActivationComplete,
  parseActivationMarks,
  previousMarkAt,
  shouldEmitActivationStep,
  type ActivationMarks,
} from '../activation-funnel';

describe('activation funnel — the ladder', () => {
  it('is ordered, 1-based, and stable', () => {
    // The index is written into every row and read back by the funnel query.
    // Reordering this array silently rewrites history — pin it.
    expect(ACTIVATION_STEPS).toEqual([
      'home_reached',
      'train_opened',
      'workout_opened',
      'first_set_logged',
    ]);
    expect(activationStepIndex('home_reached')).toBe(1);
    expect(activationStepIndex('first_set_logged')).toBe(4);
    expect(ACTIVATION_EVENT).toBe('activation_step');
  });
});

describe('activation funnel — emit-once, then off forever', () => {
  it('emits a step the first time only', () => {
    expect(shouldEmitActivationStep({}, 'train_opened')).toBe(true);
    expect(shouldEmitActivationStep({ train_opened: 1_000 }, 'train_opened')).toBe(false);
  });

  it('still emits a DIFFERENT step once one is marked', () => {
    expect(shouldEmitActivationStep({ home_reached: 1_000 }, 'train_opened')).toBe(true);
  });

  it('switches the whole ladder off once the first set lands', () => {
    // The bound on write volume: four rows per athlete, lifetime.
    const done: ActivationMarks = { first_set_logged: 5_000 };
    expect(isActivationComplete(done)).toBe(true);
    for (const step of ACTIVATION_STEPS) {
      expect(shouldEmitActivationStep(done, step)).toBe(false);
    }
  });

  it('does not treat a missing terminal mark as complete', () => {
    expect(isActivationComplete({ home_reached: 1, train_opened: 2, workout_opened: 3 })).toBe(false);
  });
});

describe('activation funnel — props', () => {
  it('carries the step, its index and both elapsed times', () => {
    const props = activationStepProps('train_opened', { home_reached: 1_000 }, {
      now: 4_000,
      signupAtMs: 500,
    });
    expect(props).toMatchObject({
      step: 'train_opened',
      index: 2,
      ms_since_signup: 3_500,
      ms_since_prev_step: 3_000,
    });
  });

  it('reports unknown elapsed times as null, never as 0', () => {
    // 0 would read as "instant" in an average; null reads as "we don't know".
    const props = activationStepProps('home_reached', {}, { now: 4_000, signupAtMs: null });
    expect(props.ms_since_signup).toBeNull();
    expect(props.ms_since_prev_step).toBeNull();
  });

  it('refuses a negative duration from a backwards device clock', () => {
    const props = activationStepProps('home_reached', { home_reached: 9_000 }, {
      now: 4_000,
      signupAtMs: 8_000,
    });
    expect(props.ms_since_signup).toBeNull();
    expect(props.ms_since_prev_step).toBeNull();
  });

  it('merges the state the athlete found', () => {
    const props = activationStepProps('train_opened', {}, {
      now: 1,
      signupAtMs: null,
      extra: { has_plan: false, day_kind: 'rest' },
    });
    expect(props).toMatchObject({ has_plan: false, day_kind: 'rest', index: 2 });
  });

  it('measures from the LATEST mark, so a deep link stays meaningful', () => {
    // Athlete deep-links into a workout without passing Train: the baseline is
    // the last thing we actually saw, not the next-lowest index.
    const props = activationStepProps('workout_opened', { home_reached: 1_000, train_opened: 3_000 }, {
      now: 3_500,
      signupAtMs: null,
    });
    expect(props.ms_since_prev_step).toBe(500);
  });
});

describe('activation funnel — previousMarkAt', () => {
  it('is null with no marks and the max otherwise', () => {
    expect(previousMarkAt({})).toBeNull();
    expect(previousMarkAt({ home_reached: 10, workout_opened: 40, train_opened: 20 })).toBe(40);
  });
});

describe('activation funnel — persisted marks survive anything', () => {
  it('round-trips a real blob', () => {
    const marks: ActivationMarks = { home_reached: 1, train_opened: 2 };
    expect(parseActivationMarks(JSON.stringify(marks))).toEqual(marks);
  });

  it('yields {} for null, junk, wrong shapes and bad values', () => {
    // A corrupt mark must degrade to "emit again", never to a crash on boot.
    expect(parseActivationMarks(null)).toEqual({});
    expect(parseActivationMarks('not json')).toEqual({});
    expect(parseActivationMarks('[1,2,3]')).toEqual({});
    expect(parseActivationMarks('"a string"')).toEqual({});
    expect(parseActivationMarks('{"train_opened":"soon"}')).toEqual({});
    expect(parseActivationMarks('{"train_opened":0}')).toEqual({});
    expect(parseActivationMarks('{"unknown_step":123}')).toEqual({});
  });

  it('keeps the good keys from a partly-corrupt blob', () => {
    expect(parseActivationMarks('{"home_reached":42,"train_opened":null}')).toEqual({
      home_reached: 42,
    });
  });
});
