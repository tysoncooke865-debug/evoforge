/**
 * ARCADE §1 — THE TITLE MASTHEAD.
 *
 * EVOFORGE as a game-title treatment: the pixel display face, centred like a
 * cabinet marquee, with a two-tone light bar under it instead of a glow — the
 * restraint rule from the live header holds (glow is for CTAs and rarity, not
 * a brand name). Under the title, the run status: an LV chip and a thin EXP
 * bar, which together are the live level module re-cut as a start-screen
 * status line. The whole status line is ONE door to /profile, exactly the
 * door the live module opens — never a dead button.
 *
 * Numbers are model.forgeProgress (the confirmed summary the whole app
 * levels on); progressPercent is the same pure rule that grants the level.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { progressPercent } from '@/domain/xp';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

export function ArcadeMasthead({
  level,
  xpIntoLevel,
  xpNeeded,
}: {
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const pct = progressPercent(xpIntoLevel, xpNeeded);
  const toNext = Math.max(0, xpNeeded - xpIntoLevel);
  const nextLevel = Math.min(level + 1, 100);
  // Pure width rule, never adjustsFontSizeToFit (RN-web) — Jersey 25 is
  // condensed and these sizes cannot wrap the wordmark.
  const brandSize = width >= 460 ? 40 : width >= 390 ? 34 : 28;

  return (
    // zIndex, same reason as the live masthead: oversized pressables below
    // reach up under this block, and the level door's taps must win.
    <View className="w-full items-center" style={{ zIndex: 10 }}>
      <Text
        className="text-text"
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: brandSize, lineHeight: brandSize + 6, letterSpacing: 1, ...pixelFont() }}
      >
        EVOFORGE
      </Text>
      {/* The marquee light bar — cyan into purple, the shell's own two
          ambient tints. A 2px rule, not a bloom: title treatment without a
          glow war against the character card below. */}
      <LinearGradient
        colors={[`${colors.accent}00`, colors.accent, colors.epic, `${colors.epic}00`]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ height: 2, width: Math.min(260, brandSize * 7), borderRadius: 1 }}
      />

      {/* The run status: LV chip + thin EXP bar. One pressable, one door. */}
      <Pressable
        onPress={() => router.push('/profile' as never)}
        accessibilityRole="button"
        accessibilityLabel={`Level ${level}. ${xpIntoLevel} of ${xpNeeded} experience toward level ${nextLevel}. Opens your profile.`}
        testID="arcade-level-module"
        className="mt-s2 w-full flex-row items-center"
        style={{ minHeight: 44, maxWidth: 340, gap: 10, alignSelf: 'center' }}
      >
        <View
          className="rounded-md border px-s2"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(13,21,36,0.6)', paddingVertical: 4 }}
        >
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 14, letterSpacing: 0.5, ...pixelFont() }}
          >
            LV {level}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* Thin EXP bar — same progressPercent that grants the level. */}
          <View
            className="overflow-hidden rounded-pill"
            style={{ height: 4, backgroundColor: colors['surface-3'] }}
          >
            <View
              style={{
                width: `${pct}%`,
                minWidth: pct > 0 ? 4 : 0,
                height: '100%',
                borderRadius: 999,
                backgroundColor: colors.accent,
              }}
            />
          </View>
          <Text
            className="text-text-dim"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ marginTop: 3, fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
          >
            {level >= 100 ? 'MAX LEVEL' : `EXP ${xpIntoLevel}/${xpNeeded} · ${toNext} TO LV ${nextLevel}`}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
