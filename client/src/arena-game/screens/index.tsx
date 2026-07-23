import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { NeonButton, Screen } from '../components/ui';
import { colors, spacing, typography } from '../constants/theme';
import { BALANCE_VERSION } from '../content';
import { resolveEntryRoute } from '../services/onboarding/onboarding';
import { usePlayer } from '../services/player-data/use-player';

export default function TitleScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  return (
    <Screen scroll={false} style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>FORGE YOUR CHAMPION</Text>
        <Text style={styles.logo}>EVOFORGE</Text>
        <Text style={styles.logoAccent}>ARENA</Text>
      </View>
      <View style={styles.actions}>
        {/* First-time players route through onboarding; done players go to
            the lobby (decision logic: services/onboarding/onboarding.ts). */}
        <NeonButton label="ENTER THE ARENA" onPress={() => router.push(resolveEntryRoute(save))} />
        {/* P11: the debug door is dev/opt-in only — a regular athlete's
            front door has exactly one action. */}
        {(__DEV__ || save.settings.showDebugPanel) && (
          <NeonButton label="Developer Debug" variant="secondary" onPress={() => router.push('/forge-arena/debug')} />
        )}
      </View>
      <Text style={styles.version}>beta · balance v{BALANCE_VERSION}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'space-between', paddingVertical: spacing.xl * 2 },
  hero: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  kicker: { color: colors.textDim, letterSpacing: 3, fontSize: 12, fontWeight: '600' },
  // P7: the wordmark wears the EvoForge pixel display face.
  logo: { ...typography.pixelBold, color: colors.text, fontSize: 52, letterSpacing: 4 },
  logoAccent: { ...typography.pixelBold, color: colors.cyan, fontSize: 52, letterSpacing: 10 },
  actions: { gap: spacing.md },
  version: { color: colors.textFaint, textAlign: 'center', fontSize: 12 },
});
