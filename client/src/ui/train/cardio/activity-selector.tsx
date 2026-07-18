import { Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CARDIO_ACTIVITIES } from '@/ui/train/cardio/activities';

/**
 * CARDIO_REDESIGN — CHOOSE ACTIVITY. Pixel-iconed cards (no emoji) in a
 * compact wrap. The selected card glows cyan and lifts; the rest stay clear
 * but subdued. Picking one drives the form's fields below it.
 */
export function ActivityTypeSelector({
  type,
  onSelect,
}: {
  type: string;
  onSelect: (type: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {CARDIO_ACTIVITIES.map((a) => {
        const active = a.type === type;
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
              width: '48%',
              minHeight: 62,
              borderColor: active ? colors.accent : colors.border,
              backgroundColor: active ? 'rgba(34,211,238,0.1)' : colors['surface-2'],
              shadowColor: colors.accent,
              shadowOpacity: active ? 0.4 : 0,
              shadowRadius: 12,
              transform: [{ scale: active ? 1.02 : 1 }],
            }}
          >
            <View className="flex-row items-center" style={{ gap: 8 }}>
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
            <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={2}>
              {a.blurb}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
