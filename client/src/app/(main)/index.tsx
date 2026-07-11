import { ScrollView, Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import {
  useBodyweightLog,
  useCardioLog,
  useLatestBodyfatMid,
  useLedgerXp,
  usePhysiqueRatings,
  useProfile,
  useWorkoutLog,
} from '@/data/hooks';
import { calculateAvatarStats } from '@/domain/avatar-stats-calc';
import { workoutSummary } from '@/domain/summary';
import { pyFloat } from '@/domain/py';
import { AvatarCard } from '@/ui/avatar-card';
import { XpBar } from '@/ui/xp-bar';

/**
 * Home: the athlete's character on real data. Level and XP come from the
 * golden-fixtured domain port; branch/class come from the FULL
 * calculate_avatar_stats blend (AI ratings, body fat, cardio, muscle sets) --
 * a profile-only approximation shipped first and mis-branded an aesthetic
 * athlete as Mass Monster.
 */
export default function HomeScreen() {
  const { signOut } = useAuth();
  const profile = useProfile();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const bodyweights = useBodyweightLog();
  const bfMid = useLatestBodyfatMid();
  const physique = usePhysiqueRatings();
  const ledger = useLedgerXp();

  const baseLevel = profile.data?.base_level ?? 1;
  const summary = workoutSummary(
    workouts.data ?? [],
    cardio.data ?? [],
    ledger.data ?? null,
    baseLevel
  );

  // latest_bodyweight_value(): last positive reading, else null (77kg default
  // applies inside the calc, exactly like Python).
  const bwRows = bodyweights.data ?? [];
  const positiveBw = bwRows
    .map((r) => pyFloat(r.bodyweight) ?? 0)
    .filter((v) => v > 0);
  const latestBodyweight = positiveBw.length > 0 ? positiveBw[positiveBw.length - 1] : null;

  const cardioDistanceKm = (cardio.data ?? []).reduce(
    (acc, r) => acc + (pyFloat((r as Record<string, unknown>).distance_km) ?? 0),
    0
  );

  const stats = calculateAvatarStats({
    workoutRows: workouts.data ?? [],
    level: summary.level,
    latestBodyweight,
    bfMid: bfMid.data ?? null,
    physique: (physique.data ?? {
      physique_score: null,
      leanness_score: null,
      symmetry_score: null,
      muscularity_score: null,
    }) as never,
    cardioMinutes: summary.cardioMinutes,
    cardioDistanceKm,
  });

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <AvatarCard branch={stats.branch} level={summary.level} />

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s2 text-xs text-text-mute">LEVEL {summary.level} PROGRESS</Text>
          <XpBar xpIntoLevel={summary.xpIntoLevel} xpNeeded={summary.xpNeeded} />
          <View className="mt-s4 flex-row justify-between">
            <Stat label="TOTAL SETS" value={String(summary.totalSets)} />
            <Stat label="TOTAL XP" value={String(summary.xp)} />
            <Stat label="CARDIO MIN" value={String(Math.trunc(summary.cardioMinutes))} />
          </View>
          {summary.xpDrift !== 0 ? (
            <Text className="mt-s2 text-2xs text-warn">
              ledger drift {summary.xpDrift} · source: {summary.xpSource}
            </Text>
          ) : null}
        </View>

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s2 text-xs text-text-mute">
            {stats.characterClass.toUpperCase()} · {stats.buildType.toUpperCase()} · FOCUS:{' '}
            {stats.weakPointFocus.toUpperCase()}
          </Text>
          <View className="flex-row flex-wrap justify-between">
            <Stat label="STRENGTH" value={`${stats.strengthScore}`} />
            <Stat label="SIZE" value={`${stats.sizeScore}`} />
            <Stat label="LEAN" value={`${stats.leannessScore}`} />
            <Stat label="CONDITION" value={`${stats.conditioningScore}`} />
            <Stat label="AESTHETIC" value={`${stats.aestheticScore}`} />
          </View>
        </View>

        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          testID="sign-out"
        >
          <Text className="font-bold text-text">SIGN OUT</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="items-center">
      <Text className="text-lg font-bold text-accent">{value}</Text>
      <Text className="text-2xs text-text-mute">{label}</Text>
    </View>
  );
}
