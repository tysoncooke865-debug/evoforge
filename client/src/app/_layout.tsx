import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { AuthProvider } from '@/data/auth-context';

import '@/global.css';

export default function RootLayout() {
  // useState, not module scope: one QueryClient per app instance, never shared
  // across static-render passes. Per-user isolation inside it is by auth state
  // (RLS on the server is the real guard; the client cache is cleared on
  // sign-out in auth-context).
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#070b14' }, // --bg, behind route transitions
          }}
        />
      </AuthProvider>
    </QueryClientProvider>
  );
}
