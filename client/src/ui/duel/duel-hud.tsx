import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { AT_RISK, countdown, formatCoins, urgencyOf } from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';

/**
 * THE DUEL'S STATUS FURNITURE — the small pieces that appear on every duel
 * surface and must read identically on all of them.
 */

/**
 * A live clock that ticks WITHOUT re-rendering the page around it.
 *
 * It re-renders itself once a minute, which is the finest granularity the copy
 * ever shows. A per-second interval on a 7-day countdown would re-render a
 * whole duel screen 604,800 times to change a number 10,080 times.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * THE COUNTDOWN. Colour carries urgency; the words never change shape, so the
 * chip does not jump about as it counts down.
 */
export function DuelCountdown({
  endsAt,
  nowMs,
  label = 'REMAINING',
  compact = false,
  testID,
}: {
  endsAt: string | null;
  nowMs: number;
  label?: string;
  compact?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  if (!endsAt) return null;
  const left = Date.parse(endsAt) - nowMs;
  const urgency = urgencyOf(left);
  const tint =
    urgency === 'final' ? colors.danger : urgency === 'soon' ? colors.warn : colors['text-dim'];
  const text = countdown(left);

  return (
    <View
      testID={testID}
      className="flex-row items-center rounded-pill border px-s3"
      style={{
        gap: 6,
        minHeight: compact ? 28 : 34,
        borderColor: `${tint}59`,
        backgroundColor: urgency === 'calm' ? 'rgba(13,21,36,0.6)' : `${tint}14`,
      }}
      accessibilityLabel={`${text} ${label.toLowerCase()}`}
    >
      <Text allowFontScaling={false} style={{ fontSize: compact ? 11 : 13, color: tint, letterSpacing: 0.6, ...pixelFont() }}>
        {text}
      </Text>
      {compact ? null : (
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 8, letterSpacing: 1.2, ...pixelFont(false) }}
        >
          {left <= 0 ? 'SETTLING' : label}
        </Text>
      )}
    </View>
  );
}

/** The wallet, as a chip. One component so Home, the hub and the duel all
 *  render the same coins the same way. */
export function CoinBalance({
  coins,
  size = 'base',
  testID,
}: {
  coins: number | null;
  size?: 'base' | 'sm';
  testID?: string;
}) {
  const colors = useThemeColors();
  const big = size === 'base';
  return (
    <View className="flex-row items-center" style={{ gap: 6 }} testID={testID}>
      <CoinIcon size={big ? 22 : 15} />
      <Text
        allowFontScaling={false}
        style={{ fontSize: big ? 18 : 13, color: colors.legendary, letterSpacing: 0, ...pixelFont() }}
      >
        {coins === null ? '—' : formatCoins(coins)}
      </Text>
    </View>
  );
}

/**
 * WHAT IS ACTUALLY AT RISK — the paragraph, deleted.
 *
 * The old copy was true and nobody read it: "A draw refunds both stakes in
 * full. Nothing else is at risk — your XP, your Forge Level, your Evo Rating
 * and your evolution progress are all earned from your logged training…".
 * The same facts as five labelled rows are scannable in a second, and the long
 * version still exists behind CHALLENGE RULES for anyone who wants it.
 */
export function AtRiskGrid({ stake, testID }: { stake: number; testID?: string }) {
  const colors = useThemeColors();
  return (
    <View testID={testID}>
      <View className="flex-row" style={{ gap: 8 }}>
        <Cell k="IF YOU WIN" v={`+${formatCoins(stake)}`} tint={colors.success} />
        <Cell k="IF YOU LOSE" v={`−${formatCoins(stake)}`} tint={colors['text-dim']} />
      </View>
      <View className="mt-s2 flex-row flex-wrap" style={{ gap: 6 }}>
        {AT_RISK.map((f) => (
          <View
            key={f.k}
            className="flex-row items-center rounded-md border px-s2 py-s1"
            style={{ gap: 6, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
          >
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
            >
              {f.k}
            </Text>
            <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.success, ...pixelFont(false) }}>
              {f.v}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Cell({ k, v, tint }: { k: string; v: string; tint: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-lg border px-s3 py-s2"
      style={{ flex: 1, minWidth: 0, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1.3, ...pixelFont(false) }}
      >
        {k}
      </Text>
      <View className="mt-s1 flex-row items-center" style={{ gap: 5 }}>
        <CoinIcon size={14} />
        <Text allowFontScaling={false} style={{ fontSize: 19, color: tint, letterSpacing: 0, ...pixelFont() }}>
          {v}
        </Text>
      </View>
    </View>
  );
}

/** A quiet inline row: a label on the left, a value on the right. */
export function DuelRow({ k, v, tint }: { k: string; v: string; tint?: string }) {
  const colors = useThemeColors();
  return (
    <View className="mt-s2 flex-row items-start justify-between" style={{ gap: 12 }}>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>{k}</Text>
      <Text className="flex-1 text-right text-2xs" style={{ color: tint ?? colors.text }}>{v}</Text>
    </View>
  );
}
