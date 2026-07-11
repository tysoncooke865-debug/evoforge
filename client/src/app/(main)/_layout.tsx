import { Redirect, Tabs } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import tokens from '@/theme/tokens';

/**
 * The signed-in shell. Gate order mirrors app.py: no session -> sign-in;
 * session without a profile row -> onboarding (A SAVED PROFILE ROW IS THE
 * ONBOARDED FLAG); else the app. Loading HOLDS rather than redirecting: a
 * slow profile read must not bounce an onboarded athlete through the wizard.
 *
 * Navigation is bottom tabs -- the mobile/native shape from the plan. The
 * >=1024px sidebar variant arrives when there are enough screens to warrant
 * it (plan puts the full shell across Phases 2-5).
 */
export default function MainLayout() {
  const { session, loading } = useAuth();
  const profile = useProfile();

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
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.colors.bg },
        tabBarStyle: {
          backgroundColor: tokens.colors.surface,
          borderTopColor: tokens.colors.border,
        },
        tabBarActiveTintColor: tokens.colors.accent,
        tabBarInactiveTintColor: tokens.colors['text-mute'],
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: makeIcon('⌂') }}
      />
      <Tabs.Screen
        name="avatar"
        options={{ title: 'Avatar', tabBarIcon: makeIcon('◈') }}
      />
    </Tabs>
  );
}

function makeIcon(glyph: string) {
  return function TabIcon({ color }: { color: import('react-native').ColorValue }) {
    return <Text style={{ color: color as string, fontSize: 18, lineHeight: 22 }}>{glyph}</Text>;
  };
}
