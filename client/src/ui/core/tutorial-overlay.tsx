import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWorkoutIndex } from '@/data/hooks';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE FIRST-RUN TOUR (Tyson, 2026-07-13): four cards that show a new
 * athlete where everything lives — shown once (AsyncStorage flag) and
 * skippable at every step. Existing users see it once too: the six-tab +
 * companion-menu layout is new to them as well.
 *
 * IT WAITS FOR THE FIRST WORKOUT NOW (2026-08-06). It used to fire the
 * moment onboarding landed an athlete on Home, which put a full-screen
 * modal — one that eats every tap — between "START FIRST WORKOUT" and the
 * logger. A tour of six tabs is worth nothing to somebody who has not yet
 * done the one thing the app is for, and the activation funnel says only 11
 * of 31 signups ever logged a workout.
 *
 * So: it holds until the athlete has at least one logged training day, and
 * it never renders over the workout logger itself. Both conditions are
 * server truth (the workout index) rather than a flag that a refresh or a
 * second device would lose.
 */

const KEY = 'evoforge-tutorial-done-v1';

const STEPS: readonly { icon: string; title: string; body: string }[] = [
  {
    icon: '⌂',
    title: 'YOUR SIX TABS',
    body:
      'Home is your champion — tap it to enter the Forge and evolve. Train logs your ' +
      'workouts. The Oracle scans your physique with AI. Social is friends, rivals, ' +
      'gyms and the feed. Arena is where you battle. Fuel tracks your calories.',
  },
  {
    icon: '🕹',
    title: 'YOUR COMPANION IS YOUR MENU',
    body:
      'Tap the little animated fighter in the top-right of any screen — that opens ' +
      'your bag: progress charts, awards, coins, schedule, profile and more.',
  },
  {
    icon: '⚒',
    title: 'TRAIN, YOUR WAY',
    body:
      'On Train: log sets with one tap (they save even offline), the rest timer starts ' +
      'itself, ⇄ swaps any exercise for a same-muscle alternative, drag the ⣿ grip to ' +
      'reorder, and CHOOSE/UPLOAD MY WORKOUT builds or scans your own split.',
  },
  {
    icon: '⚔',
    title: 'START HERE: SET YOUR WEEK',
    body:
      'On Train, tap EDIT SCHEDULE to pick a split for each day, then log your first set. ' +
      'Every set earns XP, levels your champion, evolves your form — and can win you ' +
      'Arena battles against friends. That is the whole loop.',
  },
];

export function TutorialOverlay() {
  const colors = useThemeColors();
  const [step, setStep] = useState(-1); // -1 = unknown/hidden
  const pathname = usePathname();
  const index = useWorkoutIndex();
  // Earned: at least one logged training day. Until then the athlete has an
  // activation path to walk and nothing may stand in it.
  const hasTrained = (index.data?.byDate.size ?? 0) > 0;
  const onLogger = pathname?.startsWith('/workout') === true;

  useEffect(() => {
    if (!hasTrained) return;
    void AsyncStorage.getItem(KEY).then((done) => {
      if (!done) setStep(0);
    });
  }, [hasTrained]);

  if (!hasTrained || onLogger) return null;
  if (step < 0 || step >= STEPS.length) return null;
  const s = STEPS[step];
  const finish = () => {
    void AsyncStorage.setItem(KEY, '1');
    setStep(STEPS.length);
  };

  return (
    <View
      className="absolute inset-0 justify-end p-s4"
      style={{ backgroundColor: 'rgba(2,5,11,0.78)', zIndex: 60 }}
      testID="tutorial-overlay"
    >
      <View
        className="rounded-xl border p-s5"
        style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}
      >
        <View className="mb-s2 flex-row items-center justify-between">
          <Text className="text-2xl">{s.icon}</Text>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            {step + 1} / {STEPS.length}
          </Text>
        </View>
        <Text
          className="mb-s2 text-lg font-bold text-text"
          style={{ letterSpacing: 1, textShadowColor: 'rgba(34,211,238,0.4)', textShadowRadius: 12 }}
        >
          {s.title}
        </Text>
        <Text className="mb-s4 text-sm text-text-dim">{s.body}</Text>
        <NeonButton
          title={step === STEPS.length - 1 ? 'START FORGING' : 'NEXT'}
          onPress={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))}
          testID="tutorial-next"
        />
        <Pressable
          onPress={finish}
          accessibilityRole="button"
          className="mt-s2 items-center justify-center"
          style={{ minHeight: 44 }}
          testID="tutorial-skip"
        >
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
            SKIP TOUR
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
