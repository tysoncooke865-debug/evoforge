import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { progressPercent } from '@/domain/xp';
import { animations } from '@/theme/animations';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { useSettingsStore } from '@/state/settings-store';

interface XpBarProps {
  xpIntoLevel: number;
  xpNeeded: number;
  /** Show "123 / 500 XP" under the bar. */
  showNumbers?: boolean;
}

const fill = animations.fillGrowXp;

/**
 * The XP progress bar. The percentage comes from progressPercent() -- the same
 * function that grants the level -- so the bar reaches exactly 100% at
 * level-up. Never divide by hand (root CLAUDE.md, XP contract).
 *
 * ANIMATED NODES CARRY INLINE STYLES ONLY: NativeWind's className interop
 * drops composed styles on Animated.View on web -- the bug that shipped
 * zero-width fills. fillGrow (one-shot) always plays; the sheen sweep is an
 * ambient loop and yields to perf mode / reduced motion.
 */
export function XpBar({ xpIntoLevel, xpNeeded, showNumbers = true }: XpBarProps) {
  const pct = progressPercent(xpIntoLevel, xpNeeded);
  const width = useSharedValue(0);
  const sheenX = useSharedValue(-60);
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const ambient = !reducedMotion && !perfMode;

  useEffect(() => {
    width.value = withTiming(pct, {
      duration: fill.duration,
      easing: Easing.bezier(...(fill.easing as readonly [number, number, number, number])),
    });
  }, [pct, width]);

  useEffect(() => {
    if (!ambient) {
      sheenX.value = -60;
      return;
    }
    sheenX.value = withRepeat(
      withTiming(340, { duration: animations.sheen.duration, easing: Easing.linear }),
      -1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sheenX.value }, { skewX: '-20deg' }],
  }));

  return (
    <View>
      <View className="h-s3 overflow-hidden rounded-pill border border-border-soft bg-surface-2">
        <Animated.View
          style={[
            {
              height: '100%',
              borderRadius: 999,
              overflow: 'hidden',
              minWidth: pct > 0 ? 6 : 0, // earned XP is always visible, never a 0px sliver
              shadowColor: tokens.colors.accent,
              shadowOpacity: 0.5,
              shadowRadius: 8,
            },
            fillStyle,
          ]}
        >
          <LinearGradient
            colors={[tokens.colors['accent-strong'], tokens.colors.accent, tokens.colors['accent-deep']]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
          />
          {ambient ? (
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: 36,
                  backgroundColor: 'rgba(255,255,255,0.28)',
                },
                sheenStyle,
              ]}
            />
          ) : null}
        </Animated.View>
      </View>
      {showNumbers ? (
        <Text className="mt-s1 text-text-dim" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>
          {xpIntoLevel} / {xpNeeded} XP
        </Text>
      ) : null}
    </View>
  );
}
