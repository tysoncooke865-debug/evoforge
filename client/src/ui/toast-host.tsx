import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { animations } from '@/theme/animations';
import { useSettingsStore } from '@/state/settings-store';
import { useToastStore, type Toast } from '@/state/toast-store';

/**
 * Renders the toast queue above everything. Timing comes from animations.ts:
 * toastIn (4s) for standard toasts, xpToastPop (2.6s) for XP, xpPulse looping
 * on the XP number while its toast lives. One-shots END at opacity 0 -- the
 * store entry is dismissed when the animation's clock runs out, never before,
 * so a toast cannot be "fast-forwarded" into invisibility.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <View pointerEvents="none" className="absolute inset-x-0 bottom-s12 items-center gap-s2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </View>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const spec = toast.kind === 'xp' ? animations.xpToastPop : animations.toastIn;
  // P8: the XP pulse is an ambient LOOP and must yield to reduced motion /
  // perf mode. The toast's own entrance is a ONE-SHOT that ends at opacity 0
  // — never fast-forward or disable that, or the toast becomes invisible.
  const reducedMotion = useReducedMotion();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const loopsAllowed = !reducedMotion && !perfMode;

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);
  const scale = useSharedValue(0.9);
  const pulse = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.bezier(...(spec.easing as readonly [number, number, number, number]));
    const d = spec.duration;

    if (toast.kind === 'xp') {
      // xpToastPop: 0 -> pop 1.04 @14% -> settle 1 @24% -> hold -> fade @100%
      opacity.value = withSequence(
        withTiming(1, { duration: d * 0.14, easing: ease }),
        withTiming(1, { duration: d * 0.68 }),
        withTiming(0, { duration: d * 0.18, easing: ease })
      );
      scale.value = withSequence(
        withTiming(1.04, { duration: d * 0.14, easing: ease }),
        withTiming(1, { duration: d * 0.1, easing: ease }),
        withTiming(1, { duration: d * 0.58 }),
        withTiming(0.96, { duration: d * 0.18, easing: ease })
      );
      translateY.value = 0;
      // The XP number pulses while the toast lives — an ambient loop, so it
      // is disabled (held at rest scale 1, still fully legible) rather than
      // fast-forwarded when motion is unwelcome.
      if (loopsAllowed) {
        pulse.value = withRepeat(
          withSequence(
            withTiming(1.16, { duration: animations.xpPulse.duration / 2 }),
            withTiming(1, { duration: animations.xpPulse.duration / 2 })
          ),
          -1
        );
      }
    } else {
      // toastIn: rise+appear @8%, hold to 88%, sink+fade @100%
      opacity.value = withSequence(
        withTiming(1, { duration: d * 0.08, easing: ease }),
        withTiming(1, { duration: d * 0.8 }),
        withTiming(0, { duration: d * 0.12, easing: ease })
      );
      translateY.value = withSequence(
        withTiming(0, { duration: d * 0.08, easing: ease }),
        withTiming(0, { duration: d * 0.8 }),
        withTiming(10, { duration: d * 0.12, easing: ease })
      );
      scale.value = 1;
    }

    const timer = setTimeout(() => dismiss(toast.id), d + 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const accent =
    toast.kind === 'pr' ? 'text-legendary' : toast.kind === 'error' ? 'text-danger' : 'text-accent';

  return (
    <Animated.View
      // Inline styles only: NativeWind className drops composed styles on
      // Animated.View on web (the zero-width-fill bug class).
      style={[
        {
          minWidth: 260,
          maxWidth: 420,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 18,
          borderWidth: 1,
          borderColor: 'rgba(34, 211, 238, 0.34)',
          backgroundColor: '#131d31',
          padding: 16,
          shadowColor: '#22d3ee',
          shadowOpacity: 0.28,
          shadowRadius: 12,
          elevation: 8,
        },
        style,
      ]}
    >
      <View className="flex-1">
        <Text className={`text-sm font-bold ${accent}`}>{toast.title}</Text>
        {toast.subtitle ? <Text className="text-xs text-text-dim">{toast.subtitle}</Text> : null}
      </View>
      {toast.xp !== undefined ? (
        <Animated.View style={pulseStyle}>
          <Text className="text-xl font-bold text-accent">+{toast.xp} XP</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
