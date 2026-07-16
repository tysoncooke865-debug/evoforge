import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

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
    <View
      className="flex-1 items-center justify-center p-s6"
      style={{ backgroundColor: tokens.colors['bg-deep'] }}
    >
      {/* The shell's ambient light rig — auth screens sit on the same stage. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
      <View className="w-full max-w-[420px]">
        <GlowCard>
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{
              fontSize: 30,
              lineHeight: 36,
              letterSpacing: 0,
              textShadowColor: 'rgba(34, 211, 238, 0.55)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            EVOFORGE
          </Text>
          <Text className="mb-s6 text-sm text-text-dim">Sign in to continue</Text>

          <FieldLabel>EMAIL</FieldLabel>
          <TextInput
            className="mb-s4 rounded-md border border-border bg-surface-2 p-s3 text-text"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChangeText={setEmail}
            testID="email"
          />

          <FieldLabel>PASSWORD</FieldLabel>
          <TextInput
            className="mb-s6 rounded-md border border-border bg-surface-2 p-s3 text-text"
            secureTextEntry
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            testID="password"
          />

          {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}

          <NeonButton title="SIGN IN" onPress={() => void signIn()} busy={busy} testID="sign-in" />

          <Link href="/sign-up" className="mt-s4">
            <Text className="text-sm text-text-dim">
              New here? <Text className="text-accent">Create your character</Text>
            </Text>
          </Link>
        </GlowCard>
      </View>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      className="mb-s1 text-text-mute"
      allowFontScaling={false}
      style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}
