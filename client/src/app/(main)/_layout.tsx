import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';

/**
 * The signed-in shell. Gate order mirrors app.py: no session -> sign-in;
 * session without a profile row -> onboarding (A SAVED PROFILE ROW IS THE
 * ONBOARDED FLAG); else the app. Loading states hold rather than flicker a
 * redirect: a slow profile read must not bounce an onboarded user through
 * the wizard.
 */
export default function MainLayout() {
  const { session, loading } = useAuth();
  const profile = useProfile();

  if (loading || (session && profile.isPending)) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#22d3ee" />
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
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070b14' } }}
    />
  );
}
