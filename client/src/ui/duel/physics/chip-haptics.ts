import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * IMPACT HAPTICS, throttled hard.
 *
 * A physics table generates hundreds of contacts a second. Forwarding even a
 * fraction of them produces a phone that buzzes continuously while a pile
 * settles — which reads as a malfunction, drains the battery, and is genuinely
 * unpleasant. So the rules here are stricter than the audio's:
 *
 *   - a floor well above the audio floor: most impacts that make a sound make
 *     NO vibration, and that is the correct ratio;
 *   - one buzz per 110ms, globally, whatever is happening;
 *   - and a settling pile is silent to the hand, because after the first
 *     couple of hits the intensities fall under the floor on their own.
 *
 * Web has no haptics API worth using (navigator.vibrate is ignored on iOS
 * Safari and blunt everywhere else), so this is a native-only layer that
 * simply does nothing in the PWA rather than pretending.
 */

const MIN_INTENSITY = 0.3;
const SPACING_MS = 110;
/** Above this, the impact gets the heavier tap. */
const MEDIUM = 0.55;
const HEAVY = 0.82;

let lastAt = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function chipImpactHaptic(intensity: number): void {
  if (Platform.OS === 'web') return;
  if (intensity < MIN_INTENSITY) return;
  const t = now();
  if (t - lastAt < SPACING_MS) return;
  lastAt = t;
  const style =
    intensity >= HEAVY ? Haptics.ImpactFeedbackStyle.Heavy
      : intensity >= MEDIUM ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light;
  void Haptics.impactAsync(style);
}

/** A chip leaving the tray — a selection tick, not an impact. */
export function chipReleaseHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.selectionAsync();
}

/** The pot locking: one deliberate, unmistakable confirmation. */
export function potLockHaptic(): void {
  if (Platform.OS === 'web') return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
