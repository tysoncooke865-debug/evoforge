/**
 * Reduced-motion preference for the arena's continuous-while-moving effects
 * (the unit walk-bob). The P6/P7 doctrine kept every effect reactive and
 * short-lived precisely to avoid ungated continuous motion; the walk-bob is
 * movement-driven (it stops when the unit stops) but still runs for seconds
 * at a time, so it gets a real gate. Self-contained on AccessibilityInfo —
 * the arena package deliberately imports nothing from src/ui.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotionPref(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
