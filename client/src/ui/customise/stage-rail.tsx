import { Image, type ImageSource } from 'expo-image';
import type { ImageSourcePropType } from 'react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { PIXEL } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';

/**
 * CUSTOMISE §stage rail — the evolution stages as a slim VERTICAL rail
 * hugging the right edge of the podium box (owner ask: click through
 * stages without leaving the display). One compact tile per stage:
 * number, mini sprite, lock when gated. Renders NOTHING for ≤1 stage —
 * a single-form character (or a champion with no ladder) gets no rail
 * forced on it. Overflowing ladders scroll inside the rail.
 */

export interface StageRailItem {
  key: string;
  /** 1-based stage number shown on the tile. */
  stageNo: number;
  sprite: ImageSource | ImageSourcePropType | undefined;
  pixelated: boolean;
  selected: boolean;
  locked: boolean;
  accessibilityLabel: string;
  testID: string;
  onPress: () => void;
}

export function StageRail({ items, maxHeight }: { items: StageRailItem[]; maxHeight: number }) {
  const colors = useThemeColors();
  if (items.length <= 1) return null;
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ maxHeight, flexGrow: 0 }}
      contentContainerStyle={{ gap: 6 }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => {
            playSelect();
            item.onPress();
          }}
          accessibilityRole="button"
          accessibilityLabel={item.accessibilityLabel}
          testID={item.testID}
          className="items-center rounded-lg border p-s1"
          style={{
            width: 52,
            minHeight: 56,
            borderColor: item.selected ? `${colors.accent}b3` : item.locked ? 'rgba(120,170,220,0.10)' : colors.border,
            backgroundColor: item.selected ? 'rgba(34,211,238,0.12)' : 'rgba(13,21,36,0.6)',
            shadowColor: colors.accent,
            shadowOpacity: item.selected ? 0.4 : 0,
            shadowRadius: 10,
            elevation: item.selected ? 4 : 0,
          }}
        >
          <Text
            allowFontScaling={false}
            style={{
              fontSize: 7,
              color: item.selected ? colors.accent : colors['text-mute'],
              fontFamily: PIXEL,
              letterSpacing: 0.5,
            }}
          >
            S{item.stageNo}
          </Text>
          <View className="items-center justify-center" style={{ height: 38 }}>
            {item.sprite ? (
              <Image
                source={item.sprite}
                style={{
                  width: 32,
                  height: 36,
                  opacity: item.locked ? 0.35 : 1,
                  ...(item.pixelated ? ({ imageRendering: 'pixelated' } as object) : {}),
                }}
                contentFit="contain"
              />
            ) : (
              <Text style={{ fontSize: 16, opacity: 0.3 }}>👤</Text>
            )}
            {item.locked ? (
              <Text style={{ position: 'absolute', bottom: -2, right: -4, fontSize: 9 }}>🔒</Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
