import { Platform } from 'react-native';

/**
 * True when EvoForge should show its OWN in-app entry pad instead of the OS
 * keyboard: every native build, and any web browser on a touch screen (a
 * phone/tablet, coarse pointer). Desktop web keeps a plain typeable input so
 * the Playwright tours can .fill() it. Shared by NumberField (keypad) and
 * TextField (themed QWERTY) so the two never disagree.
 */
export const USE_CUSTOM_PAD =
  Platform.OS !== 'web' ||
  (typeof window !== 'undefined' &&
    ((typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
      (typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0)));
