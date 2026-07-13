import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useCustomPlan, useWorkoutLog } from '@/data/hooks';
import { useClaimCoin } from '@/data/coins';
import { useDeleteRoutine, useRoutines, useSaveRoutine } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
import { useFinishWorkout, useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { useUserPlans } from '@/data/user-plans';
import {
  daysForSource,
  defaultSource,
  resolvePlanSources,
  type SourceIndex,
} from '@/domain/plan-sources';
import { useAvatarData } from '@/data/use-avatar-data';
import { CARDIO_TYPES } from '@/domain/cardio';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat, pyInt } from '@/domain/py';
import {
  adhocNameError,
  buildEffectivePlan,
  canAddSet,
  canRemoveSet,
  planTotals,
  removeAction,
  type LoggedFacts,
  type PlanEntry,
  type SessionExercise,
} from '@/domain/session-plan';
import { activeWorkout, adhocOf, overridesFor, useSessionStore } from '@/state/session-store';
import { useToastStore } from '@/state/toast-store';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { nextScheduledSession } from '@/domain/scheduled-streak';
import { computeStreak } from '@/domain/streak';
import { buildWeekBars } from '@/domain/week-status';
import { normaliseWorkoutLog } from '@/domain/summary';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { Link } from 'expo-router';

import { substitutesFor } from '@/domain/exercise-library';
import { CardioCard, cardioAnim } from '@/ui/cardio-logger';
import { RestTimerBar } from '@/ui/rest-timer';
import { ExerciseCard } from '@/ui/exercise-logger';
import { ExercisePicker } from '@/ui/exercise-picker';
import { schemeSentence } from '@/ui/scheme-sentence';
import { WeekBarRow } from '@/ui/week-bar';
import { Chip, NeonButton } from '@/ui/neon-button';
import { SummarySheet, type WorkoutSummaryData } from '@/ui/summary-sheet';
import { ScreenHeader } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';
import { CompanionMenuButton } from '@/ui/companion-menu';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * Today: the logging loop. Saves go through useSaveSet -- an edit updates in
 * place (never re-granting XP) and only a new set announces. Set pips per
 * exercise, the day bar, WORKOUT COMPLETE once per (day,date), FINISH EARLY
 * with an honest summary.
 */
/** The app's own six-day routine. Static — derived from a generated catalog. */
const BUILT_IN_DAYS: readonly string[] = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);

