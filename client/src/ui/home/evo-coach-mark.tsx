/**
 * HOME §1c (PREMIUM PASS, 2026-08-03) — THE ONE-TIME EVO COACH MARK.
 *
 * The page assumed the athlete already knew what "51" meant. This is the one
 * moment where it stops assuming: a single card, one idea, one confirmation,
 * never again.
 *
 * WHY IT IS NOT A SECOND TOUR. `ui/help/page-help.tsx` already auto-opens a
 * six-step spotlight tour the first time Home is reached, and `TutorialOverlay`
 * runs before that. Three overlays stacked on arrival is how athletes learn to
 * dismiss overlays without reading them. So this one WAITS: it appears only
 * once the first-run tutorial is done AND the home tour has already been seen
 * (i.e. it can never be the second overlay in a session), and only when a
 * confirmed rating actually exists — an athlete with no rating yet is looking
 * at the hero's own DISCOVER invitation, which explains the same thing better.
 *
 * PERSISTENCE follows page-help's own pattern exactly — a raw AsyncStorage
 * key, not a Zustand store. It is a "I have read this tip" device preference
 * like `evoforge-help-seen-v1` beside it, so it deliberately survives sign-out
 * (the store doctrine covers per-athlete STATE; this is neither).
 *
 * Every failure path opens rather than closes: a storage error must never
 * suppress the explanation forever, and it must never show it twice in a row
 * either — so a read failure shows it, and the write is attempted regardless.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { playSelect } from '@/ui/core/sound';

import { EvoEmblem } from './evo-emblem';

const COACH_KEY = 'evoforge-evo-coach-v1';
const TOUR_KEY = 'evoforge-tutorial-done-v1'; // shared with TutorialOverlay
const HELP_SEEN_KEY = 'evoforge-help-seen-v1'; // shared with PageHelp

/** Long enough that the screen has painted and settled; short enough that it
 *  still reads as part of arriving, not as an interruption. */
const APPEAR_DELAY = 1100;

export function EvoCoachMark({ enabled }: { enabled: boolean }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let show = true;
      try {
        const [coach, tour, seen] = await AsyncStorage.multiGet([COACH_KEY, TOUR_KEY, HELP_SEEN_KEY]);
        const seenKeys = seen[1] ? (JSON.parse(seen[1]) as unknown) : [];
        const homeToured = Array.isArray(seenKeys) && seenKeys.includes('home');
        // Already read it · the first-run tutorial has not finished · the home
        // tour is still owed. Any of the three means: not now.
        show = !coach[1] && Boolean(tour[1]) && homeToured;
      } catch {
        show = true; // a storage failure must not silence the explanation
      }
      if (cancelled || !show) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        setOpen(true);
        if (!reduced) {
          enter.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
        }
      }, APPEAR_DELAY);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const dismiss = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSelect();
    setOpen(false);
    void AsyncStorage.setItem(COACH_KEY, '1').catch(() => undefined);
  };

  // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson).
  const cardStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 14 }, { scale: 0.97 + enter.value * 0.03 }],
  }));

  if (!open) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable
        className="flex-1 items-center justify-center px-s5"
        // 0.82, not 0.88: the rating has to stay LEGIBLE behind the card, or
        // the card is explaining something the athlete cannot see.
        style={{ backgroundColor: 'rgba(2,5,11,0.82)' }}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        testID="evo-coach-backdrop"
      >
        <Animated.View style={[{ width: '100%', maxWidth: 380, alignItems: 'stretch' }, cardStyle]}>
          {/* The caret. Without it the card is a notice; with it the card is
              a POINTER at the crest still visible above the dim. */}
          <View
            pointerEvents="none"
            style={{
              alignSelf: 'center',
              width: 0,
              height: 0,
              borderLeftWidth: 9,
              borderRightWidth: 9,
              borderBottomWidth: 9,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: `${colors.epic}70`,
            }}
          />
          <Pressable
            onPress={() => undefined}
            testID="evo-coach"
            accessibilityRole="alert"
            className="items-center overflow-hidden rounded-xl border p-s5"
            style={{
              borderColor: `${colors.epic}70`,
              backgroundColor: colors.surface,
              shadowColor: colors.epic,
              shadowOpacity: 0.45,
              shadowRadius: 34,
              elevation: 16,
            }}
          >
            {/* The crest behind the star — the same object the athlete is
                about to look at on the page, so the card and the page are
                unmistakably about the same thing. */}
            <View className="items-center justify-center" style={{ height: 76 }}>
              <View pointerEvents="none" style={{ position: 'absolute' }}>
                <EvoEmblem width={168} colour={colors.epic} />
              </View>
              <Text allowFontScaling={false} style={{ fontSize: 34 }}>
                ⭐
              </Text>
            </View>

            <Text
              allowFontScaling={false}
              className="mt-s2"
              style={{ fontSize: 18, letterSpacing: 2, color: colors.epic, ...pixelFont() }}
            >
              EVO RATING
            </Text>

            <Text className="mt-s3 text-center text-base text-text">
              This is your overall fitness score.
            </Text>
            <Text className="mt-s2 text-center text-sm text-text-dim">
              Train consistently and improve your strength, physique and cardio to increase it.
            </Text>
            <Text className="mt-s3 text-center text-2xs text-text-mute">
              Tap the rating any time for the full breakdown.
            </Text>

            <View className="mt-s5 w-full">
              <NeonButton title="GOT IT" variant="epic" pixel onPress={dismiss} testID="evo-coach-dismiss" />
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
