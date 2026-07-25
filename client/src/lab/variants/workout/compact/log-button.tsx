import { ActivityIndicator, Pressable, Text } from 'react-native';

import { XP_PER_SET } from '@/domain/xp';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import type { LogState } from './model';

/**
 * COMPACT variant — the three-state LOG button (req 13):
 *   next   — the ONE recommended set page-wide: solid accent + the page's
 *            strongest glow (policy-sanctioned: primary CTA);
 *   idle   — available but not current: dark fill, cyan outline, no shadow;
 *   logged — ✓ LOGGED, accent-tinted fill; state carried by check + text,
 *            never colour alone (req 20).
 * Every state shows the honest +10 XP line (XP_PER_SET — a set is worth 10,
 * exactly; the design brief's '+15 XP' does not exist in this codebase).
 */
export function LogButton({
  state,
  saving,
  onPress,
  testID,
}: {
  state: LogState;
  saving: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  const logged = state === 'logged';
  const next = state === 'next';
  return (
    <Pressable
      onPress={onPress}
      disabled={saving}
      accessibilityRole="button"
      accessibilityLabel={logged ? 'update this set' : 'log this set'}
      accessibilityState={{ selected: logged }}
      className="ml-auto items-center justify-center rounded-md"
      style={{
        minWidth: 74,
        minHeight: 44,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: next
          ? colors.accent
          : logged
            ? `${colors.accent}40`
            : `${colors.accent}59`,
        backgroundColor: next
          ? colors.accent
          : logged
            ? `${colors.accent}14`
            : colors['surface-2'],
        ...(next
          ? { shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 10, elevation: 5 }
          : null),
      }}
      testID={testID}
    >
      {saving ? (
        <ActivityIndicator size="small" color={next ? colors['accent-ink'] : colors.accent} />
      ) : (
        <>
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 13,
              letterSpacing: 0.5,
              color: next ? colors['accent-ink'] : logged ? colors['text-dim'] : colors.accent,
              ...pixelFont(),
            }}
          >
            {logged ? '✓ LOGGED' : 'LOG SET'}
          </Text>
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 9,
              letterSpacing: 0.5,
              color: next ? colors['accent-ink'] : `${colors.accent}b0`,
              ...pixelFont(false),
            }}
          >
            +{XP_PER_SET} XP
          </Text>
        </>
      )}
    </Pressable>
  );
}
