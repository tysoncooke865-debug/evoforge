import { Redirect, Tabs, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/auth-context';
import { initFinishQueue } from '@/data/finish-queue';
import { initSetQueue } from '@/data/set-queue';
import { useProfile } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { activeWorkout, useSessionStore } from '@/state/session-store';
import { LevelUpOverlay } from '@/ui/level-up-overlay';
import { TutorialOverlay } from '@/ui/tutorial-overlay';
import { scrollActiveToTop } from '@/ui/scroll-registry';
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
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !hydrated || !session || profile.data === undefined) return;
    resumedRef.current = true;
    if (active !== null) router.replace('/today');
  }, [hydrated, active, session, profile.data]);

  // Level-up detector: compares CONFIRMED summary.level across refetches.
  // First observation only arms it (no ceremony for merely opening the app);
  // multi-level jumps celebrate once, from the old level to the new.
  const { summary, ready } = useAvatarData();
  const prevLevelRef = useRef<number | null>(null);
  const [levelUp, setLevelUp] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    if (!ready) return; // pre-load defaults must never arm or trigger
    const level = summary.level;
    if (prevLevelRef.current === null) {
      prevLevelRef.current = level;
      return;
    }
    if (level > prevLevelRef.current) {
      setLevelUp({ from: prevLevelRef.current, to: level });
    }
    prevLevelRef.current = level;
  }, [summary.level, ready]);

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
          height: 56 + Math.max(insets.bottom, 6),
          paddingBottom: Math.max(insets.bottom, 6),
          paddingTop: 6,
        },
        tabBarActiveTintColor: tokens.colors.accent,
        tabBarInactiveTintColor: tokens.colors['text-mute'],
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      {/* TRANSFORM P1: five majors. Everything else lives in the profile
          menu (tap your companion, top-right of any screen). */}
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: makeIcon('⌂') }} />
      <Tabs.Screen name="today" options={{ title: 'Train', tabBarIcon: makeIcon('◎') }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress', tabBarIcon: makeIcon('◺') }} />
      <Tabs.Screen name="avatar" options={{ title: 'Forge', tabBarIcon: makeIcon('◈') }} />
      <Tabs.Screen name="arena" options={{ title: 'Arena', tabBarIcon: makeIcon('⚔') }} />
      {/* Routable, not in the bar — reached from the profile menu. */}
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
