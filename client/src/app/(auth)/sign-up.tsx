import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';

export default function SignUpScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const signUp = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
    } else if (!data.session) {
      // Confirmations are on: Supabase created the user but withholds the
      // session until the email link is clicked.
      setConfirmationSent(true);
    }
    // With a session, the (auth) layout redirects; the missing profile row
    // then routes to /onboarding. A saved profile row IS the onboarded flag.
    setBusy(false);
  };

  if (confirmationSent) {
    return (
      <View className="flex-1 items-center justify-center bg-bg p-s6">
        <View className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-s6">
          <Text className="text-xl font-bold text-accent">CHECK YOUR EMAIL</Text>
          <Text className="mt-s2 text-sm text-text-dim">
            We sent a confirmation link to {email}. Open it, then sign in.
          </Text>
          <Link href="/sign-in" className="mt-s4">
            <Text className="text-accent">Back to sign in</Text>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center bg-bg p-s6">
      <View className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-s6">
        <Text className="text-2xl font-bold text-accent">EVOFORGE</Text>
        <Text className="mb-s6 text-sm text-text-dim">Create your account</Text>

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
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          testID="password"
        />

        {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}

        <Pressable
          className="items-center rounded-md bg-accent p-s3"
          onPress={signUp}
          disabled={busy}
          testID="sign-up"
        >
          {busy ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className="font-bold text-accent-ink">CREATE ACCOUNT</Text>
          )}
        </Pressable>

        <Link href="/sign-in" className="mt-s4">
          <Text className="text-sm text-text-dim">
            Already forged? <Text className="text-accent">Sign in</Text>
          </Text>
        </Link>
      </View>
    </View>
  );
}
