/**
 * PAGE LAB FORK of src/app/(main)/today.tsx — the diff-zero baseline.
 * Diverges from the live screen in exactly three ways (the fork recipe,
 * src/lab/README.md): named export, the workout door opens the LAB workout
 * variant instead of /workout, and the two writes that are not the
 * developer's own act — the activation step and REOPEN — go through the
 * mock-safe shims. Everything else is verbatim; diff against today.tsx to
 * review a variant (scripts/lab-sync.mjs --check pins it).
 */
import * as Haptics from 'expo-haptics';
import { Link, router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  Easing,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  useLabActivationStep as useActivationStep,
  useLabReopenWorkout as useReopenWorkout,
} from '@/lab/mock/mutations';
import { labWorkoutHref } from '@/lab/links';
import { useBodyweightLog, useCardioLog, useProfile, useWorkoutIndex, useWorkoutLog } from '@/data/hooks';
import { useUserExercises } from '@/data/exercises';
import { useExercisePrefs } from '@/data/exercise-prefs';
import { buildCorpus } from '@/data/exercise-corpus';

import { useDeleteRoutine, useRoutines, type Routine } from '@/data/routines';
import {
  useClaimPlanSession,
  usePlanSessionClaims,
  useReleasePlanSession,
} from '@/data/plan-claims';
import { canTrainEarly, EARLY_REFUSAL_MESSAGE, indexClaims } from '@/domain/plan-claims';
import { useSaveSchedule, useWorkoutSchedule } from '@/data/schedule';
import { useWorkoutSessions } from '@/data/sessions';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { BUILT_IN_DAYS, SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { useSavePlanSourcePref } from '@/data/plan-source-pref';
import { useUserPlans } from '@/data/user-plans';
import { useEvoRatingCurrent, useEvoSnapshots } from '@/data/progression/use-evo-rating';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { DEFAULT_CARDIO_TARGETS, dailyMission, todayMinutes } from '@/domain/cardio-stats';
import { currentBodyweightKg } from '@/domain/bodyweight-current';
import { difficultyFor, missionObjectiveFor } from '@/domain/mission-brief';
import { libraryMuscleFor, userMuscleFor } from '@/domain/muscle-lookup';
import {
  focusFor,
  muscleIdsFor,
  normaliseMuscleGroup,
  pillLabelsFor,
  type MuscleId,
  type MuscleView,
} from '@/domain/muscle-map';
import { daysForSource, type SourceIndex } from '@/domain/plan-sources';
import { estimateEvoPerSession } from '@/domain/progression/evo-per-session';
import { evoEvidenceFor, evoEvidenceLabel } from '@/domain/progression/session-evidence';
import { weekStart } from '@/domain/progress-aggregates';
import {
  adhocNameError,
  autoWorkoutName,
  dayProgress,
  EMPTY_OVERRIDES,
  type DayOverrides,
  type LoggedFacts,
  type PlanEntry,
  type SessionExercise,
} from '@/domain/session-plan';
import { pyInt } from '@/domain/py';
import { dwKey, lastSessionForWorkout } from '@/domain/workout-index';
import { addDaysIso, todayIso as calendarToday } from '@/domain/today';
import { buildWeekBars, extraBarsForToday, extraScheduledBars, scheduledDayFor, scheduledExtrasFor, sourceDayFor } from '@/domain/week-status';
import { estimateMinutes, estimateNetKcal, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup, isCountedSet } from '@/domain/workouts';
import { resolveTodaySession, startedWorkoutToday } from '@/domain/today-session';
import { useFirstWorkout, useMarkFirstWorkoutStarted } from '@/data/first-workout';
import { recommendStarter, targetMusclesFromText } from '@/domain/recommend-starter';
import type { EquipmentAccess, ExperienceLevel, OnboardingGoal } from '@/domain/onboarding-v3';
import { activityXp } from '@/domain/xp';
import { adhocOf, daySwapOf, useSessionStore } from '@/state/session-store';
import { pixelFont } from '@/theme/fonts';
import { useToastStore } from '@/state/toast-store';
import { useThemeColors } from '@/theme/use-theme';
import { CardioDashboard } from '@/ui/train/cardio/cardio-dashboard';
import { cardioAnim } from '@/ui/train/cardio/activities';
import { ChampionCharge } from '@/ui/train/champion-charge';
import { DailyWorkoutCarousel, type DailyCarouselHandle } from '@/ui/train/daily-workout-carousel';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';
import { ManagePlanSheet, type LoadoutSource } from '@/ui/train/manage-plan-sheet';
import { MissionBriefCard } from '@/ui/train/mission-brief';
import { MissionLaunch } from '@/ui/train/mission-launch';
import { CalloutLayer } from '@/ui/callouts/callout-layer';
import { MuscleBoard, type MuscleLoad } from '@/ui/train/muscle-board';
import { PlanRail } from '@/ui/train/plan-rail';
import { TRAIN_CLOCK_MS, TRAIN_INTRO_MS, useTrainScale } from '@/ui/train/train-scale';
import { bestViewFor } from '@/ui/muscle-map/muscle-map';
import { ScreenAmbience } from '@/ui/core/ambience';
import { useAmbient } from '@/ui/core/use-ambient';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { PixelDumbbell, PixelHeart } from '@/ui/core/pixel-icons';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { WeekBarRow } from '@/ui/train/week-bar';

/**
 * TRAIN — THE HUB, AS A MISSION BRIEFING (TRAIN_OVERHAUL; elevated 2026-08-03).
 *
 * One dominant question, answered before anything scrolls: WHAT AM I DOING
 * TODAY, AND HOW DO I START. The logging UI stays its own page (`/workout`) —
 * Train briefs, it never logs.
 *
 * ---- WHAT THE 2026-08-03 PASS CHANGED, AND WHAT IT DID NOT ----
 *
 * Not a redesign. Every value on this page is the same value, from the same
 * resolution, with the same doors: the source picker, the per-day source rule,
 * SWAP TODAY'S DAY, PLAN SCAN, quick workouts, routines, extras and the week
 * bars all behave exactly as they did. What changed is the ORDER and the
 * LANGUAGE, against the brief's hierarchy — mission ▸ muscle ▸ rewards ▸ CTA:
 *
 *   THE HERO became a BRIEFING (ui/train/mission-brief.tsx). It gained the two
 *   things it never said: WHY this session exists (the objective, derived from
 *   the muscles in domain/mission-brief.ts) and WHAT IT PAYS — Evo first, XP
 *   second, the same numbers from the same modules Home's card uses.
 *
 *   THE FIGURE became a READOUT (ui/train/muscle-hologram.tsx) and a DOOR to
 *   the MUSCLE LOAD BOARD (ui/train/muscle-board.tsx). The art is untouched.
 *   It is a door rather than a control because at 130pt an individual muscle
 *   is a ~4mm target: tapping the figure ANYWHERE opens the board, where the
 *   same figure is drawn at the full width of the sheet and every region is
 *   comfortably pressable. The PRIMARY MUSCLES chips open it too — they are a
 *   labelled list of exactly those regions, and three of them (front traps,
 *   the adductors, the abductors) have mask artwork but NO hit geometry, so
 *   the figure alone could never reach them at any size.
 *
 *   THREE GREY UTILITY CARDS became ONE PLAN RAIL (ui/train/plan-rail.tsx),
 *   with every door they held moved into MANAGE PLAN. Nothing was deleted; the
 *   page simply stopped offering six administrative choices beside its one
 *   action.
 *
 * ---- THE ENTRANCE, AND WHY IT IS ONE VALUE ----
 *
 * `intro` is the page's entrance clock and `clock` its ambient one. Every
 * staged animation on this screen — header, mission, hologram power-on, reward
 * chips, CTA glow, the scan sweep, the progress shimmer — is a WINDOW on one of
 * those two, because on web every Reanimated loop runs on the main JS thread
 * and the cost of motion is the number of DRIVERS, not the number of effects.
 */


const WEEKDAYS_LONG = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** '2026-07-15' → 'WEDNESDAY, JUL 15' — the header's date line. */
const headerDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
/** The carousel card's compact date: 'TODAY · JUL 15' / 'TUE · JUL 14'. */
const cardDate = (iso: string, todayIso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = iso === todayIso ? 'TODAY' : WEEKDAYS_SHORT[d.getUTCDay()];
  return `${day} · ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** EQUAL CARDS (Tyson, 2026-07-15): every carousel card — and the carousel
 *  itself — is exactly one height. Content NEVER sizes a card: the figure
 *  lives in a fixed box and the rewards block rides marginTop:auto. The height
 *  itself moved to ui/train/train-scale.ts on 2026-08-03, because the briefing
 *  needs more room on a Pro Max than an SE can spare. */

/** today ±N as ISO dates — cached per today so the array is referentially
 *  stable across renders (the FlatList must never see a fresh array). */
const CAROUSEL_REACH = 7;
let datesCache: { key: string; dates: string[] } | null = null;
const datesAround = (todayIso: string): string[] => {
  if (datesCache?.key !== todayIso) {
    const out: string[] = [];
    for (let i = -CAROUSEL_REACH; i <= CAROUSEL_REACH; i++) out.push(addDaysIso(todayIso, i));
    datesCache = { key: todayIso, dates: out };
  }
  return datesCache.dates;
};

export function TrainBaseline() {
  const colors = useThemeColors();
  const todayIso = calendarToday();
  const scale = useTrainScale();

  const workouts = useWorkoutLog();
  const exercisePrefs = useExercisePrefs();
  const schedule = useWorkoutSchedule();
  const sessions = useWorkoutSessions();
  const reopenWorkout = useReopenWorkout();
  const routines = useRoutines();
  const deleteRoutine = useDeleteRoutine();
  const profile = useProfile();
  const bodyweights = useBodyweightLog();
  const userExercises = useUserExercises();
  const { sources, resolveDay, preferredSource, loading: planLoading } = useDayPlan();
  const savePref = useSavePlanSourcePref();
  const saveSchedule = useSaveSchedule();
  // The header's LV. badge — FORGE LEVEL (earned XP only; Tyson 2026-07-16).
  const forge = useForgeProgression();
  const forgeProgress = forgeProgressFromRow(forge.data ?? null);

  const adhoc = useSessionStore(adhocOf);
  const startAdhoc = useSessionStore((s) => s.startAdhoc);
  const daySwap = useSessionStore(daySwapOf);
  const setDaySwap = useSessionStore((s) => s.setDaySwap);
  // Narrow selections (not the whole store): the hub re-renders on override
  // writes only because today's bars are judged against the EDITED plan.
  const sessionDate = useSessionStore((s) => s.date);
  const sessionDays = useSessionStore((s) => s.days);
  const overridesForDay = (workout: string): DayOverrides =>
    sessionDate === todayIso ? (sessionDays[workout] ?? EMPTY_OVERRIDES) : EMPTY_OVERRIDES;

  const [mode, setMode] = useState<0 | 1>(0);
  // CARDIO_MISSION_REDESIGN: nothing is silently pre-picked — the mission
  // card's first real state is CHOOSE ACTIVITY, not a default the athlete
  // never chose (see cardio-mission-card.tsx).
  const [cardioType, setCardioType] = useState<string | null>(null);
  // The cardio header companion reads the SAME real numbers the mission card
  // does (todayMinutes/dailyMission, domain/cardio-stats.ts) — one query,
  // shared by TanStack's cache with CardioDashboard's own useCardioLog().
  const cardioLog = useCardioLog();
  const cardioMission = dailyMission(
    todayMinutes(cardioLog.data ?? [], todayIso),
    DEFAULT_CARDIO_TARGETS.dailyMinutes
  );
  const [sourceChoice, setSource] = useState<SourceIndex | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  /** A day picked from "SWAP TODAY'S DAY", awaiting the just-today/save choice. */
  const [swapPick, setSwapPick] = useState<string | null>(null);
  /** THE MUSCLE BOARD. `open` is the sheet's visibility; `pick` is which
   *  muscle it starts on (null = show them all). Two fields rather than one
   *  nullable id because "opened from the figure" and "closed" are different
   *  states that a single `MuscleId | null` cannot tell apart. */
  const [boardOpen, setBoardOpen] = useState(false);
  const [musclePick, setMusclePick] = useState<MuscleId | null>(null);
  /** The workout START WORKOUT is launching into, for the ENTERING MISSION veil. */
  const [launching, setLaunching] = useState<string | null>(null);

  // ---- THE TWO CLOCKS (see the header note) ----
  //
  // `intro` replays the 660ms briefing entrance on every FOCUS, which is what
  // makes it an entrance rather than a mount effect: this is a tab screen and
  // it stays mounted, so a mount-driven animation would fire once per app
  // launch and never again. It is a ONE-SHOT, so per the animations doctrine it
  // is not perf-gated — but reduced motion pins it at 1, fully arrived.
  //
  // `clock` is the ambient one (scan sweep, hologram bloom, progress shimmer)
  // and IS gated, on the full ambient rule: focus + reduced motion + perf mode.
  const reduced = useReducedMotion();
  const ambient = useAmbient();
  const intro = useSharedValue(1);
  const clock = useSharedValue(0);
  useFocusEffect(
    useCallback(() => {
      // Clearing the veil on FOCUS, not on blur. Blur fires within a frame of
      // router.push on web, which killed the veil before it ever painted — and
      // the whole point of it is to cover the frames where the /workout route
      // is still arriving. It is inside this screen's view tree, so the pushed
      // page draws over it anyway; the only thing that must be true is that
      // coming BACK to Train finds it gone, and that is this line.
      setLaunching(null);
      if (!reduced) {
        intro.value = 0;
        intro.value = withTiming(1, { duration: TRAIN_INTRO_MS, easing: Easing.out(Easing.cubic) });
      } else {
        intro.value = 1;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reduced])
  );
  useEffect(() => {
    if (!ambient) {
      clock.value = 0;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(withTiming(1, { duration: TRAIN_CLOCK_MS, easing: Easing.linear }), -1);
  }, [ambient, clock]);

  // The SAVED choice (migration 035) is the resting state; sourceChoice is
  // only the in-flight override so the modal responds instantly.
  const source: SourceIndex = sourceChoice ?? preferredSource;
  const planDays = daysForSource(source, sources, BUILT_IN_DAYS);

  // PER-DAY SOURCE (2026-07-19, migration 066): the schedule can pin a source
  // to each weekday, so a week can mix MY PLAN legs, AI push, built-in pull.
  // A day WITHOUT an explicit source follows the global `source` — so any
  // schedule saved before this feature (sources = null) behaves exactly as it
  // did. Read from the LATEST row; past days keep the global source (history is
  // history, mirroring sourceDayFor).
  const latestSchedule =
    schedule.data && schedule.data.length > 0 ? schedule.data[schedule.data.length - 1] : null;
  const scheduleSources: Record<string, number> = latestSchedule?.sources ?? {};
  const explicitSourceForDate = (date: string): SourceIndex | null => {
    if (date < todayIso) return null;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const s = scheduleSources[String(dow)];
    return s === 0 || s === 1 || s === 2 ? s : null;
  };
  const sourceForDate = (date: string): SourceIndex => explicitSourceForDate(date) ?? source;

  // B1 (2026-07-19): ONE shared index per data change (TanStack select) —
  // the carousel cards and week bars used to re-filter the full 2500-row
  // log each, every render.
  const workoutIndex = useWorkoutIndex();
  /** Any logged training day ever — what makes a rest day a real rest day. */
  const hasEverTrained = (workoutIndex.data?.byDate.size ?? 0) > 0;
  const starterForToday = planDays.find((d) => d.trim() !== '') ?? null;
  const firstWorkout = useFirstWorkout(starterForToday);
  const markFirstWorkout = useMarkFirstWorkoutStarted();

  /** How much of a day is done: sets logged vs sets the plan asks for. The plan
   *  is read from the SAME source the door will open, so the hub and the page
   *  can never disagree about what the day contains. `trained` is the separate
   *  any-valid-set signal week-status derives history from — an athlete who
   *  swapped every exercise has done=0 against the plan but still trained. */
  const setsFor = (date: string, workout: string | null): { done: number; target: number; trained: boolean } => {
    if (!workout) return { done: 0, target: 0, trained: false };
    const key = dwKey(date, workout);
    const counted = workoutIndex.data?.countedByDateWorkout.get(key) ?? [];
    const isAdhocDay = date === todayIso && adhoc?.name === workout;
    const entries: readonly PlanEntry[] = isAdhocDay
      ? (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets, e.reps] as const)
      : resolveDay(workout, sourceForDate(date)).entries;
    // TODAY runs through the SAME pipeline as the workout page (substitutions,
    // ±sets, skips, add/remove) — or a swapped day reads PARTIAL here while the
    // page says complete. Past days keep the raw plan: overrides expire daily.
    if (date === todayIso) {
      const allRows = workoutIndex.data?.byDateWorkout.get(key) ?? [];
      const logged = (exercise: string): LoggedFacts => {
        let maxSetNo = 0;
        for (const r of allRows) {
          if (String(r.exercise) !== exercise) continue;
          maxSetNo = Math.max(maxSetNo, pyInt(r.set) ?? 0);
        }
        return {
          validCount: counted.filter((r) => String(r.exercise) === exercise).length,
          maxSetNo,
        };
      };
      const { done, target } = dayProgress(entries, overridesForDay(workout), logged);
      return { done, target, trained: counted.length > 0 };
    }
    const target = entries.reduce((n, [, sets]) => n + sets, 0);
    const done = entries.reduce((n, [exercise, sets]) => {
      const logged = counted.filter((r) => String(r.exercise) === exercise).length;
      return n + Math.min(logged, sets);
    }, 0);
    return { done, target, trained: counted.length > 0 };
  };

  /** The workout NAME a date carries, in the CHOSEN source: switching
   *  MY PLAN / AI PLAN / BUILT-IN renames today and the upcoming week onto
   *  that plan's days (past days are history and keep theirs). */
  const dayInSource = (date: string): string | null => {
    // DAY SWAP (2026-07-24): a "just for today" trade outranks the schedule
    // entirely — it is deliberately today-only and self-expires at midnight
    // (session-store), so tomorrow falls straight back through to whatever's
    // below without a trace.
    if (date === todayIso && daySwap) return daySwap;
    // A day with an EXPLICIT per-day source stores the name already correct for
    // that source (the editor picked it from that source's day list), so the
    // global positional remap must not touch it — return the stored name as-is.
    if (explicitSourceForDate(date) !== null) return scheduledDayFor(date, schedule.data ?? []);
    return sourceDayFor(date, schedule.data ?? [], planDays, todayIso);
  };

  /**
   * ── TRAIN EARLY (§2, migration 194) ──
   *
   * "Users should be able to train early, late, or differently without
   * breaking their plan." Wednesday's Legs, trained on Tuesday, logs to
   * TUESDAY — the same sets, the same XP, the same finish marker, the same
   * streak, through the same code that has always written them. The only
   * thing a claim changes is whether Wednesday still asks for Legs.
   *
   * That is the whole design, and it is why this could be added to a live app
   * without touching progression: nothing about COMPLETION moved. What moved
   * is the calendar's memory of what is still owed.
   *
   * Declared HERE, above the week bars, because they consume it.
   */
  const claims = usePlanSessionClaims();
  const claimIndex = indexClaims(claims.data);
  const claimPlanSession = useClaimPlanSession();
  const releasePlanSession = useReleasePlanSession();
  const claimFor = (date: string, workout: string) => claimIndex.for(date, workout);

  const weekBars = buildWeekBars(
    schedule.data ?? [],
    sessions.data ?? [],
    setsFor,
    todayIso,
    dayInSource,
    // A session trained early reads COMPLETED on its scheduled day rather
    // than UPCOMING — the week must not ask for a workout that is done.
    (d, w) => claimIndex.isClaimed(d, w)
  );
  const scheduledToday = dayInSource(todayIso);

  /**
   * ACTIVATION FUNNEL step 2 (docs/ACTIVATION_ANALYTICS.md) — the one event
   * that records what the athlete FOUND, not merely that they arrived. Five of
   * the eight who bound an origin never logged a set, and nothing in the
   * current rail can say whether they landed on a workout or on an empty rest
   * day. `ready` waits out the plan queries deliberately: firing early would
   * report the loading state instead of the screen they saw.
   */
  const activationDay = scheduledToday ? resolveDay(scheduledToday, preferredSource) : null;
  useActivationStep('train_opened', {
    ready: !planLoading && !schedule.isPending,
    extra: {
      has_plan: sources.has.myPlan || sources.has.aiPlan,
      day_kind: scheduledToday ? 'workout' : 'rest',
      exercise_count: activationDay?.entries.length ?? 0,
      plan_source: preferredSource,
      has_schedule: (schedule.data ?? []).length > 0,
    },
  });

  /** SWAP TODAY'S DAY — "save to my schedule": today's weekday's PRIMARY
   *  becomes `to` from now on, every extra riding along untouched (same shape
   *  schedule.tsx's own SAVE writes). No latest row yet means the athlete
   *  never set up a week — nothing sensible to edit in place, so this stays a
   *  no-op and the caller sends them to EDIT SCHEDULE instead. */
  const swapDayPermanently = (to: string) => {
    if (!latestSchedule) return;
    const dow = String(new Date(`${todayIso}T00:00:00Z`).getUTCDay());
    const cur = latestSchedule.plan[dow];
    const extras = Array.isArray(cur) ? cur.slice(1) : [];
    const nextPlan = { ...latestSchedule.plan, [dow]: extras.length > 0 ? [to, ...extras] : to };
    saveSchedule.mutate({ plan: nextPlan, sources: latestSchedule.sources ?? undefined });
  };
  // 065: the week's EXTRA scheduled workouts — each renders beneath its
  // day's primary bar; today's are in_progress so BOTH of today's bars light.
  const scheduledExtras = extraScheduledBars(schedule.data ?? [], sessions.data ?? [], setsFor, todayIso);
  const todaysExtras = scheduledExtrasFor(todayIso, schedule.data ?? []);
  // Ad-hoc and off-schedule workouts get their own bar — otherwise finishing one
  // leaves it with no home on Train: green nowhere, reachable nowhere. The
  // exclusion list is every name that already owns a bar today: the remapped
  // primary + the extras (a swapped-AWAY stored name stays eligible — that's
  // the off-schedule case this exists for).
  const extraBars = extraBarsForToday(
    workouts.data ?? [],
    sessions.data ?? [],
    adhoc?.name ?? null,
    [...(scheduledToday ? [scheduledToday] : []), ...todaysExtras],
    todayIso,
    setsFor
  );

  // THE CAROUSEL'S DATE WINDOW: today ±7, stable keys, today centred.
  // Widen the ± constant to load more history later.
  const dates = datesAround(todayIso);

  const userPlans = useUserPlans();
  const [mapViewChoice, setMapViewChoice] = useState<MuscleView | null>(null);
  // A6: the one bodyweight chain (latest log → profile → caller default).
  const bodyweightKg =
    currentBodyweightKg(bodyweights.data, profile.data?.bodyweight_kg) ??
    (profile.data?.sex === 'female' ? FEMALE_CALIBRATION : MALE_CALIBRATION).defaultBodyweight;

  // ---- "+0.4 EVO" — the athlete's OWN measured rate, never a forecast.
  //
  // The SAME module Home's mission card reads (evo-per-session.ts): real
  // rating gain across a window divided by the training days that produced it.
  // It returns null — and the briefing shows no Evo number at all rather than
  // a default — until there is enough history for the average to mean
  // anything. Two screens, one number, one refusal.
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

  /** EVERYTHING one day's card needs, computed from ITS date — progress is
   *  keyed (date, workout), so a set completed on one day can never appear on
   *  another. Null = nothing assigned (rest, or no schedule at all). */
  const cardDataFor = (date: string) => {
    let workout = dayInSource(date);
    // Today's active ad-hoc fills an otherwise-empty today.
    if (!workout && date === todayIso && adhoc?.name) workout = adhoc.name;
    if (!workout) return null;
    const resolved = resolveDay(workout, sourceForDate(date));
    const entries = resolved.entries;
    const name = splitWorkoutName(workout);
    // WHOSE version of this day is on screen. Plans share day names ("Legs"
    // exists in all three of Tyson's plans), so when the day has no subtitle
    // of its own the sub line names the PLAN.
    const planName =
      resolved.from === 0
        ? (userPlans.data?.custom?.plan_name ?? 'My Plan')
        : resolved.from === 1
          ? (userPlans.data?.ai?.plan_name ?? 'AI Plan')
          : 'Built-in Routine';
    // Pills and map share ONE vocabulary: each exercise's tag through the
    // muscle ladder, normalised into MuscleIds.
    const muscles = muscleIdsFor(
      entries.map(
        ([exercise]) =>
          userMuscleFor(exercise, userExercises.data ?? []) ??
          libraryMuscleFor(exercise) ??
          inferMuscleGroup(exercise)
      )
    );
    const sets = entries.reduce((n, [, s]) => n + s, 0);
    // KCAL is NET — the surplus over resting — sized by the athlete's own
    // last session of this workout before this date.
    const lastWork = lastSessionForWorkout(workoutIndex.data, workout, date);
    const kcalSets = sets > 0 ? sets : (lastWork?.sets ?? 0);
    const kcalRepsPerSet = lastWork && lastWork.sets > 0 ? lastWork.totalReps / lastWork.sets : null;
    const progress = setsFor(date, workout);
    const marker = (sessions.data ?? []).some((m) => m.date === date && m.workout === workout);
    return {
      workout,
      title: name.title,
      sub: name.sub ?? planName,
      planName,
      pills: pillLabelsFor(muscles),
      muscles,
      /** The day's plan, kept so a tapped muscle can name the exercises that
       *  hit it — the same entries the pills and the map were built from, so
       *  the sheet can never disagree with the figure it opened from. */
      entries,
      /** The briefing's WHY, derived from the muscles rather than the day's
       *  name (athletes name days anything; the muscles are the fact). */
      objective: missionObjectiveFor(muscles),
      difficulty: difficultyFor(sets),
      sets,
      minutes: estimateMinutes(sets),
      kcal: estimateNetKcal(kcalSets, kcalRepsPerSet, bodyweightKg),
      done: progress.done,
      target: progress.target,
      finished: marker,
    };
  };

  /** Today's card, computed once for the header champion and the launch veil. */
  const todayCard = cardDataFor(todayIso);

  /**
   * A tapped muscle's real weekly volume: sets LOGGED since Monday whose
   * exercise resolves to that muscle through the same ladder the pills and the
   * map use. Computed on TAP, never per render — it walks the week's rows, and
   * the hub already re-renders on every override write.
   */
  const weekSetsForMuscle = (muscle: MuscleId): number => {
    const from = weekStart(todayIso);
    let n = 0;
    for (const [date, rows] of workoutIndex.data?.byDate ?? new Map()) {
      if (date < from || date > todayIso) continue;
      for (const r of rows) {
        if (!isCountedSet(r.weight, r.reps)) continue;
        const exercise = String(r.exercise);
        const label =
          userMuscleFor(exercise, userExercises.data ?? []) ??
          libraryMuscleFor(exercise) ??
          inferMuscleGroup(exercise);
        if (normaliseMuscleGroup(label) === muscle) n += 1;
      }
    }
    return n;
  };

  /** One muscle's whole story, resolved on demand by the board. */
  const loadForMuscle = (muscle: MuscleId): MuscleLoad => ({
    muscle,
    exercises: todaysExercisesForMuscle(muscle),
    weekSets: weekSetsForMuscle(muscle),
  });

  /** Today's planned exercises that tag the muscle, with their set counts. */
  const todaysExercisesForMuscle = (muscle: MuscleId): { exercise: string; sets: number }[] => {
    const out: { exercise: string; sets: number }[] = [];
    for (const [exercise, sets] of todayCard?.entries ?? []) {
      const label =
        userMuscleFor(exercise, userExercises.data ?? []) ??
        libraryMuscleFor(exercise) ??
        inferMuscleGroup(exercise);
      if (normaliseMuscleGroup(label) === muscle) out.push({ exercise, sets });
    }
    return out;
  };

  /** Every workout NAME that already owns a session on today's date — the
   *  collision check `canTrainEarly` refuses on. */
  const namesInPlayToday = (): string[] => [
    ...(scheduledToday ? [scheduledToday] : []),
    ...todaysExtras,
    ...(adhoc?.name ? [adhoc.name] : []),
    ...extraBars.map((b) => b.workout ?? ''),
  ];

  const trainEarly = (plannedDate: string, workout: string) => {
    const verdict = canTrainEarly({
      plannedDate,
      workout,
      todayIso,
      claims: claimIndex,
      namesInPlayToday: namesInPlayToday(),
    });
    if (!verdict.ok) {
      useToastStore.getState().push({
        kind: 'info',
        title: 'NOT TODAY',
        subtitle: EARLY_REFUSAL_MESSAGE[verdict.reason],
      });
      return;
    }
    // The claim is written on START, not on the first set: tapping TRAIN EARLY
    // IS the decision to move the session, and the week should say so before
    // the athlete has touched a barbell. PUT IT BACK on the moved card — and
    // reopening the session — undo it, so the decision is never a trap.
    claimPlanSession.mutate({ plannedDate, workout, completedDate: todayIso });
    // The session opens on TODAY (that is where the sets belong) but carries
    // the PLANNED day's source — a per-day source (066) means Wednesday's
    // "Legs" can be the AI plan's while today follows MY PLAN, and resolving
    // it against today's source would silently hand over a different workout.
    launch(todayIso, workout, sourceForDate(plannedDate));
  };

  const putBack = (plannedDate: string, workout: string) =>
    releasePlanSession.mutate({ plannedDate, workout });

  const carouselRef = useRef<DailyCarouselHandle>(null);

  /** The ONE entry path into a workout — and the SOURCE goes with it. Without
   *  that, the workout page had to guess whose plan you meant, and guessed the
   *  same way every time (whichever plan held the day name). */
  const open = (date: string, workout: string, sourceOverride?: SourceIndex) =>
    router.push(
      labWorkoutHref('baseline', {
        date,
        workout,
        source: sourceOverride ?? sourceForDate(date),
      }) as never
    );

  /**
   * START WORKOUT. The veil and the navigation go up on the SAME frame — see
   * ui/train/mission-launch.tsx for why the transition must never be something
   * the athlete waits through. This is still the one door: `open` is unchanged.
   */
  const launch = (date: string, workout: string, sourceOverride?: SourceIndex) => {
    // MISSION START gets a MEDIUM tick, not the button's default light one:
    // this is the page's one committing action and it should feel heavier in
    // the hand than switching a plan does.
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLaunching(workout);
    open(date, workout, sourceOverride);
  };

  /** ONE day of the carousel — always the same card shell, five states. */
  const renderDayCard = (date: string) => {
    const data = cardDataFor(date);
    const isToday = date === todayIso;
    const dateTag = (
      <Text
        className="text-2xs"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ letterSpacing: 0, flexShrink: 0, color: isToday ? colors.accent : colors['text-mute'], ...pixelFont() }}
        testID={`card-date-${date}`}
      >
        {cardDate(date, todayIso)}
      </Text>
    );
    const dropdown = (
      <Pressable
        onPress={() => setChangeOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="change plan source"
        testID="plan-dropdown"
        hitSlop={{ top: 8, bottom: 8 }}
        className="flex-row items-center rounded-md border px-s2"
        // 28 -> 44: react-native-web's Pressable IGNORES hitSlop (see the note
        // in ui/core/neon-button.tsx), so only the box itself clears the touch
        // floor. hitSlop stays because native Pressable does honour it.
        style={{ minHeight: 44, gap: 5, flexShrink: 1, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.08)' }}
      >
        <Text
          className="text-2xs text-accent"
          numberOfLines={1}
          ellipsizeMode="tail"
          allowFontScaling={false}
          style={{ letterSpacing: 0, flexShrink: 1, ...pixelFont() }}
        >
          {SOURCE_LABEL[sourceForDate(date)]}
        </Text>
        <Text className="text-2xs font-bold text-accent">⌄</Text>
      </Pressable>
    );

    if (!data) {
      // Rest day / nothing planned: same shell, honest content, no fake stats.
      const hasSchedule = (schedule.data ?? []).length > 0;
      /* A REST DAY IS EARNED. On TODAY, an athlete who has never trained is
         offered day one of their own plan instead — the same rule Home uses
         (domain/today-session.ts), so the two screens cannot disagree about
         whether today is trainable. Future days are untouched: a scheduled
         rest day next Thursday is still a rest day. */
      const firstSession = isToday
        ? resolveTodaySession({
            scheduledToday: null,
            startedToday: startedWorkoutToday(workouts.data ?? [], todayIso),
            planDays,
            hasEverTrained,
          })
        : { workout: null, reason: 'none' as const };
      /** START vs RESUME vs done — read from the persisted record, not sets. */
      const firstCta =
        isToday && (firstWorkout.cta === 'start' || firstWorkout.cta === 'resume')
          ? (firstWorkout.workout ?? firstSession.workout)
          : null;
      return (
        <View style={{ height: scale.cardHeight, paddingHorizontal: 2 }}>
          <GlowCard glow={colors.accent} padding={14} fill>
            <View testID={`hero-card-${date}`} style={{ flex: 1 }}>
              <View className="flex-row items-center justify-between">
                {dropdown}
                {dateTag}
              </View>
              <View className="flex-1 items-center justify-center" style={{ gap: 6 }}>
                <Text className="text-xl text-text" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
                  {firstWorkout.cta === 'completed'
                    ? 'WORKOUT COMPLETE'
                    : firstCta
                      ? firstWorkout.cta === 'resume'
                        ? 'YOUR FIRST WORKOUT'
                        : 'YOUR FIRST WORKOUT'
                      : hasSchedule
                        ? 'REST DAY'
                        : 'NO WORKOUT PLANNED'}
                </Text>
                <Text className="text-center text-sm text-text-dim">
                  {firstWorkout.cta === 'completed'
                    ? 'Logged and banked. Rest up — your next session is on your schedule.'
                    : firstCta
                      ? firstWorkout.cta === 'resume'
                        ? `${firstCta} is open and waiting — pick up where you left off.`
                        : `${firstCta} — start whenever you are ready. Your week begins from here.`
                      : hasSchedule
                        ? 'Recovery is where the muscle is built. See you tomorrow.'
                        : 'Pick a plan or start from scratch.'}
                </Text>
              </View>
              {/* Footer pinned — same vertical position on every card. */}
              <View style={{ marginTop: 'auto', gap: 8 }}>
                {/* START only when there is genuinely nothing started yet.
                    The record is on the profile (138), so this survives a
                    refresh, a sign-out and a second device — it is not
                    `completedSets > 0`, which is blind to a workout that is
                    open but not yet logged. */}
                {firstCta ? (
                  <NeonButton
                    title={firstWorkout.cta === 'resume' ? 'RESUME FIRST WORKOUT' : 'START FIRST WORKOUT'}
                    pixel
                    onPress={() => {
                      // Record the start BEFORE navigating: write-once
                      // server-side, so a second tap changes nothing.
                      markFirstWorkout.mutate({ workout: firstCta, date: todayIso });
                      open(todayIso, firstCta);
                    }}
                    testID={firstWorkout.cta === 'resume' ? 'hero-resume-first' : 'hero-start-first'}
                  />
                ) : null}
                <NeonButton
                  title="ADD WORKOUT"
                  variant="ghost"
                  pixel
                  onPress={() => setEmptyOpen(true)}
                  testID={`add-workout-${date}`}
                />
              </View>
            </View>
          </GlowCard>
        </View>
      );
    }

    const mapView = mapViewChoice ?? bestViewFor(data.muscles);
    // THE BRIEFING. Every value below is the same value this card always
    // carried; ui/train/mission-brief.tsx only decides the order they are
    // read in and what arrives when.
    return (
      <MissionBriefCard
        data={{
          workout: data.workout,
          title: data.title,
          sub: data.sub,
          objective: data.objective,
          pills: data.pills,
          muscles: data.muscles,
          difficulty: data.difficulty,
          sets: data.sets,
          minutes: data.minutes,
          done: data.done,
          finished: data.finished,
        }}
        header={
          <>
            {dropdown}
            {dateTag}
          </>
        }
        // The Evo rate and the XP are the athlete's, not the day's — the same
        // pair Home's mission card shows, so the two screens agree.
        evoPerSession={evoPerSession}
        xpReward={activityXp(data.sets, 0)}
        benefit={evoEvidenceLabel(evoEvidenceFor({ sets: data.sets, cardioMinutes: 0 }))}
        mapView={mapView}
        focus={focusFor(data.muscles)}
        onFlip={() => setMapViewChoice(mapView === 'front' ? 'back' : 'front')}
        // A muscle only opens its own readout on TODAY's card: the sheet talks
        // about this week's volume and today's exercises, and neither of those
        // is about the Thursday you swiped to.
        onMusclePress={
          isToday
            ? (m) => {
                setMusclePick(m);
                setBoardOpen(true);
              }
            : undefined
        }
        onStart={() => launch(date, data.workout)}
        /* §1 — QUICK WORKOUT IS ALWAYS REACHABLE. It opens the SAME sheet the
           rest-day card's ADD WORKOUT opens and runs the SAME startEmpty()
           path, which names the session uniquely against everything already
           in play today (adhocNameError / autoWorkoutName). So a quick
           session cannot merge into the planned one, cannot mark it complete,
           and cannot delete it — it simply becomes a second workout on the
           day, with its own bar, which the week rail has supported since 065. */
        onQuickWorkout={isToday ? () => setEmptyOpen(true) : undefined}
        /* §2 — an upcoming day is a door, not a wall. */
        onTrainEarly={date > todayIso && !claimFor(date, data.workout) ? () => trainEarly(date, data.workout) : undefined}
        movedTo={claimFor(date, data.workout)?.completed_date ?? null}
        onPutBack={
          claimFor(date, data.workout) ? () => putBack(date, data.workout) : undefined
        }
        isToday={isToday}
        intro={intro}
        clock={clock}
        testID={isToday ? 'hero-card' : `hero-card-${date}`}
        progressTestID={isToday ? 'hero-progress' : `hero-progress-${date}`}
        startTestID={isToday ? 'hero-start' : `hero-start-${date}`}
      />
    );
  };

  /** EDIT on a locked bar: unlock AND go in. One tap from bar to editing is what
   *  a soft lock has to mean, or it is just a wall. */
  const editLocked = (date: string, workout: string) => {
    const marker = (sessions.data ?? []).find((m) => m.date === date && m.workout === workout);
    if (marker) reopenWorkout.mutate(marker);
    open(date, workout);
  };

  const startEmpty = (rawName: string, picks: SessionExercise[]) => {
    // EVERY name that already means something — not just the tab you happen to
    // be looking at. A custom split's day names are its own, so the SCHEDULED
    // day was not in this list, and naming an ad-hoc after it merged the two
    // workouts into one (blanking the scheduled day's exercises, and filing its
    // sets under the scheduled key). adhocNameError exists to stop exactly that.
    const taken = [
      ...daysForSource(0, sources, BUILT_IN_DAYS),
      ...daysForSource(1, sources, BUILT_IN_DAYS),
      ...BUILT_IN_DAYS,
      ...(scheduledToday ? [scheduledToday] : []),
      ...todaysExtras, // 065: a scheduled extra owns its name today too
      ...extraBars.map((b) => b.workout ?? ''),
    ];
    /* AN EMPTY NAME IS NOT AN ERROR. The field says "optional" and now means
       it: we name the session from the day and what they picked, uniquely
       against everything already in play today so two sessions can never
       collapse into one record. A name they DID type is still validated. */
    const typed = rawName.trim();
    let name: string;
    if (typed === '') {
      const focusCounts = new Map<string, number>();
      for (const p of picks) {
        const m = inferMuscleGroup(p.exercise);
        // "Other" is inferMuscleGroup's FALLBACK, not a muscle — naming a
        // session "Thursday Other Workout" is worse than not naming its focus.
        if (m && m.toLowerCase() !== 'other') focusCounts.set(m, (focusCounts.get(m) ?? 0) + 1);
      }
      const focus =
        [...focusCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      name = autoWorkoutName(todayIso, focus, taken);
    } else {
      const err = adhocNameError(typed, taken);
      if (err !== null) {
        useToastStore.getState().push({ kind: 'error', title: 'PICK ANOTHER NAME', subtitle: err });
        return;
      }
      name = typed;
    }
    startAdhoc({ name, exercises: picks });
    setEmptyOpen(false);
    open(todayIso, name);
  };

  const startRoutine = (routineName: string, exercises: SessionExercise[]) => {
    const name =
      adhocNameError(routineName, planDays) === null ? routineName : `${routineName} (today)`;
    startAdhoc({ name, exercises });
    setEmptyOpen(false);
    open(todayIso, name);
  };

  /** The 📷 door — the routine builder opens with the scan sheet up. */
  const goScan = () => {
    setChangeOpen(false);
    setEmptyOpen(false);
    router.push('/routine?import=1' as never);
  };

  const scanRow = (testID: string) => (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={goScan}
      className="flex-row items-center justify-center rounded-md border px-s3"
      style={{ minHeight: 48, gap: 8, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.07)' }}
    >
      <Text className="text-base">📷</Text>
      <View className="items-start">
        <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
          SCAN WORKOUT
        </Text>
        <Text className="text-2xs text-text-mute">Import from a photo or screenshot</Text>
      </View>
    </Pressable>
  );

  /**
   * THE PLAN SWITCHER'S DATA. The sheet renders it; the RULE stays here,
   * because it is the same rule the carousel resolves days with.
   */
  const loadouts: LoadoutSource[] = ([0, 1, 2] as SourceIndex[]).map((i) => ({
    index: i,
    label: SOURCE_LABEL[i],
    hint:
      i === 0
        ? sources.has.myPlan
          ? 'Workouts you built yourself'
          : 'Nothing saved yet — create one below'
        : i === 1
          ? sources.has.aiPlan
            ? 'Personalised by EvoForge around your goals'
            : 'Not forged yet — create one below'
          : 'The ready-made EvoForge program',
    days: daysForSource(i, sources, BUILT_IN_DAYS),
    empty: (i === 0 && !sources.has.myPlan) || (i === 1 && !sources.has.aiPlan),
  }));

  /**
   * Picking a loadout — FIXED (2026-08-05, Tyson: "changing workouts with
   * the dropdown doesn't change the workout").
   *
   * The previous handler re-stamped every trained weekday's PER-DAY SOURCE
   * to the newly picked index (`uniform[dow] = i`) so a map Schedule had
   * written couldn't keep outranking this choice. That fix introduced the
   * exact bug it was written to prevent, one level down: `dayInSource`
   * (below) treats an EXPLICIT per-day source as proof the stored day NAME
   * already belongs to that source — true when schedule.tsx wrote it (the
   * editor picks the name FROM that source's list), false here, because
   * stamping `sources[dow]` never touched `plan[dow]`'s NAME. So every
   * trained day kept whatever title the OLD source had given it, now
   * flagged "explicit" — which skips `sourceDayFor`'s positional remap
   * entirely (see week-status.ts) and freezes the stale title in place. The
   * dropdown's own label updated (it reads `source` directly); the card
   * titled after it never did.
   *
   * The fix is to CLEAR the per-day map instead of uniformly overwriting
   * it: `explicitSourceForDate` then returns null everywhere, exactly what
   * "outrank the old map forever" needs — every day falls through to
   * `sourceDayFor(date, schedule.data, planDays, todayIso)`, which is the
   * function actually built to rename a week's slots onto a newly chosen
   * plan's own days.
   */
  const pickSource = (i: SourceIndex) => {
    setSource(i);
    savePref.mutate(i); // fire-and-forget; the error toast covers a failed sync
    if (latestSchedule && latestSchedule.sources && Object.keys(latestSchedule.sources).length > 0) {
      saveSchedule.mutate({ plan: latestSchedule.plan, sources: {} });
    }
    setChangeOpen(false);
  };


  return (
    <ScreenShell
      backdrop={<ScreenAmbience />}
      overlay={
        launching !== null ? (
          <MissionLaunch workout={launching} />
        ) : (
          // The hub carries the same floating layer as the workout page, so an
          // offer that lands between exercises — or a payout that settles while
          // the athlete is looking at their week — still reaches them. It is
          // pointerEvents="box-none", it gates itself on the athlete's own
          // setting, and it renders nothing when there is nothing to say.
          <CalloutLayer />
        )
      }
    >
      {/* COMPACT HEADER (Tyson's target layout, 2026-07-15): the title rides
          the top safe area, the date sits UNDER it, and the companion lives
          in a small outlined profile container with the level beneath. */}
      <View className="w-full flex-row items-start justify-between">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            className="text-text"
            allowFontScaling={false}
            style={{
              fontSize: 30,
              lineHeight: 36,
              letterSpacing: 0,
              textShadowColor: 'rgba(34, 211, 238, 0.55)',
              textShadowRadius: 18,
              ...pixelFont(),
            }}
          >
            {mode === 1 ? 'CARDIO' : 'TRAIN'}
          </Text>
          <View className="mt-s1 flex-row items-center" style={{ gap: 6 }}>
            <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0.5, ...pixelFont() }}>
              TODAY
            </Text>
            <Text className="text-2xs text-text-mute">•</Text>
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {headerDate(todayIso)}
            </Text>
          </View>
        </View>
        <View className="items-center">
          {/* THE CHAMPION READS TODAY (ui/train/champion-charge.tsx): idle at
              zero, working while the day fills, victorious once it is done.
              Same sprite, same profile-menu tap — it just stopped being
              wallpaper. CARDIO mode keeps its activity animation. */}
          <ChampionCharge
            done={mode === 1 ? cardioMission.done : (todayCard?.done ?? 0)}
            target={mode === 1 ? cardioMission.target : (todayCard?.target ?? 0)}
            finished={mode === 1 ? cardioMission.complete : (todayCard?.finished ?? false)}
            overrideAnim={mode === 1 ? cardioAnim(cardioType) : undefined}
            height={44}
          />
          <Pressable
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel="open profile"
            testID="header-level"
            className="mt-s1 items-center justify-center"
            style={{ minHeight: 24, minWidth: 44 }}
          >
            <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
              FORGE LV. {forgeProgress.level} ›
            </Text>
          </Pressable>
        </View>
      </View>

      <SegmentedTabs
        left="LIFT"
        right="CARDIO"
        active={mode}
        onChange={setMode}
        testIDPrefix="today-mode"
        pixelLabels
        leftIcon={<PixelDumbbell size={14} color={mode === 0 ? colors.accent : colors['text-dim']} />}
        rightIcon={<PixelHeart size={14} color={mode === 1 ? colors.accent : colors['text-dim']} />}
      />

      <View style={{ display: mode === 0 ? 'flex' : 'none', gap: 12 }}>
        {/* THE HERO — now a daily carousel (Tyson's spec): the SAME card,
            swipeable one calendar day at a time. Every value inside a card
            comes from ITS date, so progress can never bleed across days and
            START always starts the visible date. */}
        <DailyWorkoutCarousel
          ref={carouselRef}
          dates={dates}
          initialIndex={CAROUSEL_REACH}
          cardHeight={scale.cardHeight}
          renderDay={renderDayCard}
        />

        {/* ONE PLAN RAIL where three grey utility cards and their explanatory
            line used to be. Every door they held moved into MANAGE PLAN — see
            ui/train/plan-rail.tsx for what that trade buys and what it costs. */}
        <PlanRail
          planName={todayCard?.planName ?? SOURCE_LABEL[source]}
          onSwitch={() => setChangeOpen(true)}
          onManage={() => setChangeOpen(true)}
        />

        {/* THIS WEEK — the doors. */}
        {weekBars ? (
          <View>
            <View className="mb-s2 flex-row items-center justify-between">
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                THIS WEEK
              </Text>
              <Pressable
                onPress={() => router.push('/schedule' as never)}
                accessibilityRole="button"
                testID="view-calendar"
                hitSlop={{ top: 8, bottom: 8 }}
                className="items-center justify-center"
                style={{ minHeight: 44 }}
              >
                <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
                  VIEW CALENDAR ›
                </Text>
              </Pressable>
            </View>
            {weekBars.map((bar) => (
              <Fragment key={bar.date}>
                <WeekBarRow
                  bar={bar}
                  // A week row FOCUSES the carousel on its date (Tyson's
                  // carousel spec) — the card's own button is the door in.
                  onOpen={() => carouselRef.current?.scrollToDate(bar.date)}
                  // Only TODAY's workout can be edited — the cards log to today.
                  // EDIT on a past bar used to delete the marker and land the
                  // athlete on a read-only page: nothing edited, the lock gone,
                  // and no way to restore it.
                  onEdit={
                    bar.locked && bar.workout && bar.date === todayIso
                      ? () => editLocked(bar.date, bar.workout as string)
                      : undefined
                  }
                />
                {/* 065: the day's extra scheduled workouts, directly beneath.
                    No carousel card exists for an extra, so TODAY's bar is
                    its own door in; other days focus the carousel like any
                    week row. */}
                {(scheduledExtras.get(bar.date) ?? []).map((extra) => (
                  <WeekBarRow
                    key={`${extra.date}:${extra.workout}`}
                    bar={extra}
                    showDay={false}
                    onOpen={() =>
                      extra.date === todayIso && extra.workout
                        ? open(extra.date, extra.workout)
                        : carouselRef.current?.scrollToDate(extra.date)
                    }
                    onEdit={
                      extra.locked && extra.workout && extra.date === todayIso
                        ? () => editLocked(extra.date, extra.workout as string)
                        : undefined
                    }
                  />
                ))}
              </Fragment>
            ))}
            {extraBars.map((bar) => (
              <WeekBarRow
                key={`extra:${bar.workout}`}
                bar={bar}
                showDay={false}
                onOpen={() => bar.workout && open(bar.date, bar.workout)}
                onEdit={bar.locked && bar.workout ? () => editLocked(bar.date, bar.workout as string) : undefined}
              />
            ))}
          </View>
        ) : (
          /* No schedule: the day chips remain — and a chip is a door too, so
             there is exactly ONE way into a workout. */
          <View>
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              PICK A DAY
            </Text>
            <View className="flex-row flex-wrap gap-s2">
              {planDays.map((d) => (
                <Chip key={d} label={d} active={false} onPress={() => open(todayIso, d)} />
              ))}
              {extraBars.map((b) => (
                <Chip
                  key={`extra:${b.workout}`}
                  label={b.workout ?? ''}
                  active
                  onPress={() => b.workout && open(todayIso, b.workout)}
                />
              ))}
            </View>
            <Link href={'/schedule' as never} asChild>
              <Pressable accessibilityRole="button" testID="set-your-week" className="mt-s3 items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
                  ◫ SET YOUR WEEK →
                </Text>
              </Pressable>
            </Link>
          </View>
        )}
      </View>

      <View style={{ display: mode === 1 ? 'flex' : 'none', gap: 16 }}>
        <CardioDashboard type={cardioType} setType={setCardioType} intro={intro} clock={clock} />
      </View>

      {/* MANAGE PLAN — the loadout picker plus every plan door that used to be
          a grey card above the fold (ui/train/manage-plan-sheet.tsx). */}
      {changeOpen ? (
        <ManagePlanSheet
          sources={loadouts}
          active={source}
          onPickSource={pickSource}
          swapDays={planDays.filter((d) => d !== scheduledToday)}
          onPickSwapDay={(d) => setSwapPick(d)}
          onScan={goScan}
          onQuickWorkout={() => {
            setChangeOpen(false);
            setEmptyOpen(true);
          }}
          onEditSchedule={() => {
            setChangeOpen(false);
            router.push('/schedule' as never);
          }}
          onEditPlan={() => {
            setChangeOpen(false);
            router.push('/routine' as never);
          }}
          onAiPlan={() => {
            setChangeOpen(false);
            router.push('/ai' as never);
          }}
          hasMyPlan={sources.has.myPlan}
          onClose={() => setChangeOpen(false)}
        />
      ) : null}

      {/* SWAP TODAY'S DAY — just-today vs save-to-schedule, same choice
          workout.tsx already offers for exercise edits (SAVE CHANGES / JUST
          TODAY), so the pattern reads the same wherever it shows up. */}
      {swapPick !== null ? (
        <Modal transparent animationType="fade" onRequestClose={() => setSwapPick(null)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setSwapPick(null)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface }}
            >
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                SWAP {(scheduledToday ? splitWorkoutName(scheduledToday).title : 'TODAY').toUpperCase()} FOR{' '}
                {splitWorkoutName(swapPick).title.toUpperCase()}
              </Text>
              <Text className="mb-s3 text-2xs text-text-mute">
                Saving swaps this weekday&apos;s split from now on — every future week trains{' '}
                {splitWorkoutName(swapPick).title} here instead. Just today trades it once;
                tomorrow&apos;s schedule goes back to normal.
              </Text>
              <View style={{ gap: 8 }}>
                <NeonButton
                  title="SAVE TO MY SCHEDULE"
                  onPress={() => {
                    swapDayPermanently(swapPick);
                    setDaySwap(null);
                    setSwapPick(null);
                    setChangeOpen(false);
                  }}
                  testID="swap-day-save"
                />
                <NeonButton
                  title="JUST TODAY"
                  variant="ghost"
                  onPress={() => {
                    setDaySwap(swapPick);
                    setSwapPick(null);
                    setChangeOpen(false);
                  }}
                  testID="swap-day-just-today"
                />
                <NeonButton title="CANCEL" variant="ghost" onPress={() => setSwapPick(null)} testID="swap-day-cancel" />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Start a workout the plan never heard of. Its OWN component (perf,
          2026-07-23): the name field used to live in THIS screen's state, so
          every keystroke re-rendered the whole hub behind the sheet. */}
      {emptyOpen ? (
        <QuickWorkoutSheet
          corpusData={{
            userExercises: userExercises.data,
            prefRows: exercisePrefs.data,
            workoutRows: workouts.data,
          }}
          routines={routines.data ?? []}
          scanRow={scanRow}
          onStart={startEmpty}
          onStartRoutine={startRoutine}
          onDeleteRoutine={(id) => deleteRoutine.mutate(id)}
          onClose={() => setEmptyOpen(false)}
        />
      ) : null}

      {/* THE MUSCLE BOARD — the figure at full sheet width (where a muscle is
          finally a real target), every targeted region as a row, and the
          selected one expanded. It answers and leaves; it never navigates
          ("do not interrupt workflow"). */}
      {boardOpen ? (
        <MuscleBoard
          muscles={todayCard?.muscles ?? []}
          initialMuscle={musclePick}
          loadFor={loadForMuscle}
          onClose={() => {
            setBoardOpen(false);
            setMusclePick(null);
          }}
        />
      ) : null}
    </ScreenShell>
  );
}

/** QUICK WORKOUT sheet. Keeps the name/picks state LOCAL so typing renders
 *  only this sheet, never the carousel/week-bars/muscle-maps behind it.
 *  State dies with the sheet — reopening starts clean. Every testID is
 *  verbatim from the inline modal it replaced. */
function QuickWorkoutSheet({
  corpusData,
  routines,
  scanRow,
  onStart,
  onStartRoutine,
  onDeleteRoutine,
  onClose,
}: {
  corpusData: Parameters<typeof buildCorpus>[0];
  routines: readonly Routine[];
  scanRow: (testID: string) => React.ReactNode;
  onStart: (name: string, picks: SessionExercise[]) => void;
  onStartRoutine: (name: string, exercises: SessionExercise[]) => void;
  onDeleteRoutine: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  // The athlete's own onboarding answers drive the recommendations.
  const profile = useProfile();
  const [name, setName] = useState('');
  // Exercises picked in the sheet BEFORE starting — they seed the ad-hoc.
  const [picks, setPicks] = useState<SessionExercise[]>([]);

  /**
   * PREFILL RECOMMENDED — for THIS athlete and THIS session.
   *
   * It used to run the SEARCH ranker, whose top sections are `suggested`
   * (driven by training history) and `popular`. A new athlete has no history,
   * so `suggested` was empty and the list fell through to library order —
   * which is alphabetical. A Shoulders session was offered Ab Wheel Rollout,
   * Arnold Press, Assisted Pull-Up, a squat and a bench.
   *
   * `recommendStarter` needs no history: it reads the goal, experience,
   * equipment and session length the athlete gave onboarding, centres on the
   * muscle this session is for, and sequences compounds before isolation.
   * Only ADDS — never eats a pick already made.
   */
  const prefill = () => {
    const corpus = buildCorpus(corpusData, {
      programExercises: [],
      excludeNames: picks.map((p) => p.exercise),
    });
    // The typed text names a MUSCLE GROUP ("Shoulders"), not an exercise —
    // inferMuscleGroup answers "Other" for it, which matched nothing.
    const targetMuscles = targetMusclesFromText(name, inferMuscleGroup);
    const add = recommendStarter({
      goal: (profile.data?.onboarding_goal as OnboardingGoal | null) ?? null,
      experience: (profile.data?.experience_level as ExperienceLevel | null) ?? null,
      equipment: (profile.data?.equipment_access as EquipmentAccess | null) ?? null,
      sessionMinutes: profile.data?.session_minutes ?? null,
      targetMuscles,
      library: corpus.library,
      exclude: picks.map((p) => p.exercise),
    });
    if (add.length === 0) {
      useToastStore.getState().push({
        kind: 'info',
        title: 'NOTHING TO SUGGEST',
        subtitle: targetMuscles.length
          ? `No ${targetMuscles[0]} exercises match your equipment.`
          : 'Search for an exercise instead.',
      });
      return;
    }
    setPicks((cur) => {
      const have = new Set(cur.map((x) => x.exercise.toLowerCase()));
      return [...cur, ...add.filter((a) => !have.has(a.exercise.toLowerCase()))];
    });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: 560 }}
        >
          <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            QUICK WORKOUT
          </Text>
          <TextInput
            className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
            style={{ borderColor: colors.border }}
            placeholder="Workout name (optional — we'll name it)"
            placeholderTextColor="#64758f"
            value={name}
            onChangeText={setName}
            maxLength={40}
            testID="adhoc-name"
          />
          {/* One tap fills it with recommended exercises (name it first for a
              muscle-matched set; otherwise popular staples). */}
          <Pressable
            onPress={prefill}
            accessibilityRole="button"
            testID="adhoc-prefill"
            className="mt-s3 items-center rounded-md border"
            style={{ minHeight: 44, justifyContent: 'center', borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
          >
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
            >
              ⚡ PREFILL WITH RECOMMENDED EXERCISES
            </Text>
          </Pressable>
          {/* Seed exercises before you even start — optional; the workout
              page can add more. Type a letter, tap a box. */}
          <View className="mt-s3">
            <ExerciseSearchBar
              onPick={(e) =>
                setPicks((p) =>
                  p.some((x) => x.exercise === e.name)
                    ? p
                    : [...p, { exercise: e.name, sets: 3, reps: '8-12' }]
                )
              }
              excludeNames={picks.map((p) => p.exercise)}
              placeholder="Choose exercises (optional)"
              testIDPrefix="adhoc-search"
            />
          </View>
          {picks.length > 0 ? (
            <View className="mt-s2 flex-row flex-wrap gap-s2">
              {picks.map((p) => (
                <Pressable
                  key={p.exercise}
                  onPress={() => setPicks((cur) => cur.filter((x) => x.exercise !== p.exercise))}
                  accessibilityRole="button"
                  accessibilityLabel={`remove ${p.exercise}`}
                  testID={`adhoc-pick-${p.exercise}`}
                  className="rounded-md border px-s3 py-s2"
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    borderColor: `${colors.success}8c`,
                    backgroundColor: 'rgba(52,211,153,0.08)',
                  }}
                >
                  <Text className="text-2xs font-bold text-success">✓ {p.exercise} ✕</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Spec item 8: PLAN SCAN is reachable from here too — a written
              page IS an empty workout waiting to be read. */}
          <View className="mt-s3">{scanRow('empty-scan')}</View>
          <View className="mt-s3">
            <NeonButton title="START WORKOUT" pixel onPress={() => onStart(name, picks)} testID="adhoc-start" />
            <Text className="mt-s1 text-center text-2xs text-text-mute">Add exercises as you train</Text>
          </View>

          {routines.length > 0 ? (
            <View className="mt-s4">
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                MY ROUTINES
              </Text>
              <ScrollView style={{ maxHeight: 240 }}>
                {routines.map((r) => (
                  <View key={r.id} className="mb-s2 flex-row items-center gap-s2">
                    <Pressable
                      onPress={() => onStartRoutine(r.name, r.payload?.exercises ?? [])}
                      accessibilityRole="button"
                      testID={`routine-start-${r.name}`}
                      className="flex-1 rounded-md border border-border px-s3 py-s2"
                      style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                    >
                      <Text className="text-sm font-bold text-text">{r.name}</Text>
                      <Text className="text-2xs text-text-mute">
                        {(r.payload?.exercises ?? []).length} exercises · START TODAY
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => onDeleteRoutine(r.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`delete routine ${r.name}`}
                      testID={`routine-delete-${r.name}`}
                      className="items-center justify-center"
                      style={{ minWidth: 44, minHeight: 44 }}
                    >
                      <Text className="text-sm text-text-mute">✕</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View className="mt-s3">
            <NeonButton title="CANCEL" variant="ghost" onPress={onClose} testID="adhoc-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
