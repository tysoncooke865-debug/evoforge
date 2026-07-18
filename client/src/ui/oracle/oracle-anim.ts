import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/**
 * ORACLE_REDESIGN — the reveal primitives. Two rules hold everywhere here:
 * (1) VISIBILITY never depends on an animation firing (the PWA boot lesson —
 * the final value is always rendered; motion only decides whether it eases
 * in), and (2) reduced motion jumps straight to the final state. The
 * non-animating cases are DERIVED in render (never a setState in an effect);
 * state is only ever written from a rAF or timer callback. rAF + performance
 * time live inside effects, so the React Compiler's purity rule is respected.
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
