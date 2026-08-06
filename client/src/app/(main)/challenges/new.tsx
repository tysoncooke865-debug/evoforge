import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useCoinTotal } from '@/data/coins';
import { useCreateChallenge } from '@/data/forge-challenges';
import { useFriends } from '@/data/social';
import {
  CHALLENGE_DURATIONS,
  CHALLENGE_INFO,
  CHALLENGE_STAKES,
  CHALLENGE_TYPES,
  DEFAULT_LIFT,
  SAFETY_NOTE,
  type ChallengeDuration,
  type ChallengeStake,
  type ChallengeType,
} from '@/domain/forge-challenge';
import { addDaysIso, todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SkeletonScreen } from '@/ui/core/skeleton';

/**
 * CREATE A CHALLENGE — opponent → type → duration → stake → review.
 *
 * ONE SCREEN, five sections, not five modals. The athlete can see what they
 * have already chosen while choosing the next thing, and the review at the
 * bottom is the same page rather than a summary they have to trust.
 *
 * The RULES ARE SHOWN IN FULL before sending, because they are shown in full
 * before ACCEPTING too, and a wager whose terms differ between the two ends is
 * a trick. Both read CHALLENGE_INFO.
 */
export default function NewChallengeScreen() {
  const colors = useThemeColors();
  const friends = useFriends();
  const coins = useCoinTotal();
  const create = useCreateChallenge();

  const [opponent, setOpponent] = useState<{ id: string; name: string } | null>(null);
  const [type, setType] = useState<ChallengeType | null>(null);
  const [duration, setDuration] = useState<ChallengeDuration | null>(null);
  const [stake, setStake] = useState<ChallengeStake | null>(null);
  const [agreed, setAgreed] = useState(false);

  if (friends.isPending || coins.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE CHALLENGE" title="NEW CHALLENGE" onBack={() => router.back()} />
        <SkeletonScreen cards={3} testID="new-challenge-loading" />
      </ScreenShell>
    );
  }

  const balance = coins.data ?? 0;
  const friendList = friends.data ?? [];
  const info = type ? CHALLENGE_INFO[type] : null;
  const ready = opponent !== null && type !== null && duration !== null && stake !== null && agreed;

  const start = calendarToday();
  const end = duration ? addDaysIso(start, duration - 1) : null;

  if (friendList.length === 0) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="FORGE CHALLENGE" title="NEW CHALLENGE" onBack={() => router.back()} />
        <GlowCard testID="new-challenge-no-friends">
          <Text className="text-sm text-text">You need a friend first.</Text>
          <Text className="mt-s1 text-2xs text-text-dim">
            Challenges are between people who already know each other — there is no public
            matchmaking, and never will be for a wager.
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
      <ScreenHeader kicker="FORGE CHALLENGE" title="NEW CHALLENGE" onBack={() => router.back()} />

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
      <SectionLabel>2 · WHAT YOU ARE COMPETING ON</SectionLabel>
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

      {/* THE RULES, in full, the moment a type is chosen. */}
      {info ? (
        <GlowCard testID="challenge-rules">
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.2 }}>
            WHAT IS MEASURED
          </Text>
          <Text className="mt-s1 text-sm text-text">{info.measures}</Text>
          <Text className="mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.2 }}>
            HOW THE WINNER IS DECIDED
          </Text>
          <Text className="mt-s1 text-sm text-text">{info.winner}</Text>
          <Text className="mt-s3 text-2xs" style={{ color: colors.success, letterSpacing: 1.2 }}>
            WHAT COUNTS
          </Text>
          {info.counts.map((x) => (
            <Text key={x} className="mt-s1 text-2xs text-text-dim">· {x}</Text>
          ))}
          <Text className="mt-s3 text-2xs" style={{ color: colors.warn, letterSpacing: 1.2 }}>
            WHAT DOES NOT
          </Text>
          {info.doesNotCount.map((x) => (
            <Text key={x} className="mt-s1 text-2xs text-text-dim">· {x}</Text>
          ))}
        </GlowCard>
      ) : null}

      {/* ── 3 ── */}
      <SectionLabel>3 · HOW LONG</SectionLabel>
      <View className="flex-row" style={{ gap: 8 }}>
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

      {/* ── 4 ── */}
      <SectionLabel>4 · THE STAKE</SectionLabel>
      <View className="flex-row" style={{ gap: 8 }}>
        {CHALLENGE_STAKES.map((s) => (
          <Choice
            key={s}
            label={`${s}`}
            sub={s > balance ? 'too many' : undefined}
            active={stake === s}
            disabled={s > balance}
            onPress={() => setStake(s)}
            testID={`challenge-stake-${s}`}
          />
        ))}
      </View>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <CoinIcon size={14} />
        <Text className="text-2xs text-text-mute">
          You have {balance}. Coins are earned by training and are never purchasable.
        </Text>
      </View>

      {/* ── 5 ── */}
      {ready || (opponent && type && duration && stake) ? (
        <>
          <SectionLabel>5 · REVIEW</SectionLabel>
          <GlowCard glow={colors.accent} testID="challenge-review">
            <Row k="OPPONENT" v={opponent?.name ?? '—'} />
            <Row k="CHALLENGE" v={info?.name ?? '—'} />
            {type === 'most_improved_lift' ? <Row k="LIFT" v="Barbell Bench Press" /> : null}
            <Row k="STARTS" v={start} />
            <Row k="ENDS" v={end ?? '—'} />
            <Row k="STAKE EACH" v={`${stake} coins`} />
            <Row k="TOTAL ESCROW" v={`${(stake ?? 0) * 2} coins`} />
            <Row k="WINNER TAKES" v={`${(stake ?? 0) * 2} coins`} />
            <Row k="A DRAW" v="Refunds both stakes in full" />
            <Row k="CANCELLING" v="Refunds both stakes in full" />
            <Row k="A DISPUTE" v="Pauses settlement; coins stay in escrow" />
            <Row k="THE RULES" v="Lock the moment they accept" />

            <Text className="mt-s3 text-2xs text-text-mute">{SAFETY_NOTE}</Text>

            <Pressable
              onPress={() => setAgreed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              accessibilityLabel="I agree to these challenge rules"
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
        title={create.isPending ? 'SENDING…' : 'SEND CHALLENGE'}
        size="hero"
        pixel
        disabled={!ready || create.isPending}
        busy={create.isPending}
        onPress={() => {
          if (!ready || !opponent || !type || !duration || !stake) return;
          create.mutate(
            {
              opponentId: opponent.id,
              challengeType: type,
              metricKey: type === 'most_improved_lift' ? DEFAULT_LIFT : null,
              durationDays: duration,
              stake,
            },
            { onSuccess: () => router.replace('/challenges' as never) }
          );
        }}
        testID="challenge-send"
      />
      <Text className="text-center text-2xs text-text-mute">
        Nothing is staked until they accept.
      </Text>
    </ScreenShell>
  );
}

function Choice({
  label,
  sub,
  active,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  sub?: string;
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
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
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
      {sub ? <Text className="text-2xs text-text-mute">{sub}</Text> : null}
    </Pressable>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View className="mt-s2 flex-row items-start justify-between" style={{ gap: 12 }}>
      <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>{k}</Text>
      <Text className="flex-1 text-right text-2xs text-text">{v}</Text>
    </View>
  );
}
