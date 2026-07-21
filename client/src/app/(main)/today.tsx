import { Link, router } from 'expo-router';
import { Fragment, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useBodyweightLog, useProfile, useWorkoutIndex, useWorkoutLog } from '@/data/hooks';
import { useUserExercises } from '@/data/exercises';
import { useExercisePrefs } from '@/data/exercise-prefs';
import { buildCorpus } from '@/data/exercise-corpus';
import { buildSections } from '@/domain/exercise-sections';
import { useDeleteRoutine, useRoutines } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
import { useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { BUILT_IN_DAYS, SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { useSavePlanSourcePref } from '@/data/plan-source-pref';
import { useUserPlans } from '@/data/user-plans';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { CARDIO_TYPES } from '@/domain/cardio';
import { currentBodyweightKg } from '@/domain/bodyweight-current';
import { libraryMuscleFor } from '@/domain/exercise-library';
import { userMuscleFor } from '@/domain/exercise-search';
import { focusFor, muscleIdsFor, pillLabelsFor, type MuscleView } from '@/domain/muscle-map';
import { daysForSource, type SourceIndex } from '@/domain/plan-sources';
import {
  adhocNameError,
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
import { inferMuscleGroup } from '@/domain/workouts';
import { adhocOf, useSessionStore } from '@/state/session-store';
import { pixelFont } from '@/theme/fonts';
import { useToastStore } from '@/state/toast-store';
import { useThemeColors } from '@/theme/use-theme';
import { CardioDashboard } from '@/ui/train/cardio/cardio-dashboard';
import { cardioAnim } from '@/ui/train/cardio/activities';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { DailyWorkoutCarousel, type DailyCarouselHandle } from '@/ui/train/daily-workout-carousel';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';
import { MuscleMap, bestViewFor } from '@/ui/muscle-map/muscle-map';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { PixelBars, PixelClock, PixelCurvedArrow, PixelDumbbell, PixelFlame, PixelHeart, PixelPencil, PixelPlusSquare, PixelSwap } from '@/ui/core/pixel-icons';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { WeekBarRow } from '@/ui/train/week-bar';

/**
 * TRAIN — THE HUB, AS A MISSION BRIEFING (TRAIN_OVERHAUL).
 *
 * One dominant question, answered before anything scrolls: WHAT AM I DOING
 * TODAY, AND HOW DO I START. The hero card carries today's workout (name,
 * muscle pills, sets/time/kcal, the pixel body map) under an unmissable
 * START/RESUME bar. Three grey utility buttons carry everything the old
 * pill-row and scattered links did — change workout (source switching + plan
 * doors + PLAN SCAN), empty workout, edit my week. THIS WEEK keeps the doors,
 * now with status circles and an honest PARTIAL state.
 *
 * The logging UI stays its own page (`/workout`) — Train briefs, it never logs.
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
 *  itself — is exactly CARD_HEIGHT tall. Content NEVER sizes a card: the
 *  figure lives in a fixed box, the chips in a fixed two-row area, the
 *  footer rides marginTop:auto. */
const CARD_HEIGHT = 396;
const MAP_AREA_HEIGHT = 196;
const CHIP_AREA_HEIGHT = 56;
const MAX_CHIPS = 3;

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

export default function TodayScreen() {
  const colors = useThemeColors();
  const todayIso = calendarToday();

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
  const { sources, resolveDay, preferredSource } = useDayPlan();
  const savePref = useSavePlanSourcePref();
  // The header's LV. badge — FORGE LEVEL (earned XP only; Tyson 2026-07-16).
  const forge = useForgeProgression();
  const forgeProgress = forgeProgressFromRow(forge.data ?? null);

  const adhoc = useSessionStore(adhocOf);
  const startAdhoc = useSessionStore((s) => s.startAdhoc);
  // Narrow selections (not the whole store): the hub re-renders on override
  // writes only because today's bars are judged against the EDITED plan.
  const sessionDate = useSessionStore((s) => s.date);
  const sessionDays = useSessionStore((s) => s.days);
  const overridesForDay = (workout: string): DayOverrides =>
    sessionDate === todayIso ? (sessionDays[workout] ?? EMPTY_OVERRIDES) : EMPTY_OVERRIDES;

  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);
  const [sourceChoice, setSource] = useState<SourceIndex | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [adhocName, setAdhocName] = useState('');
  // Exercises picked in the sheet BEFORE starting — they seed the ad-hoc.
  const [adhocPicks, setAdhocPicks] = useState<SessionExercise[]>([]);

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
    // A day with an EXPLICIT per-day source stores the name already correct for
    // that source (the editor picked it from that source's day list), so the
    // global positional remap must not touch it — return the stored name as-is.
    if (explicitSourceForDate(date) !== null) return scheduledDayFor(date, schedule.data ?? []);
    return sourceDayFor(date, schedule.data ?? [], planDays, todayIso);
  };

  const weekBars = buildWeekBars(schedule.data ?? [], sessions.data ?? [], setsFor, todayIso, dayInSource);
  const scheduledToday = dayInSource(todayIso);
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
      pills: pillLabelsFor(muscles),
      muscles,
      sets,
      minutes: estimateMinutes(sets),
      kcal: estimateNetKcal(kcalSets, kcalRepsPerSet, bodyweightKg),
      done: progress.done,
      target: progress.target,
      finished: marker,
    };
  };

  const carouselRef = useRef<DailyCarouselHandle>(null);

  /** The ONE entry path into a workout — and the SOURCE goes with it. Without
   *  that, the workout page had to guess whose plan you meant, and guessed the
   *  same way every time (whichever plan held the day name). */
  const open = (date: string, workout: string) =>
    router.push(
      `/workout?date=${encodeURIComponent(date)}&workout=${encodeURIComponent(
        workout
      )}&source=${sourceForDate(date)}` as never
    );

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
        className="flex-row items-center rounded-md border px-s2"
        style={{ minHeight: 28, gap: 5, flexShrink: 1, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.08)' }}
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
      return (
        <View style={{ height: CARD_HEIGHT, paddingHorizontal: 2 }}>
          <GlowCard glow={colors.accent} padding={14} fill>
            <View testID={`hero-card-${date}`} style={{ flex: 1 }}>
              <View className="flex-row items-center justify-between">
                {dropdown}
                {dateTag}
              </View>
              <View className="flex-1 items-center justify-center" style={{ gap: 6 }}>
                <Text className="text-xl text-text" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
                  {hasSchedule ? 'REST DAY' : 'NO WORKOUT PLANNED'}
                </Text>
                <Text className="text-center text-sm text-text-dim">
                  {hasSchedule
                    ? 'Recovery is where the muscle is built. See you tomorrow.'
                    : 'Pick a plan or start from scratch.'}
                </Text>
              </View>
              {/* Footer pinned — same vertical position on every card. */}
              <View style={{ marginTop: 'auto' }}>
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
    const buttonTitle = data.finished
      ? 'VIEW WORKOUT'
      : data.done > 0
        ? 'CONTINUE WORKOUT'
        : 'START WORKOUT';
    return (
      <View style={{ height: CARD_HEIGHT, paddingHorizontal: 2 }}>
      <GlowCard glow={colors.accent} padding={14} fill>
        <View testID={isToday ? 'hero-card' : `hero-card-${date}`} style={{ flex: 1 }}>
          {/* HEADER - fixed. */}
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            {dropdown}
            {dateTag}
          </View>
          {/* CONTENT - flexible middle; nothing inside may grow the card. */}
          <View className="flex-row items-center" style={{ gap: 10, flex: 1 }}>
            <View className="items-start" style={{ flex: 1, minWidth: 0 }}>
              <Text
                className="mt-s2 text-text"
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
                style={{ fontSize: 21, lineHeight: 28, letterSpacing: 0, ...pixelFont() }}
              >
                {data.title.toUpperCase()}
              </Text>
              <Text
                className="text-text-dim"
                numberOfLines={1}
                ellipsizeMode="tail"
                allowFontScaling={false}
                style={{ fontSize: 13, letterSpacing: 0, ...pixelFont(false) }}
                testID="hero-sub"
              >
                {data.sub}
              </Text>
              {/* Fixed two-row chip area: 3 chips + a compact +N — a chip
                  count must never resize the card. */}
              <View
                className="mt-s2 flex-row flex-wrap gap-s1 self-stretch"
                style={{ height: CHIP_AREA_HEIGHT, alignContent: 'flex-start', overflow: 'hidden' }}
              >
                {[
                  ...data.pills.slice(0, MAX_CHIPS),
                  ...(data.pills.length > MAX_CHIPS ? [`+${data.pills.length - MAX_CHIPS}`] : []),
                ].map((p) => (
                  <View
                    key={p}
                    className="rounded-pill border bg-surface-2 px-s2 py-s1"
                    style={{ borderColor: colors.border }}
                  >
                    <Text
                      className="text-center text-text-dim"
                      numberOfLines={1}
                      allowFontScaling={false}
                      style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
                    >
                      {p}
                    </Text>
                  </View>
                ))}
              </View>
              {/* ~ marks estimates — honest numbers only. */}
              <View className="mt-s3 flex-row items-center self-stretch" style={{ gap: 10, rowGap: 4, flexWrap: 'wrap' }}>
                {(
                  [
                    [<PixelBars key="sets" size={16} color={colors['text-dim']} />, String(data.sets), 'SETS'],
                    [<PixelClock key="min" size={16} color={colors['text-dim']} />, String(data.minutes), 'EST. MIN'],
                    [<PixelFlame key="kcal" size={16} color={colors['text-dim']} />, String(data.kcal), 'EST. CAL'],
                  ] as const
                ).map(([icon, value, label]) => (
                  <View key={label} className="flex-row items-center" style={{ gap: 6 }}>
                    {icon}
                    <View className="items-start">
                      <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
                        {value}
                      </Text>
                      <Text
                        className="text-text-mute"
                        numberOfLines={1}
                        allowFontScaling={false}
                        style={{ fontSize: 8, letterSpacing: 0, ...pixelFont(false) }}
                      >
                        {label}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            {/* The character owns the right 40%. TAP flips front/back —
                horizontal swipes belong to the day carousel. */}
            <Pressable
              onPress={() => setMapViewChoice(mapView === 'front' ? 'back' : 'front')}
              accessibilityRole="button"
              accessibilityLabel={`show ${mapView === 'front' ? 'back' : 'front'} view`}
              testID="map-rotate"
              className="items-center justify-center"
              // FIXED figure box: same spot, same size, every card — the
              // focus crop scales the figure INSIDE it, never the card.
              style={{ width: '40%', height: MAP_AREA_HEIGHT, overflow: 'hidden' }}
            >
              <MuscleMap
                selectedMuscles={data.muscles}
                view={mapView}
                // Zoomed (upper/lower) renders ~25% larger than the full view —
                // the crop already trims it, so use the height headroom to make
                // the silhouette read bigger on the card (Tyson 2026-07-17).
                width={focusFor(data.muscles) === 'full' ? MAP_AREA_HEIGHT / 2 : 158}
                pulse
                focus={focusFor(data.muscles)}
              />
            </Pressable>
          </View>
          {/* FOOTER — pinned: progress bar and button sit at the same
              height on every card. */}
          <View style={{ marginTop: 'auto' }}>
            <Text
              className="text-2xs text-text-dim"
              numberOfLines={1}
              allowFontScaling={false}
              style={{ letterSpacing: 0, ...pixelFont(false) }}
              testID={isToday ? 'hero-progress' : `hero-progress-${date}`}
            >
              {data.done} / {data.sets} SETS COMPLETED
            </Text>
            <View
              className="mt-s1 self-stretch overflow-hidden rounded-pill"
              style={{ height: 4, backgroundColor: colors['surface-3'] }}
            >
              <View
                style={{
                  width: `${data.sets > 0 ? Math.min(100, (data.done / data.sets) * 100) : 0}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
          </View>
          <View className="mt-s3">
            <NeonButton
              title={buttonTitle}
              pixel
              onPress={() => open(date, data.workout)}
              rightIcon={
                // The › is system-font beside a pixel-font title; their line
                // boxes differ and the row's center put the glyph visibly low
                // (Tyson 2026-07-19). Pin its line box and lift it onto the
                // title's optical centerline.
                <Text
                  allowFontScaling={false}
                  style={{ color: colors['accent-ink'], fontSize: 16, lineHeight: 16, marginTop: -2, fontWeight: '800' }}
                >
                  ›
                </Text>
              }
              testID={isToday ? 'hero-start' : `hero-start-${date}`}
            />
          </View>
        </View>
      </GlowCard>
      </View>
    );
  };

  /** EDIT on a locked bar: unlock AND go in. One tap from bar to editing is what
   *  a soft lock has to mean, or it is just a wall. */
  const editLocked = (date: string, workout: string) => {
    const marker = (sessions.data ?? []).find((m) => m.date === date && m.workout === workout);
    if (marker) reopenWorkout.mutate(marker);
    open(date, workout);
  };

  const startEmpty = () => {
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
    const err = adhocNameError(adhocName, taken);
    if (err !== null) {
      useToastStore.getState().push({ kind: 'error', title: 'PICK ANOTHER NAME', subtitle: err });
      return;
    }
    const name = adhocName.trim();
    startAdhoc({ name, exercises: adhocPicks });
    setAdhocName('');
    setAdhocPicks([]);
    setEmptyOpen(false);
    open(todayIso, name);
  };

  /** PREFILL RECOMMENDED (Tyson, 2026-07-19): one tap seeds the QUICK WORKOUT
   *  with the exercises the athlete would most likely pick — the SAME corpus +
   *  ranking engine the search bar runs on. If they typed a name we can read a
   *  muscle from (e.g. "Chest Day"), it drives SUGGESTED FOR TODAY; otherwise it
   *  falls back to POPULAR staples. Only ADDS — never eats a pick already made. */
  const prefillAdhoc = () => {
    const corpus = buildCorpus(
      {
        userExercises: userExercises.data,
        prefRows: exercisePrefs.data,
        workoutRows: workouts.data,
      },
      { programExercises: [], excludeNames: adhocPicks.map((p) => p.exercise) }
    );
    const guessed = adhocName.trim() ? inferMuscleGroup(adhocName.trim()) : null;
    const sections = buildSections({
      library: corpus.library,
      program: [],
      history: corpus.history,
      favourites: corpus.context.favourites,
      hidden: corpus.context.hidden,
      targetMuscles: new Set(guessed ? [guessed] : []),
      alreadyAdded: new Set(adhocPicks.map((p) => p.exercise.toLowerCase())),
    });
    const names: string[] = [];
    for (const key of ['suggested', 'popular']) {
      const sec = sections.find((s) => s.key === key);
      if (sec) for (const e of sec.exercises) if (!names.includes(e.name)) names.push(e.name);
    }
    const add = names.slice(0, 6);
    if (add.length === 0) {
      useToastStore.getState().push({ kind: 'info', title: 'NOTHING TO SUGGEST', subtitle: 'Type a name or search instead.' });
      return;
    }
    setAdhocPicks((cur) => {
      const have = new Set(cur.map((x) => x.exercise));
      return [...cur, ...add.filter((n) => !have.has(n)).map((n) => ({ exercise: n, sets: 3, reps: '8-12' }))];
    });
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

  // Compact icon-left / two-line-text-right quick action (target layout).
  const utilityButton = (
    icon: React.ReactNode,
    label: string,
    subtitle: string,
    onPress: () => void,
    testID: string
  ) => (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      className="flex-1 flex-row items-center rounded-md border px-s2"
      style={{ minHeight: 46, gap: 7, borderColor: colors.border, backgroundColor: colors['surface-2'] }}
    >
      {icon}
      <View style={{ flexShrink: 1 }}>
        <Text
          className="text-text-dim"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 0, ...pixelFont(false) }}
          numberOfLines={2}
        >
          {label.replace(' ', '\n')}
        </Text>
        <Text className="text-text-mute" style={{ fontSize: 8 }} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <ScreenShell>
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
          <View
            className="rounded-lg border p-s1"
            style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(13,21,36,0.6)' }}
          >
            <CompanionMenuButton anim={mode === 1 ? cardioAnim(cardioType) : 'idle'} height={44} />
          </View>
          <Pressable
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel="open profile"
            testID="header-level"
            className="mt-s1 items-center justify-center"
            style={{ minHeight: 24, minWidth: 44 }}
          >
            <Text className="text-2xs text-accent" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
              LV. {forgeProgress.level} ›
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
          cardHeight={CARD_HEIGHT}
          renderDay={renderDayCard}
        />

        {/* The three grey utilities — everything the old pill-row and links did. */}

        {/* The three grey utilities — everything the old pill-row and links did. */}
        <View>
          <View className="flex-row gap-s2">
            {utilityButton(
              <PixelSwap size={17} color={colors['text-dim']} />,
              'CHOOSE/UPLOAD MY WORKOUT',
              'Switch or scan today\u2019s session',
              () => setChangeOpen(true),
              'change-workout'
            )}
            {utilityButton(
              <PixelPlusSquare size={16} color={colors['text-dim']} />,
              'QUICK WORKOUT',
              'Train without a plan',
              () => setEmptyOpen(true),
              'start-empty'
            )}
            {utilityButton(
              <PixelPencil size={16} color={colors['text-dim']} />,
              'EDIT SCHEDULE',
              'Set your training week',
              () => router.push('/schedule' as never),
              'edit-week'
            )}
          </View>
          <View className="mt-s2 flex-row items-center" style={{ gap: 6, paddingLeft: 6 }}>
            <PixelCurvedArrow size={16} color={colors.accent} />
            <Text className="text-2xs text-accent" style={{ flexShrink: 1 }}>
              Switch between My Plan, AI Plan or the EvoForge Plan
            </Text>
          </View>
        </View>

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
                className="items-center justify-center"
                style={{ minHeight: 28 }}
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
        <CardioDashboard type={cardioType} setType={setCardioType} />
      </View>

      {/* CHANGE WORKOUT — the one source switcher, plus every plan door. */}
      {changeOpen ? (
        <Modal transparent animationType="fade" onRequestClose={() => setChangeOpen(false)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setChangeOpen(false)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: 560 }}
            >
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                CHOOSE OR UPLOAD MY WORKOUT
              </Text>
              {([0, 1, 2] as SourceIndex[]).map((i) => {
                const label = SOURCE_LABEL[i];
                const empty = (i === 0 && !sources.has.myPlan) || (i === 1 && !sources.has.aiPlan);
                const active = i === source;
                const hint =
                  i === 0
                    ? sources.has.myPlan
                      ? 'Your scheduled workouts'
                      : 'Nothing saved yet — create one below'
                    : i === 1
                      ? sources.has.aiPlan
                        ? 'Personalised by EvoForge'
                        : 'Not forged yet — create one below'
                      : 'Ready-made training program';
                return (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setSource(i);
                      savePref.mutate(i); // fire-and-forget; error toast covers a failed sync
                      setChangeOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`today-source-${i}`}
                    className="mb-s2 rounded-md border px-s3 py-s2"
                    style={{
                      minHeight: 52,
                      justifyContent: 'center',
                      borderColor: active ? `${colors.accent}8c` : colors.border,
                      backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                      opacity: empty && !active ? 0.65 : 1,
                    }}
                  >
                    <Text
                      className="text-2xs font-bold"
                      style={{ letterSpacing: 1, color: active ? colors.accent : colors.text }}
                    >
                      {active ? '✓ ' : ''}
                      {label}
                    </Text>
                    <Text className="text-2xs text-text-mute">{hint}</Text>
                  </Pressable>
                );
              })}

              <View className="mt-s2" style={{ gap: 8 }}>
                {scanRow('change-scan')}
                <Pressable
                  accessibilityRole="button"
                  testID={sources.has.myPlan ? 'build-routine' : 'create-my-plan'}
                  onPress={() => {
                    setChangeOpen(false);
                    router.push('/routine' as never);
                  }}
                  className="items-center"
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <View className="items-center">
                    <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
                      ⚒ {sources.has.myPlan ? 'EDIT PLAN' : 'CREATE PLAN'} →
                    </Text>
                    <Text className="text-2xs text-text-mute">Manage your scheduled workouts</Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID="forge-ai-plan"
                  onPress={() => {
                    setChangeOpen(false);
                    router.push('/ai' as never);
                  }}
                  className="items-center"
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <View className="items-center">
                    <Text className="text-2xs font-bold text-epic" style={{ letterSpacing: 1.5 }}>
                      ✦ CREATE AI PLAN →
                    </Text>
                    <Text className="text-2xs text-text-mute">Forge a program around your goals</Text>
                  </View>
                </Pressable>
              </View>

              <View className="mt-s2">
                <NeonButton title="CANCEL" variant="ghost" onPress={() => setChangeOpen(false)} testID="change-close" />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Start a workout the plan never heard of. */}
      {emptyOpen ? (
        <Modal transparent animationType="fade" onRequestClose={() => setEmptyOpen(false)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setEmptyOpen(false)}>
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
                placeholder="Workout name (optional)"
                placeholderTextColor="#64758f"
                value={adhocName}
                onChangeText={setAdhocName}
                maxLength={40}
                testID="adhoc-name"
              />
              {/* One tap fills it with recommended exercises (name it first for a
                  muscle-matched set; otherwise popular staples). */}
              <Pressable
                onPress={prefillAdhoc}
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
                    setAdhocPicks((p) =>
                      p.some((x) => x.exercise === e.name)
                        ? p
                        : [...p, { exercise: e.name, sets: 3, reps: '8-12' }]
                    )
                  }
                  excludeNames={adhocPicks.map((p) => p.exercise)}
                  placeholder="Choose exercises (optional)"
                  testIDPrefix="adhoc-search"
                />
              </View>
              {adhocPicks.length > 0 ? (
                <View className="mt-s2 flex-row flex-wrap gap-s2">
                  {adhocPicks.map((p) => (
                    <Pressable
                      key={p.exercise}
                      onPress={() => setAdhocPicks((cur) => cur.filter((x) => x.exercise !== p.exercise))}
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
                <NeonButton title="START WORKOUT" pixel onPress={startEmpty} testID="adhoc-start" />
                <Text className="mt-s1 text-center text-2xs text-text-mute">Add exercises as you train</Text>
              </View>

              {(routines.data ?? []).length > 0 ? (
                <View className="mt-s4">
                  <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                    MY ROUTINES
                  </Text>
                  <ScrollView style={{ maxHeight: 240 }}>
                    {(routines.data ?? []).map((r) => (
                      <View key={r.id} className="mb-s2 flex-row items-center gap-s2">
                        <Pressable
                          onPress={() => startRoutine(r.name, r.payload?.exercises ?? [])}
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
                          onPress={() => deleteRoutine.mutate(r.id)}
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
                <NeonButton title="CANCEL" variant="ghost" onPress={() => setEmptyOpen(false)} testID="adhoc-close" />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </ScreenShell>
  );
}
