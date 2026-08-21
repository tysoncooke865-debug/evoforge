import { useEffect, useRef } from 'react';

import { router } from 'expo-router';

import {
  useLabActivationStep,
  useLabClaimCoin,
} from '@/lab/mock/mutations';
import { useLabDataMode } from '@/lab/lab-data-provider';
import { labWorkoutHref } from '@/lab/links';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useExercisePrefs, unitFor } from '@/data/exercise-prefs';
import { useUserExercises } from '@/data/exercises';
import { useBodyweightLog, useProfile, useWorkoutIndex, useWorkoutLog, useCardioLog } from '@/data/hooks';
import { useWorkoutSchedule } from '@/data/schedule';
import { useWorkoutSessions } from '@/data/sessions';
import { useAvatarData } from '@/data/use-avatar-data';
import { useDisplayIdentity } from '@/data/use-display-identity';
import { BUILT_IN_DAYS, useDayPlan } from '@/data/use-day-plan';
import { raritySlug } from '@/domain/avatar-stats';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { currentBodyweightKg } from '@/domain/bodyweight-current';
import { nextEvolutionV2 } from '@/domain/branches-v2';
import { deriveMission } from '@/domain/home-mission';
import { libraryMuscleFor, userMuscleFor } from '@/domain/muscle-lookup';
import { muscleIdsFor, pillLabelsFor } from '@/domain/muscle-map';
import { daysForSource } from '@/domain/plan-sources';
import { estimateEvoPerSession } from '@/domain/progression/evo-per-session';
import { weekStart, periodTotals } from '@/domain/progress-aggregates';
import { recentPr } from '@/domain/recent-pr';
import { computeScheduledStreak, nextScheduledSession, weeklyContract } from '@/domain/scheduled-streak';
import { completedSessions } from '@/domain/session-stats';
import { computeStreak } from '@/domain/streak';
import { resolveTodaySession, startedWorkoutToday } from '@/domain/today-session';
import { todayIso as calendarToday } from '@/domain/today';
import { resolvePlannedDay } from '@/domain/session-status';
import { estimateMinutes, estimateNetKcal, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup } from '@/domain/workouts';
import { XP_PER_SET } from '@/domain/xp';
import { dwKey, lastSessionForWorkout } from '@/domain/workout-index';
import { adhocOf, daySwapOf, useSessionStore } from '@/state/session-store';
import { useThemeColors } from '@/theme/use-theme';
import { ORIGIN_FLAGS, useClassification, useOriginStatus } from '@/data/origin';
import { useEvoRatingCurrent, useEvoSnapshots } from '@/data/progression/use-evo-rating';

/**
 * THE SHARED HOME MODEL — the derivation half of src/app/(main)/index.tsx
 * (everything above the JSX: mission resolution, identity, week totals,
 * the measured Evo rate, the two shimmed mount-time writes), forked ONCE
 * for the design variants.
 *
 * WHY SHARED WHEN THE FORK RECIPE SAYS COPY: the recipe's "copy beside the
 * variant" rule protects src/ui/ from lab edits — it says nothing about
 * sharing BETWEEN lab variants (workout/compact/model.ts is the precedent).
 * Five variants each carrying a private copy of ~200 lines of derivation
 * would drift APART, and the whole point of the design comparison is that
 * every take renders identical data. One copy makes that structural.
 *
 * The BASELINE does NOT use this hook — it stays the verbatim diff-anchor
 * against live Home. Like the baseline, this file rots-with-live by design:
 * when index.tsx's derivation changes, re-sync both. (Re-synced 2026-08-21:
 * resolvePlannedDay resolution, session-evidence streak/contract/totals,
 * the starter-mission inputs, trainAnyway, the week card's merged line.)
 *
 * mission.open() routes to the BASELINE lab workout: the comparison under
 * way is Home, and every variant opening the same workout door keeps the
 * ONE-door contract intact mid-tour.
 */
