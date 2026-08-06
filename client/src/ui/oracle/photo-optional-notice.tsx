/**
 * "PHYSIQUE PHOTOS ARE OPTIONAL" — said before the upload, not after it.
 *
 * The Oracle's privacy line lived at the BOTTOM of the screen in 2xs muted
 * text, below both scan cards. Potential users have refused to sign up rather
 * than upload physique photos, so the one sentence that would have changed
 * their mind was underneath the thing they were refusing.
 *
 * It sits above the first upload now, states the three facts that matter, and
 * offers a real way past — SKIP FOR NOW collapses the photo cards and points
 * at what the Oracle does without a camera, so declining reads as a choice
 * rather than as abandoning setup.
 *
 * The retention claim is the true one for this surface: solo scan photos are
 * analysed and discarded, never persisted (client/CLAUDE.md). It does not say
 * "only seen by AI", because the images do leave the app.
 */

import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

export function PhotoOptionalNotice({
  skipped,
  onSkip,
  onUndo,
  testID,
}: {
  skipped: boolean;
  onSkip: () => void;
  onUndo: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();

  if (skipped) {
    return (
      <View testID={testID}>
        <GlowCard padding={14}>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            PHOTO SCANS HIDDEN
          </Text>
          <Text className="mt-s2 text-xs text-text-dim">
            Nothing is missing from your setup. The Oracle still builds and rewrites your routine
            below, and your rating still moves from the sets you log.
          </Text>
          <View className="mt-s3">
            <NeonButton title="SHOW PHOTO SCANS" variant="ghost" onPress={onUndo} testID="oracle-photos-undo" />
          </View>
        </GlowCard>
      </View>
    );
  }

  return (
    <View testID={testID}>
      <GlowCard padding={14}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 12, color: colors.accent, letterSpacing: 0, ...pixelFont() }}
        >
          PHYSIQUE PHOTOS ARE OPTIONAL
        </Text>
        <Line>You can use EvoForge without uploading photos.</Line>
        <Line>Photos are analysed in memory and are not stored.</Line>
        <Line>They are never shown on your profile or to another athlete.</Line>
        <View className="mt-s3">
          <NeonButton
            title="SKIP FOR NOW"
            variant="ghost"
            onPress={onSkip}
            testID="oracle-photos-skip"
          />
        </View>
      </GlowCard>
    </View>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-s2 flex-row gap-s2">
      <Text className="text-xs text-text-mute">·</Text>
      <Text className="flex-1 text-xs text-text-dim">{children}</Text>
    </View>
  );
}
