import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { useBodyweightLog, useProfile, useWorkoutLog } from '@/data/hooks';
import { useUserExercises } from '@/data/exercises';
import { useDeleteRoutine, useRoutines } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
import { useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { BUILT_IN_DAYS, useDayPlan } from '@/data/use-day-plan';
import { FEMALE_CALIBRATION, MALE_CALIBRATION } from '@/domain/avatar-stats-calc';
import { CARDIO_TYPES } from '@/domain/cardio';
import { daysForSource, defaultSource, type SourceIndex } from '@/domain/plan-sources';
import { pyFloat } from '@/domain/py';
import { adhocNameError, type SessionExercise } from '@/domain/session-plan';
import { normaliseWorkoutLog } from '@/domain/summary';
import { todayIso as calendarToday } from '@/domain/today';
import { buildWeekBars, extraBarsForToday, scheduledDayFor } from '@/domain/week-status';
import { estimateKcal, estimateMinutes, musclePillsFor, splitWorkoutName } from '@/domain/workout-estimates';
import { adhocOf, useSessionStore } from '@/state/session-store';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { CardioCard, cardioAnim } from '@/ui/cardio-logger';
import { CompanionMenuButton } from '@/ui/companion-menu';
import { ExerciseSearchBar } from '@/ui/exercise-search-bar';
import { MusclePixelMap } from '@/ui/muscle-pixel-map';
import { Chip, NeonButton } from '@/ui/neon-button';
import { PixelCurvedArrow, PixelDumbbell, PixelHeart, PixelPencil, PixelPlusSquare, PixelSwap } from '@/ui/pixel-icons';
import { ScreenHeader } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';
import { GlowCard, ScreenShell } from '@/ui/shell';
import { WeekBarRow } from '@/ui/week-bar';

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

const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function TodayScreen() {
  const todayIso = calendarToday();

  const workouts = useWorkoutLog();
  const schedule = useWorkoutSchedule();
  const sessions = useWorkoutSessions();
  const reopenWorkout = useReopenWorkout();
  const routines = useRoutines();
  const deleteRoutine = useDeleteRoutine();
  const profile = useProfile();
  const bodyweights = useBodyweightLog();
  const userExercises = useUserExercises();
  const { sources, resolveDay } = useDayPlan();
  const { width } = useWindowDimensions();

  const adhoc = useSessionStore(adhocOf);
  const startAdhoc = useSessionStore((s) => s.startAdhoc);

  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);
  const [sourceChoice, setSource] = useState<SourceIndex | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [adhocName, setAdhocName] = useState('');
  // Exercises picked in the sheet BEFORE starting — they seed the ad-hoc.
  const [adhocPicks, setAdhocPicks] = useState<SessionExercise[]>([]);

  const source: SourceIndex = sourceChoice ?? defaultSource(sources);
  const planDays = daysForSource(source, sources, BUILT_IN_DAYS);

  const allRows = normaliseWorkoutLog(workouts.data ?? []);

  /** How much of a day is done: sets logged vs sets the plan asks for. The plan
   *  is read from the SAME source the door will open, so the hub and the page
   *  can never disagree about what the day contains. `trained` is the separate
   *  any-valid-set signal week-status derives history from — an athlete who
   *  swapped every exercise has done=0 against the plan but still trained. */
  const setsFor = (date: string, workout: string | null): { done: number; target: number; trained: boolean } => {
    if (!workout) return { done: 0, target: 0, trained: false };
    const dayRows = allRows.filter(
      (r) =>
        String(r.date) === date &&
        String(r.workout) === workout &&
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
    );
    const entries = resolveDay(workout, source).entries;
    const target = entries.reduce((n, [, sets]) => n + sets, 0);
    const done = entries.reduce((n, [exercise, sets]) => {
      const logged = dayRows.filter((r) => String(r.exercise) === exercise).length;
      return n + Math.min(logged, sets);
    }, 0);
    return { done, target, trained: dayRows.length > 0 };
  };

  const weekBars = buildWeekBars(schedule.data ?? [], sessions.data ?? [], setsFor, todayIso);
  const scheduledToday = scheduledDayFor(todayIso, schedule.data ?? []);
  // Ad-hoc and off-schedule workouts get their own bar — otherwise finishing one
  // leaves it with no home on Train: green nowhere, reachable nowhere.
  const extraBars = extraBarsForToday(
    workouts.data ?? [],
    sessions.data ?? [],
    adhoc?.name ?? null,
    scheduledToday,
    todayIso,
    setsFor
  );

  /** THE HERO DAY: today's scheduled workout, else the active ad-hoc, else the
   *  next scheduled session (labelled REST DAY · NEXT UP), else the first day
   *  of the current source — the briefing always briefs SOMETHING. */
  let heroWorkout: string | null = scheduledToday;
  let heroKicker = 'TODAY';
  if (!heroWorkout && adhoc?.name) {
    heroWorkout = adhoc.name;
    heroKicker = 'IN PROGRESS';
  }
  if (!heroWorkout) {
    for (let i = 1; i <= 7 && !heroWorkout; i++) {
      const next = scheduledDayFor(addDaysIso(todayIso, i), schedule.data ?? []);
      if (next) {
        heroWorkout = next;
        heroKicker = 'REST DAY · NEXT UP';
      }
    }
  }
  if (!heroWorkout) {
    heroWorkout = planDays[0] ?? null;
    heroKicker = 'FROM YOUR PLAN';
  }

  const heroEntries = heroWorkout ? resolveDay(heroWorkout, source).entries : [];
  const heroName = splitWorkoutName(heroWorkout ?? '');
  const heroPills = musclePillsFor(heroEntries, userExercises.data ?? []);
  const heroSets = heroEntries.reduce((n, [, sets]) => n + sets, 0);
  const heroMinutes = estimateMinutes(heroSets);
  // Bodyweight for the kcal estimate: profile snapshot → latest logged reading
  // → the sex-calibrated default (the avatar-stats fallback pattern).
  const positiveBw = (bodyweights.data ?? []).map((r) => pyFloat(r.bodyweight) ?? 0).filter((v) => v > 0);
  const bodyweightKg =
    (pyFloat(profile.data?.bodyweight_kg) ?? 0) > 0
      ? (pyFloat(profile.data?.bodyweight_kg) as number)
      : positiveBw.length > 0
        ? positiveBw[positiveBw.length - 1]
        : (profile.data?.sex === 'female' ? FEMALE_CALIBRATION : MALE_CALIBRATION).defaultBodyweight;
  const heroKcal = estimateKcal(heroSets, bodyweightKg);
  const heroDone = heroWorkout ? setsFor(todayIso, heroWorkout).done : 0;
  // Compact screens (320px class): the muscle map stacks beneath the stats
  // instead of squeezing the text column.
  const stackMap = width < 360;

  /** The ONE entry path into a workout — and the SOURCE goes with it. Without
   *  that, the workout page had to guess whose plan you meant, and guessed the
   *  same way every time (whichever plan held the day name). */
  const open = (date: string, workout: string) =>
    router.push(
      `/workout?date=${encodeURIComponent(date)}&workout=${encodeURIComponent(
        workout
      )}&source=${source}` as never
    );

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
      style={{ minHeight: 48, gap: 8, borderColor: `${tokens.colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.07)' }}
    >
      <Text className="text-base">📷</Text>
      <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
        SCAN A WRITTEN WORKOUT
      </Text>
    </Pressable>
  );

  const utilityButton = (
    icon: React.ReactNode,
    label: string,
    onPress: () => void,
    testID: string
  ) => (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      className="flex-1 items-center justify-center rounded-xl border px-s2 py-s2"
      style={{ minHeight: 56, gap: 5, borderColor: tokens.colors.border, backgroundColor: tokens.colors['surface-2'] }}
    >
      {icon}
      <Text className="text-center text-2xs font-bold text-text-dim" style={{ letterSpacing: 0.5 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={`TODAY · ${todayIso}`}
        title={mode === 1 ? 'CARDIO' : 'TRAIN'}
        hero
        right={<CompanionMenuButton anim={mode === 1 ? cardioAnim(cardioType) : 'idle'} height={56} />}
      />

      <SegmentedTabs
        left="LIFT"
        right="CARDIO"
        active={mode}
        onChange={setMode}
        testIDPrefix="today-mode"
        leftIcon={<PixelDumbbell size={14} color={mode === 0 ? tokens.colors.accent : tokens.colors['text-dim']} />}
        rightIcon={<PixelHeart size={14} color={mode === 1 ? tokens.colors.accent : tokens.colors['text-dim']} />}
      />

      <View style={{ display: mode === 0 ? 'flex' : 'none', gap: 16 }}>
        {/* THE HERO — today's briefing. */}
        {heroWorkout ? (
          <GlowCard glow={tokens.colors.accent}>
            <View testID="hero-card">
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                {heroKicker}
              </Text>
              <View className={stackMap ? '' : 'flex-row'} style={{ gap: 14 }}>
                <View className="items-center" style={stackMap ? {} : { flex: 2, minWidth: 0 }}>
                  <Text className="text-center text-2xl font-bold text-text" numberOfLines={2}>
                    {heroName.title}
                  </Text>
                  {heroName.sub ? (
                    <Text className="mt-s1 text-center text-sm text-text-dim">{heroName.sub}</Text>
                  ) : null}
                  {heroPills.length > 0 ? (
                    <View className="mt-s3 flex-row flex-wrap justify-center gap-s2">
                      {heroPills.map((p) => (
                        <View
                          key={p}
                          className="rounded-pill border bg-surface-2 px-s3 py-s1"
                          style={{ borderColor: tokens.colors.border }}
                        >
                          <Text className="text-center text-2xs font-bold text-text-dim">{p}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {/* ≈ marks estimates — honest numbers only. */}
                  <View className="mt-s3 flex-row justify-center" style={{ gap: 18 }}>
                    {[
                      [String(heroSets), 'SETS'],
                      [`≈${heroMinutes}`, 'MIN'],
                      [`≈${heroKcal}`, 'KCAL'],
                    ].map(([value, label]) => (
                      <View key={label} className="items-center">
                        <Text className="text-lg font-bold text-text">{value}</Text>
                        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
                          {label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
                <View className="items-center justify-center" style={stackMap ? { marginTop: 10 } : { flex: 1 }}>
                  <MusclePixelMap targeted={new Set(heroPills)} height={stackMap ? 132 : 156} />
                </View>
              </View>
              {/* THE most visually prominent element on the page. */}
              <View className="mt-s4">
                <NeonButton
                  title={heroDone > 0 ? 'RESUME WORKOUT' : 'START WORKOUT'}
                  size="hero"
                  onPress={() => heroWorkout && open(todayIso, heroWorkout)}
                  testID="hero-start"
                />
              </View>
            </View>
          </GlowCard>
        ) : null}

        {/* The three grey utilities — everything the old pill-row and links did. */}
        <View>
          <View className="flex-row gap-s2">
            {utilityButton(
              <PixelSwap size={17} color={tokens.colors['text-dim']} />,
              'CHANGE WORKOUT',
              () => setChangeOpen(true),
              'change-workout'
            )}
            {utilityButton(
              <PixelPlusSquare size={16} color={tokens.colors['text-dim']} />,
              'EMPTY WORKOUT',
              () => setEmptyOpen(true),
              'start-empty'
            )}
            {utilityButton(
              <PixelPencil size={16} color={tokens.colors['text-dim']} />,
              'EDIT MY WEEK',
              () => router.push('/schedule' as never),
              'edit-week'
            )}
          </View>
          <View className="mt-s2 flex-row items-center" style={{ gap: 6, paddingLeft: 6 }}>
            <PixelCurvedArrow size={16} color={tokens.colors.accent} />
            <Text className="text-2xs text-accent" style={{ flexShrink: 1 }}>
              Switch between My Plan, AI Plan or Built-in
            </Text>
          </View>
        </View>

        {/* THIS WEEK — the doors. */}
        {weekBars ? (
          <View>
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              THIS WEEK
            </Text>
            {weekBars.map((bar) => (
              <WeekBarRow
                key={bar.date}
                bar={bar}
                onOpen={() => bar.workout && open(bar.date, bar.workout)}
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
        <CardioCard type={cardioType} setType={setCardioType} />
      </View>

      {/* CHANGE WORKOUT — the one source switcher, plus every plan door. */}
      {changeOpen ? (
        <Modal transparent animationType="fade" onRequestClose={() => setChangeOpen(false)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setChangeOpen(false)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 560 }}
            >
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                CHANGE WORKOUT
              </Text>
              {([0, 1, 2] as SourceIndex[]).map((i) => {
                const label = i === 0 ? 'MY PLAN' : i === 1 ? 'AI PLAN' : 'BUILT-IN';
                const empty = (i === 0 && !sources.has.myPlan) || (i === 1 && !sources.has.aiPlan);
                const active = i === source;
                const hint =
                  i === 0
                    ? sources.has.myPlan
                      ? 'Your own days'
                      : 'Nothing saved yet — create one below'
                    : i === 1
                      ? sources.has.aiPlan
                        ? 'The plan the AI forged for you'
                        : 'Not forged yet — the door is below'
                      : 'The six-day EvoForge routine';
                return (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setSource(i);
                      setChangeOpen(false);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`today-source-${i}`}
                    className="mb-s2 rounded-md border px-s3 py-s2"
                    style={{
                      minHeight: 52,
                      justifyContent: 'center',
                      borderColor: active ? `${tokens.colors.accent}8c` : tokens.colors.border,
                      backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                      opacity: empty && !active ? 0.65 : 1,
                    }}
                  >
                    <Text
                      className="text-2xs font-bold"
                      style={{ letterSpacing: 1, color: active ? tokens.colors.accent : tokens.colors.text }}
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
                  <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
                    ⚒ {sources.has.myPlan ? 'EDIT MY PLAN' : 'CREATE MY PLAN'} →
                  </Text>
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
                  <Text className="text-2xs font-bold text-epic" style={{ letterSpacing: 1.5 }}>
                    ✦ FORGE AN AI PLAN →
                  </Text>
                </Pressable>
              </View>

              <View className="mt-s2">
                <NeonButton title="CLOSE" variant="ghost" onPress={() => setChangeOpen(false)} testID="change-close" />
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
              style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 560 }}
            >
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                START A WORKOUT
              </Text>
              <TextInput
                className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
                style={{ borderColor: tokens.colors.border }}
                placeholder="Name it — e.g. Beach Day"
                placeholderTextColor="#64758f"
                value={adhocName}
                onChangeText={setAdhocName}
                maxLength={40}
                testID="adhoc-name"
              />
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
                  placeholder="Add exercises now (optional)…"
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
                        borderColor: `${tokens.colors.success}8c`,
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
                <NeonButton title="START EMPTY WORKOUT" onPress={startEmpty} testID="adhoc-start" />
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
                <NeonButton title="CLOSE" variant="ghost" onPress={() => setEmptyOpen(false)} testID="adhoc-close" />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </ScreenShell>
  );
}
