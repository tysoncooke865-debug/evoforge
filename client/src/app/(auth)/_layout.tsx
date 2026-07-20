import { Redirect, Stack, usePathname } from 'expo-router';

import { useAuth } from '@/data/auth-context';

/**
 * Signed-in users have no business on auth screens — EXCEPT reset-password.
 * A recovery link mints a real session before the new password is chosen, so
 * redirecting it would land the athlete on Home with the old password still in
 * force and no way to finish the reset.
 */
export default function AuthLayout() {
  const { session, loading } = useAuth();
  const pathname = usePathname();

  if (!loading && session && !pathname.includes('reset-password')) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070b14' } }}
    />
  );
}
