/**
 * STILLNESS COPY of ui/home/next-rank-card.tsx (Page Lab, forked 2026-08-18).
 *
 * HOME §1a — NEXT RANK, as a rail inside the Evo crest.
 *
 * It shipped on 2026-08-03 as a standalone card between the champion and the
 * mission. The PREMIUM PASS the same day merged it INTO the rating block, and
 * the reason is hierarchy, not space (though it bought ~58pt of fold, which is
 * what paid for the bigger numeral and its subtitle):
 *
 *   The card was a second purple module, with its own 20pt tier name, its own
 *   40pt badge and its own tap target, sitting one section below a purple
 *   rating with the same accent. Two modules about ONE number is exactly the
 *   duplicate the brief asks to merge — and while both were on screen neither
 *   could be the page's single answer to "who am I".
 *
 * Nothing was lost. The tier name, the countdown, the sub-integer bar and the
 * door to /evo all survive; they are now the bottom line of the crest, which
 * is where the sentence they finish begins. `testID="next-rank-card"` is kept
 * on the rail so existing tours and help targeting still find it.
 *
 * Every value is real: the ladder is EVO_RATING_TIERS (the same descriptors
 * /evo and the leaderboard use) and the position between tiers comes from the
 * review's own `evolution_progress` hundredths, so "4 EVO TO GO" is arithmetic
 * on the athlete's actual rating, not a motivational number.
 */

import { Text, View } from 'react-native';

import { evoTierStanding } from '@/domain/progression/evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * The rail. Renders NOTHING of its own chrome — no border, no background, no
 * press handler: it is drawn inside the crest's own Pressable, so the whole
 * identity block is one tap target instead of two.
 */
export function NextRankRail({
  rating,
  evolutionProgress,
}: {
  rating: number;
  /** The review's stored hundredths toward the next integer. */
  evolutionProgress: number;
}) {
  const colors = useThemeColors();
  const standing = evoTierStanding(rating, evolutionProgress);
  const maxed = standing.nextTier === null;

  return (
    <View className="w-full" testID="next-rank-card">
      <View className="mb-s1 flex-row items-end justify-between" style={{ gap: 8 }}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            flex: 1,
            fontSize: 10,
            letterSpacing: 1.4,
            color: colors['text-dim'],
            ...pixelFont(false),
          }}
        >
          {maxed ? 'THE SUMMIT' : 'NEXT RANK'}
          <Text style={{ color: colors.epic }}>
            {`  ·  ${(maxed ? standing.tier : standing.nextTier ?? '').toUpperCase()}`}
          </Text>
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          testID="next-rank-togo"
          style={{ fontSize: 12, letterSpacing: 0.5, color: colors.epic, ...pixelFont() }}
        >
          {maxed ? 'MAX' : `${standing.evoToGo} TO GO`}
        </Text>
      </View>
      <ProgressBar value={standing.progress} colour={colors.epic} track={colors['surface-3']} />
    </View>
  );
}

/** The tier bar. STILLNESS: the live rail passes a sheen across the filled
 *  portion every 3.2s; here the fill is solid and still — the rail is a
 *  measurement, and a measurement that glints reads as a promotion. */
function ProgressBar({ value, colour, track }: { value: number; colour: string; track: string }) {
  return (
    <View className="w-full overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: track }}>
      <View
        className="rounded-pill"
        style={{
          width: `${Math.round(value * 100)}%`,
          minWidth: value > 0 ? 6 : 0,
          height: '100%',
          backgroundColor: colour,
        }}
      />
    </View>
  );
}
