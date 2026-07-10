import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';

/**
 * Phase 0 home: proves the session survives a refresh and sign-out works.
 * The real Home (avatar card, XP bar) is Phase 2.
 */
export default function HomeScreen() {
  const { session, loading, signOut } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color="#22d3ee" />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <View className="flex-1 items-center justify-center bg-bg p-s6">
      <View className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-s6">
        <Text className="text-xl font-bold text-accent">SIGNED IN</Text>
        <Text className="mb-s6 text-sm text-text-dim" testID="user-email">
          {session.user.email}
        </Text>
        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          testID="sign-out"
        >
          <Text className="font-bold text-text">SIGN OUT</Text>
        </Pressable>
      </View>
    </View>
  );
}
