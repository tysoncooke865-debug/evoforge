import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';

import {
  ACTIVATION_EVENT,
  activationStepProps,
  parseActivationMarks,
  shouldEmitActivationStep,
  type ActivationMarks,
  type ActivationStep,
} from '@/domain/activation-funnel';
import { interactiveSpanMs } from '@/domain/activation-tti';

import { track } from './analytics';
import { useAuth } from './auth-context';

/**
 * ACTIVATION FUNNEL — the emitter (docs/ACTIVATION_ANALYTICS.md). The ladder,
 * the ordering and the "should this fire" rule are pure and tested in
 * `domain/activation-funnel.ts`; this file is only wiring: persistence, the
 * auth read, and the hook screens mount.
 *
 * Same contract as every other emitter here (analytics.ts): fire-and-forget,
 * never awaited, never gates a flow, no PII.
 */

const KEY_PREFIX = 'evoforge-activation-v1:';
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

/* ------------------------------------------------------------------------ */
/* TIME-TO-INTERACTIVE (WO-006)                                              */
/* ------------------------------------------------------------------------ */

/**
 * The stopwatch half of the funnel. The RULES are pure and tested in
 * `domain/activation-tti.ts`; everything here is the wiring they need — where a
 * span starts, and whether the document went away while it ran.
 *
 * IN MEMORY ONLY, deliberately. A span that survived a reload would be
 * measuring the reload. Nothing here is persisted, so a killed app simply has
 * no measurement — which the rules already encode as `null`.
 */
const spanStart = new Map<string, number>();
const spanHidden = new Set<string>();
/** Measured spans kept so a LATER event can carry them (see `train_opened`). */
const spanMeasured = new Map<string, number | null>();

/**
 * Every open span is poisoned the moment the document goes away, and a span
 * stamped while already hidden is born poisoned. Three events, not one: iOS
 * PWAs routinely suspend without a `visibilitychange` — the same reason
 * `initNavFreezeBeacon` listens to all three (data/version-guard.ts).
 */
let hiddenWatchInstalled = false;
function installHiddenWatch(): void {
  // `typeof document` rather than `Platform.OS` on purpose: it is the exact
  // condition (there is nothing to hide without a document), and it keeps this
  // module importable by vitest, which has no react-native preset.
  if (hiddenWatchInstalled || typeof document === 'undefined') return;
  hiddenWatchInstalled = true;
  const poison = () => {
    for (const name of spanStart.keys()) spanHidden.add(name);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) poison();
  });
  window.addEventListener('pagehide', poison);
  window.addEventListener('freeze', poison);
}

/** Is the document hidden right now? (Always false with no document.) */
function documentHidden(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden === true;
}

/**
 * Stamp the start of a span. Re-stamping restarts it — a second visit to Train
 * is a second hand-off, and the last one before the event is the one that
 * describes what the athlete just waited for.
 */
export function startActivationSpan(name: string): void {
  installHiddenWatch();
  spanStart.set(name, Date.now());
  // Born hidden = born untrustworthy (a backgrounded tab's prefetch).
  if (documentHidden()) spanHidden.add(name);
  else spanHidden.delete(name);
}

/** Measure a span NOW, applying every refusal rule. Non-destructive. */
export function activationSpanMs(name: string): number | null {
  return interactiveSpanMs({
    startedAt: spanStart.get(name) ?? null,
    now: Date.now(),
    hiddenDuringSpan: spanHidden.has(name) || documentHidden(),
  });
}

/** Measure a span and keep the result for an event that fires later. */
export function noteActivationSpan(key: string, name: string): number | null {
  const ms = activationSpanMs(name);
  spanMeasured.set(key, ms);
  return ms;
}

/** Read a span measured earlier, or null if it was never taken. */
export function readActivationSpan(key: string): number | null {
  return spanMeasured.get(key) ?? null;
}

function clearActivationSpans(): void {
  spanStart.clear();
  spanHidden.clear();
  spanMeasured.clear();
}

/** The span names this rail measures. Strings in one place, not scattered. */
export const ACTIVATION_SPAN = {
  /** Stamped when onboarding finishes; read when Home mounts and when it settles. */
  home: 'home',
  /** Stamped when the Train TAB IS PRESSED; read when its plan queries settle. */
  train: 'train',
} as const;

/** Where a measured span is parked for a later event to carry. */
const HOME_INTERACTIVE = 'home_interactive';

/**
 * The TTI props for a step, merged into the event at EMIT time.
 *
 * They live here rather than in the callers' `extra` because `extra` is built
 * during render, and the interesting spans close in an effect — a render-time
 * read would always be one tick stale, which for `train_opened` means always
 * null.
 */