export function useHomeModel() {
  const colors = useThemeColors();
  const labMode = useLabDataMode();
  const { summary, stats, bfMid, ready } = useAvatarData();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();

  useLabActivationStep('home_reached');

  const claimCoins = useLabClaimCoin();
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
  const daySwap = useSessionStore(daySwapOf);

  const scheduleRows = schedule.data ?? [];
  const hasSchedule = scheduleRows.length > 0;
  // THE CANONICAL COUNT (domain/session-stats.ts): cardio rows and finish
  // markers travel with the sets, matching live Home exactly.
  const sessionEvidence = { cardioRows: cardio.data ?? [], finishes: sessions.data ?? [] };
  const streak = hasSchedule
    ? computeScheduledStreak(scheduleRows, workouts.data ?? [], todayIso, 180, sessionEvidence)
    : computeStreak(workouts.data ?? [], todayIso, sessionEvidence);
  const contract = weeklyContract(scheduleRows, workouts.data ?? [], todayIso, sessionEvidence);
  const allSessions = completedSessions({ workoutRows: workouts.data ?? [], ...sessionEvidence });
  const lastSession = allSessions.sessions[allSessions.sessions.length - 1] ?? null;
  /** The last session as ONE line — the merged week card renders it. */
  const lastSessionLine =
    lastSession === null
      ? null
      : {
          name: splitWorkoutName(lastSession.name).title,
          when: lastSession.date === todayIso ? 'today' : lastSession.date.slice(5),
          detail:
            lastSession.kind === 'cardio'
              ? `${Math.trunc(lastSession.minutes)} min`
              : `${lastSession.sets} sets · +${lastSession.sets * XP_PER_SET} XP`,
        };
  const nextSession = nextScheduledSession(scheduleRows, todayIso);

  // ---- Today's mission — the Train hub's own resolution, replayed here
  // (resolvePlannedDay: the day swap and per-day source map included). ----
  const source = preferredSource;
  const planDays = daysForSource(source, sources, BUILT_IN_DAYS);
  const workoutIndex = useWorkoutIndex();
  const latestScheduleRow = scheduleRows.length > 0 ? scheduleRows[scheduleRows.length - 1] : null;
  const explicitSourceToday = (() => {
    const map = (latestScheduleRow as { sources?: Record<string, number> } | null)?.sources;
    if (!map) return false;
    const dow = String(new Date(`${todayIso}T00:00:00Z`).getUTCDay());
    const v = map[dow];
    return v === 0 || v === 1 || v === 2;
  })();
  const scheduledToday = resolvePlannedDay({
    date: todayIso,
    todayIso,
    scheduleRows,
    planDays,
    daySwap,
    hasExplicitSource: explicitSourceToday,
  });
  const startedToday = startedWorkoutToday(workouts.data ?? [], todayIso);
  const hasEverTrained = (workoutIndex.data?.byDate.size ?? 0) > 0;
  const starterWorkout = planDays.find((d) => d.trim() !== '') ?? null;
  const missionWorkout = scheduledToday ?? adhoc?.name ?? startedToday ?? (hasEverTrained ? null : starterWorkout);

  const fromPlan = missionWorkout !== null && planDays.includes(missionWorkout);
  const entries: [string, number][] =
    missionWorkout === null
      ? []
      : fromPlan
        ? resolveDay(missionWorkout, source).entries.map(([e, s]) => [e, s] as [string, number])
        : (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets] as [string, number]);

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
    adhocWorkout: adhoc?.name ?? startedToday,
    finished,
    doneSets,
    targetSets,
    loggedSets: dayRows.length,
    starterWorkout,
    hasEverTrained,
    firstWorkoutStarted: profile.data?.first_workout_at != null,
  });

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
  const openWorkout = (name: string) => {
    router.push(
      labWorkoutHref('baseline', { date: todayIso, workout: name, source }, labMode) as never
    );
  };
  const openMission = () => {
    if (!mission.workout) return;
    openWorkout(mission.workout);
  };
  /** TRAIN ANYWAY from a rest day — same resolution as live Home, but the
   *  door it opens stays inside the lab. */
  const trainAnyway = () => {
    const session = resolveTodaySession({
      scheduledToday,
      startedToday,
      planDays,
      hasEverTrained: false, // this button IS the athlete overriding the rest day
    });
    if (session.workout) openWorkout(session.workout);
  };

  // ---- This week (Monday-start, the contract's window). ----
  const weekTotals = periodTotals(
    workouts.data ?? [],
    cardio.data ?? [],
    weekStart(todayIso),
    todayIso,
    sessions.data ?? []
  );

  // ---- Character identity (the display identity, gates re-validated). ----
  const identity = useDisplayIdentity();
  const originStatus = useOriginStatus();
  const originUnset = originStatus.data != null && originStatus.data.origin_path == null;
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
  const stage = identity.display.stage;
  const slug = raritySlug(summary.level);
  const rarityColour = (colors as Record<string, string>)[slug] ?? colors.common;
  const auraColour = identity.display.auraColour ?? rarityColour;
  const formName = identity.display.formName;

  // ---- "+0.4 EVO" — the athlete's OWN measured rate, never a forecast. ----
  const evoCurrent = useEvoRatingCurrent();
  const evoSnapshots = useEvoSnapshots(26);
  const evoRow = (evoCurrent.data ?? null) as Record<string, unknown> | null;
  const evoPerSession =
    evoRow === null
      ? null
      : (estimateEvoPerSession({
          currentRating: Number(evoRow.displayed_rating ?? 0),
          snapshots: (evoSnapshots.data ?? []).map((r) => ({
            displayedRating: Number((r as Record<string, unknown>).displayed_rating ?? 0),
            atIso: String((r as Record<string, unknown>).calculated_at ?? ''),
          })),
          trainingDates: [...(workoutIndex.data?.byDate.keys() ?? [])],
          todayIso,
        })?.perSession ?? null);

  const pr = recentPr(workouts.data);
  const prUnit = pr ? unitFor(prefs.data, pr.exercise) : ('kg' as const);
  const forge = useForgeProgression();
  const forgeProgress = forgeProgressFromRow(forge.data ?? null);

  /** Never logged a set. Live Home no longer reorders for these athletes
   *  (mission leads for everyone since 2026-08-06), but variants may still
   *  read it to soften identity surfaces that have nothing to show. */
  const neverTrained = !workoutIndex.isPending && (workoutIndex.data?.byDate.size ?? 0) === 0;

  return {
    forgeProgress,
    neverTrained,
    mission: {
      mission,
      title: missionName.title,
      sub: missionName.sub,
      pills,
      minutes: estimateMinutes(targetSets),
      kcal: estimateNetKcal(kcalSets, kcalRepsPerSet, bodyweightKg),
      next: nextSession,
      loading: missionLoading,
      error: missionError && !missionLoading,
      retry: retryMission,
      open: openMission,
      trainAnyway,
      evoPerSession,
    },
    identity: {
      originUnset,
      originChoiceReady,
      donor: identity.display.donor,
      stage,
      auraColour,
      tierName: slug.toUpperCase(),
      formName,
      paintedSource: identity.paintedSource,
      animatedSource: identity.animatedSource,
      stillSource: identity.stillSource,
      hasArt: identity.hasArt,
    },
    week: {
      pips: contract.pips,
      todayIso,
      streak: streak.current,
      streakLabel: hasSchedule ? ('FORGE STREAK' as const) : ('DAY STREAK' as const),
      contract,
      hasSchedule,
      totals: weekTotals,
      /** The merged week card's extra rows (live WeekStrip's totals prop). */
      weekCard: {
        sessionsDone: contract.done,
        sessionsTarget: contract.target,
        hasSchedule,
        sets: weekTotals.sets,
        cardioMinutes: weekTotals.cardioMinutes,
        xp: weekTotals.xp,
      },
      lastSessionLine,
    },
    belowFold: {
      pr,
      prUnit,
      evolution,
      stats,
      summary,
    },
  };
}

export type HomeModel = ReturnType<typeof useHomeModel>;
