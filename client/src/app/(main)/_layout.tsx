import { useQueryClient } from '@tanstack/react-query';
import { Redirect, Tabs, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/auth-context';
import { initFinishQueue } from '@/data/finish-queue';
import { initSetQueue } from '@/data/set-queue';
import { useProfile } from '@/data/hooks';
import { migrateForgeHistory } from '@/data/progression/award-xp';
import { runDueEvoReview } from '@/data/progression/evo-review-io';
import { progressionFeatures } from '@/data/progression/features';
import { supabase } from '@/data/supabase';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { todayIso } from '@/domain/today';
import { activeWorkout, activeWorkoutSource, useSessionStore } from '@/state/session-store';
import { LevelUpOverlay } from '@/ui/character/level-up-overlay';
import { PixelDumbbell } from '@/ui/core/pixel-icons';
import { TutorialOverlay } from '@/ui/core/tutorial-overlay';
import { scrollActiveToTop } from '@/ui/core/scroll-registry';
import { PIXEL } from '@/theme/fonts';
import tokens from '@/theme/tokens';

/**
 * The signed-in shell. Gate order mirrors app.py: no session -> sign-in;
 * session without a profile row -> onboarding (A SAVED PROFILE ROW IS THE
 * ONBOARDED FLAG); else the app. Loading HOLDS rather than redirecting: a
 * slow profile read must not bounce an onboarded athlete through the wizard.
 *
 * Five core tabs + More; the overflow screens stay routable (href: null
 * hides them from the bar without unmounting the router entries).
 */
export default function MainLayout() {
  const { session, loading } = useAuth();
  // TRANSFORM P2: resume flushing any offline-logged sets after a cold
  // start; also re-flushes on the browser 'online' event.
  useEffect(() => {
    initSetQueue();
    // A finish is as losable as a set was — and now as durable.
    initFinishQueue();
  }, []);
  const profile = useProfile();
  const insets = useSafeAreaInsets();

  /**
   * Tyson, 2026-07-14: CLOSE THE APP MID-WORKOUT, REOPEN INTO IT.
   *
   * If a workout is underway (a set banked today, or an ad-hoc workout
   * started) the cold start lands on Train; otherwise Home, as always. The
   * decision reads ONLY the persisted session store — no network — so it is
   * made on the first frame the athlete could act on.
   *
   * ONCE PER LAUNCH (the ref): this must not fight the athlete. If they open
   * mid-workout, land on Train, and then tap Home, they stay on Home.
   *
   * It waits for hydration: the persisted store arrives asynchronously, and
   * redirecting on the pre-hydration snapshot would always read "no workout".
   */
  const hydrated = useSessionStore((s) => s._hydrated);
  const active = useSessionStore(activeWorkout);
  const activeSource = useSessionStore(activeWorkoutSource);
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !hydrated || !session || profile.data === undefined) return;
    resumedRef.current = true;
    // Straight back INTO the workout, not merely onto Train — and into the SAME
    // one: without the source the day was re-resolved against BUILT-IN, so an
    // athlete mid-way through their AI plan's "Push 1" was resumed into the
    // built-in routine's different exercises.
    if (active !== null) {
      const src = activeSource ?? 2;
      router.replace(
        `/workout?date=${encodeURIComponent(todayIso())}&workout=${encodeURIComponent(
          active
        )}&source=${src}` as never
      );
    }
  }, [hydrated, active, activeSource, session, profile.data]);

  // PROGRESSION P5: once signed in with the flag on, run the idempotent
  // §43 history migration (event keys make reruns no-ops) and the weekly
  // Evo review WHEN DUE (never forced from here). Fire-and-forget: a
  // failure surfaces on the Evo page, never blocks the shell.
  const progressionRef = useRef(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (progressionRef.current || !session || profile.data === undefined || profile.data === null) return;
    if (!progressionFeatures.newProgressionEnabled) return;
    progressionRef.current = true;
    void (async () => {
      try {
        await migrateForgeHistory(supabase);
      } catch {
        /* rerun-safe next launch */
      }
      if (progressionFeatures.evoReviewsEnabled) {
        try {
          const result = await runDueEvoReview(supabase);
          if (result.ran) {
            // The reads may already be cached as null/stale — tell them.
            void queryClient.invalidateQueries({ queryKey: ['evo_rating_current'] });
            void queryClient.invalidateQueries({ queryKey: ['evo_rating_snapshots'] });
          }
        } catch {
          /* the Evo page's manual run remains */
        }
      }
      void queryClient.invalidateQueries({ queryKey: ['user_progression'] });
    })();
  }, [session, profile.data, queryClient]);

  // OPTIMISE (2026-07-16): idle-time tab preload. With async routes, a
  // tab's FIRST visit pays its chunk fetch + first render; prefetch mounts
  // the other four in the background once the app is idle, so every tab
  // switch is a pure show. Safe by audit: none of the tab screens has
  // mount-time subscriptions (focus-scoped effects stay focus-scoped), and
  // their queries share the already-warm cache. The workout page is NOT
  // preloaded — it is params-dependent.
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (prefetchedRef.current || !session || profile.data === undefined) return;
    prefetchedRef.current = true;
    const warm = () => {
      for (const href of ['/today', '/progress', '/avatar', '/arena']) {
        try {
          router.prefetch(href as never);
        } catch {
          // Preload is an optimisation, never a failure mode.
        }
      }
    };
    type IdleWindow = { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    const w = globalThis as IdleWindow;
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2500);
  }, [session, profile.data]);

  // Level-up detector: compares the CONFIRMED Forge Level across refetches
  // (Tyson, 2026-07-16: the game level is the earned Forge Level now).
  // First observation only arms it (no ceremony for merely opening the app);
  // multi-level jumps celebrate once, from the old level to the new.
  const forge = useForgeProgression();
  const ready = !forge.isPending;
  const prevLevelRef = useRef<number | null>(null);
  const [levelUp, setLevelUp] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!ready) return; // pre-load defaults must never arm or trigger
    const level = forgeProgressFromRow(forge.data ?? null).level;
    if (prevLevelRef.current === null) {
      prevLevelRef.current = level;
      return;
    }
    if (level > prevLevelRef.current) {
      setLevelUp({ from: prevLevelRef.current, to: level });
    }
    prevLevelRef.current = level;
  }, [forge.data, ready]);

  if (loading || (session && profile.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={tokens.colors.accent} />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  if (profile.data === null) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <>
    <Tabs
      // P2 C4: EVERY tab press scrolls the focused screen to the top. The
      // deferred call lets a cross-tab press land focus first, so one code
      // path covers re-pressing the current tab AND navigating to a page.
      screenListeners={{ tabPress: () => setTimeout(scrollActiveToTop, 0) }}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.colors.bg },
        tabBarStyle: {
          backgroundColor: tokens.colors.surface,
          borderTopColor: tokens.colors.border,
          // Safe-area aware: never let the home indicator / Safari chrome
          // swallow the bar. Height grows with the inset, not over content.
          // Compact (Tyson's target layout): the bar must not eat the week.
          height: 54 + Math.max(insets.bottom, 4),
          paddingBottom: Math.max(insets.bottom, 4),
          paddingTop: 4,
        },
        tabBarActiveTintColor: tokens.colors.accent,
        tabBarInactiveTintColor: tokens.colors['text-mute'],
        tabBarLabelStyle: { fontFamily: PIXEL, fontWeight: 'normal', fontSize: 9, letterSpacing: 0 },
      }}
    >
      {/* TRANSFORM P1: five majors. Everything else lives in the profile
          menu (tap your companion, top-right of any screen). */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: makeIcon('⌂') }} />
      {/* TRAIN_OVERHAUL: Train wears the pixel dumbbell; the injected tint
          keeps active/inactive colouring working exactly like the glyphs. */}
      <Tabs.Screen
        name="today"
        options={{ title: 'Train', tabBarIcon: ({ color }) => <PixelDumbbell size={19} color={color as string} /> }}
      />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: makeIcon('◺') }} />
      <Tabs.Screen name="avatar" options={{ title: 'Forge', tabBarIcon: makeIcon('◈') }} />
      <Tabs.Screen name="arena" options={{ title: 'Arena', tabBarIcon: makeIcon('⚔') }} />
      {/* Routable, not in the bar — reached from the profile menu. */}
      {/* TRAIN_PAGE_V2: the workout is a PAGE, pushed over Train. Routable,
          hidden from the bar (the bar stays visible on it). */}
      <Tabs.Screen name="workout" options={{ href: null }} />
      <Tabs.Screen name="log" options={{ href: null }} />
      <Tabs.Screen name="ai" options={{ href: null }} />
      <Tabs.Screen name="more" options={{ href: null }} />
      <Tabs.Screen name="routine" options={{ href: null }} />
      <Tabs.Screen name="goals" options={{ href: null }} />
      <Tabs.Screen name="awards" options={{ href: null }} />
      <Tabs.Screen name="rank" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="data" options={{ href: null }} />
      <Tabs.Screen name="schedule" options={{ href: null }} />
      <Tabs.Screen name="streak" options={{ href: null }} />
      <Tabs.Screen name="coins" options={{ href: null }} />
      {/* PROGRESSION P5: the Evo Rating + Forge Level detail pages. */}
      <Tabs.Screen name="evo" options={{ href: null }} />
      <Tabs.Screen name="evo-scan" options={{ href: null }} />
      <Tabs.Screen name="forge-level" options={{ href: null }} />
      <Tabs.Screen name="rival" options={{ href: null }} />
      {/* Dev-only mask workbench — the screen renders nothing in production. */}
      <Tabs.Screen name="muscle-lab" options={{ href: null }} />
    </Tabs>
    {levelUp ? (
      <LevelUpOverlay from={levelUp.from} to={levelUp.to} onClose={() => setLevelUp(null)} />
    ) : null}
    <TutorialOverlay />
    </>
  );
}

function makeIcon(glyph: string) {
  return function TabIcon({ color }: { color: import('react-native').ColorValue }) {
    return <Text style={{ color: color as string, fontSize: 18, lineHeight: 22 }}>{glyph}</Text>;
  };
}