function ttiPropsFor(step: ActivationStep): Record<string, unknown> {
  if (step === 'home_reached') {
    // Onboarding finished -> Home painted. Null on a cold boot (never stamped).
    return { ms_to_mount: activationSpanMs(ACTIVATION_SPAN.home) };
  }
  if (step === 'train_opened') {
    return {
      // Train TAB PRESSED -> Train's plan queries settled. THE hand-off number:
      // chunk fetch, mount and data, which is what the athlete actually sat
      // through. Null when they arrived without pressing the tab.
      ms_to_interactive: activationSpanMs(ACTIVATION_SPAN.train),
      // The Home half, carried forward: Home has no emit point of its own at
      // the moment it becomes interactive, and adding a fifth step would break
      // the four-rows-per-athlete bound the rail is built on.
      ms_home_to_interactive: readActivationSpan(HOME_INTERACTIVE),
    };
  }
  return {};
}

/**
 * In-memory guard against the same step firing twice before the first write
 * lands (two screens mounting in the same frame). AsyncStorage is the
 * durable mark; this only closes the read-modify-write window.
 */
const inFlight = new Set<string>();

async function readMarks(userId: string): Promise<ActivationMarks> {
  try {
    return parseActivationMarks(await AsyncStorage.getItem(keyFor(userId)));
  } catch {
    return {};
  }
}

/**
 * Record that an athlete reached `step`, emitting `activation_step` the FIRST
 * time only. `extra` is the state they found on arrival — counts and enums,
 * never PII.
 *
 * Best-effort throughout: a storage failure degrades to "might emit twice",
 * which the funnel query (max(index), min(created_at) per step) absorbs. It
 * never throws and never blocks the caller.
 */
export async function markActivationStep(
  userId: string | null,
  signupAtIso: string | null | undefined,
  step: ActivationStep,
  extra?: Record<string, unknown>
): Promise<void> {
  if (!userId) return;
  const guard = `${userId}:${step}`;
  if (inFlight.has(guard)) return;
  inFlight.add(guard);
  try {
    // The stopwatch stops HERE — at the moment the caller said "interactive" —
    // not after the storage read below, which would fold a cache round trip
    // into every measurement. Discarded if the step already fired.
    const tti = ttiPropsFor(step);
    const marks = await readMarks(userId);
    if (!shouldEmitActivationStep(marks, step)) return;

    const now = Date.now();
    const signupAt = signupAtIso ? Date.parse(signupAtIso) : NaN;
    track(
      ACTIVATION_EVENT,
      activationStepProps(step, marks, {
        now,
        signupAtMs: Number.isFinite(signupAt) ? signupAt : null,
        // TTI first so a caller could never shadow a measurement by accident.
        extra: { ...tti, ...(extra ?? {}) },
      })
    );

    try {
      await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ ...marks, [step]: now }));
    } catch {
      /* the event is already away; a lost mark only risks a duplicate */
    }
  } catch {
    /* analytics must never break a flow */
  } finally {
    inFlight.delete(guard);
  }
}

/**
 * Sign-out clears every cache layer — no exception for this one. The marks are
 * keyed by user id so they could not leak between athletes anyway, but the rule
 * is absolute for a reason (root CLAUDE.md), and duplicates are harmless here.
 */
export async function clearActivationMarks(): Promise<void> {
  // The in-memory spans go with them — a span started by the last athlete must
  // never be measured against the next one's first screen.
  clearActivationSpans();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(KEY_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    /* best-effort */
  }
}

/**
 * Record the moment a screen became INTERACTIVE, once per mount, so a later
 * step event can carry it. Used by Home, which has no event of its own at the
 * moment its mission card stops loading.
 */
export function useHomeInteractive(interactive: boolean): void {
  const noted = useRef(false);
  useEffect(() => {
    if (noted.current || !interactive) return;
    noted.current = true;
    noteActivationSpan(HOME_INTERACTIVE, ACTIVATION_SPAN.home);
  }, [interactive]);
}

/**
 * Mount-time reporter for a screen in the activation ladder.
 *
 * `ready` exists because WHAT the athlete found is the point: firing while the
 * plan queries are still pending would record the loading state, not the screen
 * they actually saw. Pass `false` until the data behind `extra` has settled.
 *
 * Fires at most once per mount; `markActivationStep` enforces once per athlete.
 */
export function useActivationStep(
  step: ActivationStep,
  opts: { ready?: boolean; extra?: Record<string, unknown> } = {}
): void {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const signupAt = session?.user?.created_at ?? null;
  const ready = opts.ready ?? true;
  const extra = opts.extra;
  const fired = useRef(false);

  useEffect(() => {
    if (!userId || !ready || fired.current) return;
    fired.current = true;
    void markActivationStep(userId, signupAt, step, extra);
    // `extra` is READ at emit time and deliberately not a dependency: callers
    // pass a fresh object literal every render, so depending on its identity
    // would re-run this effect constantly to fight the once-per-mount guard for
    // no gain. `ready` is the signal that the state behind it has settled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, signupAt, ready, step]);
}
