import { Children, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * CUSTOMISE §wheel — the horizontal stepper wheel. A snapping FlatList of
 * fixed-width cards with DISCRETE ‹ › buttons overlaid on its edges, so one
 * tap moves exactly one card (owner ask: no scroll-only wheels). The list
 * still swipes freely; the buttons are the precise path. Buttons hide at
 * their end of the rail rather than rendering disabled.
 */
export function StepperWheel({
  itemWidth,
  gap = 8,
  testID,
  children,
}: {
  itemWidth: number;
  gap?: number;
  testID?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  const items = Children.toArray(children);
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);
  const stride = itemWidth + gap;

  const step = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(items.length - 1, index + dir));
    setIndex(next);
    listRef.current?.scrollToIndex({ index: next, animated: true });
  };

  if (items.length === 0) return null;

  return (
    <View>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => <>{item}</>}
        keyExtractor={(_, i) => String(i)}
        snapToInterval={stride}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ gap, paddingRight: gap }}
        getItemLayout={(_, i) => ({ length: stride, offset: stride * i, index: i })}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / stride);
          setIndex(Math.max(0, Math.min(items.length - 1, i)));
        }}
        testID={testID}
      />
      {index > 0 ? (
        <Pressable
          onPress={() => step(-1)}
          accessibilityRole="button"
          accessibilityLabel="previous item"
          testID={testID ? `${testID}-prev` : 'wheel-prev'}
          className="absolute items-center justify-center rounded-md border"
          style={{
            left: 0,
            top: '50%',
            transform: [{ translateY: '-50%' as never }],
            width: 28,
            minHeight: 44,
            borderColor: `${colors.accent}59`,
            backgroundColor: 'rgba(7,11,20,0.82)',
          }}
        >
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 16, ...pixelFont() }}>
            ‹
          </Text>
        </Pressable>
      ) : null}
      {index < items.length - 1 ? (
        <Pressable
          onPress={() => step(1)}
          accessibilityRole="button"
          accessibilityLabel="next item"
          testID={testID ? `${testID}-next` : 'wheel-next'}
          className="absolute items-center justify-center rounded-md border"
          style={{
            right: 0,
            top: '50%',
            transform: [{ translateY: '-50%' as never }],
            width: 28,
            minHeight: 44,
            borderColor: `${colors.accent}59`,
            backgroundColor: 'rgba(7,11,20,0.82)',
          }}
        >
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 16, ...pixelFont() }}>
            ›
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
