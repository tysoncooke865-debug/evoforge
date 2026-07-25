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

  it('gives the other two steps no TTI props at all', async () => {
    // They have no hand-off to describe; an always-null column reads as a
    // broken measurement rather than as an absent one.
    await markActivationStep(USER, null, 'workout_opened');
    expect(lastProps()).not.toHaveProperty('ms_to_interactive');
    expect(lastProps()).not.toHaveProperty('ms_to_mount');
  });

  it('lets a caller-supplied prop win over a measured one', async () => {
    startActivationSpan(ACTIVATION_SPAN.train);
    await markActivationStep(USER, null, 'train_opened', { ms_to_interactive: 42 });
    expect(lastProps().ms_to_interactive).toBe(42);
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
});
