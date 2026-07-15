import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { RecentPr } from '@/domain/recent-pr';
import type { WeightUnit } from '@/domain/units';
import { kgToLb } from '@/domain/units';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-07-14' → 'Jul 14'. */
const shortDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/**
 * HOME_REDESIGN §8 — RECENT PR: the newest personal record, replayed from
 * the athlete's own rows by set-save's e1RM rule. Weight honours the
 * per-exercise KG⇄LB preference (display courtesy — the database is kg
 * forever). No PR yet is an honest invitation, not a fake record.
 */
export function RecentPrCard({ pr, unit }: { pr: RecentPr | null; unit: WeightUnit }) {
  const weight =
    pr === null
      ? null
      : unit === 'lb'
        ? `${kgToLb(pr.weightKg).toFixed(1)}`
        : `${pr.weightKg % 1 === 0 ? pr.weightKg.toFixed(0) : pr.weightKg.toFixed(1)}`;
  return (
    <Pressable
      onPress={() => router.push('/progress' as never)}
      accessibilityRole="button"
      accessibilityLabel={
        pr
          ? `Recent PR: ${pr.exercise}, ${weight} ${unit === 'lb' ? 'pounds' : 'kilograms'} for ${pr.reps} reps on ${shortDate(pr.date)}. Opens Progress.`
          : 'No PR yet. Log your first workout to begin tracking records.'
      }
      testID="recent-pr-card"
      className="rounded-xl border p-s4"
      style={{ flex: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <Text className="text-2xs font-bold" style={{ letterSpacing: 2, color: tokens.colors.success }}>
        RECENT PR
      </Text>
      {pr ? (
        <>
          <Text className="mt-s1 text-sm text-text" numberOfLines={1} ellipsizeMode="tail">
            {pr.exercise}
          </Text>
          <View className="mt-s1 flex-row items-baseline" style={{ gap: 4 }}>
            <Text className="text-text" allowFontScaling={false} style={{ fontSize: 22, letterSpacing: 0, ...pixelFont() }}>
              {weight}
            </Text>
            <Text className="text-text-dim" allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 0, ...pixelFont(false) }}>
              {unit.toUpperCase()}
            </Text>
          </View>
          <Text className="text-2xs" style={{ color: tokens.colors.success }}>
            {pr.reps} rep{pr.reps === 1 ? '' : 's'}
          </Text>
          <Text className="text-2xs text-text-mute">{shortDate(pr.date)}</Text>
        </>
      ) : (
        <>
          <Text className="mt-s1 text-sm font-bold text-text">NO PR YET</Text>
          <Text className="mt-s1 text-2xs text-text-dim">Log your first workout to begin tracking records.</Text>
        </>
      )}
    </Pressable>
  );
}
