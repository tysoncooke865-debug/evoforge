import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { PixelMuscle, PixelShield } from '@/ui/core/pixel-icons';
import { GlowCard } from '@/ui/core/shell';
import { ThinBar } from '@/ui/fuel/progress-bar';

/**
 * FUEL_REDESIGN — the protein goal, dressed as a game reward card. It
 * promises NOTHING the progression system doesn't grant: no XP kind exists
 * for nutrition, so the card celebrates the target itself (hidden-never-
 * mocked rule — the reference mock's "+10% Recovery XP" has no backend; a
 * real reward can be wired through the `reward` line when one exists).
 */
export function FuelBonusCard({
  proteinTarget,
  proteinConsumed,
  dinnerLogged,
}: {
  proteinTarget: number;
  proteinConsumed: number;
  /** Whether the DINNER slot holds an entry — drives the recommendation. */
  dinnerLogged: boolean;
}) {
  const colors = useThemeColors();
  const remaining = Math.max(0, proteinTarget - proteinConsumed);
  const hit = proteinTarget > 0 && remaining === 0;
  const tint = hit ? colors.success : colors.epic;
  return (
    <GlowCard glow={tint}>
      <View className="flex-row" style={{ gap: 14 }}>
        <View className="items-center justify-center" style={{ width: 56 }}>
          <View
            className="items-center justify-center rounded-lg border"
            style={{
              width: 54,
              height: 54,
              borderColor: `${tint}8c`,
              backgroundColor: `${tint}14`,
            }}
          >
            {hit ? (
              <PixelShield size={26} color={tint} />
            ) : (
              <PixelMuscle size={26} color={tint} />
            )}
          </View>
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, color: tint, ...pixelFont(false) }}
          >
            PROTEIN GOAL
          </Text>
          <Text className="mt-s1 text-sm font-bold text-text">
            {hit
              ? `Protein target hit — ${proteinConsumed}g logged today.`
              : `Hit ${proteinTarget}g protein today to fuel recovery.`}
          </Text>
          <View className="mt-s2 flex-row items-center justify-between">
            <Text
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 0.5, color: tint, ...pixelFont(false) }}
              testID="fuel-protein-remaining"
            >
              {hit ? '✓ COMPLETE' : `${remaining}G PROTEIN REMAINING`}
            </Text>
          </View>
          <View className="mt-s1">
            <ThinBar
              pct={proteinTarget > 0 ? (proteinConsumed / proteinTarget) * 100 : 0}
              color={tint}
              height={6}
            />
          </View>
          {!hit && !dinnerLogged ? (
            <View
              className="mt-s2 self-start rounded-md border px-s2 py-s1"
              style={{ borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.07)' }}
            >
              <Text className="text-2xs text-text-dim">✦ High-protein dinner recommended</Text>
            </View>
          ) : null}
        </View>
      </View>
    </GlowCard>
  );
}
