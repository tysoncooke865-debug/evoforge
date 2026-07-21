import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { useClaimCoin } from '@/data/coins';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useExercisePrefs, unitFor } from '@/data/exercise-prefs';
import { useUserExercises } from '@/data/exercises';
import { useBodyweightLog, useProfile, useServerGrantedXp, useWorkoutIndex, useWorkoutLog, useCardioLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { useWorkoutSessions } from '@/data/sessions';
import { useAvatarData } from '@/data/use-avatar-data';
import { useDisplayIdentity } from '@/data/use-display-identity';
import { BUILT_IN_DAYS, useDayPlan } from '@/data/use-day-plan';
import { raritySlug } from '@/domain/avatar-stats';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { currentBodyweightKg } from '@/domain/bodyweight-current';
import { nextEvolutionV2 } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { deriveMission } from '@/domain/home-mission';
import { libraryMuscleFor } from '@/domain/exercise-library';
import { userMuscleFor } from '@/domain/exercise-search';
import { muscleIdsFor, pillLabelsFor } from '@/domain/muscle-map';
import { daysForSource } from '@/domain/plan-sources';
import { weekStart, periodTotals } from '@/domain/progress-aggregates';
import { recentPr } from '@/domain/recent-pr';
import { computeScheduledStreak, nextScheduledSession, weeklyContract } from '@/domain/scheduled-streak';
import { computeStreak } from '@/domain/streak';
import { todayIso as calendarToday } from '@/domain/today';
import { sourceDayFor } from '@/domain/week-status';
import { estimateMinutes, estimateNetKcal, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup } from '@/domain/workouts';
import { dwKey, lastSessionForWorkout } from '@/domain/workout-index';
import { adhocOf, useSessionStore } from '@/state/session-store';
import { useThemeColors } from '@/theme/use-theme';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { ORIGIN_FLAGS, useClassification, useOriginStatus } from '@/data/origin';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { EvoCore } from '@/ui/home/evo-core';
import { homeFeatures } from '@/ui/home/home-features';
import { HomeHeader } from '@/ui/home/home-header';
import { MissionCard } from '@/ui/home/mission-card';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { TrainingOverview } from '@/ui/home/training-overview';
import { WeeklyScheduleCard } from '@/ui/home/weekly-schedule-card';
import { DividerGlow, EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { EvoRadar } from '@/ui/home/evo-radar';

/**
 * HOME — the RPG character hub (HOME_REDESIGN_PLAN; slimmed 2026-07-22).
 * Hierarchy: identity → THE CHARACTER (hero, badges incl. the streak,
 * actions) → evo core → today's mission → training overview → PR + next
 * evolution → the build → leaderboard. The status grid and schedule door
 * are gone (their surviving values live on the hero and Train). Every value
 * is real state; systems without backends are hidden by home-features,
 * never mocked.
 *
 * The mission card computes its ingredients EXACTLY the way the Train hub
 * does (same source resolution, same setsFor predicate, same estimates), so
 * Home and Train can never brief a different day.
 */
/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus. SUBTRACT the explained part (migration 014's rule, exactly as
 *  rank.tsx applies it): the old equality check meant ANY residue made the
 *  whole battle amount read as drift ("ledger drift 840" for 750 of honest
 *  battle XP plus 90 of residue). While the breakdown is still loading,
 *  say nothing — a warning that flashes and retracts teaches athletes to
 *  ignore it. */
function DriftWarning({ drift, source }: { drift: number; source: string }) {
  const serverGranted = useServerGrantedXp();
  if (drift === 0) return null;
  if (serverGranted.isPending) return null;
  const unexplained =
    serverGranted.data === null || serverGranted.data === undefined
      ? drift // breakdown unavailable: fall back to the strict rule
      : drift - serverGranted.data;
  if (unexplained === 0) return null;
  return (
    <Text className="text-2xs text-warn">
      ledger drift {unexplained} · source: {source}
    </Text>
  );
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const { summary, stats, bfMid, ready } = useAvatarData();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();

  // IMPROVEMENT_PLAN #12: the retroactive starting bonus — every onboarded
  // athlete claims it once; the unique index makes reloads a no-op.
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
  const { sources, resolveDay, preferredSource, loading: plansLoading } = useDayPlan();
  const adhoc = useSessionStore(adhocOf);

  const scheduleRows = schedule.data ?? [];
  const hasSchedule = scheduleRows.length > 0;
  const streak = hasSchedule
    ? computeScheduledStreak(scheduleRows, workouts.data ?? [], todayIso)
    : computeStreak(workouts.data ?? [], todayIso);
  const contract = weeklyContract(scheduleRows, workouts.data ?? [], todayIso);
  const nextSession = nextScheduledSession(scheduleRows, todayIso);

  // ---- Today's mission — the Train hub's own resolution, replayed here. ----
  const source = preferredSource;
  const planDays = daysForSource(source, sources, BUILT_IN_DAYS);
  // B3 (2026-07-19): the shared index — Home used to re-normalise the same
  // 2500 rows ~5× per render across mission/PR/totals/streak derivations.
  const workoutIndex = useWorkoutIndex();
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

  // 061 + B3: the same counted lookup Train's setsFor uses — the two
  // screens share ONE index and can never disagree about today's progress.
  const dayRows =
    missionWorkout === null
      ? []
      : (workoutIndex.data?.countedByDateWorkout.get(dwKey(todayIso, missionWorkout)) ?? []);
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

  // A6: ONE bodyweight chain app-wide (latest log → profile → caller's
  // default). This screen previously checked the ONBOARDING snapshot
  // before fresher logged readings.
  const bodyweightKg =
    currentBodyweightKg(bodyweights.data, profile.data?.bodyweight_kg) ??
    (profile.data?.sex === 'female' ? FEMALE_CALIBRATION : MALE_CALIBRATION).defaultBodyweight;
  const lastWork = missionWorkout ? lastSessionForWorkout(workoutIndex.data, missionWorkout, todayIso) : null;
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
  // ORIGIN (Tyson 2026-07-18): until an Origin is selected the podium is
  // BLANK — no avatar, no rating — just the gold FORGE YOUR ORIGIN button.
  const originStatus = useOriginStatus();
  const originUnset = originStatus.data != null && originStatus.data.origin_path == null;
  // The raw ±5 rule can hold a CHOICE open from the last scan — the gold
  // button then leads to the Forge reveal, not another scan.
  const originClassification = useClassification(ORIGIN_FLAGS.originRevealEnabled && originUnset);
  const originChoiceReady = originClassification.data?.ok === true;
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
  const rarityColour = (colors as Record<string, string>)[slug] ?? colors.common;
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
      <HomeHeader
        level={forgeProgress.level}
        xpIntoLevel={forgeProgress.xpIntoLevel}
        xpNeeded={forgeProgress.xpForNextLevel}
      />

      {/* 2. THE CHARACTER — tier/form/evolution left, avatar actions right. */}
      <AvatarHero
        originUnset={originUnset}
        originChoiceReady={originChoiceReady}
        branch={identity.display.donor}
        stage={stage}
        auraColour={auraColour}
        source={identity.paintedSource}
        animatedSource={identity.animatedSource}
        stillSource={identity.stillSource}
        silhouette={!identity.hasArt}
        tierName={slug.toUpperCase()}
        formName={formName}
        evolutionPercent={readiness.percent}
        streakCurrent={streak.current}
        streakLabel={hasSchedule ? 'FORGE STREAK' : 'DAY STREAK'}
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

      <DriftWarning drift={summary.xpDrift} source={summary.xpSource} />

      {/* 4. This week. */}
      <TrainingOverview
        contract={contract}
        weekSets={weekTotals.sets}
        weekCardioMinutes={weekTotals.cardioMinutes}
        weekXp={weekTotals.xp}
        hasSchedule={hasSchedule}
      />

      {/* 5. Recent PR + next evolution. Always stacked: EvolutionTeaser's
          silhouette + readiness columns need the full width — at half width
          "Advanced Form" wraps mid-word, exactly the fragment the brief bans. */}
      <RecentPrCard pr={pr} unit={prUnit} />
      <EvolutionTeaser branch={stats.branch} evolution={evolution} />

      {/* 7. The schedule door. */}
      <WeeklyScheduleCard />

      <DividerGlow />

      {/* 6. Character build — the radar. Sourced from the Evo Rating's four
          pillars so the wheel LINES UP with the EVO CORE card (Tyson
          2026-07-19), with a dashed projection of where they head after a
          block of consistent training. Falls back to the legacy live stats
          before the first Evo review. */}
      <View>
        <EdgeLabel>{`${stats.characterClass.toUpperCase()} · ${stats.buildType.toUpperCase()}`}</EdgeLabel>
        <View className="mt-s3">
          <EvoRadar
            fallbackStats={[
              { label: 'STR', value: stats.strengthScore },
              { label: 'SIZE', value: stats.sizeScore },
              { label: 'LEAN', value: stats.leannessScore },
              { label: 'COND', value: stats.conditioningScore },
              { label: 'AES', value: stats.aestheticScore },
            ]}
          />
        </View>
      </View>

      {/* P2 C5: collapsed-by-default leaderboard teaser, cyan-framed. */}
      <LeaderboardTeaser />
    </ScreenShell>
  );
}
