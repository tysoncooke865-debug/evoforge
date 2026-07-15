import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import tokens from '@/theme/tokens';

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

/** The floating rest bar. Renders nothing when no rest is live. */
export function RestTimerBar() {
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
    if (over && Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [over]);

  if (endAt === null || remaining === null) return null;
  // Linger for 8s after zero so "REST OVER" is seen, then self-clear.
  if (remaining <= -8) {
    void AsyncStorage.removeItem(KEY);
    return null;
  }
  const mm = Math.max(0, Math.trunc(remaining / 60));
  const ss = String(Math.max(0, remaining % 60)).padStart(2, '0');

  return (
    <View
      className="flex-row items-center justify-between rounded-xl px-s4 py-s2"
      style={{
        borderWidth: 1,
        borderColor: over ? `${tokens.colors.success}8c` : `${tokens.colors.accent}59`,
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
            color: over ? tokens.colors.success : tokens.colors.accent,
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
      </View>
    </View>
  );
}
