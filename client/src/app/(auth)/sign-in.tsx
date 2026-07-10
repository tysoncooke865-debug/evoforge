import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
    }
    setBusy(false);
    // Success needs no navigation: onAuthStateChange flips the session and the
    // (auth) layout redirects.
  };

  return (
    <View className="flex-1 items-center justify-center bg-bg p-s6">
      <View className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-s6">
        <Text className="text-2xl font-bold text-accent">EVOFORGE</Text>
        <Text className="mb-s6 text-sm text-text-dim">Sign in to continue</Text>

        <Text className="mb-s1 text-xs text-text-mute">EMAIL</Text>
        <TextInput
          className="mb-s4 rounded-md border border-border bg-surface-2 p-s3 text-text"
          autoCapitalize="none"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChangeText={setEmail}
          testID="email"
        />

        <Text className="mb-s1 text-xs text-text-mute">PASSWORD</Text>
        <TextInput
          className="mb-s6 rounded-md border border-border bg-surface-2 p-s3 text-text"
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          testID="password"
        />

        {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}

        <Pressable
          className="items-center rounded-md bg-accent p-s3"
          onPress={signIn}
          disabled={busy}
          testID="sign-in"
        >
          {busy ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className="font-bold text-accent-ink">SIGN IN</Text>
          )}
        </Pressable>

        <Link href="/sign-up" className="mt-s4">
          <Text className="text-sm text-text-dim">
            New here? <Text className="text-accent">Create your character</Text>
          </Text>
        </Link>
      </View>
    </View>
  );
}
