import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import tokens from '@/theme/tokens';
import { clearActiveScroller, setActiveScroller } from '@/ui/scroll-registry';

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
export function ScreenShell({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  // P2 C4: the FOCUSED shell owns the scroll-to-top registration; blur
  // clears it (focus-scoped — never keyed by pathname, see scroll-registry).
  const scrollRef = useRef<ScrollView>(null);
  useFocusEffect(
    useCallback(() => {
      const toTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });
      setActiveScroller(toTop);
      return () => clearActiveScroller(toTop);
    }, [])
  );
  return (
    <View className="flex-1" style={{ backgroundColor: tokens.colors['bg-deep'] }}>
      {/* Quiet ambient light — recessive enough that the header owns the top. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="items-center px-s4"
        contentContainerStyle={{
          paddingTop: Math.max(insets.top, 14),
          paddingBottom: Math.max(insets.bottom, 12) + 72, // clear the tab bar, always
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-[560px] gap-s3">{children}</View>
      </ScrollView>
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
  const edge = glow ? `${glow}59` : tokens.colors.border;
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
        colors={[tokens.colors['surface-2'], tokens.colors.surface, tokens.colors['bg-deep']]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ padding, flex: fill ? 1 : undefined }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
