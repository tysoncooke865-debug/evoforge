import { Redirect, Tabs } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/data/auth-context';
import { initSetQueue } from '@/data/set-queue';
import { useProfile } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { LevelUpOverlay } from '@/ui/level-up-overlay';
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
  }, []);
  const profile = useProfile();
  const insets = useSafeAreaInsets();

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
    </>
  );
}

function makeIcon(glyph: string) {
  return function TabIcon({ color }: { color: import('react-native').ColorValue }) {
    return <Text style={{ color: color as string, fontSize: 18, lineHeight: 22 }}>{glyph}</Text>;
  };
}
