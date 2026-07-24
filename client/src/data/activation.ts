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
    const marks = await readMarks(userId);
    if (!shouldEmitActivationStep(marks, step)) return;

    const now = Date.now();
    const signupAt = signupAtIso ? Date.parse(signupAtIso) : NaN;
    track(
      ACTIVATION_EVENT,
      activationStepProps(step, marks, {
        now,
        signupAtMs: Number.isFinite(signupAt) ? signupAt : null,
        extra,
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
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(KEY_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    /* best-effort */
  }
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
