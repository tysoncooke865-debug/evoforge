import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { useActivationStep } from '@/data/activation';
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
import { deriveMission } from '@/domain/home-mission';
import { libraryMuscleFor, userMuscleFor } from '@/domain/muscle-lookup';
import { muscleIdsFor, pillLabelsFor } from '@/domain/muscle-map';
import { daysForSource } from '@/domain/plan-sources';
import { estimateEvoPerSession } from '@/domain/progression/evo-per-session';
import { weekStart, periodTotals } from '@/domain/progress-aggregates';
import { recentPr } from '@/domain/recent-pr';
import { computeScheduledStreak, nextScheduledSession, weeklyContract } from '@/domain/scheduled-streak';
import { computeStreak } from '@/domain/streak';
import { resolveTodaySession, startedWorkoutToday } from '@/domain/today-session';
import { todayIso as calendarToday } from '@/domain/today';
import { sourceDayFor } from '@/domain/week-status';
import { estimateMinutes, estimateNetKcal, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup } from '@/domain/workouts';
import { dwKey, lastSessionForWorkout } from '@/domain/workout-index';
import { adhocOf, useSessionStore } from '@/state/session-store';
import { useThemeColors } from '@/theme/use-theme';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { ORIGIN_FLAGS, useClassification, useOriginStatus } from '@/data/origin';
import { useEvoRatingCurrent, useEvoSnapshots } from '@/data/progression/use-evo-rating';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { BelowFold } from '@/ui/home/below-fold';
import { EvoHero } from '@/ui/home/evo-hero';
import { ForgeHint } from '@/ui/home/forge-hint';
import { HomeAmbience } from '@/ui/home/home-ambience';
import { WeekStrip } from '@/ui/home/week-strip';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { homeFeatures } from '@/ui/home/home-features';
import { HomeHeader } from '@/ui/home/home-header';
import { MissionCard } from '@/ui/home/mission-card';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { TrainingOverview } from '@/ui/home/training-overview';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

