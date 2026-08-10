import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  restAlarmPermission,
  restAlarmSupported,
  restCompleteVibration,
  requestRestAlarmPermission,
} from '@/data/rest-alarm';
import { useRestAlarmPromptStore } from '@/state/rest-alarm-prompt-store';
import {
  DEFAULT_REST_SECONDS,
  REST_STEP_SECONDS,
  restClockView,
  useRestTimerStore,
  type RestClockView,
} from '@/state/rest-timer';
import { useRestUiStore } from '@/state/rest-ui-store';
import { useThemeColors } from '@/theme/use-theme';
import { playRestOver } from '@/ui/core/sound';

/**
 * THE REST TIMER'S SURFACES (§13–§19, rebuilt 2026-08-10).
 *
 * The clock itself moved to state/rest-timer.ts; this file is presentation.
 * The design that was already right is unchanged and worth restating, because
 * it is the thing §13 asks for and it was never the problem: only `endAt` is
 * stored, and the remaining time is DERIVED from `Date.now()` on every tick.
 * So the timer survives remounts, navigation, backgrounding and a screen lock
 * BY CONSTRUCTION — there is nothing to drift and nothing to resynchronise.
 * The one-second interval decides when the bar REDRAWS, never what it says.
 *
 * WHAT IS NEW HERE:
 *   ±30s        without cancel-and-restart.
 *   THE ASK     ENABLE ALERTS, shown the first time a rest actually runs and
 *               never during onboarding (§18). Declining is remembered.
 *   CATCH-UP    a rest that expired while the app was away buzzes and chimes
 *               the moment it is looked at again. This is what makes the
 *               experience correct even when iOS killed the service worker
 *               and the scheduled notification never fired.
 */

/** Re-exported so the ~6 existing importers of DEFAULT_REST_SECONDS and
 *  startRest keep one import path and one meaning. */
export { DEFAULT_REST_SECONDS };

/** Start (or restart) the rest clock. Called after a confirmed set log. The
 *  signature is unchanged from the pre-2026-08-10 version on purpose — every
 *  existing caller keeps working — and the optional second argument is how a
 *  caller says WHAT the rest is between. */
export function startRest(
  seconds: number = DEFAULT_REST_SECONDS,
  about?: { exerciseId?: string | null; exerciseName?: string | null; setNumber?: number | null }
): void {
  useRestTimerStore.getState().startTimer({ seconds, ...about });
  // §18: the ask rides the FIRST rest, not the app's first launch.
  useRestAlarmPromptStore.getState().offerOnFirstRest();
}

export function clearRest(): void {
  useRestTimerStore.getState().cancelTimer();
}

/**
 * ONE module tick for however many surfaces subscribe (the B9 rule, 2026-07-19
 * — two components each owning a 1s interval meant two timers and two
 * re-render trains per second while resting). The interval runs only while at
 * least one clock is mounted AND a rest is live.
 */
let tickTimer: ReturnType<typeof setInterval> | null = null;
let liveClocks = 0;
const tickListeners = new Set<() => void>();

const acquireTick = (fn: () => void) => {
  tickListeners.add(fn);
  liveClocks += 1;
  if (tickTimer === null) {
    tickTimer = setInterval(() => {
      for (const l of tickListeners) l();
    }, 1000);
  }
};
const releaseTick = (fn: () => void) => {
  tickListeners.delete(fn);
  liveClocks -= 1;
  if (liveClocks <= 0 && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
    liveClocks = 0;
  }
};

/** ONE buzz per rest, app-wide. The latch keys on the endAt timestamp, so two
 *  mounted surfaces chime once between them and a NEW rest chimes again. */
let buzzedForEndAt: number | null = null;

/**
 * The shared rest clock. Both timer surfaces subscribe to the SAME store —
 * the overlay is a second subscriber, never a second timer.
 */
