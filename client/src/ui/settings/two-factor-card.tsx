import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { enrollTotp, listTotpFactors, unenrollTotp, verifyTotp, type MfaFactor } from '@/data/mfa';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

/**
 * TWO-FACTOR AUTHENTICATION (TOTP) — enrol an authenticator app on your phone,
 * then every sign-in needs a 6-digit code as well as the password. Scan the QR
 * or type the secret; the code proves it worked before the factor is armed.
 */
export function TwoFactorCard() {
  const colors = useThemeColors();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<{ factorId: string; secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // load() only ever setStates from the async callback — safe inside an effect.
  const load = () => { void listTotpFactors().then((fs) => { setFactors(fs); setLoading(false); }); };
  const refresh = () => { setLoading(true); load(); }; // handlers only
  useEffect(() => { load(); }, []);
  const active = factors.find((f) => f.status === 'verified') ?? null;

  const begin = async () => {
    setBusy(true); setError(null);
    try {
      const s = await enrollTotp('EvoForge');
      setSetup({ factorId: s.factorId, secret: s.secret, qr: s.qr });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start setup.');
    }
    setBusy(false);
  };

  const confirm = async () => {
    if (!setup) return;
    setBusy(true); setError(null);
    try {
      await verifyTotp(setup.factorId, code);
      setSetup(null); setCode('');
      useToastStore.getState().push({ kind: 'achievement', title: '2FA ENABLED', subtitle: 'Your account now needs a code to sign in.' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work.');
      setCode('');
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!active) return;
    setBusy(true); setError(null);
    try {
      await unenrollTotp(active.id);
      useToastStore.getState().push({ kind: 'info', title: '2FA REMOVED', subtitle: 'Password only from now on.' });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove it.');
    }
    setBusy(false);
  };

  return (
    <GlowCard>
      <View className="flex-row items-center justify-between">
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, letterSpacing: 1.5, ...pixelFont(false) }}>
          TWO-FACTOR AUTHENTICATION
        </Text>
        {!loading ? (
          <Text
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1, color: active ? colors.success : colors['text-mute'], ...pixelFont(false) }}
            testID="mfa-status"
          >
            {active ? 'ON ✓' : 'OFF'}
          </Text>
        ) : null}
      </View>

      {setup ? (
        <View className="mt-s3" style={{ gap: 10 }}>
          <Text className="text-2xs text-text-dim">
            Scan this with your authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows.
          </Text>
          {setup.qr ? (
            <View className="items-center">
              <Image source={{ uri: setup.qr }} style={{ width: 168, height: 168, backgroundColor: '#fff', borderRadius: 8 }} contentFit="contain" />
            </View>
          ) : null}
          <Text className="text-2xs text-text-mute">Can’t scan? Enter this key manually:</Text>
          <Text selectable className="text-center text-sm text-text" style={{ letterSpacing: 2, ...pixelFont() }} testID="mfa-secret">
            {setup.secret}
          </Text>
          <TextInput
            className="min-h-[48px] rounded-md border bg-surface-2 px-s3 text-center text-xl font-bold text-text"
            style={{ letterSpacing: 8, borderColor: code.length === 6 ? `${colors.accent}8c` : colors.border }}
            placeholder="——————"
            placeholderTextColor="#64758f"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
            testID="mfa-enroll-code"
          />
          {error ? <Text className="text-2xs text-danger">{error}</Text> : null}
          <NeonButton title="CONFIRM & ENABLE" onPress={() => void confirm()} busy={busy} disabled={code.length !== 6} testID="mfa-enroll-confirm" />
          <Pressable onPress={() => { setSetup(null); setCode(''); setError(null); }} accessibilityRole="button" className="items-center" style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>CANCEL</Text>
          </Pressable>
        </View>
      ) : active ? (
        <View className="mt-s2" style={{ gap: 10 }}>
          <Text className="text-2xs text-text-dim">
            Sign-in needs a code from your authenticator app. Keep a backup of your authenticator — losing it locks you out.
          </Text>
          {error ? <Text className="text-2xs text-danger">{error}</Text> : null}
          <NeonButton title="TURN OFF 2FA" variant="ghost" onPress={() => void remove()} busy={busy} testID="mfa-remove" />
        </View>
      ) : (
        <View className="mt-s2" style={{ gap: 10 }}>
          <Text className="text-2xs text-text-dim">
            Add a second step to sign-in with an authenticator app on your phone — so a stolen password isn’t enough.
          </Text>
          {error ? <Text className="text-2xs text-danger">{error}</Text> : null}
          <NeonButton title="ENABLE 2FA" onPress={() => void begin()} busy={busy} testID="mfa-enable" />
        </View>
      )}
    </GlowCard>
  );
}
