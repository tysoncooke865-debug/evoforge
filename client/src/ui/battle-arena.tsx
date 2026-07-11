/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press/layout handlers by design, same as neon-button. */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';

/**
 * Shared Battle Arena chrome, in the Home screen's design language: the
 * same tokens, glows, pills and letter-spaced labels. Nothing here invents
 * a second visual system — every colour is a token, every animated node
 * carries inline styles only (the pinned NativeWind/web gotcha).
 */

/** A glowing circular glyph badge — the arena's icon treatment. */
export function IconBadge({
  glyph,
  tint = tokens.colors.accent,
  size = 52,
}: {
  glyph: string;
  tint?: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: `${tint}59`,
        backgroundColor: `${tint}0f`,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: tint,
        shadowOpacity: 0.45,
        shadowRadius: 12,
        elevation: 5,
      }}
    >
      <Text style={{ fontSize: size * 0.44, lineHeight: size * 0.56 }}>{glyph}</Text>
    </View>
  );
}

/** The segmented capsule: two tabs, a sprung slider, cyan-lit active side. */
export function SegmentedTabs({
  left,
  right,
  active,
  onChange,
}: {
  left: string;
  right: string;
  active: 0 | 1;
  onChange: (index: 0 | 1) => void;
}) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const slider = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const select = (index: 0 | 1) => {
    x.value = withSpring((index * width) / 2, { damping: 20, stiffness: 260 });
    onChange(index);
  };

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width - 8; // inset padding
        setWidth(w);
        x.value = (active * w) / 2;
      }}
      className="flex-row rounded-pill p-s1"
      style={{ borderWidth: 1, borderColor: `${tokens.colors.epic}33`, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 4,
            left: 4,
            bottom: 4,
            width: width / 2,
            borderRadius: 999,
            backgroundColor: 'rgba(34,211,238,0.14)',
            borderWidth: 1,
            borderColor: `${tokens.colors.accent}8c`,
            shadowColor: tokens.colors.accent,
            shadowOpacity: 0.4,
            shadowRadius: 12,
          },
          slider,
        ]}
      />
      {[left, right].map((label, i) => (
        <Pressable
          key={label}
          onPress={() => select(i as 0 | 1)}
          accessibilityRole="button"
          className="min-h-[44px] flex-1 items-center justify-center rounded-pill"
          testID={`arena-tab-${i}`}
        >
          <Text
            className="text-xs font-bold"
            style={{ letterSpacing: 1.5, color: active === i ? tokens.colors.accent : tokens.colors['text-dim'] }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
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
      style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
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
              : { borderColor: `${tokens.colors.accent}40` },
          ]}
        >
          <Text
            className="text-center text-3xl font-bold"
            style={{
              color: tokens.colors.accent,
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
            borderColor: copied ? `${tokens.colors.success}8c` : `${tokens.colors.accent}59`,
            backgroundColor: copied ? `${tokens.colors.success}14` : 'rgba(34,211,238,0.08)',
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
  return (
    <View
      className="flex-row rounded-xl py-s4"
      style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      {rules.map((rule, i) => (
        <View
          key={rule.text}
          className="flex-1 items-center gap-s1 px-s2"
          style={i > 0 ? { borderLeftWidth: 1, borderLeftColor: tokens.colors.border } : undefined}
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
  tint = tokens.colors.accent,
  testID,
}: {
  children: ReactNode;
  onPress?: () => void;
  tint?: string;
  testID?: string;
}) {
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