export default function TodayScreen() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const builtInDays = BUILT_IN_DAYS;
  const [dayChoice, setDay] = useState(BUILT_IN_DAYS[0]);

  // TYSON 2026-07-14: THREE sources — MY PLAN · AI PLAN · BUILT-IN, in that
  // order. They used to be two, because the hand-built split and the AI plan
  // shared one database slot and overwrote each other (migration 018 split
  // them). Every source drives its OWN day list; logging is source-agnostic.
  const legacyPlan = useCustomPlan(); // custom_workout_plan — the pre-018 slot
  const userPlans = useUserPlans();
  const sources = resolvePlanSources({
    customPlan: userPlans.data?.custom ?? null,
    aiPlan: userPlans.data?.ai ?? null,
    legacyPlan: legacyPlan.data ?? null,
    builtInDays: BUILT_IN_DAYS,
  });

  const [sourceChoice, setSource] = useState<SourceIndex | null>(null);
  // Until the athlete picks, open on what they meant to train (their plan, else
  // the AI's, else built-in) — and never open on an empty tab.
  const source: SourceIndex = sourceChoice ?? defaultSource(sources);
  const planDays = daysForSource(source, sources, builtInDays);

  // STAGE 1: an ad-hoc workout — "just train, name it what I like". It is an
  // EXTRA day chip (visible under BOTH plan sources, because it belongs to
  // neither) and its name becomes workout_log.workout, which is the grouping
  // key for a workout. adhocNameError refuses a name that collides with a day
  // chip: two different workouts merging into one day's math is a silent lie.
  const adhoc = useSessionStore(adhocOf);
  const startAdhoc = useSessionStore((s) => s.startAdhoc);
  const endAdhoc = useSessionStore((s) => s.endAdhoc);
  const days = adhoc ? [...planDays, adhoc.name] : planDays;

  // Clamp at render, not in an effect (react-hooks/set-state-in-effect):
  // switching source can leave the chosen chip outside the new day list —
  // the EFFECTIVE day falls back to the list's first entry, and the raw
  // choice is restored if the athlete toggles back.
  const day = days.includes(dayChoice) ? dayChoice : (days[0] ?? '');
  const onAdhocDay = adhoc !== null && day === adhoc.name;
  // A source the athlete has no plan for. Legitimate — the tab still exists so
  // they can see it is empty and act — but there is no day to log against.
  const noPlan = day === '';
  // Tyson 2026-07-13: session-level exercise substitution (same muscle).
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [subFor, setSubFor] = useState<string | null>(null);
  // STAGE 1: add an exercise the plan never thought of.
  const [pickerOpen, setPickerOpen] = useState(false);
  // STAGE 1: start a workout that isn't in any plan.
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [adhocName, setAdhocName] = useState('');
  const routines = useRoutines();
  const saveRoutine = useSaveRoutine();
  const deleteRoutine = useDeleteRoutine();

  // P2 C3: LIFT | CARDIO mode; cardio type hoisted so the header sprite can
  // train what's being logged (the old log.tsx rationale, relocated).
  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);

  // Tyson 2026-07-14: reopening mid-workout must land on THE WORKOUT, not
  // just on Train. Same one-shot + setTimeout pattern as the scheduled
  // default below (a bare setState in an effect is a lint error here).
  const hydrated = useSessionStore((s) => s._hydrated);
  const active = useSessionStore(activeWorkout);
  const activeDefaultRef = useRef(false);
  useEffect(() => {
    if (activeDefaultRef.current || !hydrated) return;
    activeDefaultRef.current = true;
    if (active === null) return;
    const t = setTimeout(() => setDay(active), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // IMPROVEMENT_PLAN #11: default the day chip to today's SCHEDULED day
  // once a schedule exists; manual override stays (it's just useState).
  const schedule = useWorkoutSchedule();
  const scheduledDefaultRef = useRef(false);
  useEffect(() => {
    if (scheduledDefaultRef.current) return;
    const rows = schedule.data;
    if (!rows || rows.length === 0) return;
    scheduledDefaultRef.current = true;
    // A workout ALREADY UNDERWAY outranks the schedule's suggestion — you are
    // standing in the gym mid-set; the calendar's opinion can wait.
    if (useSessionStore.getState().activeDay !== null) return;
    const t = setTimeout(() => {
      const plan = rows[rows.length - 1].plan;
      const dow = String(new Date(`${todayIso}T00:00:00Z`).getUTCDay());
      const assigned = plan[dow];
      if (assigned && assigned !== 'Rest' && builtInDays.includes(assigned)) setDay(assigned);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.data]);

  const claimCoins = useClaimCoin();
  const workouts = useWorkoutLog();
  // TRAIN_IMPROVEMENTS: the finish marker. `complete` is derived every render,
  // so without this a workout finished early sprang back to life the moment the
  // summary closed. The marker is the athlete's decision, persisted.
  const sessions = useWorkoutSessions();
  const finishWorkout = useFinishWorkout();
  const reopenWorkout = useReopenWorkout();
  const { summary, stats, bfMid } = useAvatarData();
  const [sheet, setSheet] = useState<WorkoutSummaryData | null>(null);
  const prCountRef = useRef(0);
  // P4: which lifts PR'd this session, for the ceremony's reveal phase.
  const prNamesRef = useRef<string[]>([]);
  const todayRows = normaliseWorkoutLog(workouts.data ?? []).filter(
    (r) => String(r.date) === todayIso && String(r.workout) === day
  );

  const validRowsFor = (exercise: string) =>
    todayRows.filter(
      (r) =>
        String(r.exercise) === exercise &&
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
    );

  // STAGE 1: what the log says about an exercise TODAY. maxSetNo counts every
  // RENDERED row (valid or not, queued-optimistic included — they live in the
  // same cache), because "− SET" must never orphan a row the athlete can see.
  const loggedFacts = (exercise: string): LoggedFacts => {
    const rows = todayRows.filter((r) => String(r.exercise) === exercise);
    let maxSetNo = 0;
    for (const r of rows) maxSetNo = Math.max(maxSetNo, pyInt(r.set) ?? 0);
    return { validCount: validRowsFor(exercise).length, maxSetNo };
  };

  // The day's exercises, from whichever source is selected. Same
  // [exercise, sets, scheme] tuple shape either way — an ad-hoc workout's
  // "plan" is simply whatever it was started with (empty, or a routine's).
  const activePlan = source === 0 ? sources.myPlan : source === 1 ? sources.aiPlan : null;
  const planDay = activePlan?.days.find((d) => d.day === day) ?? null;
  const basePlan: readonly (readonly [string, number, string])[] = onAdhocDay
    ? (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets, e.reps] as const)
    : planDay
      ? planDay.exercises.map((e) => [e.exercise, e.sets, e.reps] as const)
      : (ROUTINE[day] ?? []);
  const substituted: PlanEntry[] = basePlan.map(
    ([ex, sets, scheme]) => [subs[`${day}:${ex}`] ?? ex, sets, scheme] as const
  );

  // STAGE 1: the plan the athlete is ACTUALLY looking at — plan + today's
  // adds/removes/skips/set-deltas. All the arithmetic lives in the pure
  // domain module (session-plan.ts), which is where its honesty is tested.
  const overrides = useSessionStore((s) => overridesFor(s, day));
  // Tyson 2026-07-14: a workout in progress reopens itself on a cold start.
  const markActive = useSessionStore((s) => s.markActive);
  const clearActive = useSessionStore((s) => s.clearActive);
  const addExercise = useSessionStore((s) => s.addExercise);
  const removeExercise = useSessionStore((s) => s.removeExercise);
  const toggleSkip = useSessionStore((s) => s.toggleSkip);
  const bumpSets = useSessionStore((s) => s.bumpSets);

  const plan = buildEffectivePlan(substituted, overrides, loggedFacts);
  const totals = planTotals(plan, loggedFacts);
  const totalDone = totals.done;
  const totalTarget = totals.target;
  const complete = totals.complete;
  const nextExercise = totals.nextExercise;

  // TRAIN_IMPROVEMENTS: THIS WEEK as bars. Null when no schedule is in force —
  // the athlete then keeps the day chips, and nothing regresses for them.
  const allRows = normaliseWorkoutLog(workouts.data ?? []);
  const hasValidSets = (date: string, workout: string): boolean =>
    allRows.some(
      (r) =>
        String(r.date) === date &&
        String(r.workout) === workout &&
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
    );
  const weekBars = buildWeekBars(schedule.data ?? [], sessions.data ?? [], hasValidSets, todayIso);
  const [openDate, setOpenDate] = useState<string | null>(null);

  // Is TODAY's workout (date + name) explicitly finished?
  const marker = (sessions.data ?? []).find((m) => m.date === todayIso && m.workout === day) ?? null;
  const finished = marker !== null;

  // Today's bar opens on arrival — it is the workout they came to do. A
  // FINISHED workout collapses instead: the job is done, the list should not
  // still be shouting it at you. It stays openable, and reopening shows the
  // locked recap (Tyson, 2026-07-14).
  const expandedDate = openDate ?? (finished ? 'none' : todayIso);
  /** The LOGGING UI is today's, and only today's. */
  const viewingToday = weekBars === null || expandedDate === todayIso;

  /** The exercises a day is MEANT to hold, from whichever source is selected —
   *  so tapping "Pull 1" shows Pull 1, not a shrug. */
  const exercisesForDay = (workout: string | null): PlanEntry[] => {
    if (!workout) return [];
    const fromPlan = activePlan?.days.find((d) => d.day === workout);
    if (fromPlan) return fromPlan.exercises.map((e) => [e.exercise, e.sets, e.reps] as const);
    return [...(ROUTINE[workout] ?? [])];
  };

  /** ✕ — but a logged exercise degrades to a skip, or the day bar would
   *  contradict the XP already banked beside it. */
  const removeOrSkip = (exercise: string) => {
    const facts = loggedFacts(exercise);
    if (removeAction(facts) === 'skip') {
      toggleSkip(day, exercise);
      useToastStore.getState().push({
        kind: 'info',
        title: 'SKIPPED INSTEAD',
        subtitle: 'Sets already logged — they still count.',
      });
      return;
    }
    removeExercise(day, exercise);
  };


  const buildSummary = (): WorkoutSummaryData => ({
    day,
    setsDone: totalDone,
    setsTarget: totalTarget,
    xpBanked: totalDone * XP_PER_SET,
    prCount: prCountRef.current,
    prExercises: [...new Set(prNamesRef.current)],
    streak: computeStreak(workouts.data ?? [], todayIso).current,
    level: summary.level,
    xpIntoLevel: summary.xpIntoLevel,
    xpNeeded: summary.xpNeeded,
    evolution: nextEvolutionInfo(stats.branch, {
      level: summary.level,
      benchE1rm: stats.benchE1rm,
      bfMid,
      totalSets: summary.totalSets,
      cardioMinutes: summary.cardioMinutes,
    }),
    nextSession: nextScheduledSession(schedule.data ?? [], todayIso),
  });

  const announcedRef = useRef<string | null>(null);
  const sessionKey = `${todayIso}|${day}`;
  const hadDataRef = useRef(false);
  useEffect(() => {
    if (!workouts.data) return;
    if (!hadDataRef.current) {
      hadDataRef.current = true;
      if (complete) announcedRef.current = sessionKey;
      return;
    }
    // A workout already FINISHED never re-announces: the athlete has been
    // through the ceremony, and re-firing it would be the app forgetting.
    if (complete && announcedRef.current !== sessionKey && !finished) {
      announcedRef.current = sessionKey;
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSheet(buildSummary());
      // Coin claim (IMPROVEMENT_PLAN #12): once per date; the 013 guard's
      // 10-valid-set floor and the unique index decide, not this client.
      claimCoins.mutate({ kind: 'workout_complete', sourceId: todayIso });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, sessionKey, workouts.data]);

  const finishEarly = () => {
    setSheet(buildSummary());
  };

  /** What the athlete ACTUALLY did today — the only honest thing to save as a
   *  routine. Sets = what they logged, not what the plan asked for. */
  const performed = (): SessionExercise[] =>
    plan
      .map((e) => ({ exercise: e.exercise, sets: loggedFacts(e.exercise).validCount, reps: e.reps }))
      .filter((e) => e.sets > 0);

  const startEmpty = () => {
    const err = adhocNameError(adhocName, days);
    if (err !== null) {
      useToastStore.getState().push({ kind: 'error', title: 'PICK ANOTHER NAME', subtitle: err });
      return;
    }
    const name = adhocName.trim();
    startAdhoc({ name, exercises: [] });
    setDay(name);
    setAdhocName('');
    setEmptyOpen(false);
  };

  const startRoutine = (routineName: string, exercises: SessionExercise[]) => {
    // A routine's own name may collide with a day chip (they are saved
    // independently); suffix rather than refuse — the athlete asked to train.
    const base = adhocNameError(routineName, days) === null ? routineName : `${routineName} (today)`;
    startAdhoc({ name: base, exercises });
    setDay(base);
    setEmptyOpen(false);
  };

  const dayPct = totalTarget > 0 ? (totalDone / totalTarget) * 100 : 0;


  return (
    <ScreenShell>
      <ScreenHeader
        kicker={`TODAY · ${todayIso}`}
        title={mode === 1 ? 'CARDIO' : noPlan ? 'NO PLAN YET' : day.split(' - ')[0].toUpperCase()}
        right={
          <CompanionMenuButton
            anim={mode === 1 ? cardioAnim(cardioType) : complete ? 'victory' : 'idle'}
            height={56}
          />
        }
      />

      {/* P2 C3: cardio lives on Today. Both panels stay MOUNTED and toggle
          via display style — the keep-mounted pattern from the old log.tsx,
          so half-typed cardio forms AND SetRow state survive mode flips. */}
      <SegmentedTabs left="LIFT" right="CARDIO" active={mode} onChange={setMode} testIDPrefix="today-mode" />

      <View style={{ display: mode === 0 ? 'flex' : 'none', gap: 16 }}>
      <RestTimerBar />
      {/* TYSON 2026-07-14: MY PLAN · AI PLAN · BUILT-IN, in that order. A source
          with nothing behind it is still offered — tapping it says what to do
          about that, which beats hiding the tab and leaving the athlete to
          wonder where their plan went. */}
      <View className="flex-row gap-s2">
        {([0, 1, 2] as SourceIndex[]).map((i) => {
          const label = i === 0 ? 'MY PLAN' : i === 1 ? 'AI PLAN' : 'BUILT-IN';
          const empty = (i === 0 && !sources.has.myPlan) || (i === 1 && !sources.has.aiPlan);
          const active = i === source;
          return (
            <Pressable
              key={label}
              onPress={() => setSource(i)}
              accessibilityRole="button"
              testID={`today-source-${i}`}
              className="flex-1 items-center justify-center rounded-pill border px-s2"
              style={{
                minHeight: 44,
                borderColor: active ? `${tokens.colors.accent}8c` : tokens.colors.border,
                backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                opacity: empty && !active ? 0.55 : 1,
              }}
            >
              <Text
                className="text-2xs font-bold"
                style={{ letterSpacing: 1, color: active ? tokens.colors.accent : tokens.colors['text-dim'] }}
                numberOfLines={1}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* The selected source has no plan behind it — say what to do. */}
      {source === 0 && !sources.has.myPlan ? (
        <Link href={'/routine' as never} asChild>
          <Pressable accessibilityRole="button" testID="create-my-plan" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              ⚒ CREATE MY PLAN →
            </Text>
          </Pressable>
        </Link>
      ) : null}
      {source === 1 && !sources.has.aiPlan ? (
        <Link href={'/ai' as never} asChild>
          <Pressable accessibilityRole="button" testID="forge-ai-plan" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-2xs font-bold text-epic" style={{ letterSpacing: 1.5 }}>
              ✦ FORGE AN AI PLAN →
            </Text>
          </Pressable>
        </Link>
      ) : null}
      {/* Always reachable: building a plan should never require emptying one. */}
      {sources.has.myPlan ? (
        <Link href={'/routine' as never} asChild>
          <Pressable accessibilityRole="button" testID="build-routine" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
              ⚒ EDIT MY PLAN →
            </Text>
          </Pressable>
        </Link>
      ) : null}

      {/* STAGE 1: train something the plan never heard of. */}
      {!adhoc ? (
        <Pressable
          accessibilityRole="button"
          testID="start-empty"
          onPress={() => setEmptyOpen(true)}
          className="items-center"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
            ＋ START AN EMPTY WORKOUT
          </Text>
        </Pressable>
      ) : null}

      {/* THIS WEEK — one bar per day, with the truth on the right. */}
      {weekBars ? (
        <View>
          <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            THIS WEEK
          </Text>
          {weekBars.map((bar) => (
            <WeekBarRow
              key={bar.date}
              bar={bar}
              expanded={expandedDate === bar.date && bar.status !== 'rest'}
              onToggle={() => {
                // 'none' = everything collapsed (distinct from null = "not yet
                // chosen", which opens today).
                const collapsing = expandedDate === bar.date;
                setOpenDate(collapsing ? 'none' : bar.date);
                // ONLY today's bar drives the logging column. The cards log to
                // todayIso — repointing them at a past bar would write today's
                // date under last Tuesday's name.
                if (!collapsing && bar.date === todayIso && bar.workout) setDay(bar.workout);
              }}
            >
              {bar.date === todayIso ? undefined : (
                <DayPanel
                  rows={allRows}
                  date={bar.date}
                  workout={bar.workout}
                  planned={exercisesForDay(bar.workout)}
                />
              )}
            </WeekBarRow>
          ))}
          <Link href={'/schedule' as never} asChild>
            <Pressable accessibilityRole="button" testID="edit-week" className="mt-s1 items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
                ◫ EDIT MY WEEK →
              </Text>
            </Pressable>
          </Link>
        </View>
      ) : (
        <Link href={'/schedule' as never} asChild>
          <Pressable accessibilityRole="button" testID="set-your-week" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              ◫ SET YOUR WEEK →
            </Text>
          </Pressable>
        </Link>
      )}

      {noPlan || !viewingToday ? null : (
      <GlowCard glow={complete ? tokens.colors.success : undefined}>
        {/* The chips remain the day picker for athletes with no schedule; with
            a schedule, the week bars above choose the day and the chips are
            redundant noise. */}
        {weekBars ? null : (
          <View className="mb-s4 flex-row flex-wrap gap-s2">
            {days.map((d) => (
              <Chip key={d} label={d} active={d === day} onPress={() => setDay(d)} />
            ))}
          </View>
        )}

        <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
          <View
            style={{
              width: `${dayPct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: complete ? tokens.colors.success : tokens.colors.accent,
              minWidth: totalDone > 0 ? 4 : 0,
              shadowColor: complete ? tokens.colors.success : tokens.colors.accent,
              shadowOpacity: 0.5,
              shadowRadius: 8,
            }}
          />
        </View>
        <View className="mt-s2 flex-row justify-between">
          <Text className={`text-2xs font-bold ${complete ? 'text-success' : 'text-text-mute'}`} style={{ letterSpacing: 1.5 }}>
            {complete ? '✓ ALL SETS COMPLETE' : `${totalDone} / ${totalTarget} SETS`}
          </Text>
          <Text className="text-2xs font-bold text-accent">+{totalDone * XP_PER_SET} XP TODAY</Text>
        </View>
      </GlowCard>
      )}

      {noPlan || !viewingToday ? null : plan.map((entry) => {
        const { exercise, sets, reps, skipped } = entry;
        const facts = loggedFacts(exercise);
        return (
          <ExerciseCard
            // Day is part of the key: ROUTINE reuses exercise names across days
            // (e.g. Lat Pulldown on both Pull days), and SetRow seeds its typed
            // state once on mount — a same-key day switch kept the previous
            // day's numbers on screen and saved them under the NEW day.
            key={`${day}:${exercise}`}
            date={todayIso}
            workout={day}
            exercise={exercise}
            targetSets={sets}
            scheme={reps}
            loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
            allRows={workouts.data ?? []}
            doneCount={facts.validCount}
            isNext={exercise === nextExercise}
            onPr={() => {
              prCountRef.current += 1;
              prNamesRef.current.push(exercise);
            }}
            // A banked set means a workout is UNDERWAY — that is what a cold
            // start reopens to. (Marking on every logged set, not just the
            // first, keeps it correct if the athlete switches day chips.)
            onLogged={() => markActive(day)}
            durable
            // A finished workout is READ-ONLY (a UX lock, not a security one —
            // the XP contract already makes an edit grant nothing). REOPEN
            // unlocks it, because a fat-fingered FINISH must be recoverable.
            readOnly={finished}
            onSubstitute={finished ? undefined : () => setSubFor(exercise)}
            skipped={skipped}
            onRemove={finished ? undefined : () => removeOrSkip(exercise)}
            onSkip={finished ? undefined : () => toggleSkip(day, exercise)}
            onAddSet={!finished && canAddSet(sets) ? () => bumpSets(day, exercise, 1) : undefined}
            // Absent, not disabled, at the floor — the row below it is logged.
            onRemoveSet={
              !finished && canRemoveSet(sets, facts) ? () => bumpSets(day, exercise, -1) : undefined
            }
          />
        );
      })}

      {/* STAGE 1: the plan is a suggestion, not a cage. */}
      {noPlan || finished || !viewingToday ? null : (
        <NeonButton
          title="＋ ADD EXERCISE"
          variant="ghost"
          onPress={() => setPickerOpen(true)}
          testID="add-exercise"
        />
      )}

      {/* FINISHED — locked, with the hatch. */}
      {finished && viewingToday ? (
        <View
          className="flex-row items-center justify-between rounded-xl p-s4"
          style={{
            borderWidth: 1,
            borderColor: `${tokens.colors.success}66`,
            backgroundColor: 'rgba(52,211,153,0.06)',
          }}
        >
          <View className="flex-1">
            <Text className="text-2xs font-bold" style={{ color: tokens.colors.success, letterSpacing: 2 }}>
              ✓ WORKOUT COMPLETE
            </Text>
            <Text className="text-2xs text-text-mute">
              {totalDone}/{totalTarget} sets · locked
            </Text>
          </View>
          <Pressable
            onPress={() => marker && reopenWorkout.mutate(marker.id)}
            accessibilityRole="button"
            testID="reopen-workout"
            className="items-center justify-center px-s3"
            style={{ minHeight: 44 }}
          >
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              REOPEN
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!finished && viewingToday && totalDone > 0 && !complete ? (
        <NeonButton
          title={`FINISH WORKOUT · ${totalDone}/${totalTarget} SETS`}
          variant="ghost"
          onPress={finishEarly}
          testID="finish-workout"
        />
      ) : null}

      {onAdhocDay ? (
        <Pressable
          accessibilityRole="button"
          testID="end-adhoc"
          onPress={() => {
            endAdhoc();
            clearActive();
            setDay(planDays[0] ?? BUILT_IN_DAYS[0]);
          }}
          className="items-center"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
            END “{adhoc?.name}”
          </Text>
        </Pressable>
      ) : null}
      </View>

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(e) => {
          addExercise(day, { exercise: e.name, sets: 3, reps: '8-12' });
          setPickerOpen(false);
        }}
        excludeNames={plan.map((p) => p.exercise)}
        // The day being trained: drives IN YOUR PROGRAM, the target muscles,
        // and therefore SUGGESTED FOR TODAY and the ranking.
        programExercises={plan.map((p) => p.exercise)}
      />

      <View style={{ display: mode === 1 ? 'flex' : 'none', gap: 16 }}>
        <CardioCard type={cardioType} setType={setCardioType} />
      </View>
      <SummarySheet
        data={sheet}
        onClose={() => {
          // Closing without finishing (KEEP TRAINING / SKIP) leaves the workout
          // open — but it is no longer the thing a cold start reopens into,
          // because the athlete has seen their summary and moved on.
          setSheet(null);
          clearActive();
        }}
        // THE FIX: this writes the marker. Finishing now STICKS.
        onFinish={() => {
          finishWorkout.mutate({ date: todayIso, workout: day });
          clearActive();
          // The job is done — close the day. It stays openable (the bar is
          // still there), it just stops shouting at you. An explicit collapse,
          // because the athlete had OPENED it by hand and that choice would
          // otherwise outrank the finished default.
          setOpenDate('none');
        }}
        // STAGE 1: save what you actually did, to do again. Never writes
        // custom_workout_plan — a routine is a workout, not a split.
        onSaveRoutine={
          performed().length > 0
            ? (name) => saveRoutine.mutate({ name, exercises: performed() })
            : undefined
        }
        defaultRoutineName={day}
      />

      {/* STAGE 1: the empty-workout sheet — name it, or start a saved routine. */}
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

      {/* Substitution sheet: same-muscle alternatives, one tap. */}
      {subFor !== null ? (
        <Modal transparent animationType="fade" onRequestClose={() => setSubFor(null)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setSubFor(null)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 520 }}
            >
              <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                SWAP · SAME MUSCLE GROUP
              </Text>
              <Text className="mb-s3 text-sm font-bold text-text">{subFor}</Text>
              <View className="flex-row flex-wrap gap-s2">
                {substitutesFor(subFor).slice(0, 12).map((alt) => (
                  <Pressable
                    key={alt.name}
                    onPress={() => {
                      setSubs((s) => {
                        const next = { ...s };
                        // Re-substituting an already-swapped card keys back
                        // to the ORIGINAL plan exercise so RESET works.
                        const orig = Object.keys(next).find((k) => next[k] === subFor && k.startsWith(`${day}:`));
                        const key = orig ?? `${day}:${subFor}`;
                        next[key] = alt.name;
                        return next;
                      });
                      setSubFor(null);
                    }}
                    accessibilityRole="button"
                    className="rounded-md border border-border px-s3 py-s2"
                    style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                  >
                    <Text className="text-2xs font-bold text-text-dim">{alt.name}</Text>
                  </Pressable>
                ))}
              </View>
              <View className="mt-s3">
                <NeonButton
                  title="RESET TO PLAN"
                  variant="ghost"
                  onPress={() => {
                    setSubs((s) => {
                      const next = { ...s };
                      for (const k of Object.keys(next)) if (next[k] === subFor) delete next[k];
                      return next;
                    });
                    setSubFor(null);
                  }}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </ScreenShell>
  );
}

/**
 * A day's drop-down: WHAT IS IN IT.
 *
 * Tapping "Pull 1 - Back Thickness" means "show me Pull 1 - Back Thickness".
 * It used to answer "Not yet — this one is ahead of you", which tells the
 * athlete nothing they did not already know (Tyson, 2026-07-14).
 *
 * So every day lists its exercises. Where sets were logged, it shows what was
 * lifted; where they were not, it shows what the plan asks for. It is READ-ONLY
 * by construction — the logging cards write to TODAY, so pointing them at
 * Thursday would file today's sets under Thursday's name.
 */
function DayPanel({
  rows,
  date,
  workout,
  planned,
}: {
  rows: import('@/domain/summary').WorkoutRow[];
  date: string;
  workout: string | null;
  planned: readonly PlanEntry[];
}) {
  if (!workout) return null;

  const loggedFor = (exercise: string) =>
    rows.filter(
      (r) =>
        String(r.date) === date &&
        String(r.workout) === workout &&
        String(r.exercise) === exercise &&
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
    );

  // Anything logged that the plan does not list (an added exercise, a swap)
  // still belongs in the recap — it happened.
  const plannedNames = new Set(planned.map(([e]) => e));
  const extras = [
    ...new Set(
      rows
        .filter(
          (r) =>
            String(r.date) === date &&
            String(r.workout) === workout &&
            !plannedNames.has(String(r.exercise)) &&
            (pyFloat(r.weight) ?? 0) > 0 &&
            (pyFloat(r.reps) ?? 0) > 0
        )
        .map((r) => String(r.exercise))
    ),
  ];

  const entries: { exercise: string; sets: number; scheme: string }[] = [
    ...planned.map(([exercise, sets, scheme]) => ({ exercise, sets, scheme })),
    ...extras.map((exercise) => ({ exercise, sets: 0, scheme: '' })),
  ];

  if (entries.length === 0) {
    return (
      <View className="rounded-xl border border-border p-s4" style={{ backgroundColor: 'rgba(13,21,36,0.5)' }}>
        <Text className="text-2xs text-text-mute">No exercises in this day yet.</Text>
      </View>
    );
  }

  const totalLogged = entries.reduce((n, e) => n + loggedFor(e.exercise).length, 0);

  return (
    <View className="rounded-xl border border-border p-s4" style={{ backgroundColor: 'rgba(13,21,36,0.5)' }}>
      {entries.map((e) => {
        const done = loggedFor(e.exercise);
        return (
          <View key={e.exercise} className="mb-s3">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 text-sm font-bold text-text" numberOfLines={1}>
                {e.exercise}
              </Text>
              <Text
                className="text-2xs font-bold"
                style={{ color: done.length > 0 ? tokens.colors.success : tokens.colors['text-mute'] }}
              >
                {done.length > 0 ? `✓ ${done.length}` : e.sets > 0 ? `${e.sets} SETS` : ''}
              </Text>
            </View>
            <Text className="text-2xs text-text-mute" numberOfLines={2}>
              {done.length > 0
                ? done
                    .map((r) => `${pyFloat(r.weight) ?? 0} kg × ${pyInt(r.reps) ?? 0}`)
                    .join('  ·  ')
                : e.scheme
                  ? schemeSentence(e.scheme)
                  : ''}
            </Text>
          </View>
        );
      })}
      <Text
        className="text-2xs font-bold"
        style={{
          letterSpacing: 1.5,
          color: totalLogged > 0 ? tokens.colors.success : tokens.colors['text-mute'],
        }}
      >
        {totalLogged > 0
          ? `${totalLogged} SET${totalLogged === 1 ? '' : 'S'} LOGGED`
          : date > new Date().toISOString().slice(0, 10)
            ? 'UPCOMING'
            : '0 SETS LOGGED'}
      </Text>
    </View>
  );
}
