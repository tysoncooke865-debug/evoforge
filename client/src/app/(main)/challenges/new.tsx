import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useCoinTotal } from '@/data/coins';
import { useCreateChallenge } from '@/data/forge-challenges';
import { useDuelConfig } from '@/data/forge-duel';
import { useFriends } from '@/data/social';
import {
  CHALLENGE_DURATIONS,
  CHALLENGE_INFO,
  CHALLENGE_TYPES,
  DEFAULT_LIFT,
  SAFETY_NOTE,
  type ChallengeDuration,
  type ChallengeType,
} from '@/domain/forge-challenge';
import { DEFAULT_DUEL_CONFIG, clampStake, formatCoins, maxStakeFor } from '@/domain/forge-duel';
import { addDaysIso, todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { AtRiskGrid, CoinBalance, DuelRow } from '@/ui/duel/duel-hud';

/**
 * START A DUEL — opponent → contest → length → chips → send.
 *
 * ONE SCREEN, five moves, not five modals. The athlete can see what they have
 * already chosen while choosing the next thing, and the review at the bottom is
 * the same page rather than a summary they have to trust.
 *
 * THE RULES ARE SHOWN IN FULL BEFORE SENDING, because they are shown in full
 * before ACCEPTING too, and a wager whose terms differ between the two ends is
 * a trick. Both read CHALLENGE_INFO.
 */
export default function NewChallengeScreen() {
  const colors = useThemeColors();
  const friends = useFriends();
  const coins = useCoinTotal();
  const create = useCreateChallenge();
  const cfgQuery = useDuelConfig();
  const cfg = cfgQuery.data ?? DEFAULT_DUEL_CONFIG;

  const [opponent, setOpponent] = useState<{ id: string; name: string } | null>(null);
  const [type, setType] = useState<ChallengeType | null>(null);
  const [duration, setDuration] = useState<ChallengeDuration | null>(null);
  const [stake, setStake] = useState(0);
  const [spectators, setSpectators] = useState(true);
  const [agreed, setAgreed] = useState(false);

  if (friends.isPending || coins.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE DUEL" title="NEW DUEL" onBack={() => router.back()} />
        <SkeletonScreen cards={3} testID="new-challenge-loading" />
      </ScreenShell>
    );
  }

  const balance = coins.data ?? 0;
  const friendList = friends.data ?? [];
  const info = type ? CHALLENGE_INFO[type] : null;
  // The largest stake the SERVER would accept, computed from the same three
  // limits it checks. The table cannot offer a refusal.
  const maxStake = maxStakeFor(balance, cfg);
  const ready =
    opponent !== null && type !== null && duration !== null && stake >= cfg.min_stake && agreed;

  const start = calendarToday();
  const end = duration ? addDaysIso(start, duration - 1) : null;

  if (friendList.length === 0) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE DUEL" title="NEW DUEL" onBack={() => router.back()} />
        <GlowCard testID="new-challenge-no-friends">
          <Text className="text-sm text-text">You need a friend first.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            Duels are between people who already know each other — there is no public
            matchmaking, and never will be where coins are involved.
          </Text>
          <View className="mt-s3">
            <NeonButton title="FIND FRIENDS" pixel onPress={() => router.push('/friends' as never)} testID="new-challenge-friends" />
          </View>
        </GlowCard>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="FORGE DUEL"
        title="NEW DUEL"
        onBack={() => router.back()}
        right={<CoinBalance coins={coins.data ?? null} testID="new-duel-balance" />}
      />

      {/* ── 1 ── */}
      <SectionLabel>1 · WHO</SectionLabel>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {friendList.map((f) => (
          <Choice
            key={f.id}
            label={f.display_name}
            active={opponent?.id === f.id}
            onPress={() => setOpponent({ id: f.id, name: f.display_name })}
            testID={`challenge-opponent-${f.id}`}
          />
        ))}
      </View>

      {/* ── 2 ── */}
      <SectionLabel>2 · THE CONTEST</SectionLabel>
      {CHALLENGE_TYPES.map((t) => {
        const i = CHALLENGE_INFO[t];
        const on = type === t;
        return (
          <Pressable
            key={t}
            onPress={() => setType(t)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${i.name}. ${i.tagline}.`}
            testID={`challenge-type-${t}`}
            className="w-full rounded-xl border p-s3"
            style={{
              minHeight: 44,
              borderColor: on ? colors.accent : colors.border,
              backgroundColor: on ? 'rgba(34,211,238,0.07)' : 'rgba(13,21,36,0.5)',
            }}
          >
            <Text
              allowFontScaling={false}
              style={{ fontSize: 11, letterSpacing: 1.2, color: on ? colors.accent : colors.text, ...pixelFont(false) }}
            >
              {i.name}
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">{i.tagline}</Text>
          </Pressable>
        );
      })}

      {info ? (
        <GlowCard testID="challenge-rules">
          <DuelRow k="MEASURED" v={info.measures} />
          <DuelRow k="WINNER" v={info.winner} />
          <DuelRow k="COUNTS" v={info.counts.join(' · ')} />
          <DuelRow k="DOES NOT" v={info.doesNotCount.join(' · ')} />
          {type === 'most_improved_lift' ? (
            // 139's baseline rule, stated where the athlete agrees to it: the
            // starting number is snapshotted at acceptance and never
            // recomputed, so a later edit to old training cannot rewrite it.
            <DuelRow k="STARTING VALUE" v="Frozen the moment they accept — later edits cannot move it." />
          ) : null}
        </GlowCard>
      ) : null}

      {/* ── 3 ── */}
      <SectionLabel>3 · HOW LONG</SectionLabel>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {CHALLENGE_DURATIONS.map((d) => (
          <Choice
            key={d}
            label={`${d} DAYS`}
            active={duration === d}
            onPress={() => setDuration(d)}
            testID={`challenge-duration-${d}`}
          />
        ))}
      </View>

      {/* ── 4 ── THE TABLE. */}
      <SectionLabel>4 · SET THE PLEDGE</SectionLabel>
      <GlowCard testID="challenge-stake-table" padding={16}>
        <ChipWagerTable
          value={stake}
          onChange={(v) => setStake(clampStake(v, balance, cfg))}
          balance={balance}
          min={cfg.min_stake}
          max={maxStake}
          potLabel="POOL IF THEY ACCEPT"
          testID="new-duel-table"
        />
        <Text className="mt-s2 text-2xs text-text-mute">
          You have {formatCoins(balance)}. Coins are earned by training and are never purchasable.
          Nothing leaves your wallet until they accept.
        </Text>
      </GlowCard>

      {/* ── 5 ── */}
      <SectionLabel>5 · WHO CAN WATCH</SectionLabel>
      <Pressable
        onPress={() => setSpectators((v) => !v)}
        accessibilityRole="switch"
        accessibilityState={{ checked: spectators }}
        accessibilityLabel="Let mutual friends watch and back this duel"
        testID="challenge-spectators"
        className="w-full flex-row items-center rounded-xl border p-s3"
        style={{
          gap: 12,
          minHeight: 44,
          borderColor: spectators ? `${colors.accent}59` : colors.border,
          backgroundColor: spectators ? 'rgba(34,211,238,0.06)' : 'rgba(13,21,36,0.5)',
        }}
      >
        <View
          style={{
            width: 22, height: 22, borderRadius: 5, borderWidth: 1,
            borderColor: spectators ? colors.accent : colors.border,
            backgroundColor: spectators ? 'rgba(34,211,238,0.15)' : 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          {spectators ? <Text style={{ color: colors.accent, fontSize: 13 }}>✓</Text> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-sm text-text">Friends can watch and back a side</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            They see the duel metric and the scoreline — never your measurements, photos or
            workout log. Turn this off and the duel is between the two of you.
          </Text>
        </View>
      </Pressable>

      {/* ── REVIEW ── */}
      {opponent && type && duration && stake > 0 ? (
        <>
          <SectionLabel>REVIEW</SectionLabel>
          <GlowCard glow={colors.accent} testID="challenge-review">
            <DuelRow k="OPPONENT" v={opponent.name} />
            <DuelRow k="CONTEST" v={info?.name ?? '—'} />
            {type === 'most_improved_lift' ? <DuelRow k="LIFT" v="Barbell Bench Press" /> : null}
            <DuelRow k="RUNS" v={`${start} → ${end ?? '—'}`} />
            <DuelRow k="PLEDGE EACH" v={`${formatCoins(stake)} coins`} tint={colors.text} />
            <DuelRow k="POT" v={`${formatCoins(stake * 2)} coins`} tint={colors.legendary} />
            <DuelRow k="RAISING" v={`Either of you may propose one after you have both trained. Up to ${cfg.max_raises}.`} />
            <DuelRow k="THE RULES" v="Contest, length and opening pledge lock the moment they accept." />

            <View className="mt-s3">
              <AtRiskGrid stake={stake} testID="new-duel-at-risk" />
            </View>

            <Text className="mt-s3 text-2xs text-text-mute">{SAFETY_NOTE}</Text>

            <Pressable
              onPress={() => setAgreed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel="I agree to these duel rules"
              testID="challenge-agree"
              className="mt-s3 flex-row items-center"
              style={{ gap: 10, minHeight: 44 }}
            >
              <View
                style={{
                  width: 22, height: 22, borderRadius: 5, borderWidth: 1,
                  borderColor: agreed ? colors.success : colors.border,
                  backgroundColor: agreed ? 'rgba(52,211,153,0.15)' : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {agreed ? <Text style={{ color: colors.success, fontSize: 13 }}>✓</Text> : null}
              </View>
              <Text className="flex-1 text-2xs text-text-dim">
                I have read these rules and agree to them.
              </Text>
            </Pressable>
          </GlowCard>
        </>
      ) : null}

      <NeonButton
        title={create.isPending ? 'SENDING…' : stake > 0 ? `SEND · ${formatCoins(stake)} EACH` : 'SEND DUEL'}
        size="hero"
        pixel
        disabled={!ready || create.isPending}
        busy={create.isPending}
        onPress={() => {
          if (!ready || !opponent || !type || !duration) return;
          create.mutate(
            {
              opponentId: opponent.id,
              challengeType: type,
              metricKey: type === 'most_improved_lift' ? DEFAULT_LIFT : null,
              durationDays: duration,
              stake,
              spectatorsEnabled: spectators,
            },
            { onSuccess: () => router.replace('/challenges' as never) }
          );
        }}
        testID="challenge-send"
      />
      <Text className="text-center text-2xs text-text-mute">
        Nothing is staked until they accept. They can counter with a different number.
      </Text>
    </ScreenShell>
  );
}

function Choice({
  label,
  active,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      testID={testID}
      className="rounded-lg border px-s3"
      style={{
        minHeight: 44,
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? 'rgba(34,211,238,0.1)' : 'rgba(13,21,36,0.5)',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 12, letterSpacing: 0.5, color: active ? colors.accent : colors.text, ...pixelFont() }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
