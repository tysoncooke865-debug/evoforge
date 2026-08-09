import { Pressable, Text, View } from 'react-native';

import { DUEL_REACTIONS, type DuelReactionKey } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/*
 * SPLIT OUT OF `supporter-meter.tsx`, WHICH IS GONE (Phase 7).
 *
 * Third-party staking is retired (V5_MIGRATION_AUDIT.md §4, migration 164), and
 * the meter, the estimate and the position went with it. Reactions did NOT:
 * spectating survives with no coins attached, and it was only ever housed in that
 * file because supporters were the people doing the reacting.
 */

/**
 * REACTIONS — five glyphs, toggled.
 *
 * The vocabulary is closed on purpose: a fixed set cannot carry a message, so
 * it needs no moderation, and the primary key caps one athlete at five rows
 * however fast they tap. That is a cheaper rate limit than a counter and one
 * that cannot drift.
 */
export function DuelReactions({
  counts,
  mine,
  onToggle,
  disabled = false,
  testID,
}: {
  counts: Record<string, number>;
  mine: readonly string[];
  onToggle: (emoji: DuelReactionKey, on: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }} testID={testID}>
      {DUEL_REACTIONS.map((r) => {
        const on = mine.includes(r.key);
        const n = counts[r.key] ?? 0;
        return (
          <Pressable
            key={r.key}
            onPress={disabled ? undefined : () => onToggle(r.key, !on)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`${r.label}${n ? `, ${n}` : ''}`}
            testID={`duel-react-${r.key}`}
            className="flex-row items-center rounded-pill border px-s3"
            style={{
              gap: 5,
              minHeight: 44,
              opacity: disabled ? 0.45 : 1,
              borderColor: on ? `${colors.accent}8c` : colors.border,
              backgroundColor: on ? 'rgba(34,211,238,0.1)' : 'rgba(13,21,36,0.5)',
            }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 15 }}>{r.glyph}</Text>
            {n > 0 ? (
              <Text
                allowFontScaling={false}
                style={{ fontSize: 11, color: on ? colors.accent : colors['text-dim'], ...pixelFont() }}
              >
                {n}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
