import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelPeople } from '@/ui/core/pixel-icons';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * SOCIAL — the tab that replaced Forge (Tyson 2026-07-18; the Forge screen now
 * opens by tapping the champion on Home). An HONEST placeholder: it says
 * COMING SOON rather than mocking a feature with no backend (the house rule —
 * a system without a backend is hidden or clearly unbuilt, never faked). The
 * shape fills in once Tyson specs the social features.
 */
export default function SocialScreen() {
  const colors = useThemeColors();
  return (
    <ScreenShell>
      <ScreenHeader kicker="THE GUILD" title="SOCIAL" />
      <GlowCard glow={colors.epic}>
        <View className="items-center py-s6">
          <View
            className="items-center justify-center rounded-xl border"
            style={{
              width: 72,
              height: 72,
              borderColor: `${colors.epic}59`,
              backgroundColor: 'rgba(168,85,247,0.08)',
            }}
          >
            <PixelPeople size={36} color={colors.epic} />
          </View>
          <Text
            className="mt-s4 text-text"
            allowFontScaling={false}
            style={{ fontSize: 20, letterSpacing: 1, textShadowColor: `${colors.epic}8c`, textShadowRadius: 14, ...pixelFont() }}
          >
            COMING SOON
          </Text>
          <Text className="mt-s2 max-w-[300px] text-center text-sm text-text-dim">
            Rivals, friends and the guild are being forged. Your training already counts toward
            it — check back soon.
          </Text>
        </View>
      </GlowCard>
    </ScreenShell>
  );
}
