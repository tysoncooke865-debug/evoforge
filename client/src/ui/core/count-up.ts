import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * THE REVEAL PRIMITIVES (moved here 2026-08-05 from ui/oracle/oracle-anim.ts,
 * where they were built for the Oracle's theatrical scan reveals — Home/Train/
 * Cardio/Fuel's mission-briefing pass all want the same "a number counts up
 * to its real value" beat, so this is the ONE copy. `ui/oracle/oracle-anim.ts`
 * re-exports from here; every existing Oracle import keeps working unchanged.
 *
 * Two rules hold everywhere this is used: (1) VISIBILITY never depends on an
 * animation firing (the PWA boot lesson — the final value is always rendered;
 * motion only decides whether it eases in), and (2) reduced motion jumps
 * straight to the final state. The non-animating cases are DERIVED in render
 * (never a setState in an effect); state is only ever written from a rAF or
 * timer callback.
 */

/**
 * Count a number from 0 → target over `duration` ms once `enabled` flips true.
 * Reduced motion (or a platform lacking rAF) returns the target at once.
 */
export function useCountUp(target: number, enabled: boolean, duration = 900): number {
  const reduced = useReducedMotion();
  const canAnimate =
    !reduced && typeof requestAnimationFrame !== 'undefined' && Platform.OS === 'web';
  const [value, setValue] = useState(canAnimate ? 0 : target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !canAnimate) return;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast then settling, the count-up feel.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(t >= 1 ? target : eased * target); // written only from rAF
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, enabled, canAnimate, duration]);

  return canAnimate ? value : target;
}

/**
 * Ease a number from wherever it was to wherever it now is.
 *
 * useCountUp animates 0 → target ONCE. A pot that goes 50 → 150 needs the other
 * shape: start from the value already on screen, so the athlete watches THEIR
 * number climb rather than a fresh count from zero that erases what it was.
 *
 * Same two rules: the final value is always reachable without an animation
 * frame (reduced motion and non-web return the target immediately), and state
 * is only ever written from a rAF callback.
 */
export function useTweenNumber(target: number, duration = 650): number {
  const reduced = useReducedMotion();
  const canAnimate =
    !reduced && typeof requestAnimationFrame !== 'undefined' && Platform.OS === 'web';
  const [value, setValue] = useState(target);
  /**
   * WHAT IS ACTUALLY ON SCREEN. Written only from the rAF callback, so an
   * interrupted tween resumes from where it really was.
   *
   * THIS REF USED TO BE SET IN THE EFFECT'S CLEANUP, from the render closure —
   * and that closure holds the value as it was when the effect was CREATED,
   * not the value the tween had reached. So a number that went 0 → 1000 and
   * then back to 0 restored `from` to the stale 0, the new tween saw
   * `start === target`, returned early, and the displayed number stayed on
   * 1000 forever. The browser found it as "CLEAR does not clear the stake";
   * it would have hit every second change on the pot too.
   */
  const shown = useRef(target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!canAnimate) return;
    const start = shown.current;
    if (start === target) return;
    let t0: number | null = null;
    const tick = (now: number) => {
      if (t0 === null) t0 = now;
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = t >= 1 ? target : start + (target - start) * eased;
      shown.current = v;
      setValue(v); // written only from rAF
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, canAnimate, duration]);

  return canAnimate ? value : target;
}

export type RevealPhase = 'scanning' | 'complete' | 'done';

/**
 * The theatrical reveal after a REAL analysis returns: a brief "SCANNING…"
 * beat, then "✓ Analysis Complete", then the content ('done'). Reduced motion
 * (or `active=false`) derives straight to 'done' — the content is never
 * withheld — and the animating path advances only through timer callbacks.
 */
export function useReveal(active: boolean): RevealPhase {
  const reduced = useReducedMotion();
  const animate = active && !reduced;
  const [phase, setPhase] = useState<RevealPhase>('scanning');

  useEffect(() => {
    if (!animate) return;
    const t1 = setTimeout(() => setPhase('complete'), 700); // written only from timers
    const t2 = setTimeout(() => setPhase('done'), 1250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [animate]);

  return animate ? phase : 'done';
}
