import * as Haptics from 'expo-haptics';
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { FlatList, Platform, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

/**
 * DAILY WORKOUT CAROUSEL (Tyson's spec, 2026-07-15): the Train hero card,
 * swipeable one calendar day at a time.
 *
 * A horizontal FlatList with paging — RN's own directional gesture locking
 * does the right thing inside the page's vertical ScrollView: a mostly
 * vertical drag scrolls the page, a mostly horizontal drag that STARTS on
 * the card moves the day. Full-width pages + snapToInterval keep exactly one
 * card settled; neighbours peek only mid-drag, which is the spec's "subtle
 * edge". Keys are ISO dates; item layout is fixed so the initial index
 * renders without measurement.
 */
export interface DailyCarouselHandle {
  scrollToDate: (date: string) => void;
}

export const DailyWorkoutCarousel = forwardRef<
  DailyCarouselHandle,
  {
    dates: readonly string[];
    initialIndex: number;
    renderDay: (date: string) => ReactNode;
    onIndexChange?: (index: number, date: string) => void;
  }
>(function DailyWorkoutCarousel({ dates, initialIndex, renderDay, onIndexChange }, ref) {
  const [width, setWidth] = useState(0);
  const listRef = useRef<FlatList<string>>(null);
  const indexRef = useRef(initialIndex);

  useImperativeHandle(ref, () => ({
    scrollToDate: (date: string) => {
      const i = dates.indexOf(date);
      if (i >= 0) listRef.current?.scrollToIndex({ index: i, animated: true });
    },
  }));

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    const i = Math.max(0, Math.min(dates.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    // One haptic per SETTLED change — never per pixel, never repeats.
    if (i !== indexRef.current) {
      indexRef.current = i;
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      onIndexChange?.(i, dates[i]);
    }
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="daily-carousel">
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={dates as string[]}
          keyExtractor={(d) => d}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={width}
          snapToAlignment="start"
          decelerationRate="fast"
          disableIntervalMomentum
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          onMomentumScrollEnd={settle}
          // Web has no momentum events for wheel/trackpad snaps — settle on
          // plain scroll-end too (debounced by the browser).
          onScrollEndDrag={Platform.OS === 'web' ? settle : undefined}
          // ±2 neighbours rendered; history beyond stays lazy.
          initialNumToRender={3}
          windowSize={5}
          maxToRenderPerBatch={3}
          renderItem={({ item }) => <View style={{ width }}>{renderDay(item)}</View>}
        />
      ) : null}
    </View>
  );
});