/**
 * HOME — the RPG character hub (HOME_REDESIGN_PLAN; slimmed 2026-07-22;
 * re-stacked 2026-08-02; REDESIGNED 2026-08-03; PREMIUM PASS 2026-08-03).
 *
 * The page answers three questions in two seconds, and it now does it in
 * THREE sections instead of five:
 *   WHO AM I / WHY CARE   the Evo Rating crest — the number, what it means
 *                         ("OVERALL FITNESS SCORE"), the rank it is about to
 *                         become — and the champion standing under it
 *   WHAT NEXT             TODAY'S MISSION, the one dominant CTA
 * and then THIS WEEK, the promise the athlete made to themselves. Everything
 * that reads rather than acts — the evolution path, the weekly numbers, the
 * PR, the next form, the radar, the leaderboard — lives below the fold in
 * BelowFold, mounted after the first paint. Nothing was deleted.
 *
 * WHAT THE PREMIUM PASS MERGED, AND WHY IT IS NOT SIMPLY "LESS":
 *   - NEXT RANK stopped being its own card and became the crest's bottom rail
 *     (next-rank-card.tsx). Two purple modules about ONE number meant neither
 *     could be the page's answer to "who am I".
 *   - THE FORGE HINT stopped being a line under the masthead and became the
 *     plaque on the champion's podium (forge-hint.tsx), which is where the tap
 *     it describes actually happens — and it took the CURRENT FORM chip with
 *     it, so the champion's left flank is now deliberately empty.
 *   - The masthead gave up its glow. Prestige is a contrast relationship: the
 *     rating cannot be the loudest thing on the page while a glowing wordmark
 *     sits above it.
 * Those three bought ~78pt of fold, which paid for a 15% bigger numeral, the
 * subtitle that stops the page assuming, and an 8% bigger champion — and the
 * CTA still clears the PHONE's fold (paddingTop 47 + an 88pt tab bar) with
 * more room than it had before.
 *
 * THE ORDER REVERSED ON 2026-08-03. Between 2026-08-02 and that commit the
 * mission led the page, because the old hero rig (a 192pt champion inside a
 * 450pt stage) could not fit above it. That constraint is gone rather than
 * ignored: home-scale.ts sizes the champion to the viewport and HeroStage
 * takes a `headroom` multiplier. If a future change pushes START MISSION off
 * the fold again, shrink the rig; do not re-order.
 *
 * Every value is real state; systems without backends are hidden by
 * home-features / progressionFeatures, never mocked. In particular there is
 * no per-workout Evo grant on the mission card and there cannot be one — see
 * domain/progression/session-evidence.ts for the arithmetic reason and for
 * what the card says instead.
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

  // ACTIVATION FUNNEL step 1 (docs/ACTIVATION_ANALYTICS.md). Fires on ARRIVAL,
  // which is the whole point: page_view records the PREVIOUS route on
  // navigation, so an athlete who lands here straight out of onboarding and
  // quits without navigating emits nothing at all today.
  useActivationStep('home_reached');

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
  // ALREADY UNDER WAY? Server truth from the log, not the session store —
  // it survives a refresh, a second device and a cleared cache, which is
  // what "return to the app after partially logging" actually needs.
  const startedToday = startedWorkoutToday(workouts.data ?? [], todayIso);
  // Never completed a workout: a rest day cannot apply yet, so day one of
  // their own plan stays reachable (domain/today-session.ts).
  const hasEverTrained = (workoutIndex.data?.byDate.size ?? 0) > 0;
  const starterWorkout = planDays.find((d) => d.trim() !== '') ?? null;
  const missionWorkout = scheduledToday ?? adhoc?.name ?? startedToday ?? (hasEverTrained ? null : starterWorkout);

  // The day's plan entries: a named plan day resolves from the plan (whether
  // the schedule assigned it today or it is the starter being offered); an
  // ad-hoc day's plan is the ad-hoc's own picks.
  const fromPlan = missionWorkout !== null && planDays.includes(missionWorkout);
  const entries: [string, number][] =
    missionWorkout === null
      ? []
      : fromPlan
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
    adhocWorkout: adhoc?.name ?? startedToday,
    finished,
    doneSets,
    targetSets,
    loggedSets: dayRows.length,
    starterWorkout,
    hasEverTrained,
    firstWorkoutStarted: profile.data?.first_workout_at != null,
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
  const openWorkout = (name: string) => {
    router.push(
      `/workout?date=${encodeURIComponent(todayIso)}&workout=${encodeURIComponent(name)}&source=${source}` as never
    );
  };
  const openMission = () => {
    if (!mission.workout) return;
    openWorkout(mission.workout);
  };
  /**
   * TRAIN ANYWAY, from a genuine rest day. Resolves the same way every other
   * entry point does (domain/today-session.ts) and always ends at a real
   * session for TODAY — resume what is already started, else the scheduled
   * day, else day one of their own plan. It never merely changes tabs, which
   * is what it used to do.
   */
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
  const stage = identity.display.stage;
  const slug = raritySlug(summary.level);
  const rarityColour = (colors as Record<string, string>)[slug] ?? colors.common;
  const auraColour = identity.display.auraColour ?? rarityColour;
  const formName = identity.display.formName;

  // ---- "+0.4 EVO" — the athlete's OWN measured rate, never a forecast.
  // Rating gain across a window divided by the training days that produced it
  // (domain/progression/evo-per-session.ts). Returns null — and the mission
  // card shows no Evo number at all — until there is enough history for the
  // average to mean something. Both reads are already warm on this screen.
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

  /** Never logged a set. The page leads with the mission for these athletes. */
  const neverTrained = !workoutIndex.isPending && (workoutIndex.data?.byDate.size ?? 0) === 0;

  const missionCard = (
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
      onTrainAnyway={trainAnyway}
      features={homeFeatures}
      evoPerSession={evoPerSession}
    />
  );

  return (
    <ScreenShell backdrop={<HomeAmbience />}>
      {/* 1. Identity + the level module — FORGE LEVEL (Tyson, 2026-07-16:
          the game level starts from zero and holds ONLY earned XP; the old
          onboarding-seeded level is retired from display, avatar stages
          keep their own track so no character regresses). */}
      <HomeHeader
        level={forgeProgress.level}
        xpIntoLevel={forgeProgress.xpIntoLevel}
        xpNeeded={forgeProgress.xpForNextLevel}
      />

      {/* ONBOARDING V3 (spec §8). For an athlete who has NEVER TRAINED the
          page's job is different: there is no identity to lead with yet — the
          rating is calibrating and the champion has one workout of history.
          So the mission leads, and identity follows.

          This does NOT reverse the 2026-08-03 order for everybody. The moment
          a first workout is logged, the established identity-first page
          returns and stays. The exception is scoped to exactly the athletes
          the funnel says we lose: 16 bound an Origin, 11 ever logged a set. */}
      {neverTrained ? missionCard : null}

      {/* 2. THE IDENTITY BLOCK — the Evo Rating and the champion are ONE
          thing on the page, so they are one slot in the shell's gap stack and
          set their own tighter internal rhythm. Separate slots spent 24pt of
          the fold on air between parts of the same sentence.
          The forge hint left this block on 2026-08-03: it is the plaque on the
          champion's podium now (ui/home/forge-hint.tsx), which costs no
          vertical budget and teaches the tap where the tap happens. */}
      <View className="w-full items-center">
        {/* THE FORGE HINT IS BACK ON TOP (Tyson, third brief): "it teaches
            interaction before the user sees the Champion." An athlete who has
            not learned that the champion is a button never scrolls far enough
            to find a hint sitting under it. The podium's plaque keeps the form
            NAME and dropped the instruction, so the two no longer repeat. */}
        {originUnset ? null : <ForgeHint />}
        {/* zIndex, for the same reason HomeHeader carries one: the champion's
            rig is taller than its own box and reaches up under whatever sits
            above it. AvatarStage's sprite is pointerEvents:none now, and this
            is the belt to that brace — the rating's doors must win. */}
        <View className="mt-s1 w-full items-center" style={{ zIndex: 1 }}>
          <EvoHero suppressEmptyState={originUnset} />
        </View>
        {/* 10pt, not 0: at HOME_ART_SCALE the champion's head reaches ABOVE
            the rig's own top edge (the sprite frame overflows into the sky it
            reclaimed), and without this it crowds the descriptor pill. */}
        <View className="w-full" style={{ marginTop: 6 }}>
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
            features={homeFeatures}
          />
        </View>
      </View>

      {/* 3. TODAY'S MISSION — the one dominant CTA on the page, and the
          reason the page exists. It moves ABOVE the identity block for an
          athlete who has never trained (see missionCard's note). */}
      {neverTrained ? null : missionCard}

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. When it
          IS due it sits directly under the mission, because it is the only
          other thing on the page with a deadline. */}
      <ReforgeDayCard testID="home-reforge-day" />

            {/* 4. THIS WEEK — seven days and a streak, nothing else. */}
      <WeekStrip
        pips={contract.pips}
        todayIso={todayIso}
        streak={streak.current}
        streakLabel={hasSchedule ? 'FORGE STREAK' : 'DAY STREAK'}
      />

      {/* 5. TERTIARY — the optional private baseline. Self-hides until a
          workout has been COMPLETED, hides for good once the athlete says
          don't ask again, and is deliberately styled as an offer rather than
          an outstanding task (spec §6, §8). */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- THE FOLD. Everything below still exists, still reads live
          state, and still opens the same doors — it just no longer competes
          for the first screen. Mounted after the first paint. ---- */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

        {/* This week, by the numbers (the pips live above now). */}
        <TrainingOverview
          contract={contract}
          weekSets={weekTotals.sets}
          weekCardioMinutes={weekTotals.cardioMinutes}
          weekXp={weekTotals.xp}
          hasSchedule={hasSchedule}
        />

        {/* Recent PR + next evolution. Always stacked: EvolutionTeaser's
            silhouette + readiness columns need the full width — at half width
            "Advanced Form" wraps mid-word, exactly the fragment the brief bans. */}
        <RecentPrCard pr={pr} unit={prUnit} />
        <EvolutionTeaser branch={stats.branch} evolution={evolution} />

        {/* Character build — the radar. Sourced from the Evo Rating's four
            pillars so the wheel LINES UP with the rating above (Tyson
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

        <DriftWarning drift={summary.xpDrift} source={summary.xpSource} />
      </BelowFold>
    </ScreenShell>
  );
}
