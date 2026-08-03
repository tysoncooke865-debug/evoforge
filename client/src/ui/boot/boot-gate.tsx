/**
 * THE LAUNCH OVERLAY'S LIFECYCLE — the safety-critical half of the forge
 * intro. The animation lives in forge-intro.tsx; what is here is only the
 * decision to show it and, much more importantly, the guarantee that it goes
 * away.
 *
 * ================================================================
 *  IT IS AN OVERLAY. IT IS NEVER A GATE.
 * ================================================================
 *
 * On 2026-07-16 the installed iPhone PWA was stranded on a blank screen because
 * `_layout.tsx` wrapped the whole app in a Reanimated view whose opacity
 * started at 0 and only reached 1 via an animation frame — in a cold-launched
 * iOS standalone PWA that frame can simply never tick, and the app was
 * invisible over the boot colour. The rule that came out of it is absolute:
 * **app content must never depend on an animation firing to become visible.**
 *
 * A full-screen launch animation is the most obvious way to break that rule
 * again, so this one is built to be incapable of it:
 *
 *   1. The app renders UNDERNEATH from the first frame. This component is a
 *      SIBLING of the app tree, not a wrapper around it. If every line of the
 *      intro failed, the app would already be on screen behind it.
 *   2. Dismissal is a plain `setTimeout`, not an animation callback, not an
 *      `onFinished`, not a frame counter. Timers fire on devices where
 *      requestAnimationFrame does not.
 *   3. There is a SECOND, independent deadline (BOOT_HARD_CAP_MS) whose only
 *      job is to be the thing that cannot be reasoned wrong.
 *   4. THE OVERLAY NEVER RECEIVES A TOUCH (2026-08-03 — see forge-intro.tsx's
 *      root node). It shipped with a tap-to-skip Pressable; an athlete
 *      reported being unable to type into the sign-in fields afterwards, every
 *      launch, on Safari and the installed PWA, and it could not be
 *      reproduced in automation on either engine. A full-screen touch
 *      interceptor sitting over an app that is already mounted and
 *      interactive underneath, removed at an arbitrary instant by a TIMER
 *      rather than by the user's own tap-release, is exactly the shape of a
 *      real-device touch/responder bug that in-process test harnesses do not
 *      faithfully reproduce. Rather than keep chasing an unreproducible
 *      mechanism, the risk was removed at its root: the overlay is
 *      `pointerEvents="none"` for its entire life. It was never required to
 *      be skippable.
 *   5. When it ends it UNMOUNTS. An overlay parked at opacity 0 still eats
 *      every tap underneath it (the overflowing-box lesson) — moot now that
 *      it never took one, but true regardless.
 *
 * ================================================================
 *  ONCE PER LAUNCH
 * ================================================================
 *
 * `launched` is module scope, so the sequence plays once per JS instance:
 * every cold start on native, every page load on web, and NOT on route changes
 * or tab switches. That is what "every single time the application opens"
 * means on each platform.
 *
 * ================================================================
 *  WHAT IT IS HIDING
 * ================================================================
 *
 * Nothing artificial. Because the app mounts underneath, the ~2.7 seconds are
 * spent on work that was going to happen anyway and now happens unseen: the
 * font load, the Supabase session restore, the persisted query-cache rehydrate,
 * the profile fetch, the session store's hydration and the route warmer. The
 * intro does not wait for any of them and cannot be delayed by them — the
 * brief's "maximum ~3 seconds" is a property of the timer, not a hope about a
 * network. Anything still loading when the forge opens shows its own state.
 */

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { BOOT_HARD_CAP_MS, BOOT_REDUCED_MS, BOOT_TOTAL_MS } from '@/domain/boot-sequence';

import { ForgeIntro } from './forge-intro';

/** Flipped on the first mount; module scope = once per JS instance. */
let launched = false;

/**
 * WHERE IT DOES NOT PLAY.
 *
 * `?nointro=1` is the manual escape hatch, and `/lab` is automatic: the Dev Lab
 * PHOTOGRAPHS the real app in a sandbox, and a 2.7-second curtain in front of
 * every shot would appear in every photograph it takes. A launch animation is
 * for a launch; the lab is not launching anything.
 */
function suppressed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location.pathname.startsWith('/lab')) return true;
    return new URLSearchParams(window.location.search).has('nointro');
  } catch {
    return false;
  }
}

export function BootGate() {
  const reduced = useReducedMotion();
  // The initialiser is pure and idempotent — it only READS the flag, so a
  // double-invoked render (StrictMode) cannot swallow the intro. The flag is
  // set in the effect below, exactly once.
  const [playing, setPlaying] = useState(() => !launched && !suppressed());

  useEffect(() => {
    launched = true;
    if (!playing) return;
    const run = reduced ? BOOT_REDUCED_MS : BOOT_TOTAL_MS;
    // THE DISMISSAL. A timer, deliberately — see the header.
    const end = setTimeout(() => setPlaying(false), run);
    // THE SECOND DEADLINE. If anything above is ever wrong, this is not.
    const cap = setTimeout(() => setPlaying(false), BOOT_HARD_CAP_MS);
    return () => {
      clearTimeout(end);
      clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!playing) return null;
  return <ForgeIntro reduced={reduced} />;
}
