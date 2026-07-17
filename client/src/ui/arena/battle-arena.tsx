/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press/layout handlers by design, same as neon-button. */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useToastStore } from '@/state/toast-store';
import { useThemeColors } from '@/theme/use-theme';

/**
 * Shared Battle Arena chrome, in the Home screen's design language: the
 * same tokens, glows, pills and letter-spaced labels. Nothing here invents
 * a second visual system — every colour is a token, every animated node
 * carries inline styles only (the pinned NativeWind/web gotcha).
 */

/** A glowing circular glyph badge — the arena's icon treatment. */
export function IconBadge({
  glyph,
  tint,
  size = 52,
}: {
  glyph: string;
  tint?: string;
  size?: number;
}) {
  const colors = useThemeColors();
  const tintColor = tint ?? colors.accent;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: `${tintColor}59`,
        backgroundColor: `${tintColor}0f`,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: tintColor,
        shadowOpacity: 0.45,
        shadowRadius: 12,
        elevation: 5,
      }}
    >
      <Text style={{ fontSize: size * 0.44, lineHeight: size * 0.56 }}>{glyph}</Text>
    </View>
  );
}

/** Copy on web, share sheet on native — either way the code leaves the
 *  phone. Both paths can be denied (clipboard permission, dismissed sheet);
 *  neither may throw — the code is on screen either way. */
export async function shareBattleCode(code: string): Promise<boolean> {
  const message = `Battle me on EvoForge — code ${code}`;
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(code);
      useToastStore.getState().push({ kind: 'info', title: 'CODE COPIED', subtitle: code });
    } else {
      await Share.share({ message });
    }
    return true;
  } catch {
    useToastStore.getState().push({ kind: 'info', title: 'COPY BY HAND', subtitle: code });
    return false;
  }
}

/** The battle-code glass card: whispered label, glowing code, copy control. */
export function CodeCard({ code }: { code: string }) {
  const colors = useThemeColors();
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({
    borderColor: `rgba(52,211,153,${0.35 + flash.value * 0.4})`,
    opacity: 1,
  }));
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await shareBattleCode(code);
    if (!ok) return; // no green tick for a copy that didn't happen
    setCopied(true);
    flash.value = withTiming(1, { duration: 120 });
    flash.value = withTiming(0, { duration: 900 });
  };

  return (
    <View
      className="rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      <Text className="text-center text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
        YOUR BATTLE CODE
      </Text>
      <View className="mt-s2 flex-row items-center gap-s2">
        <Animated.View
          style={[
            {
              flex: 1,
              borderWidth: 1,
              borderRadius: 12,
              paddingVertical: 10,
              backgroundColor: 'rgba(4,18,26,0.6)',
            },
            copied
              ? flashStyle
              : { borderColor: `${colors.accent}40` },
          ]}
        >
          <Text
            className="text-center text-3xl font-bold"
            style={{
              color: colors.accent,
              letterSpacing: 10,
              textShadowColor: 'rgba(34,211,238,0.6)',
              textShadowRadius: 16,
            }}
            testID="battle-code"
          >
            {code}
          </Text>
        </Animated.View>
        <Pressable
          onPress={() => void copy()}
          accessibilityRole="button"
          accessibilityLabel="Copy battle code"
          className="min-h-[44px] items-center justify-center rounded-md px-s3"
          style={{
            borderWidth: 1,
            borderColor: copied ? `${colors.success}8c` : `${colors.accent}59`,
            backgroundColor: copied ? `${colors.success}14` : 'rgba(34,211,238,0.08)',
          }}
          testID="battle-code-copy"
        >
          <Text className="text-base">{copied ? '✓' : '📋'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The rules strip: three even columns, evolution-card spacing. */
export function RulesStrip({
  rules,
}: {
  rules: readonly { glyph: string; text: string }[];
}) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row rounded-xl py-s4"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      {rules.map((rule, i) => (
        <View
          key={rule.text}
          className="flex-1 items-center gap-s1 px-s2"
          style={i > 0 ? { borderLeftWidth: 1, borderLeftColor: colors.border } : undefined}
        >
          <Text className="text-lg">{rule.glyph}</Text>
          <Text className="text-center text-2xs text-text-dim">{rule.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** A press-lift wrapper: scale + glow on press, the Chip feel for cards. */
export function PressCard({
  children,
  onPress,
  tint,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  tint?: string;
  testID?: string;
}) {
  void tint; // accepted for API compatibility; the glow treatment retired
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        onPressIn={() => (scale.value = withSpring(0.97, { damping: 20, stiffness: 400 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 16, stiffness: 300 }))}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export const BLITZ_RULES = [
  { glyph: '🏋', text: 'Three lifts a rut' },
  { glyph: '⏱', text: 'Twelve-minute bell' },
  { glyph: '🏆', text: 'Lift the object first' },
] as const;
