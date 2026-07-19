import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import { FlatList, Platform, ScrollView, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/theme/use-theme';
import { clearActiveScroller, setActiveScroller } from '@/ui/core/scroll-registry';

/**
 * The screen shell: near-black stage lighting instead of a flat background.
 * Two huge blurred radial glows -- cyan upper-left, purple upper-right -- the
 * same light rig assets/styles.css paints behind .stApp. Every screen sits on
 * this so depth is ambient, not per-card.
 *
 * Safe areas: top inset respected (notch / dynamic island), and the content
 * always bottom-pads past the tab bar so nothing hides behind it -- on iOS
 * Safari the browser chrome + home indicator make this the #1 layout bug.
 */
export function ScreenShell({
  children,
  refreshControl,
}: {
  children: ReactNode;
  /** Optional pull-to-refresh element, passed straight to the ScrollView
   *  (first consumer: /rank, 2026-07-19). */
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // P2 C4: the FOCUSED shell owns the scroll-to-top registration; blur
  // clears it (focus-scoped — never keyed by pathname, see scroll-registry).
  const scrollRef = useRef<ScrollView>(null);
  // OPTIMISE_PLAN M1 — the screen entrance: every focus fades + rises the
  // content once (220ms, one-shot; never re-fires on scroll). Reduced
  // motion pins it fully visible.
  const reducedMotion = useReducedMotion();
  // THE PAGE-CHANGE FLASH/FREEZE (Tyson's iPhone, iOS 18 WebKit, 2026-07-18;
  // beacon-proven current bundle + zero errors): this entrance used to set
  // opacity to 0 ON EVERY FOCUS and animate to 1 — gating the whole screen's
  // VISIBILITY on an animation frame. Under page-change load an older engine
  // stalls that frame: the new page sits invisible, then pops. Same doctrine
  // as the boot fade: visibility must never depend on an animation firing.
  // Web now pins the screen visible (no entrance); native builds keep it.
  const animateEntrance = Platform.OS !== 'web' && !reducedMotion;
  const enter = useSharedValue(animateEntrance ? 0 : 1);
  useFocusEffect(
    useCallback(() => {
      const toTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
      setActiveScroller(toTop);
      if (animateEntrance) {
        enter.value = 0;
        enter.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) });
      }
      return () => clearActiveScroller(toTop);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animateEntrance])
  );
  // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson): className
  // interop drops composed styles on Animated.View on web.
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 6 }],
  }));
  return (
    <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }}>
      {/* Quiet ambient light — recessive enough that the header owns the top. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="items-center px-s4"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 14),
          // Clear the tab bar (54 + bottom inset) with real breathing room, so
          // a card's footer controls (+ SET / − SET / SKIP) never hide behind
          // the nav (Tyson 2026-07-16).
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        <Animated.View style={[{ width: '100%', alignItems: 'center' }, enterStyle]}>
          <View className="w-full max-w-[560px] gap-s3">{children}</View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/**
 * B6 (2026-07-19): the LIST shell — ScreenShell's exact frame (bg, ambient
 * blobs, insets, scroll-to-top registry, tab-bar clearance) around a
 * VIRTUALISED FlatList instead of a ScrollView. Built for the social feed,
 * which grew unbounded across LOAD MORE with every photo card mounted.
 * Header content rides ListHeaderComponent; the entrance animation is
 * deliberately absent (web pins visible anyway — the iOS-18 doctrine).
 */
export function FlatListShell<T>({
  data,
  renderItem,
  keyExtractor,
  header,
  footer,
  onEndReached,
}: {
  data: readonly T[];
  renderItem: (item: T) => React.ReactElement | null;
  keyExtractor: (item: T) => string;
  header?: ReactNode;
  footer?: ReactNode;
  onEndReached?: () => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<T>>(null);
  useFocusEffect(
    useCallback(() => {
      const toTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setActiveScroller(toTop);
      return () => clearActiveScroller(toTop);
    }, [])
  );
  return (
    <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
      <FlatList
        ref={listRef}
        data={data as T[]}
        keyExtractor={keyExtractor}
        renderItem={({ item }) => (
          <View className="w-full max-w-[560px] self-center" style={{ marginBottom: 14 }}>
            {renderItem(item)}
          </View>
        )}
        ListHeaderComponent={
          header ? <View className="w-full max-w-[560px] gap-s3 self-center pb-s3">{header}</View> : null
        }
        ListFooterComponent={
          footer ? <View className="w-full max-w-[560px] self-center">{footer}</View> : null
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.6}
        className="flex-1"
        contentContainerClassName="px-s4"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: Math.max(insets.bottom, 12) + 96,
        }}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        maxToRenderPerBatch={4}
        removeClippedSubviews
      />
    </View>
  );
}

/**
 * The design-system card: a soft vertical gradient (never a flat colour), a
 * thin outline, and room to breathe. `glow` tints the outline + drops a soft
 * bloom in any accent colour -- rarity, success, danger.
 */
export function GlowCard({
  children,
  glow,
  className = '',
  padding = 20,
  fill = false,
}: {
  children: ReactNode;
  glow?: string;
  className?: string;
  /** Compact cards (the Train hero) trade breath for screen economy. */
  padding?: number;
  /** Stretch to the parent's fixed height (the carousel's equal cards). */
  fill?: boolean;
}) {
  const colors = useThemeColors();
  const edge = glow ? `${glow}59` : colors.border;
  return (
    <View
      className={`overflow-hidden rounded-xl ${className}`}
      style={{
        flex: fill ? 1 : undefined,
        borderWidth: 1,
        borderColor: edge,
        shadowColor: glow ?? '#000000',
        shadowOpacity: glow ? 0.3 : 0.35,
        shadowRadius: glow ? 24 : 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }}
    >
      <LinearGradient
        colors={[colors['surface-2'], colors.surface, colors['bg-deep']]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ padding, flex: fill ? 1 : undefined }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
