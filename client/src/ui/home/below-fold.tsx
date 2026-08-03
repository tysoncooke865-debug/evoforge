/**
 * HOME (2026-08-03) — everything that is no longer competing for the first
 * screen, and the seam that separates it.
 *
 * The brief's rule for this band: nothing was removed from the app, it just
 * stopped shouting on arrival. So the sections below are the SAME
 * components, with the same data and the same doors — they simply render
 * after the first screen has painted.
 *
 * WHY DEFER AT ALL: this half holds the two most expensive things on Home —
 * the radar (an SVG polygon set plus a projection overlay) and the
 * leaderboard teaser — and both used to mount before the athlete could see
 * the START button. The idle slot lets the first frame commit first; the
 * placeholder holds a plausible height so the scrollbar does not jump when
 * the real content lands.
 *
 * NOT InteractionManager (tried, reverted 2026-08-03): RN 0.86 ships
 * `InteractionManagerStub` — `runAfterInteractions` is a bare `setImmediate`,
 * which bridgeless polyfills to `queueMicrotask`, so the callback, the state
 * update and the second render all land in the SAME task as the first render
 * and NOTHING is deferred on native. It also warns "deprecated" on every run.
 * requestIdleCallback is the app's existing idle seam (_layout.tsx's route
 * warmer uses it the same way) and RN 0.86 gives it a real native
 * implementation. The `timeout` is load-bearing on web: a page booted in a
 * hidden tab gets no idle slot at all, and without it the athlete would
 * return to a permanent placeholder.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { DividerGlow, EdgeLabel } from '@/ui/core/hud';

type IdleGlobal = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function BelowFold({
  children,
  placeholderHeight = 320,
}: {
  children: ReactNode;
  /** Roughly what the deferred stack measures, so the scroll extent barely
   *  changes when it mounts. */
  placeholderHeight?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = globalThis as IdleGlobal;
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    // ONE slot in the shell's gap stack whether or not the content is up yet,
    // so mounting never re-flows the sections above.
    <View className="w-full gap-s3">
      <View className="mt-s2">
        <DividerGlow />
      </View>
      <EdgeLabel>YOUR PROGRESS</EdgeLabel>
      {ready ? children : <View style={{ height: placeholderHeight }} testID="below-fold-pending" />}
    </View>
  );
}
