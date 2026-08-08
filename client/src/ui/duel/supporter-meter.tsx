import { Pressable, Text, View } from 'react-native';

import {
  DUEL_REACTIONS,
  countdown,
  formatCoins,
  supportSplit,
  type DuelReactionKey,
} from '@/domain/forge-duel';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * SOCIAL SENTIMENT, as a meter.
 *
 * SHOWS THE SHARE, NOT THE MONEY. Percentages and a headcount tell the whole
 * story — "62% are on Tyson" — while raw coin totals would turn a friendly
 * prediction into a public statement about somebody's wallet, and would let a
 * spectator work out exactly what one friend staked. The server returns the
 * totals so the pari-mutuel estimate can be honest; this component chooses not
 * to print them.
 */
export function SupporterMeter({
  challengerName,
  opponentName,
  challengerTotal,
  opponentTotal,
  supporterCount,
  closesAt,
  nowMs,
  live = true,
  testID,
}: {
  challengerName: string;
  opponentName: string;
  challengerTotal: number;
  opponentTotal: number;
  supporterCount: number;
  closesAt: string | null;
  nowMs: number;
  /** A settled duel's support window is closed whatever its clock says — the
   *  screenshot pass caught "CLOSES IN 1D 10H" on a duel that had already
   *  paid out. */
  live?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const split = supportSplit(challengerTotal, opponentTotal);
  const open = live && closesAt !== null && Date.parse(closesAt) > nowMs;
  const left = closesAt ? Date.parse(closesAt) - nowMs : 0;

  return (
    <View testID={testID}>
      <View className="flex-row items-center justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.4, ...pixelFont(false) }}
        >
          {supporterCount === 0
            ? 'NOBODY BACKING YET'
            : `${supporterCount} ${supporterCount === 1 ? 'SUPPORTER' : 'SUPPORTERS'}`}
        </Text>
        <Text
          allowFontScaling={false}
          testID={testID ? `${testID}-window` : undefined}
          style={{
            fontSize: 9,
            letterSpacing: 1.2,
            color: open ? colors.warn : colors['text-mute'],
            ...pixelFont(false),
          }}
        >
          {open ? `CLOSES IN ${countdown(left)}` : 'SUPPORT LOCKED'}
        </Text>
      </View>

      <View
        className="mt-s2 w-full flex-row overflow-hidden rounded-pill"
        style={{ height: 10, backgroundColor: colors['surface-3'] }}
        accessibilityLabel={`${split.challengerPct} percent behind ${challengerName}, ${split.opponentPct} percent behind ${opponentName}`}
      >
        <View style={{ width: `${split.challengerPct}%`, backgroundColor: colors.accent, opacity: split.total ? 1 : 0.3 }} />
        <View style={{ width: `${split.opponentPct}%`, backgroundColor: colors.danger, opacity: split.total ? 1 : 0.3 }} />
      </View>

      <View className="mt-s2 flex-row items-center justify-between" style={{ gap: 10 }}>
        <Side name={challengerName} pct={split.challengerPct} tint={colors.accent} muted={split.total === 0} />
        <Side name={opponentName} pct={split.opponentPct} tint={colors.danger} muted={split.total === 0} right />
      </View>
    </View>
  );
}

function Side({
  name,
  pct,
  tint,
  muted,
  right,
}: {
  name: string;
  pct: number;
  tint: string;
  muted: boolean;
  right?: boolean;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: right ? 'flex-end' : 'flex-start' }}>
      <Text className="text-2xs text-text-dim" numberOfLines={1}>{name}</Text>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 15, color: muted ? '#64758f' : tint, letterSpacing: 0, ...pixelFont() }}
      >
        {muted ? '—' : `${pct}%`}
      </Text>
    </View>
  );
}

/**
 * REACTIONS — five glyphs, toggled.
 *
 * The vocabulary is closed on purpose: a fixed set cannot carry a message, so
 * it needs no moderation, and the primary key caps one athlete at five rows
 * however fast they tap. That is a cheaper rate limit than a counter and one
 * that cannot drift.
 */
export function DuelReactions({
  counts,
  mine,
  onToggle,
  disabled = false,
  testID,
}: {
  counts: Record<string, number>;
  mine: readonly string[];
  onToggle: (emoji: DuelReactionKey, on: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }} testID={testID}>
      {DUEL_REACTIONS.map((r) => {
        const on = mine.includes(r.key);
        const n = counts[r.key] ?? 0;
        return (
          <Pressable
            key={r.key}
            onPress={disabled ? undefined : () => onToggle(r.key, !on)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`${r.label}${n ? `, ${n}` : ''}`}
            testID={`duel-react-${r.key}`}
            className="flex-row items-center rounded-pill border px-s3"
            style={{
              gap: 5,
              minHeight: 44,
              opacity: disabled ? 0.45 : 1,
              borderColor: on ? `${colors.accent}8c` : colors.border,
              backgroundColor: on ? 'rgba(34,211,238,0.1)' : 'rgba(13,21,36,0.5)',
            }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 15 }}>{r.glyph}</Text>
            {n > 0 ? (
              <Text
                allowFontScaling={false}
                style={{ fontSize: 11, color: on ? colors.accent : colors['text-dim'], ...pixelFont() }}
              >
                {n}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** What a supporter's position looks like once it exists — including, after
 *  settlement, exactly what it returned. */
export function MySupport({
  backedName,
  amount,
  payout,
  estimate,
  settled,
  testID,
}: {
  backedName: string;
  amount: number;
  payout: number | null;
  /** The pari-mutuel estimate while the pools are still moving. */
  estimate: number | null;
  settled: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  const won = settled && (payout ?? 0) > amount;
  const tint = settled ? (won ? colors.success : colors['text-dim']) : colors.accent;
  return (
    <View
      testID={testID}
      className="flex-row items-center rounded-lg border px-s3 py-s2"
      style={{ gap: 10, borderColor: `${tint}45`, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.3, color: tint, ...pixelFont(false) }}
        >
          {settled ? (won ? 'YOUR CALL PAID' : 'YOUR CALL') : 'YOU ARE BACKING'}
        </Text>
        <Text className="mt-s1 text-sm text-text" numberOfLines={1}>{backedName}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text allowFontScaling={false} style={{ fontSize: 17, color: tint, letterSpacing: 0, ...pixelFont() }}>
          {settled ? `${payout ?? 0 > 0 ? '+' : ''}${formatCoins(payout ?? 0)}` : formatCoins(amount)}
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {settled
            ? `staked ${formatCoins(amount)}`
            : estimate !== null && estimate > amount
              ? `~${formatCoins(estimate)} if they win`
              : 'nothing on the other side yet'}
        </Text>
      </View>
    </View>
  );
}
