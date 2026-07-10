import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/data/auth-context';

/** Signed-in users have no business on auth screens. */
export default function AuthLayout() {
  const { session, loading } = useAuth();

  if (!loading && session) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070b14' } }}
    />
  );
}
