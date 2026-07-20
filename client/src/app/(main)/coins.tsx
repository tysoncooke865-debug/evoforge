import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import { COIN_LABELS, useCoinHistory, useCoinTotal, type CoinEvent } from '@/data/coins';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/** The positive earning sources, in the order they read on the breakdown, each
 *  with its own hue. `spend` is handled separately (it's an outflow). */
const SOURCES: { kind: string; label: string; colour: (c: ReturnType<typeof useThemeColors>) => string }[] = [
  { kind: 'workout_complete', label: 'Workouts', colour: (c) => c.accent },
  { kind: 'pr', label: 'Personal records', colour: (c) => c.epic },
  { kind: 'streak_milestone', label: 'Streak milestones', colour: (c) => c.legendary },
  { kind: 'starting_bonus', label: 'Starting bonus', colour: (c) => c.rare },
  { kind: 'adjustment', label: 'Adjustments', colour: (c) => c['text-dim'] },
];

function startOfWeekMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // Monday as the week start (getDay: 0=Sun).
  const dow = (d.getDay() + 6) % 7;
  return d.getTime() - dow * 86_400_000;
}

/** THE VAULT — balance, this-week flow, where the coins came from, and the full
 *  ledger. The balance renders "—" on any read failure (a failure shown as 0
 *  reads as a wiped wallet). */
export default function CoinsScreen() {
  const colors = useThemeColors();
  const total = useCoinTotal();
  const history = useCoinHistory();
  const events = useMemo(() => history.data ?? [], [history.data]);
  // Capture "now" once at mount — Date.now() is impure inside a memo/render.
  const [nowMs] = useState(() => Date.now());

  const stats = useMemo(() => {
    const weekStart = startOfWeekMs(nowMs);
    let weekEarned = 0;
    let weekSpent = 0;
    let lifetimeSpent = 0;
    const bySource = new Map<string, number>();
    for (const e of events) {
      const t = Date.parse(String(e.created_at));
      const inWeek = Number.isFinite(t) && t >= weekStart;
      if (e.amount >= 0) {
        bySource.set(e.kind, (bySource.get(e.kind) ?? 0) + e.amount);
        if (inWeek) weekEarned += e.amount;
      } else {
        lifetimeSpent += -e.amount;
        if (inWeek) weekSpent += -e.amount;
      }
    }
    const earnedTotal = [...bySource.values()].reduce((a, v) => a + v, 0);
    return { weekEarned, weekSpent, lifetimeSpent, bySource, earnedTotal };
  }, [events, nowMs]);

  const maxSource = Math.max(1, ...SOURCES.map((s) => stats.bySource.get(s.kind) ?? 0));

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="THE VAULT"
        title="COINS"
        right={
          <View className="flex-row items-center gap-s2">
            <CoinIcon size={40} />
            <Text
              allowFontScaling={false}
              style={{ fontSize: 30, lineHeight: 36, color: colors.legendary, textShadowColor: 'rgba(251,191,36,0.5)', textShadowRadius: 14, ...pixelFont() }}
              testID="coin-balance"
            >
              {total.data === null || total.data === undefined ? '—' : total.data}
            </Text>
          </View>
        }
      />

      {/* This week + lifetime spent. */}
      {events.length > 0 ? (
        <GlowCard glow={colors.legendary}>
          <View className="flex-row" style={{ gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}>THIS WEEK</Text>
              <Text allowFontScaling={false} style={{ fontSize: 20, color: colors.legendary, ...pixelFont() }}>+{stats.weekEarned}</Text>
              {stats.weekSpent > 0 ? <Text className="text-2xs text-danger">−{stats.weekSpent} spent</Text> : null}
            </View>
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <View style={{ flex: 1 }}>
              <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}>EARNED (ALL)</Text>
              <Text allowFontScaling={false} style={{ fontSize: 20, color: colors.text, ...pixelFont() }}>{stats.earnedTotal}</Text>
              {stats.lifetimeSpent > 0 ? <Text className="text-2xs text-text-mute">−{stats.lifetimeSpent} spent</Text> : null}
            </View>
          </View>
        </GlowCard>
      ) : null}

      {/* Where the coins come from. */}
      {stats.earnedTotal > 0 ? (
        <GlowCard>
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
            WHERE YOUR COINS COME FROM
          </Text>
          <View className="mt-s3" style={{ gap: 10 }}>
            {SOURCES.map((s) => {
              const val = stats.bySource.get(s.kind) ?? 0;
              if (val <= 0) return null;
              const colour = s.colour(colors);
              return (
                <View key={s.kind} testID={`coin-source-${s.kind}`}>
                  <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                    <Text className="text-2xs text-text-dim">{s.label}</Text>
                    <Text allowFontScaling={false} style={{ fontSize: 11, color: colour, ...pixelFont(false) }}>
                      {val} · {Math.round((val / stats.earnedTotal) * 100)}%
                    </Text>
                  </View>
                  <View className="mt-s1 overflow-hidden rounded-pill" style={{ height: 5, backgroundColor: colors['surface-3'] }}>
                    <View style={{ height: '100%', width: `${Math.max(0.04, val / maxSource) * 100}%`, borderRadius: 999, backgroundColor: colour }} />
                  </View>
                </View>
              );
            })}
          </View>
        </GlowCard>
      ) : null}

      {/* Spend pointer — the shops (skins, champions, palettes) live in Customise. */}
      <Pressable
        onPress={() => router.push('/customise' as never)}
        accessibilityRole="button"
        testID="coin-spend-cta"
        className="flex-row items-center justify-between rounded-lg border p-s3"
        style={{ borderColor: `${colors.legendary}59`, backgroundColor: 'rgba(251,191,36,0.06)' }}
      >
        <View style={{ flex: 1 }}>
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>SPEND YOUR COINS →</Text>
          <Text className="mt-s1 text-2xs text-text-mute">Unlock champion skins, new champions and colour palettes in Customise.</Text>
        </View>
        <CoinIcon size={22} />
      </Pressable>

      <Text className="mt-s1 text-2xs text-text-mute">
        Every coin is server-verified: workout complete +25, PR +50, streak milestones 10× the
        milestone, plus the 100-coin starting bonus.
      </Text>

      <Text className="mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>HISTORY</Text>
      {events.length === 0 ? (
        <Text className="text-center text-2xs text-text-mute">Nothing banked yet — go train.</Text>
      ) : (
        events.map((e) => <LedgerRow key={e.id} e={e} />)
      )}
    </ScreenShell>
  );
}

function LedgerRow({ e }: { e: CoinEvent }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-between rounded-md border border-border p-s3"
      style={{ backgroundColor: 'rgba(8,14,26,0.55)' }}
    >
      <View className="flex-1">
        <Text className="text-text" allowFontScaling={false} style={{ fontSize: 13, ...pixelFont() }}>
          {COIN_LABELS[e.kind] ?? e.kind}
        </Text>
        <Text className="text-2xs text-text-mute">
          {String(e.created_at).slice(0, 10)}
          {e.source_id && e.kind === 'streak_milestone' ? ` · ${e.source_id.split(':')[0]}-day streak` : ''}
        </Text>
      </View>
      <View className="flex-row items-center gap-s1">
        <CoinIcon size={16} />
        <Text allowFontScaling={false} style={{ fontSize: 14, color: e.amount > 0 ? colors.legendary : colors.danger, ...pixelFont() }}>
          {e.amount > 0 ? `+${e.amount}` : e.amount}
        </Text>
      </View>
    </View>
  );
}
