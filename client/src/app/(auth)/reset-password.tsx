import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

/**
 * PASSWORD RESET — both halves of the flow on one screen.
 *
 * REQUEST: no session, so we ask for the email and send the recovery mail.
 * CHOOSE:  arriving from the mailed link, supabase-js (detectSessionInUrl) has
 *          already exchanged the token for a recovery session — so we can call
 *          updateUser directly. `?mode=set` also forces this half, which is how
 *          native deep links land here.
 *
 * The recovery session IS a real session, so the (auth) layout would normally
 * bounce a signed-in visitor out to the app. This screen is exempt (see the
 * layout's allowlist) — otherwise the link drops you on Home with the old
 * password still in force and no way to change it.
 */
export default function ResetPasswordScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [recovering, setRecovering] = useState(params.mode === 'set');

  // A PASSWORD_RECOVERY event (or an existing session on this route) means the
  // athlete came in from the mail link and should be choosing a new password.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendLink = async () => {
    setBusy(true);
    setError(null);
    const redirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password?mode=set`
        : undefined;
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    // Never reveal whether the address is registered — always claim success.
    if (err && !/rate|limit|seconds/i.test(err.message)) setSent(true);
    else if (err) setError(err.message);
    else setSent(true);
    setBusy(false);
  };

  const choosePassword = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) setError(err.message);
    else setDone(true);
    setBusy(false);
  };

  const heading = (t: string) => (
    <Text
      className="text-accent"
      allowFontScaling={false}
      style={{ fontSize: 24, lineHeight: 30, textShadowColor: 'rgba(34,211,238,0.55)', textShadowRadius: 18, ...pixelFont() }}
    >
      {t}
    </Text>
  );

  return (
    <View className="flex-1 items-center justify-center p-s6" style={{ backgroundColor: colors['bg-deep'] }}>
      <View className="w-full max-w-[420px]">
        <GlowCard glow={colors.accent}>
          {done ? (
            <>
              {heading('PASSWORD SET')}
              <Text className="mt-s2 text-sm text-text-dim">
                Your new password is live. Sign in with it to get back to your character.
              </Text>
              <Link href="/sign-in" className="mt-s4">
                <Text className="text-accent">Go to sign in</Text>
              </Link>
            </>
          ) : recovering ? (
            <>
              {heading('CHOOSE A PASSWORD')}
              <Text className="mt-s2 mb-s4 text-sm text-text-dim">Pick something at least 8 characters long.</Text>
              <TextInput
                className="mb-s4 rounded-md border border-border bg-surface-2 p-s3 text-text"
                secureTextEntry
                autoComplete="new-password"
                accessibilityLabel="New password"
                placeholder="New password"
                placeholderTextColor="#64758f"
                value={password}
                onChangeText={setPassword}
                testID="new-password"
              />
              {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}
              <NeonButton
                title="SAVE PASSWORD"
                onPress={() => void choosePassword()}
                busy={busy}
                disabled={password.length < 8}
                testID="save-password"
              />
            </>
          ) : sent ? (
            <>
              {heading('CHECK YOUR EMAIL')}
              <Text className="mt-s2 text-sm text-text-dim">
                If {email.trim()} has an account, a reset link is on its way. It can take a
                minute — check your spam folder too.
              </Text>
              <Link href="/sign-in" className="mt-s4">
                <Text className="text-accent">Back to sign in</Text>
              </Link>
            </>
          ) : (
            <>
              {heading('RESET PASSWORD')}
              <Text className="mt-s2 mb-s4 text-sm text-text-dim">
                Enter your email and we’ll send you a link to choose a new password.
              </Text>
              <TextInput
                className="mb-s4 rounded-md border border-border bg-surface-2 p-s3 text-text"
                autoCapitalize="none"
                autoComplete="email"
                inputMode="email"
                accessibilityLabel="Email"
                placeholder="you@example.com"
                placeholderTextColor="#64758f"
                value={email}
                onChangeText={setEmail}
                testID="reset-email"
              />
              {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}
              <NeonButton
                title="SEND RESET LINK"
                onPress={() => void sendLink()}
                busy={busy}
                disabled={!email.includes('@')}
                testID="send-reset"
              />
              <Link href="/sign-in" className="mt-s4">
                <Text className="text-sm text-text-dim">Remembered it? <Text className="text-accent">Sign in</Text></Text>
              </Link>
            </>
          )}
        </GlowCard>
      </View>
    </View>
  );
}
