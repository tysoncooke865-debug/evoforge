import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import tokens from '@/theme/tokens';

/**
 * The screen shell: near-black stage lighting instead of a flat background.
 * Two huge blurred radial glows -- cyan upper-left, purple upper-right -- the
 * same light rig assets/styles.css paints behind .stApp. Every screen sits on
 * this so depth is ambient, not per-card.
 */
export function ScreenShell({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1" style={{ backgroundColor: tokens.colors['bg-deep'] }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -180, left: -160, width: 480, height: 480, borderRadius: 240, backgroundColor: 'rgba(34, 211, 238, 0.09)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -140, right: -180, width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(168, 85, 247, 0.08)' }} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="items-center px-s4 pb-s12 pt-s6"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-[560px] gap-s4">{children}</View>
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
}: {
  children: ReactNode;
  glow?: string;
  className?: string;
}) {
  const edge = glow ? `${glow}59` : tokens.colors.border;
  return (
    <View
      className={`overflow-hidden rounded-xl ${className}`}
      style={{
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
        style={{ padding: 20 }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}
