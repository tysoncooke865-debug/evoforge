import { ScrollView, Pressable, Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useCardioLog, useLedgerXp, useProfile, useWorkoutLog } from '@/data/hooks';
import { determineAvatarBranch } from '@/domain/avatar-stats';
import { workoutSummary } from '@/domain/summary';
import { AvatarCard } from '@/ui/avatar-card';
import { XpBar } from '@/ui/xp-bar';

/**
 * Home: the athlete's character on real data. Level and XP come from the
 * golden-fixtured domain port fed by the Query hooks -- the same recount the
 * Python app does every render, because the derived number is the only oracle
 * that can catch ledger drift.
 *
 * Branch selection here is the placement-era approximation (profile strength
 * scores); calculate_avatar_stats' full blend arrives with Phase 3 data.
 */
export default function HomeScreen() {
  const { signOut } = useAuth();
  const profile = useProfile();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const ledger = useLedgerXp();

  const baseLevel = profile.data?.base_level ?? 1;
  const summary = workoutSummary(
    workouts.data ?? [],
    cardio.data ?? [],
    ledger.data ?? null,
    baseLevel
  );

  // Approximate stat mix from the profile until Phase 3 ports the full blend.
  const bench = profile.data?.bench_e1rm ?? 0;
  const bw = profile.data?.bodyweight_kg || 77;
  const strengthScore = Math.min(100, Math.round(((bench / bw) / 1.5) * 100));
  const branch = determineAvatarBranch({
    strength_score: strengthScore,
    size_score: Math.min(100, strengthScore * 0.85),
    conditioning_score: summary.cardioMinutes > 0 ? 55 : 35,
    aesthetic_score: (profile.data?.physique_score ?? 5) * (100 / 15),
  });

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <AvatarCard branch={branch} level={summary.level} />

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
