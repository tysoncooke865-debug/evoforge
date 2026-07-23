/**
 * EvoForge Arena (the card-battler mini-game) mounted inside EvoForge.
 * The Arena is a self-contained feature package at src/arena-game; this
 * layout boots it for the signed-in athlete: content validation once, then
 * per-user namespaced persistence + the Supabase-backed provider
 * (initArenaForUser). Session is guaranteed by the (main) gate.
 */
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { ErrorBoundary } from '@/arena-game/components/error-boundary';
import { NeonButton } from '@/arena-game/components/ui';
import { colors, spacing } from '@/arena-game/constants/theme';
import { validateAllContent } from '@/arena-game/content';
import { initArenaForUser } from '@/arena-game/services/app-services';
import { useAuth } from '@/data/auth-context';

type BootState =
  | { phase: 'loading' }
  | { phase: 'ready' }
  | { phase: 'failed'; message: string };

export default function ForgeArenaLayout() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' });

  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    setBoot({ phase: 'loading' });
    (async () => {
      try {
        const report = validateAllContent();
        if (!report.ok) {
          console.error('[forge-arena] content validation failed', report.errors);
        }
        await initArenaForUser(userId);
        if (!cancelled) setBoot({ phase: 'ready' });
      } catch (e) {
        console.error('[forge-arena] bootstrap failed', e);
        if (!cancelled) {
          setBoot({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (boot.phase === 'loading') {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootTitle}>EVOFORGE ARENA</Text>
        <ActivityIndicator color={colors.cyan} size="large" />
      </View>
    );
  }

  if (boot.phase === 'failed') {
    return (
      <View style={styles.boot}>
        <Text style={styles.bootTitle}>EVOFORGE ARENA</Text>
        <Text style={styles.bootError}>Failed to start: {boot.message}</Text>
        <NeonButton
          label="Retry"
          onPress={() => setBoot({ phase: 'loading' })}
        />
      </View>
    );
  }

  return (
    <ErrorBoundary label="forge-arena">
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="feedback" options={{ title: 'Beta Feedback' }} />
        <Stack.Screen name="lobby" options={{ title: 'Arena Lobby' }} />
        <Stack.Screen name="battle" options={{ headerShown: false }} />
        <Stack.Screen name="tutorial" options={{ headerShown: false }} />
        <Stack.Screen name="gym" options={{ title: 'Gym' }} />
        <Stack.Screen name="gym-roster" options={{ title: 'Gym Roster' }} />
        <Stack.Screen name="gym-squad" options={{ title: 'War Squad' }} />
        <Stack.Screen name="gym-war" options={{ headerShown: false }} />
        <Stack.Screen name="battle-log" options={{ title: 'Battle Log' }} />
        <Stack.Screen name="replay" options={{ title: 'Replay' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="debug" options={{ title: 'Developer Debug' }} />
        <Stack.Screen name="dev-stress" options={{ title: 'Render Stress Lab' }} />
      </Stack>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  bootTitle: {
    color: colors.cyan,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 4,
  },
  bootError: { color: colors.danger, textAlign: 'center' },
});
