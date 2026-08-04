import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CARDIO_ACTIVITIES } from '@/ui/train/cardio/activities';

/**
 * CARDIO_REDESIGN — CHOOSE ACTIVITY. Pixel-iconed cards (no emoji) in a
 * compact wrap. The selected card glows cyan, lifts, and gets a small tick —
 * a colour change is never the only cue. Picking one drives the form's
 * fields below it. `type: null` is "nothing chosen yet" — the mission's own
 * CHOOSE ACTIVITY state, not a silently pre-picked default.
 *
 * THE LAST CARD SPANS FULL WIDTH when the catalogue is odd-length (2026-08-04:
 * seven activities in a two-column wrap leaves OTHER alone on its own row at
 * half width — an empty-looking gap beside it that a full-width row reads as
 * intentional instead of unfinished).
 */
export function ActivityTypeSelector({
  type,
  onSelect,
}: {
  type: string | null;
  onSelect: (type: string) => void;
}) {
  const colors = useThemeColors();
  const lastIsAlone = CARDIO_ACTIVITIES.length % 2 === 1;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {CARDIO_ACTIVITIES.map((a, i) => {
        const active = a.type === type;
        const full = lastIsAlone && i === CARDIO_ACTIVITIES.length - 1;
        return (
          <Pressable
            key={a.type}
            onPress={() => onSelect(a.type)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${a.label} — ${a.blurb}`}
            testID={`cardio-type-${a.type.toLowerCase().replace(/\s+/g, '-')}`}
            className="rounded-lg border p-s3"
            style={{
              width: full ? '100%' : '48%',
              minHeight: 62,
              borderColor: active ? colors.accent : colors.border,
              backgroundColor: active ? 'rgba(34,211,238,0.1)' : colors['surface-2'],
              shadowColor: colors.accent,
              shadowOpacity: active ? 0.4 : 0,
              shadowRadius: 12,
              transform: [{ scale: active ? 1.02 : 1 }],
            }}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center" style={{ gap: 8, flexShrink: 1 }}>
                <a.Icon size={18} color={active ? colors.accent : colors['text-dim']} />
                <Text
                  className={active ? 'text-text' : 'text-text-dim'}
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont() }}
                >
                  {a.label}
                </Text>
              </View>
              {active ? (
                <View
                  className="items-center justify-center rounded-full"
                  style={{ width: 16, height: 16, backgroundColor: colors.accent }}
                >
                  <Text style={{ fontSize: 10, lineHeight: 12, color: colors['accent-ink'], fontWeight: '800' }}>
                    ✓
                  </Text>
                </View>
              ) : null}
            </View>
            <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={2}>
              {a.blurb}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