export function useRestClock(): RestClockView | null {
  const isActive = useRestTimerStore((s) => s.isActive);
  const endAt = useRestTimerStore((s) => s.endAt);
  const completeTimer = useRestTimerStore((s) => s.completeTimer);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const tick = () => setNow(Date.now());
    tick();
    acquireTick(tick);
    return () => releaseTick(tick);
  }, [isActive, endAt]);

  /**
   * CATCH-UP ON RESUME (§25: "app temporarily suspended", "timer already
   * expired when app reopens"). A frozen tab runs no timers, so returning to
   * the app must re-read the clock rather than wait for the next tick that
   * was never going to come. On web this is `visibilitychange`; the same
   * listener also covers a tab that was merely in the background.
   */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  const view = restClockView({ isActive, endAt }, now);

  // The completion buzz lives in an effect (side effects never run in render):
  // exactly once per rest, as `over` flips true — INCLUDING when it flipped
  // while the app was suspended and we only found out on resume.
  const over = view?.over ?? false;
  useEffect(() => {
    if (!over || endAt === null || buzzedForEndAt === endAt) return;
    buzzedForEndAt = endAt;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    restCompleteVibration(); // web: one pulse where the platform supports it
    playRestOver(); // the retro rest-over chime (settings-gated)
  }, [over, endAt]);

  // Self-clear once REST OVER has been seen for long enough. Idempotent —
  // either subscriber may reach it first.
  useEffect(() => {
    if (view?.expired) completeTimer();
  }, [view?.expired, completeTimer]);

  return view === null || view.expired ? null : view;
}

/** ±30s. Its own component because both surfaces want it and neither wants
 *  to own the store wiring. */
function NudgeButton({
  seconds,
  testID,
}: {
  seconds: number;
  testID: string;
}) {
  const colors = useThemeColors();
  const addTime = useRestTimerStore((s) => s.addTime);
  const label = seconds > 0 ? `+${seconds}` : `${seconds}`;
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        addTime(seconds);
      }}
      accessibilityRole="button"
      accessibilityLabel={seconds > 0 ? `add ${seconds} seconds of rest` : `remove ${-seconds} seconds of rest`}
      className="items-center justify-center rounded-md"
      style={{ minWidth: 40, minHeight: 40, borderWidth: 1, borderColor: `${colors.accent}40` }}
      testID={testID}
    >
      <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 0.5 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * ENABLE ALERTS — asked contextually, once (§18).
 *
 * NOT during onboarding, not on app launch, and not again after a decline.
 * A permission prompt lands best at the moment its value is obvious, and the
 * moment is the first time an athlete is actually standing there resting.
 * Declining costs nothing: the in-app timer is unaffected, and Settings still
 * has the switch.
 */
function AlertsPrompt() {
  const colors = useThemeColors();
  const pending = useRestAlarmPromptStore((s) => s.pending);
  const dismiss = useRestAlarmPromptStore((s) => s.dismissForever);
  const [asking, setAsking] = useState(false);

  if (!pending || !restAlarmSupported() || restAlarmPermission() !== 'default') return null;

  return (
    <View
      className="mt-s2 flex-row items-center justify-between rounded-md border px-s3 py-s2"
      style={{ borderColor: `${colors.accent}40`, backgroundColor: 'rgba(34,211,238,0.06)' }}
      testID="rest-alerts-prompt"
    >
      <Text className="flex-1 pr-s2 text-2xs text-text-dim">Get alerted when your rest ends.</Text>
      <Pressable
        onPress={async () => {
          setAsking(true);
          await requestRestAlarmPermission();
          setAsking(false);
          // Asked is asked, whatever the answer — §18's "no repeated nagging".
          dismiss();
        }}
        accessibilityRole="button"
        disabled={asking}
        className="items-center justify-center rounded-md px-s3"
        style={{ minHeight: 40, backgroundColor: `${colors.accent}22` }}
        testID="rest-alerts-enable"
      >
        <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
          ENABLE ALERTS
        </Text>
      </Pressable>
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="not now"
        className="items-center justify-center"
        style={{ minWidth: 40, minHeight: 40 }}
        testID="rest-alerts-dismiss"
      >
        <Text className="text-2xs text-text-mute">✕</Text>
      </Pressable>
    </View>
  );
}

/** The inline rest bar — the STATIONARY anchor. Renders nothing when no
 *  rest is live; carries the ▾ that re-deploys the floating box. */
