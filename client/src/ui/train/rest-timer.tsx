import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRestUiStore } from '@/state/rest-ui-store';
import { useThemeColors } from '@/theme/use-theme';
import { playRestOver } from '@/ui/core/sound';

/**
 * TRANSFORM P2 — the rest timer. Absolute-timestamp design, per the
 * brief: only `restEndAt` is stored (AsyncStorage), remaining time is
 * DERIVED from Date.now() on every tick, so the timer survives remounts,
 * navigation, backgrounding and screen locks by construction — nothing to
 * drift, nothing to reset. The 1s tick only re-renders the bar while a
 * rest is live.
 */

const KEY = 'evoforge-rest-end-v1';
export const DEFAULT_REST_SECONDS = 120;

let listeners: (() => void)[] = [];

/** Start (or restart) the rest clock. Called after a confirmed set log. */
export function startRest(seconds: number = DEFAULT_REST_SECONDS): void {
  const endAt = Date.now() + seconds * 1000;
  void AsyncStorage.setItem(KEY, String(endAt));
  for (const l of listeners) l();
}

export function clearRest(): void {
  void AsyncStorage.removeItem(KEY);
  for (const l of listeners) l();
}

async function readEndAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** One buzz per rest, app-wide — the clock now has TWO mounted subscribers
 *  (inline bar + floating box) and each firing its own effect would chime
 *  twice. The module-level latch keys on the endAt timestamp. */
let buzzedForEndAt: number | null = null;

/** The shared rest clock: both timer surfaces subscribe to the SAME module
 *  state — the overlay is a second subscriber, never a second timer. */
function useRestClock(): { remaining: number; over: boolean; mm: number; ss: string } | null {
  const [endAt, setEndAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => void readEndAt().then(setEndAt);
    sync();
    listeners.push(sync);
    return () => {
      listeners = listeners.filter((l) => l !== sync);
    };
  }, []);

  useEffect(() => {
    if (endAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endAt]);

  const remaining = endAt === null ? null : Math.ceil((endAt - now) / 1000);
  const over = remaining !== null && remaining <= 0;

  // The completion buzz lives in an effect (refs/side-effects never run in
  // render): fires exactly once per rest as `over` flips true.
  useEffect(() => {
    if (!over || endAt === null || buzzedForEndAt === endAt) return;
    buzzedForEndAt = endAt;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    playRestOver(); // the retro rest-over chime (web; settings-gated)
  }, [over, endAt]);

  if (endAt === null || remaining === null) return null;
  // Linger for 8s after zero so "REST OVER" is seen, then self-clear
  // (idempotent — either subscriber may reach it first).
  if (remaining <= -8) {
    void AsyncStorage.removeItem(KEY);
    return null;
  }
  const mm = Math.max(0, Math.trunc(remaining / 60));
  const ss = String(Math.max(0, remaining % 60)).padStart(2, '0');
  return { remaining, over, mm, ss };
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
      <View className="flex-row items-center gap-s3">
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
