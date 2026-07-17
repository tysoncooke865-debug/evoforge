import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE FIRST-RUN TOUR (Tyson, 2026-07-13): four cards that show a new
 * athlete where everything lives — shown once (AsyncStorage flag), right
 * after onboarding lands them on Home, and skippable at every step.
 * Existing users see it once too: the five-tab + companion-menu layout is
 * new to them as well.
 */

const KEY = 'evoforge-tutorial-done-v1';

const STEPS: readonly { icon: string; title: string; body: string }[] = [
  {
    icon: '⌂',
    title: 'YOUR SIX WORLDS',
    body:
      'Home is your character. Train logs your workouts. The Oracle judges your ' +
      'physique with AI. Forge is where you evolve. Arena is where you fight. ' +
      'Fuel tracks your calories.',
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
      'itself, ⇄ swaps any exercise for a same-muscle alternative, and BUILD MY OWN ' +
      'ROUTINE lets you forge your own split.',
  },
  {
    icon: '⚔',
    title: 'EVERY SET COUNTS',
    body:
      'Sets earn XP, level your character and evolve your form. Fight friends in the ' +
      'Arena — Volume Duels and Heads or Tails — where real training decides the winner.',
  },
];

export function TutorialOverlay() {
  const colors = useThemeColors();
  const [step, setStep] = useState(-1); // -1 = unknown/hidden

  useEffect(() => {
    void AsyncStorage.getItem(KEY).then((done) => {
      if (!done) setStep(0);
    });
  }, []);

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