export function RestTimerBar() {
  const colors = useThemeColors();
  const clock = useRestClock();
  const collapsed = useRestUiStore((s) => s.collapsed);
  const setCollapsed = useRestUiStore((s) => s.setCollapsed);

  if (clock === null) return null;
  const { over, mm, ss } = clock;

  return (
    <View>
      <View
        className="flex-row items-center justify-between rounded-xl px-s4 py-s2"
        style={{
          borderWidth: 1,
          borderColor: over ? `${colors.success}8c` : `${colors.accent}59`,
          backgroundColor: over ? 'rgba(52,211,153,0.10)' : 'rgba(34,211,238,0.07)',
        }}
        testID="rest-timer"
      >
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          {over ? 'REST OVER — NEXT SET' : 'RESTING'}
        </Text>
        <View className="flex-row items-center gap-s2">
          {/* ±30s only while the clock is still running: adding time to a rest
              that is already over is a new rest, and SKIP → log is the honest
              way to say that. */}
          {over ? null : (
            <>
              <NudgeButton seconds={-REST_STEP_SECONDS} testID="rest-minus" />
              <NudgeButton seconds={REST_STEP_SECONDS} testID="rest-plus" />
            </>
          )}
          <Text
            className="text-xl font-bold"
            style={{
              color: over ? colors.success : colors.accent,
              fontVariant: ['tabular-nums'],
            }}
          >
            {over ? '✓' : `${mm}:${ss}`}
          </Text>
          <Pressable
            onPress={clearRest}
            accessibilityRole="button"
            accessibilityLabel="skip rest"
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
            testID="rest-skip"
          >
            <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
              SKIP
            </Text>
          </Pressable>
          {collapsed ? (
            // §3.3: the ▾ that re-deploys the floating box after ▴ dismissed it.
            <Pressable
              onPress={() => setCollapsed(false)}
              accessibilityRole="button"
              accessibilityLabel="show the floating rest timer"
              className="items-center justify-center"
              style={{ minWidth: 44, minHeight: 44 }}
              testID="rest-deploy"
            >
              <Text className="text-sm text-accent">▾</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <AlertsPrompt />
    </View>
  );
}

/**
 * The FLOATING rest box (§3.2/3.3): pinned inside the workout screen above
 * the scroll, so the countdown is visible however deep the page is. Compact,
 * right-aligned pill — the header back button owns the top-left. ▴ collapses
 * it; the inline bar's ▾ brings it back. No animation on purpose (an ambient
 * mover on every workout screen would fight the reduced-motion doctrine).
 */
export function FloatingRestTimer() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const clock = useRestClock();
  const collapsed = useRestUiStore((s) => s.collapsed);
  const setCollapsed = useRestUiStore((s) => s.setCollapsed);

  if (clock === null || collapsed) return null;
  const { over, mm, ss } = clock;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: Math.max(insets.top, 10) + 2, left: 0, right: 0, alignItems: 'flex-end' }}
    >
      <View
        className="mr-s3 flex-row items-center rounded-pill border px-s3"
        style={{
          minHeight: 40,
          gap: 10,
          borderColor: over ? `${colors.success}8c` : `${colors.accent}8c`,
          backgroundColor: over ? 'rgba(9,26,23,0.94)' : 'rgba(8,17,28,0.94)',
          shadowColor: over ? colors.success : colors.accent,
          shadowOpacity: 0.35,
          shadowRadius: 12,
          elevation: 6,
        }}
        testID="rest-float"
      >
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          {over ? 'REST OVER' : 'REST'}
        </Text>
        <Text
          className="text-base font-bold"
          style={{ color: over ? colors.success : colors.accent, fontVariant: ['tabular-nums'] }}
        >
          {over ? '✓' : `${mm}:${ss}`}
        </Text>
        {/* NO CHANCE SURFACE IN THE REST TIMER (v5 §3, which names it).
            There used to be a DROP button here, hedged about as carefully as it
            could be — opt-in, never in the last ten seconds, hidden once rest was
            over, with a comment observing that a surface appearing by itself would
            be "a slot machine attached to a barbell". The hedging was good and the
            surface was still a staked board between sets. A reveal is now granted
            silently and waits for the summary. */}
        <Pressable
          onPress={clearRest}
          accessibilityRole="button"
          accessibilityLabel="skip rest"
          className="items-center justify-center"
          style={{ minWidth: 36, minHeight: 40 }}
          testID="rest-float-skip"
        >
          <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1 }}>
            SKIP
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setCollapsed(true)}
          accessibilityRole="button"
          accessibilityLabel="hide the floating rest timer"
          className="items-center justify-center"
          style={{ minWidth: 36, minHeight: 40 }}
          testID="rest-float-collapse"
        >
          <Text className="text-sm text-accent">▴</Text>
        </Pressable>
      </View>
    </View>
  );
}
