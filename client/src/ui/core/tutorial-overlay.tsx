import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useMarkTourSeen, useTourGate } from '@/data/tour-state';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE FIRST-RUN TOUR (Tyson, 2026-07-13): four cards that show a new
 * athlete where everything lives — shown once (AsyncStorage flag) and
 * skippable at every step. Existing users see it once too: the six-tab +
 * companion-menu layout is new to them as well.
 *
 * IT WAITS FOR A *COMPLETED* WORKOUT (2026-08-06, second pass).
 *
 * First it fired the moment onboarding landed an athlete on Home — a
 * full-screen modal that eats every tap, between "START FIRST WORKOUT" and
 * the logger. Gating it on "has a logged training day" fixed that and
 * introduced the next one: that is true the instant the FIRST SET lands, so
 * the tour appeared the moment an athlete logged one set and stepped back to
 * Home, interrupting a workout that was still in progress.
 *
 * The gate lives in data/tour-state.ts now and asks three things, all from
 * persisted data: has a workout been COMPLETED, is one under way right now,
 * and has this ATHLETE (not this browser) already seen it. It also only ever
 * renders on Home, so it can never cover the logger, the finish summary or
 * Train.
 *
 * Seen-ness is written to the profile (migration 137, write-once server-side)
 * as well as AsyncStorage. The local flag is a fast path that stops the
 * overlay flashing while the profile loads; the column is what survives a
 * reinstall, a second device and the every-cache-layer sign-out rule.
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
  // No sentinel: the GATE decides whether the tour exists, `step` only says
  // where you are in it, and `dismissed` closes it for this render tree. That
  // leaves nothing to arm in an effect (react-hooks/set-state-in-effect).
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();
  const gate = useTourGate();
  const markSeen = useMarkTourSeen();
  // HOME ONLY. Anywhere else and it is covering something the athlete chose
  // to look at — including the logger and the finish summary.
  const onHome = pathname === '/' || pathname === '/index';

  /**
   * THE PROFILE IS THE ONLY TRUTH FOR "SEEN" (137). The legacy AsyncStorage
   * key is read exactly once, as a BACKFILL: an athlete who dismissed the
   * tour before the column existed must not be shown it again. Their answer
   * is written to the profile and the local key stops mattering.
   *
   * Known and accepted: the legacy key is global to the browser, so a second
   * athlete signing in on a device where someone else dismissed the tour is
   * backfilled as having seen it. That costs them a tutorial they can still
   * reach through the ? button on every page — against re-showing a dismissed
   * tour to every existing athlete, which is the certain harm. New answers
   * are per-athlete from here on, so it cannot happen twice.
   */
  const backfilledRef = useRef(false);
  useEffect(() => {
    if (!gate.ready || gate.seen || backfilledRef.current) return;
    backfilledRef.current = true;
    void AsyncStorage.getItem(KEY).then((legacy) => {
      if (legacy) markSeen.mutate('completed');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.ready, gate.seen]);

  if (!gate.mayShow || !onHome || dismissed) return null;
  const s = STEPS[Math.min(step, STEPS.length - 1)];
  const finish = (ending: 'completed' | 'skipped') => {
    // Local first so the overlay closes instantly, profile second so the
    // answer outlives this browser. The 137 trigger keeps the first write,
    // so a double tap or a retry cannot rewrite or clear it.
    void AsyncStorage.setItem(KEY, '1');
    markSeen.mutate(ending);
    setDismissed(true);
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
          onPress={() => (step === STEPS.length - 1 ? finish('completed') : setStep(step + 1))}
          testID="tutorial-next"
        />
        <Pressable
          onPress={() => finish('skipped')}
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
