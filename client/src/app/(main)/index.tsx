import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { useClaimCoin, useCoinTotal } from '@/data/coins';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useExercisePrefs, unitFor } from '@/data/exercise-prefs';
import { useUserExercises } from '@/data/exercises';
import { useBodyweightLog, useProfile, useServerGrantedXp, useWorkoutLog, useCardioLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { useWorkoutSessions } from '@/data/sessions';
import { useAvatarData } from '@/data/use-avatar-data';
import { useDisplayIdentity } from '@/data/use-display-identity';
import { BUILT_IN_DAYS, useDayPlan } from '@/data/use-day-plan';
import { raritySlug } from '@/domain/avatar-stats';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { nextEvolutionV2 } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { deriveMission } from '@/domain/home-mission';
import { libraryMuscleFor } from '@/domain/exercise-library';
import { userMuscleFor } from '@/domain/exercise-search';
import { muscleIdsFor, pillLabelsFor } from '@/domain/muscle-map';
import { daysForSource, defaultSource } from '@/domain/plan-sources';
import { weekStart, periodTotals } from '@/domain/progress-aggregates';
import { pyFloat } from '@/domain/py';
import { recentPr } from '@/domain/recent-pr';
import { computeScheduledStreak, nextScheduledSession, weeklyContract } from '@/domain/scheduled-streak';
import { computeStreak } from '@/domain/streak';
import { normaliseWorkoutLog } from '@/domain/summary';
import { todayIso as calendarToday } from '@/domain/today';
import { sourceDayFor } from '@/domain/week-status';
import { estimateMinutes, estimateNetKcal, lastSessionWork, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup } from '@/domain/workouts';
import { adhocOf, useSessionStore } from '@/state/session-store';
import tokens from '@/theme/tokens';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { EvoCore } from '@/ui/home/evo-core';
import { homeFeatures } from '@/ui/home/home-features';
import { HomeHeader } from '@/ui/home/home-header';
import { MissionCard } from '@/ui/home/mission-card';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { StatusGrid } from '@/ui/home/status-grid';
import { TrainingOverview } from '@/ui/home/training-overview';
import { WeeklyScheduleCard } from '@/ui/home/weekly-schedule-card';
import { DividerGlow, EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { StatBar } from '@/ui/character/stat-bar';
import { StatRadar } from '@/ui/character/stat-radar';

/**
 * HOME — the RPG character hub (HOME_REDESIGN_PLAN). Hierarchy: identity →
 * THE CHARACTER (hero, badges, actions) → today's mission → player status →
 * training overview → PR + next evolution → schedule door → the build →
 * leaderboard. Every value is real state; systems without backends are
 * hidden by home-features, never mocked.
 *
 * The mission card computes its ingredients EXACTLY the way the Train hub
 * does (same source resolution, same setsFor predicate, same estimates), so
 * Home and Train can never brief a different day.
 */
/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus, mirroring migration 014's leaderboard rule. */
function DriftWarning({ drift, source }: { drift: number; source: string }) {
  const serverGranted = useServerGrantedXp();
  if (drift === 0) return null;
  if (serverGranted.data !== null && serverGranted.data !== undefined && drift === serverGranted.data) return null;
  return (
    <Text className="text-2xs text-warn">
      ledger drift {drift} · source: {source}
    </Text>
  );
}

export default function HomeScreen() {
  const { summary, stats, bfMid, ready } = useAvatarData();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const [showRadar, setShowRadar] = useState(false);

  // IMPROVEMENT_PLAN #12: the retroactive starting bonus — every onboarded
  // athlete claims it once; the unique index makes reloads a no-op.
  const coins = useCoinTotal();
  const claimCoins = useClaimCoin();
  const bonusTriedRef = useRef(false);
  useEffect(() => {
    if (!ready || bonusTriedRef.current) return;
    bonusTriedRef.current = true;
    claimCoins.mutate({ kind: 'starting_bonus', sourceId: 'onboarding' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const todayIso = calendarToday();
  const schedule = useWorkoutSchedule();
  const sessions = useWorkoutSessions();
  const profile = useProfile();
  const bodyweights = useBodyweightLog();
  const userExercises = useUserExercises();
  const prefs = useExercisePrefs();
  const { sources, resolveDay, loading: plansLoading } = useDayPlan();
  const adhoc = useSessionStore(adhocOf);

  const scheduleRows = schedule.data ?? [];
  const hasSchedule = scheduleRows.length > 0;
  const streak = hasSchedule
    ? computeScheduledStreak(scheduleRows, workouts.data ?? [], todayIso)
    : computeStreak(workouts.data ?? [], todayIso);
  const contract = weeklyContract(scheduleRows, workouts.data ?? [], todayIso);
  const nextSession = nextScheduledSession(scheduleRows, todayIso);

  // ---- Today's mission — the Train hub's own resolution, replayed here. ----
  const source = defaultSource(sources);
  const planDays = daysForSource(source, sources, BUILT_IN_DAYS);
  const allRows = normaliseWorkoutLog(workouts.data ?? []);
  const scheduledToday = sourceDayFor(todayIso, scheduleRows, planDays, todayIso);
  const missionWorkout = scheduledToday ?? adhoc?.name ?? null;

  // The day's plan entries: the chosen source first (the resolveDayIn rule);
  // an ad-hoc day's plan is the ad-hoc's own picks.
  const entries: [string, number][] =
    missionWorkout === null
      ? []
      : scheduledToday !== null
        ? resolveDay(missionWorkout, source).entries.map(([e, s]) => [e, s] as [string, number])
        : (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets] as [string, number]);

  const dayRows = allRows.filter(
    (r) =>
      String(r.date) === todayIso &&
      String(r.workout) === missionWorkout &&
      (pyFloat(r.weight) ?? 0) > 0 &&
      (pyFloat(r.reps) ?? 0) > 0
  );
  const targetSets = entries.reduce((n, [, s]) => n + s, 0);
  const doneSets = entries.reduce((n, [exercise, s]) => {
    const logged = dayRows.filter((r) => String(r.exercise) === exercise).length;
    return n + Math.min(logged, s);
  }, 0);
  const finished =
    missionWorkout !== null &&
    (sessions.data ?? []).some((m) => m.date === todayIso && m.workout === missionWorkout);

  const mission = deriveMission({
    hasSchedule,
    assignedWorkout: scheduledToday,
    adhocWorkout: adhoc?.name ?? null,
    finished,
    doneSets,
    targetSets,
    loggedSets: dayRows.length,
  });

  // Estimates — the Train hero's own math (bodyweight fallback included).
  const positiveBw = (bodyweights.data ?? []).map((r) => pyFloat(r.bodyweight) ?? 0).filter((v) => v > 0);
  const bodyweightKg =
    (pyFloat(profile.data?.bodyweight_kg) ?? 0) > 0
      ? (pyFloat(profile.data?.bodyweight_kg) as number)
      : positiveBw.length > 0
        ? positiveBw[positiveBw.length - 1]
        : (profile.data?.sex === 'female' ? FEMALE_CALIBRATION : MALE_CALIBRATION).defaultBodyweight;
  const lastWork = missionWorkout ? lastSessionWork(allRows, missionWorkout, todayIso) : null;
  const kcalSets = targetSets > 0 ? targetSets : (lastWork?.sets ?? 0);
  const kcalRepsPerSet = lastWork && lastWork.sets > 0 ? lastWork.totalReps / lastWork.sets : null;
  const pills =
    entries.length > 0
      ? pillLabelsFor(
          muscleIdsFor(
            entries.map(
              ([exercise]) =>
                userMuscleFor(exercise, userExercises.data ?? []) ??
                libraryMuscleFor(exercise) ??
                inferMuscleGroup(exercise)
            )
          )
        )
      : [];
  const missionName = splitWorkoutName(missionWorkout ?? '');

  const missionLoading = schedule.isPending || sessions.isPending || workouts.isPending || plansLoading;
  const missionError = schedule.isError || sessions.isError || workouts.isError;
  const retryMission = () => {
    void schedule.refetch();
    void sessions.refetch();
    void workouts.refetch();
  };
  const openMission = () => {
    if (!mission.workout) return;
    router.push(
      `/workout?date=${encodeURIComponent(todayIso)}&workout=${encodeURIComponent(mission.workout)}&source=${source}` as never
    );
  };

  // ---- This week (Monday-start, the contract's window). ----
  const weekTotals = periodTotals(workouts.data ?? [], cardio.data ?? [], weekStart(todayIso), todayIso);

  // ---- Character identity — the DISPLAY identity (CUSTOMISE, 2026-07-16):
  // the derived truth with the equipped loadout applied, re-validated
  // against live gates on every read (a closed gate falls back silently).
  const identity = useDisplayIdentity();
  const displayBranch = identity.display.branch;
  const evolution = nextEvolutionV2(displayBranch, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });
  const readiness = evolutionReadiness(evolution.requirements);
  const stage = identity.display.stage;
  const slug = raritySlug(summary.level);
  const rarityColour = (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;
  const auraColour = identity.display.auraColour ?? rarityColour;
  const formName = identity.display.formName;

  const pr = recentPr(workouts.data);
  const prUnit = pr ? unitFor(prefs.data, pr.exercise) : ('kg' as const);
  const forge = useForgeProgression();
  const forgeProgress = forgeProgressFromRow(forge.data ?? null);

  return (
    <ScreenShell>
      {/* 1. Identity + the level module — FORGE LEVEL (Tyson, 2026-07-16:
          the game level starts from zero and holds ONLY earned XP; the old
          onboarding-seeded level is retired from display, avatar stages
          keep their own track so no character regresses). */}
      <HomeHeader level={forgeProgress.level} xpIntoLevel={forgeProgress.xpIntoLevel} xpNeeded={forgeProgress.xpForNextLevel} />

      {/* 2. THE CHARACTER — tier/form/evolution left, avatar actions right. */}
      <AvatarHero
        branch={identity.display.donor}
        stage={stage}
        auraColour={auraColour}
        source={identity.paintedSource}
        animatedSource={identity.animatedSource}
        stillSource={identity.stillSource}
        silhouette={!identity.hasArt}
        tierName={slug.toUpperCase()}
        tierColour={auraColour}
        formName={formName}
        evolutionPercent={readiness.percent}
        features={homeFeatures}
      />
      {/* 2.5 THE EVO CORE (spec §30) — renders only when the new
          progression is enabled; self-hides otherwise. */}
      <EvoCore />

      {/* 3. Today's mission — the one dominant CTA on the page. */}
      <MissionCard
        mission={mission}
        title={missionName.title}
        sub={missionName.sub}
        pills={pills}
        minutes={estimateMinutes(targetSets)}
        kcal={estimateNetKcal(kcalSets, kcalRepsPerSet, bodyweightKg)}
        next={nextSession}
        loading={missionLoading}
        error={missionError && !missionLoading}
        onRetry={retryMission}
        onOpen={openMission}
        features={homeFeatures}
      />

      {/* 4. Player status — streak, coins, XP, tier. */}
      <StatusGrid
        streakCurrent={streak.current}
        streakBest={streak.best}
        streakLabel={hasSchedule ? 'FORGE STREAK' : 'DAY STREAK'}
        coins={coins.data}
        totalXp={summary.xp}
        tierName={slug.toUpperCase()}
        tierColour={auraColour}
        features={homeFeatures}
      />
      <DriftWarning drift={summary.xpDrift} source={summary.xpSource} />

      {/* 5. This week. */}
      <TrainingOverview
        contract={contract}
        weekSets={weekTotals.sets}
        weekCardioMinutes={weekTotals.cardioMinutes}
        weekXp={weekTotals.xp}
        hasSchedule={hasSchedule}
      />

      {/* 6. Recent PR + next evolution. Always stacked: EvolutionTeaser's
          silhouette + readiness columns need the full width — at half width
          "Advanced Form" wraps mid-word, exactly the fragment the brief bans. */}
      <RecentPrCard pr={pr} unit={prUnit} />
      <EvolutionTeaser branch={stats.branch} evolution={evolution} />

      {/* 7. The schedule door. */}
      <WeeklyScheduleCard />

      <DividerGlow />

      {/* 8. Character build — RPG stat rows; radar on demand. */}
      <View>
        <EdgeLabel
          right={
            <Pressable onPress={() => setShowRadar((v) => !v)} accessibilityRole="button" accessibilityLabel="Toggle radar view">
              <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
                {showRadar ? 'BARS' : 'RADAR'}
              </Text>
            </Pressable>
          }
        >
          {`${stats.characterClass.toUpperCase()} · ${stats.buildType.toUpperCase()}`}
        </EdgeLabel>
        <View className="mt-s3">
          {showRadar ? (
            <StatRadar
              stats={[
                { label: 'STR', value: stats.strengthScore },
                { label: 'SIZE', value: stats.sizeScore },
                { label: 'LEAN', value: stats.leannessScore },
                { label: 'COND', value: stats.conditioningScore },
                { label: 'AES', value: stats.aestheticScore },
              ]}
            />
          ) : (
            <>
              <StatBar abbr="STR" name="Strength" value={stats.strengthScore} colour={tokens.colors.accent} />
              <StatBar abbr="SIZE" name="Mass" value={stats.sizeScore} colour={tokens.colors.epic} />
              <StatBar abbr="LEAN" name="Leanness" value={stats.leannessScore} colour={tokens.colors.success} />
              <StatBar abbr="COND" name="Engine" value={stats.conditioningScore} colour={tokens.colors.rare} />
              <StatBar abbr="AES" name="Aesthetic" value={stats.aestheticScore} colour={tokens.colors.mythic} />
            </>
          )}
        </View>
        <Text className="text-2xs text-text-mute">
          Weak point focus: <Text className="text-text-dim">{stats.weakPointFocus}</Text>
        </Text>
      </View>

      {/* P2 C5: collapsed-by-default leaderboard teaser, cyan-framed. */}
      <LeaderboardTeaser />
    </ScreenShell>
  );
}
