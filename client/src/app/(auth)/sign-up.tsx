import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

export default function SignUpScreen() {
  const colors = useThemeColors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [resent, setResent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  // Explicit consent is required to create an account — recorded as an
  // affirmative action (a ticked box), not a pre-ticked default.
  const [agreed, setAgreed] = useState(false);

  // The confirmation mail is the ONLY way in, so a mail that never lands is a
  // dead end. Offer one resend rather than making them sign up again (which
  // errors with "already registered" and traps them completely).
  const resend = async () => {
    setResent('sending');
    const { error: err } = await supabase.auth.resend({ type: 'signup', email });
    setResent(err ? 'failed' : 'sent');
  };

  const signUp = async () => {
    if (!agreed) {
      setError('Please agree to the Terms and Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
    } else if (data.user && (data.user.identities?.length ?? 0) === 0) {
      // Supabase does NOT error on a duplicate signup (that would leak which
      // emails are registered) — it returns a user with no identities and no
      // session, which is indistinguishable from a fresh signup. Without this
      // branch a returning athlete is told to check an inbox no mail is ever
      // sent to, and there is no way out of that screen.
      setError('That email already has an account. Sign in instead — or reset your password.');
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
      <AuthStage>
        <GlowCard glow={colors.accent}>
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{
              fontSize: 24,
              lineHeight: 30,
              textShadowColor: 'rgba(34, 211, 238, 0.55)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            CHECK YOUR EMAIL
          </Text>
          <Text className="mt-s2 text-sm text-text-dim">
            We sent a confirmation link to {email}. Open it, then sign in. It can take
            a minute or two — check your spam folder if it hasn’t arrived.
          </Text>
          <View className="mt-s4">
            <NeonButton
              title={resent === 'sent' ? 'LINK RESENT' : 'RESEND THE LINK'}
              variant="ghost"
              busy={resent === 'sending'}
              disabled={resent === 'sent'}
              onPress={() => void resend()}
              testID="signup-resend"
            />
          </View>
          {resent === 'failed' ? (
            <Text className="mt-s2 text-2xs text-danger">
              Couldn’t resend just yet — wait a minute and try again.
            </Text>
          ) : null}
          <Link href="/sign-in" className="mt-s4">
            <Text className="text-accent">Back to sign in</Text>
          </Link>
        </GlowCard>
      </AuthStage>
    );
  }

  return (
    <AuthStage>
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
        <Text className="mb-s6 text-sm text-text-dim">Create your account</Text>

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
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          testID="password"
        />

        {/* Affirmative consent to the Terms + Privacy Policy (GDPR/App Store). */}
        <Pressable
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          testID="signup-agree"
          className="mb-s4 flex-row items-start"
          style={{ gap: 10 }}
        >
          <View
            style={{
              width: 22, height: 22, borderRadius: 6, marginTop: 1, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderColor: agreed ? colors.accent : colors.border,
              backgroundColor: agreed ? `${colors.accent}22` : 'transparent',
            }}
          >
            {agreed ? <Text allowFontScaling={false} style={{ fontSize: 13, color: colors.accent }}>✓</Text> : null}
          </View>
          <Text className="flex-1 text-2xs text-text-dim" style={{ lineHeight: 17 }}>
            I’m 16 or older and I agree to the{' '}
            <Text className="text-accent" onPress={() => router.push('/legal?doc=terms' as never)}>Terms of Use</Text>,{' '}
            <Text className="text-accent" onPress={() => router.push('/legal?doc=privacy' as never)}>Privacy Policy</Text>{' '}
            and{' '}
            <Text className="text-accent" onPress={() => router.push('/legal?doc=ai' as never)}>AI &amp; Health notice</Text>.
          </Text>
        </Pressable>

        {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}

        <NeonButton title="CREATE ACCOUNT" onPress={() => void signUp()} busy={busy} disabled={!agreed} testID="sign-up" />

        <Link href="/sign-in" className="mt-s4">
          <Text className="text-sm text-text-dim">
            Already forged? <Text className="text-accent">Sign in</Text>
          </Text>
        </Link>
      </GlowCard>
    </AuthStage>
  );
}

/** The shell's ambient light rig — auth screens sit on the same stage. */
function AuthStage({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-1 items-center justify-center p-s6"
      style={{ backgroundColor: colors['bg-deep'] }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
      <View className="w-full max-w-[420px]">{children}</View>
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
