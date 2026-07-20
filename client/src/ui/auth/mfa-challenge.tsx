import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { supabase } from '@/data/supabase';
import { listTotpFactors, verifyTotp } from '@/data/mfa';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

/**
 * The 2FA gate: shown by the authed layout while the session is aal1 but the
 * account has a verified TOTP factor. Nothing else in the app renders until a
 * valid code lands — the sign-out escape hatch prevents a lockout.
 */
export function MfaChallenge({ onVerified }: { onVerified: () => void }) {
  const colors = useThemeColors();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listTotpFactors().then((fs) => {
      if (!live) return;
      setFactorId(fs.find((f) => f.status === 'verified')?.id ?? null);
    });
    return () => { live = false; };
  }, []);

  const submit = async () => {
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factorId, code);
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work.');
      setCode('');
    }
    setBusy(false);
  };

  return (
    <View className="flex-1 items-center justify-center p-s6" style={{ backgroundColor: colors['bg-deep'] }}>
      <View className="w-full max-w-[420px]">
        <GlowCard glow={colors.accent}>
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 24, lineHeight: 30, textShadowColor: 'rgba(34,211,238,0.55)', textShadowRadius: 18, ...pixelFont() }}
          >
            TWO-FACTOR
          </Text>
          <Text className="mt-s2 text-sm text-text-dim">
            Enter the 6-digit code from your authenticator app to finish signing in.
          </Text>

          <TextInput
            className="mt-s4 min-h-[54px] rounded-xl border bg-surface-2 px-s3 text-center text-2xl font-bold text-text"
            style={{ letterSpacing: 10, borderColor: code.length === 6 ? `${colors.accent}8c` : colors.border }}
            placeholder="——————"
            placeholderTextColor="#64758f"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            testID="mfa-code"
          />

          {error ? <Text className="mt-s3 text-sm text-danger">{error}</Text> : null}

          <View className="mt-s4">
            <NeonButton
              title="VERIFY"
              onPress={() => void submit()}
              busy={busy}
              disabled={code.length !== 6 || !factorId}
              testID="mfa-verify"
            />
          </View>

          <Pressable
            onPress={() => void supabase.auth.signOut()}
            accessibilityRole="button"
            testID="mfa-signout"
            className="mt-s4 items-center"
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>SIGN OUT INSTEAD</Text>
          </Pressable>
        </GlowCard>
      </View>
    </View>
  );
}
