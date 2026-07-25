/**
 * ACTIVATION EMITTER — the TTI wiring (WO-006, docs/ACTIVATION_ANALYTICS.md).
 *
 * The refusal RULES are pinned in domain/__tests__/activation-tti.test.ts. What
 * is pinned here is the wiring those rules need and a pure test cannot see:
 * which step carries which span, that a step never carries a span it did not
 * measure, and that a caller's own `extra` still wins. This matters because the
 * whole point of the work order is that the number is readable in two weeks —
 * a prop silently emitted as null for everyone would look exactly like a fast
 * app, which is the failure mode the nav-stall beacon already shipped once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTIVATION_SPAN,
  activationSpanMs,
  clearActivationMarks,
  markActivationStep,
  noteActivationSpan,
  readActivationSpan,
  startActivationSpan,
  startActivationSpanOnce,
  startTrainHandoff,
} from '../activation';

const tracked: { name: string; props: Record<string, unknown> }[] = [];
vi.mock('../analytics', () => ({
  track: (name: string, props: Record<string, unknown>) => {
    tracked.push({ name, props });
  },
}));

// The hook half needs an auth session; the functions under test do not.
vi.mock('../auth-context', () => ({ useAuth: () => ({ session: null }) }));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    getAllKeys: async () => Array.from(store.keys()),
    multiRemove: async (ks: string[]) => void ks.forEach((k) => store.delete(k)),
  },
}));

const USER = 'u-1';
const lastProps = () => tracked[tracked.length - 1].props;

beforeEach(async () => {
  tracked.length = 0;
  store.clear();
  await clearActivationMarks();
});

describe('activation emitter — the hand-off stopwatch', () => {
  it('carries onboarding -> Home on home_reached', async () => {
    vi.useFakeTimers();
    try {
      startActivationSpan(ACTIVATION_SPAN.home);
      vi.advanceTimersByTime(2_400);
      await markActivationStep(USER, null, 'home_reached');
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps().ms_to_mount).toBe(2_400);
  });

  it('carries BOTH halves of the hand-off on train_opened', async () => {
    vi.useFakeTimers();
    try {
      startActivationSpan(ACTIVATION_SPAN.home);
      vi.advanceTimersByTime(3_000);
      // 'home_interactive' is the parking key useHomeInteractive() writes.
      // Spelled out rather than exported on purpose: renaming it changes what
      // `ms_home_to_interactive` means, and this line should go red when it does.
      noteActivationSpan('home_interactive', ACTIVATION_SPAN.home);
      startActivationSpan(ACTIVATION_SPAN.train);
      vi.advanceTimersByTime(1_250);
      await markActivationStep(USER, null, 'train_opened', { day_kind: 'workout' });
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps()).toMatchObject({
      ms_to_interactive: 1_250,
      ms_home_to_interactive: 3_000,
      day_kind: 'workout',
    });
  });

  it('reports an unstamped span as null, never as 0', async () => {
    // A cold boot never passes through onboarding's stamp. The funnel's own
    // rule: unknown is null, because a 0 drags the average down silently.
    await markActivationStep(USER, null, 'home_reached');
    expect(lastProps().ms_to_mount).toBeNull();
  });

  it('reports Train reached WITHOUT a tab press as null, not as instant', async () => {
    // The span is stamped by the Train tab's `tabPress` listener
    // ((main)/_layout.tsx), never by the screen itself: focus arrives after the
    // chunk fetch and the first render, so a focus-stamped span would hide the
    // slowest part of the hand-off and read ~0 ms no matter how slow the phone.
    // The cost of that choice is this case — a deep link or a cold boot
    // straight into Train never presses the tab — and it must read as UNKNOWN.
    // A 0 here would quietly drag the fleet average toward "we are fast".
    await markActivationStep(USER, null, 'train_opened', { day_kind: 'workout' });
    expect(lastProps().ms_to_interactive).toBeNull();
    expect(lastProps().day_kind).toBe('workout');
  });

  it('files the hand-off under a device, or the percentile is unreadable', async () => {
    // The work order asks for the hand-off "on a real mid-range phone, not a
    // desktop browser", and track() attaches nothing of its own — so without
    // these two the re-measure pools a desktop and a mid-range Android into one
    // percentile. Both must be PRESENT on the event that carries the spans;
    // what they read is the pure module's business (activation-tti.test.ts).
    startActivationSpan(ACTIVATION_SPAN.train);
    await markActivationStep(USER, null, 'train_opened');
    expect(lastProps()).toHaveProperty('device_class');
    expect(lastProps()).toHaveProperty('device_tier');
    // Node has a `navigator` but no matchMedia/maxTouchPoints/deviceMemory —
    // the same shape a native build presents, and it must refuse, not guess.
    expect(lastProps().device_class).toBe('unknown');
    expect(lastProps().device_tier).toBe('unknown');
  });

  it('files the HOME half under a device too — it is the only row the lost athletes write', async () => {
    // The whole cohort this work order is about reaches Home and stops. They
    // emit `home_reached` and nothing else, so a device that rides only
    // `train_opened` describes every athlete EXCEPT the ones being lost, and
    // `ms_to_mount` — their one span — pools a desktop with a mid-range Android.
    // That is the same failure the dimension was added to prevent.
    startActivationSpan(ACTIVATION_SPAN.home);
    await markActivationStep(USER, null, 'home_reached');
    expect(lastProps()).toHaveProperty('device_class');
    expect(lastProps()).toHaveProperty('device_tier');
  });

  it('gives the other two steps no TTI props at all', async () => {
    // They have no hand-off to describe; an always-null column reads as a
    // broken measurement rather than as an absent one. The device buckets go
    // with the spans for the same reason — every athlete's device is already
    // readable off their step-1 row, joined on user_id.
    await markActivationStep(USER, null, 'workout_opened');
    expect(lastProps()).not.toHaveProperty('ms_to_interactive');
    expect(lastProps()).not.toHaveProperty('ms_to_mount');
    expect(lastProps()).not.toHaveProperty('device_class');
    expect(lastProps()).not.toHaveProperty('device_tier');
  });

  it('measures a hand-off that came through HOME, not only through the tab', async () => {
    // `router.push('/today')` raises no `tabPress`, so Home's own TRAIN ANYWAY
    // (rest day) and QUICK WORKOUT (no plan) doors used to reach Train with the
    // stopwatch never started and report null. Both now stamp through the same
    // `startTrainHandoff` the tab listener uses — one definition, because the
    // doors have to agree about what the number means.
    vi.useFakeTimers();
    try {
      startTrainHandoff('home_rest');
      vi.advanceTimersByTime(2_100);
      await markActivationStep(USER, null, 'train_opened');
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps().ms_to_interactive).toBe(2_100);
  });

  it('names the door the span came through — three doors are three populations', async () => {
    // The three doors share ONE span definition on purpose, but they are not one
    // athlete: the tab is pressed by someone with a plan and a schedule, TRAIN
    // ANYWAY is only rendered on a REST DAY and QUICK WORKOUT only with NO PLAN.
    // The mission-card pair started reporting spans that used to be null, so
    // without this prop the percentile absorbed a new population mid-flight and
    // the only advice available was "guess".
    startTrainHandoff('home_quick');
    await markActivationStep(USER, null, 'train_opened');
    expect(lastProps().handoff_door).toBe('home_quick');
  });

  it('reports `none` when nothing pressed, so a REFUSAL is not read as an absence', async () => {
    // `ms_to_interactive` is null both for a refused span (hidden tab, backwards
    // clock, past the ceiling) and for an athlete who arrived without a press at
    // all (deep link, cold boot, the mid-workout resume redirect). Those are
    // different facts about the app; the door is what tells them apart.
    await markActivationStep(USER, null, 'train_opened');
    expect(lastProps().ms_to_interactive).toBeNull();
    expect(lastProps().handoff_door).toBe('none');
  });

  it('carries the LAST door, because the span belongs to the last press', async () => {
    // Train's span is re-stampable on purpose — a second visit is a second
    // hand-off. The door has to move with it, or a hand-off is filed under a
    // press that did not produce it.
    startTrainHandoff('home_rest');
    startTrainHandoff('tab');
    await markActivationStep(USER, null, 'train_opened');
    expect(lastProps().handoff_door).toBe('tab');
  });

  it('gives the other steps no door — it describes the Train span only', async () => {
    await markActivationStep(USER, null, 'home_reached');
    expect(lastProps()).not.toHaveProperty('handoff_door');
  });

  it('lets a caller-supplied prop win over a measured one', async () => {
    startActivationSpan(ACTIVATION_SPAN.train);
    await markActivationStep(USER, null, 'train_opened', { ms_to_interactive: 42 });
    expect(lastProps().ms_to_interactive).toBe(42);
  });

  it('refuses to restart the hand-off span, so a second tap cannot shorten it', async () => {
    // ENTER THE FORGE hands off to a profile refetch onboarding.tsx must await
    // before it can navigate — an unchanged screen for the length of a round
    // trip. An athlete who taps again inside that gap would, under a plain
    // re-stamp, be measured from the SECOND tap. The error runs one way: the
    // slower the hand-off, the likelier the extra tap, so it would shorten
    // exactly the long spans this rail exists to see.
    vi.useFakeTimers();
    try {
      startActivationSpanOnce(ACTIVATION_SPAN.home);
      vi.advanceTimersByTime(600);
      startActivationSpanOnce(ACTIVATION_SPAN.home); // the impatient second tap
      vi.advanceTimersByTime(500);
      await markActivationStep(USER, null, 'home_reached');
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps().ms_to_mount).toBe(1_100); // from the FIRST tap, not 500
  });

  it('still lets the Train span restart — a second visit IS a second hand-off', async () => {
    // The once-only rule is the hand-off's, not the API's: Train is re-entered
    // all day and the last press before the event is the one that describes
    // what the athlete just waited for.
    vi.useFakeTimers();
    try {
      startActivationSpan(ACTIVATION_SPAN.train);
      vi.advanceTimersByTime(4_000);
      startActivationSpan(ACTIVATION_SPAN.train);
      vi.advanceTimersByTime(700);
      await markActivationStep(USER, null, 'train_opened');
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps().ms_to_interactive).toBe(700);
  });
});

describe('activation emitter — spans go with every other cache on sign-out', () => {
  it('drops stamped and measured spans alike', async () => {
    startActivationSpan(ACTIVATION_SPAN.train);
    noteActivationSpan('home_interactive', ACTIVATION_SPAN.train);
    expect(readActivationSpan('home_interactive')).not.toBeNull();

    await clearActivationMarks();

    // A span started by the last athlete must never be measured against the
    // next one's first screen.
    expect(activationSpanMs(ACTIVATION_SPAN.train)).toBeNull();
    expect(readActivationSpan('home_interactive')).toBeNull();
  });

  it('drops the door with the span it described', async () => {
    // A door that outlived its span would file the NEXT athlete's arrival under
    // the last one's press — a row that reads like a measured hand-off and is
    // not one. It goes with every other cache, no exception carved out.
    startTrainHandoff('home_quick');
    await clearActivationMarks();

    await markActivationStep(USER, null, 'train_opened');
    expect(lastProps().handoff_door).toBe('none');
    expect(lastProps().ms_to_interactive).toBeNull();
  });

  it('re-arms the once-only hand-off stamp for the next athlete', async () => {
    // The once-only rule must not outlive the session that earned it: two
    // athletes onboarding in the same tab is a real sequence (a shared phone,
    // a support session), and the second one would otherwise report the FIRST
    // one's start — a span of minutes or hours, silently ceilinged to null.
    startActivationSpanOnce(ACTIVATION_SPAN.home);
    await clearActivationMarks();

    vi.useFakeTimers();
    try {
      startActivationSpanOnce(ACTIVATION_SPAN.home);
      vi.advanceTimersByTime(900);
      await markActivationStep(USER, null, 'home_reached');
    } finally {
      vi.useRealTimers();
    }
    expect(lastProps().ms_to_mount).toBe(900);
  });
});
