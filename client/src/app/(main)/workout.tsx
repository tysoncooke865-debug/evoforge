import { router, useLocalSearchParams } from 'expo-router';
import { isCountedSet } from '@/domain/workouts';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useAuth } from '@/data/auth-context';
import { useClaimCoin } from '@/data/coins';
import { useOriginStatus } from '@/data/origin';
import { originAsBranch } from '@/domain/customise';
import { usePublishGhost } from '@/data/ghosts';
import { useWorkoutLog } from '@/data/hooks';
import { useRoutines, useSaveRoutine, useUpdateRoutine } from '@/data/routines';
import { useSaveSchedule, useWorkoutSchedule } from '@/data/schedule';
import { useSaveUserPlan, useUserPlans } from '@/data/user-plans';
import { useFinishWorkout, useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { useAvatarData } from '@/data/use-avatar-data';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { championForBranch } from '@/domain/battle-rpg/champions';
import { substitutesFor } from '@/domain/exercise-library';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { applyEditsToDay, diffDayEdits, mergeDayIntoCustomPlan } from '@/domain/plan-edits';
import type { PlanDay } from '@/domain/custom-plan';
import { pyInt } from '@/domain/py';
import type { SourceIndex } from '@/domain/plan-sources';
import { nextScheduledSession } from '@/domain/scheduled-streak';
import { useSaveRoutinePromptStore } from '@/state/save-routine-prompt-store';
import {
  applyOrder,
  buildEffectivePlan,
  canAddSet,
  canRemoveSet,
  planTotals,
  removeAction,
  type LoggedFacts,
  type PlanEntry,
  type SessionExercise,
} from '@/domain/session-plan';
import { computeStreak } from '@/domain/streak';
import { normaliseWorkoutLog } from '@/domain/summary';
import { todayIso as calendarToday } from '@/domain/today';
import { XP_PER_SET } from '@/domain/xp';
import { adhocOf, overridesFor, useSessionStore } from '@/state/session-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playComplete } from '@/ui/core/sound';
import { ExerciseCard } from '@/ui/train/exercise-logger';
import { ExercisePicker } from '@/ui/train/exercise-picker';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';
import { ReorderableList } from '@/ui/train/reorderable-list';
import { NeonButton } from '@/ui/core/neon-button';
import { FloatingRestTimer, RestTimerBar } from '@/ui/train/rest-timer';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SummarySheet, type WorkoutSummaryData } from '@/ui/train/summary-sheet';

/**
 * THE WORKOUT PAGE (TRAIN_PAGE_V2).
 *
 * A workout is now ENTERED, not expanded inline: Train is the hub, this is the
 * thing you are doing. Pushed on top of Train with a back arrow, so leaving is
 * one tap and the tab bar never disappears.
 *
 * Params: `date` + `workout`. EDITABLE ONLY WHEN date === today AND the workout
 * is not finished — the logging cards write to the date in the URL, and a page
 * that let you "log" last Tuesday would file today's sets under it. Past and
 * future days open a read-only recap instead.
 *
 * FINISH IS ALWAYS THERE (the trap this closes): it used to render only while
 * `totalDone > 0 && !complete`, so once every set was done the button vanished,
 * the auto-ceremony fired once, and KEEP TRAINING left the athlete with no
 * button, no ceremony, and no way to finish at all. It now renders whenever the
 * workout is not finished, disabled until one real set exists — a 0-set finish
 * would paint a day green with no training in it, and `past + no sets = MISSED`
 * is load-bearing in week-status.
 */
export default function WorkoutScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ date?: string; workout?: string; source?: string }>();
  const todayIso = calendarToday();
  const date = params.date ?? todayIso;
  const workoutName = params.workout ?? '';
  // Which plan the athlete was looking at when they opened this door.
  const parsedSource = Number(params.source);

  /**
   * BACK GOES TO TRAIN — explicitly.
   *
   * router.back() pops the NAVIGATION stack, and on a tab layout that is the
   * previously focused TAB: finishing a workout landed the athlete on Home if
   * that is where they had been, which is not where they came from and not
   * where the green bar they just earned is. The workout page is only ever
   * entered from Train, so Train is where leaving it means.
   */
  const back = () => router.replace('/today' as never);

  const workouts = useWorkoutLog();
  const schedule = useWorkoutSchedule();
  const sessions = useWorkoutSessions();
  const finishWorkout = useFinishWorkout();
  const reopenWorkout = useReopenWorkout();
  const claimCoins = useClaimCoin();
  const saveRoutine = useSaveRoutine();
  const updateRoutine = useUpdateRoutine();
  const userPlans = useUserPlans();
  const savePlan = useSaveUserPlan();
  const saveSchedule = useSaveSchedule();
  const { summary, stats, bfMid, branchV2 } = useAvatarData();
  // THE ORIGIN LOCK: a published ghost carries the origin champion.
  const originStatus = useOriginStatus();
  const ghostBranch = originAsBranch(originStatus.data?.origin_path) ?? branchV2;
  const { session } = useAuth();
  const publishGhost = usePublishGhost();
  const forge = useForgeProgression();
  const { resolveDay, preferredSource: savedSource } = useDayPlan();
  // A deep link without ?source= follows the SAVED choice (035), so a
  // reload-restored or externally opened workout page agrees with Train.
  const preferredSource: SourceIndex =
    parsedSource === 0 || parsedSource === 1 || parsedSource === 2 ? parsedSource : savedSource;

  const adhoc = useSessionStore(adhocOf);
  const overrides = useSessionStore((s) => overridesFor(s, workoutName));
  const markActive = useSessionStore((s) => s.markActive);
  const clearActive = useSessionStore((s) => s.clearActive);
  const endAdhoc = useSessionStore((s) => s.endAdhoc);
  const addExercise = useSessionStore((s) => s.addExercise);
  const removeExercise = useSessionStore((s) => s.removeExercise);
  const toggleSkip = useSessionStore((s) => s.toggleSkip);
  const toggleSuperset = useSessionStore((s) => s.toggleSuperset);
  const substitute = useSessionStore((s) => s.substitute);
  const resetSubstitution = useSessionStore((s) => s.resetSubstitution);
  const seedSupersets = useSessionStore((s) => s.seedSupersets);
  const bumpSets = useSessionStore((s) => s.bumpSets);
  const reorderExercises = useSessionStore((s) => s.reorderExercises);

  const [sheet, setSheet] = useState<WorkoutSummaryData | null>(null);
  const [reordering, setReordering] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 065: the ceremony's own SAVE AS ROUTINE suppresses the post-finish prompt.
  const savedInCeremonyRef = useRef(false);
  const routines = useRoutines();
  const [subFor, setSubFor] = useState<string | null>(null);
  // SUPERSET (2026-07-18): which exercise is picking a partner.
  const [pairFor, setPairFor] = useState<string | null>(null);
  // FINISH with sets remaining asks first — "you have N sets remaining".
  const [confirmRemaining, setConfirmRemaining] = useState(false);
  // FINISH with the day edited asks whether the edits become the template.
  const [savePrompt, setSavePrompt] = useState(false);

  /** Swap the card being substituted for `altName`. Lives in the session
   *  store (persisted) — a refresh mid-workout must not quietly restore the
   *  exercise the athlete swapped away. One path for the same-muscle chips
   *  AND the search bar. */
  const swapTo = (altName: string) => {
    if (subFor !== null) substitute(workoutName, subFor, altName);
    setSubFor(null);
  };
  const prCountRef = useRef(0);
  const prNamesRef = useRef<string[]>([]);

  const marker =
    (sessions.data ?? []).find((m) => m.date === date && m.workout === workoutName) ?? null;
  const finished = marker !== null;
  const isToday = date === todayIso;
  /** Logging writes to the date in the URL, so only TODAY may log. */
  const editable = isToday && !finished;

  const allRows = normaliseWorkoutLog(workouts.data ?? []);
  const dayRows = allRows.filter(
    (r) => String(r.date) === date && String(r.workout) === workoutName
  );

  const validRowsFor = (exercise: string) =>
    dayRows.filter(
      (r) =>
        String(r.exercise) === exercise &&
        isCountedSet(r.weight, r.reps)
    );

  const loggedFacts = (exercise: string): LoggedFacts => {
    let maxSetNo = 0;
    for (const r of dayRows) {
      if (String(r.exercise) !== exercise) continue;
      maxSetNo = Math.max(maxSetNo, pyInt(r.set) ?? 0);
    }
    return { validCount: validRowsFor(exercise).length, maxSetNo };
  };

  // An ad-hoc workout's exercises live in the session store; everything else
  // comes from THE SOURCE THE ATHLETE CHOSE (falling back only when that source
  // does not contain the day — and saying so when it happens).
  const isAdhoc = adhoc !== null && adhoc.name === workoutName;
  const resolved = resolveDay(workoutName, preferredSource);
  const basePlan: PlanEntry[] = isAdhoc
    ? (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets, e.reps] as const)
    : resolved.entries;
  /** The day is not in the plan they picked — we are showing someone else's. */
  const borrowedFrom =
    !isAdhoc && resolved.from !== null && resolved.from !== preferredSource ? resolved.from : null;
  // REORDER (2026-07-19): the athlete's chosen order is a presentation layer
  // over the effective plan — applied after buildEffectivePlan so add/remove/
  // skip/substitute all still work, and a stale name never drops an exercise.
  // Substitutions apply INSIDE buildEffectivePlan (overrides.substituted).
  const plan = applyOrder(buildEffectivePlan(basePlan, overrides, loggedFacts), overrides.order);
  const totals = planTotals(plan, loggedFacts);
  const { done: totalDone, target: totalTarget, complete, nextExercise } = totals;
  const dayPct = totalTarget > 0 ? (totalDone / totalTarget) * 100 : 0;

  const forgeProgress = forgeProgressFromRow(forge.data ?? null);
  const buildSummary = (): WorkoutSummaryData => ({
    day: workoutName,
    setsDone: totalDone,
    setsTarget: totalTarget,
    xpBanked: totalDone * XP_PER_SET,
    prCount: prCountRef.current,
    prExercises: [...new Set(prNamesRef.current)],
    streak: computeStreak(workouts.data ?? [], todayIso).current,
    // The ceremony's LEVEL PATH is the FORGE level now (earned XP only —
    // Tyson 2026-07-16); evolution below keeps its own legacy-level track.
    level: forgeProgress.level,
    xpIntoLevel: forgeProgress.xpIntoLevel,
    xpNeeded: forgeProgress.xpForNextLevel,
    evolution: nextEvolutionInfo(stats.branch, {
      level: summary.level,
      benchE1rm: stats.benchE1rm,
      bfMid,
      totalSets: summary.totalSets,
      cardioMinutes: summary.cardioMinutes,
    }),
    nextSession: nextScheduledSession(schedule.data ?? [], todayIso),
  });

  // The completion ceremony, once per workout — and never for one already
  // finished (the athlete has been through it; re-firing would be the app
  // forgetting).
  const announcedRef = useRef(false);
  const hadDataRef = useRef(false);

  // The route stays MOUNTED between workouts (it is a tab with href:null), so
  // opening another workout only swaps the params. Everything below is per
  // (date, workout) and MUST be reset, or the ceremony fires once per app launch
  // and workout A's PRs turn up in workout B's summary.
  const keyRef = useRef(`${date}|${workoutName}`);
  useEffect(() => {
    const key = `${date}|${workoutName}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    announcedRef.current = false;
    hadDataRef.current = false;
    prCountRef.current = 0;
    prNamesRef.current = [];
    setSheet(null);
    setSubFor(null);
    setPairFor(null);
    setConfirmRemaining(false);
    setSavePrompt(false);
    setPickerOpen(false);
    setReordering(false);
  }, [date, workoutName]);

  useEffect(() => {
    if (!workouts.data || !editable) return;
    if (!hadDataRef.current) {
      hadDataRef.current = true;
      if (complete) announcedRef.current = true;
      return;
    }
    if (complete && !announcedRef.current) {
      announcedRef.current = true;
      if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      playComplete(); // the retro workout-complete jingle (web; settings-gated)
      // NO auto-opened sheet: finishing is the athlete's act (the button at the
      // bottom), not something the last set does to them. The coin claim STAYS
      // here — the offline finish-queue flush never claims, so this is the only
      // coin path for an offline finish (claims are idempotent, migration 013).
      claimCoins.mutate({ kind: 'workout_complete', sourceId: date });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, workouts.data, editable]);

  const removeOrSkip = (exercise: string) => {
    const facts = loggedFacts(exercise);
    if (removeAction(facts) === 'skip') {
      toggleSkip(workoutName, exercise);
      useToastStore.getState().push({
        kind: 'info',
        title: 'SKIPPED INSTEAD',
        subtitle: 'Sets already logged — they still count.',
      });
      return;
    }
    removeExercise(workoutName, exercise);
  };

  /** Sets still owed when the athlete reaches for FINISH. */
  const remaining = Math.max(0, totalTarget - totalDone);

  // SAVED SUPERSETS seed the session once per (day, today) — the workout page
  // then shows them, toggling edits the seeded map, and the finish-time diff
  // compares clean until the athlete actually changes a pairing.
  useEffect(() => {
    if (!editable || isAdhoc) return;
    const pairs = resolved.supersets;
    if (pairs && Object.keys(pairs).length > 0) seedSupersets(workoutName, pairs);
  });

  /** What the athlete changed about the day, template vs session overrides —
   *  and whether there is anywhere to save it (an ad-hoc has its own
   *  save-as-routine flow; a day nobody owns has no template to update). */
  const edits = isAdhoc ? null : diffDayEdits(basePlan, resolved.supersets ?? {}, overrides);
  const canSaveEdits =
    !isAdhoc && (resolved.from !== null || resolved.routine !== undefined);

  /** The finish loop's front door: an incomplete day asks first. */
  const onFinishPress = () => {
    if (remaining > 0) {
      setConfirmRemaining(true);
      return;
    }
    proceedToFinish();
  };

  /** Second gate: an edited day asks whether the edits become the template. */
  const proceedToFinish = () => {
    if (editable && canSaveEdits && edits?.dirty) {
      setSavePrompt(true);
      return;
    }
    setSheet(buildSummary());
  };

  /** SAVE CHANGES: persist the edited day back to wherever it came from, so
   *  the next session of this workout loads the edited version. */
  const saveEdits = () => {
    const sourcePlan =
      resolved.from === 0 ? (userPlans.data?.custom ?? null)
      : resolved.from === 1 ? (userPlans.data?.ai ?? null)
      : null;
    const templateDay = sourcePlan?.days.find((d) => d.day === workoutName);
    const reasons = templateDay
      ? new Map(templateDay.exercises.map((e) => [e.exercise, e.reason] as const))
      : null;
    const exercises = applyEditsToDay(
      basePlan,
      reasons,
      overrides,
      overrides.superset ?? resolved.supersets ?? {}
    );
    if (exercises.length === 0) return;

    if (resolved.routine !== undefined) {
      const routineRow = (routines.data ?? []).find((r) => r.name === resolved.routine);
      if (routineRow) {
        updateRoutine.mutate({
          id: routineRow.id,
          name: routineRow.name,
          exercises: exercises.map(({ exercise, sets, reps, supersetWith }) =>
            supersetWith ? { exercise, sets, reps, supersetWith } : { exercise, sets, reps }
          ),
        });
      }
      return;
    }

    if (resolved.from === 0 || resolved.from === 1) {
      if (!sourcePlan) return;
      const kind = resolved.from === 0 ? ('custom' as const) : ('ai' as const);
      const newDay: PlanDay = {
        day: workoutName,
        goal: templateDay?.goal ?? '',
        exercises,
      };
      const days = sourcePlan.days.some((d) => d.day === workoutName)
        ? sourcePlan.days.map((d) => (d.day === workoutName ? newDay : d))
        : [...sourcePlan.days, newDay];
      savePlan.mutate(
        { kind, plan: { ...sourcePlan, days } },
        {
          onSuccess: () =>
            useToastStore.getState().push({
              kind: 'info',
              title: 'WORKOUT UPDATED',
              subtitle: `${workoutName} · saved to ${kind === 'custom' ? 'MY PLAN' : 'AI PLAN'}`,
            }),
        }
      );
      return;
    }

    // BUILT-IN: the catalog cannot change, so the edited day FORKS into MY
    // PLAN, and every scheduled weekday carrying this day is pointed at
    // source 0 (066 per-day sources) so the fork is what opens next time.
    // active_plan_source is deliberately untouched — flipping it would remap
    // the athlete's whole week.
    if (resolved.from === 2) {
      const newDay: PlanDay = { day: workoutName, goal: '', exercises };
      savePlan.mutate(
        { kind: 'custom', plan: mergeDayIntoCustomPlan(userPlans.data?.custom ?? null, newDay) },
        {
          onSuccess: () =>
            useToastStore.getState().push({
              kind: 'info',
              title: 'SAVED TO MY PLAN',
              subtitle: `${workoutName} · your edited version opens from now on`,
            }),
        }
      );
      const latest =
        schedule.data && schedule.data.length > 0 ? schedule.data[schedule.data.length - 1] : null;
      if (latest) {
        const sources: Record<string, number> = { ...(latest.sources ?? {}) };
        let touched = false;
        for (const [dow, v] of Object.entries(latest.plan)) {
          const primary = Array.isArray(v) ? v[0] : v;
          if (primary === workoutName && sources[dow] !== 0) {
            sources[dow] = 0;
            touched = true;
          }
        }
        if (touched) saveSchedule.mutate({ plan: latest.plan, sources });
      }
    }
  };

  /** What the athlete actually DID — the only honest thing to save as a routine. */
  const performed = (): SessionExercise[] =>
    plan
      .map((e) => ({ exercise: e.exercise, sets: loggedFacts(e.exercise).validCount, reps: e.reps }))
      .filter((e) => e.sets > 0);

  const finish = () => {
    finishWorkout.mutate({ date, workout: workoutName });
    clearActive();
    // An ad-hoc workout is DONE — releasing it restores START AN EMPTY WORKOUT.
    // It used to survive forever, capping the athlete at one ad-hoc per day.
    if (isAdhoc) {
      endAdhoc();
      // 065: offer to keep what they just invented. Skipped when the ceremony
      // already saved it, when nothing was performed, and when a routine with
      // this name exists (a routine STARTED from the list re-finishing —
      // startRoutine may have suffixed " (today)", so match the base name).
      const done = performed();
      const baseName = workoutName.replace(/ \(today\)$/, '').trim();
      const exists = (routines.data ?? []).some(
        (r) => r.name.trim().toLowerCase() === baseName.toLowerCase()
      );
      if (done.length > 0 && !savedInCeremonyRef.current && !exists) {
        useSaveRoutinePromptStore.getState().offer({ name: baseName, exercises: done });
      }
    }
    // Back to Train, where the bar is already green from the optimistic write.
    back();
  };

  if (workoutName === '') {
    return (
      <ScreenShell>
        <ScreenHeader kicker="WORKOUT" title="NOTHING TO TRAIN" onBack={back} />
        <Text className="text-2xs text-text-mute">This workout has no name. Go back and pick a day.</Text>
      </ScreenShell>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    <ScreenShell>
      <ScreenHeader
        kicker={`${isToday ? 'TODAY' : date} · ${totalDone}/${totalTarget} SETS`}
        title={workoutName.split(' - ')[0].toUpperCase()}
        titleLines={2}
        onBack={back}
      />

      {editable ? <RestTimerBar /> : null}

      {/* Whose workout is this? The tab said one thing; if the day only exists
          in another plan we show that one, and we SAY so rather than quietly
          passing it off as theirs. */}
      {!isAdhoc && (resolved.from !== null || resolved.routine !== undefined) ? (
        <Text
          className="text-2xs font-bold"
          style={{
            letterSpacing: 1.5,
            color: borrowedFrom !== null ? colors.warn : colors['text-mute'],
          }}
          testID="workout-source"
        >
          {resolved.from === null
            ? 'FROM MY ROUTINES' // 065: a scheduled extra resolved by name
            : borrowedFrom !== null
              ? `NOT IN ${SOURCE_LABEL[preferredSource]} — SHOWING ${SOURCE_LABEL[borrowedFrom]}`
              : `FROM ${SOURCE_LABEL[preferredSource]}`}
        </Text>
      ) : null}

      {/* Progress — kept compact (Tyson 2026-07-16: it wasted ~30% height). */}
      <GlowCard glow={complete ? colors.success : undefined} padding={12}>
        <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
          <View
            style={{
              width: `${dayPct}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: complete ? colors.success : colors.accent,
              minWidth: totalDone > 0 ? 4 : 0,
              shadowColor: complete ? colors.success : colors.accent,
              shadowOpacity: 0.5,
              shadowRadius: 8,
            }}
          />
        </View>
        <View className="mt-s1 flex-row justify-between">
          <Text
            className={complete ? 'text-success' : 'text-text-mute'}
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
          >
            {complete ? '✓ ALL SETS COMPLETE' : `${totalDone} / ${totalTarget} SETS`}
          </Text>
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
            +{totalDone * XP_PER_SET} XP
          </Text>
        </View>
      </GlowCard>

      {/* FINISHED — locked, with the hatch. */}
      {finished ? (
        <View
          className="flex-row items-center justify-between rounded-xl p-s4"
          style={{
            borderWidth: 1,
            borderColor: `${colors.success}66`,
            backgroundColor: 'rgba(52,211,153,0.06)',
          }}
        >
          <View className="flex-1">
            <Text
              allowFontScaling={false}
              style={{ fontSize: 10, color: colors.success, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              ✓ WORKOUT COMPLETE
            </Text>
            <Text className="text-2xs text-text-mute">
              {totalDone}/{totalTarget} sets · locked
            </Text>
          </View>
          <Pressable
            onPress={() => marker && reopenWorkout.mutate(marker)}
            accessibilityRole="button"
            testID="reopen-workout"
            className="items-center justify-center px-s3"
            style={{ minHeight: 44 }}
          >
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
            >
              REOPEN
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!isToday && !finished ? (
        <Text className="text-2xs text-text-mute">
          {date > todayIso
            ? 'Upcoming — this is what the day holds.'
            : 'A past workout. Read-only; today is where you log.'}
        </Text>
      ) : null}

      {plan.length === 0 ? (
        <Text className="py-s5 text-center text-2xs text-text-mute">
          Nothing in this workout yet.
        </Text>
      ) : null}

      {/* REORDER MODE (2026-07-19): drag the ⣿ grip to change the order the
          workout runs in. A compact list stands in for the tall logging cards
          while reordering — dragging full cards mid-session is impractical.
          The new order persists in today's session overrides. */}
      {editable && plan.length > 1 ? (
        <Pressable
          onPress={() => setReordering((v) => !v)}
          accessibilityRole="button"
          testID="toggle-reorder"
          className="flex-row items-center justify-center rounded-md border"
          style={{
            minHeight: 40,
            borderColor: reordering ? `${colors.accent}80` : colors.border,
            backgroundColor: reordering ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
          }}
        >
          <Text
            className={reordering ? 'text-accent' : 'text-text-mute'}
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
          >
            {reordering ? '✓ DONE — DRAG ⣿ TO REORDER' : '⇅ REORDER EXERCISES'}
          </Text>
        </Pressable>
      ) : null}

      {reordering && editable ? (
        <ReorderableList
          items={plan}
          keyOf={(e) => e.exercise}
          rowHeight={52}
          onReorder={(next) => reorderExercises(workoutName, next.map((e) => e.exercise))}
          renderRow={(e) => (
            <View
              className="flex-row items-center gap-s2 rounded-md border border-border px-s3"
              style={{ height: 52, backgroundColor: 'rgba(13,21,36,0.7)' }}
            >
              <Text className="flex-1 text-xs font-bold text-text" numberOfLines={1}>
                {e.exercise}
              </Text>
              <Text className="text-2xs text-text-mute" allowFontScaling={false}>
                {e.sets} × {e.reps}
              </Text>
            </View>
          )}
        />
      ) : null}

      {reordering ? null : plan.map((entry, i) => {
        const { exercise, sets, reps, skipped } = entry;
        const facts = loggedFacts(exercise);
        return (
          <ExerciseCard
            key={`${workoutName}:${exercise}`}
            date={date}
            workout={workoutName}
            exercise={exercise}
            position={i + 1}
            total={plan.length}
            targetSets={sets}
            scheme={reps}
            loggedRows={dayRows.filter((r) => String(r.exercise) === exercise)}
            allRows={workouts.data ?? []}
            doneCount={facts.validCount}
            isNext={exercise === nextExercise}
            onPr={() => {
              prCountRef.current += 1;
              prNamesRef.current.push(exercise);
            }}
            onLogged={() => markActive(workoutName, preferredSource)}
            durable
            // Read-only unless it is today and unfinished — the cards write to
            // the date in the URL.
            readOnly={!editable}
            onSubstitute={editable ? () => setSubFor(exercise) : undefined}
            skipped={skipped}
            onRemove={editable ? () => removeOrSkip(exercise) : undefined}
            onSkip={editable ? () => toggleSkip(workoutName, exercise) : undefined}
            supersetWith={overrides.superset?.[exercise] ?? null}
            onSuperset={
              editable
                ? () => {
                    const partner = overrides.superset?.[exercise];
                    if (partner) toggleSuperset(workoutName, exercise, partner); // unpair
                    else setPairFor(exercise);
                  }
                : undefined
            }
            onAddSet={editable && canAddSet(sets) ? () => bumpSets(workoutName, exercise, 1) : undefined}
            onRemoveSet={
              editable && canRemoveSet(sets, facts)
                ? () => bumpSets(workoutName, exercise, -1)
                : undefined
            }
          />
        );
      })}

      {editable ? (
        <View className="gap-s2">
          {/* Type a letter, get the exercise — the picker stays for browsing. */}
          <ExerciseSearchBar
            onPick={(e) => addExercise(workoutName, { exercise: e.name, sets: 3, reps: '8-12' })}
            excludeNames={plan.map((p) => p.exercise)}
            programExercises={plan.map((p) => p.exercise)}
            placeholder="Add an exercise — type to search…"
            testIDPrefix="workout-search"
          />
          <NeonButton
            title="＋ BROWSE ALL EXERCISES"
            variant="ghost"
            onPress={() => setPickerOpen(true)}
            testID="add-exercise"
          />
        </View>
      ) : null}

      {/* BUG 3: an ad-hoc workout used to be impossible to get rid of —
          endAdhoc() was never called, so START AN EMPTY WORKOUT stayed hidden for
          the rest of the day and a mistyped one could be neither finished (no
          sets) nor dismissed. */}
      {isAdhoc && !finished && totalDone === 0 ? (
        <Pressable
          onPress={() => {
            endAdhoc();
            clearActive();
            back();
          }}
          accessibilityRole="button"
          testID="discard-workout"
          className="items-center"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
          >
            DISCARD THIS WORKOUT
          </Text>
        </Pressable>
      ) : null}

      {/* FINISH — the LAST thing on the page, while the workout is open,
          whatever the clock says. Disabled until one real set exists: a 0-set
          finish would paint the day green with no training in it, and
          "past + no sets = MISSED" is load-bearing.
          NOT gated on `editable`: an athlete who starts at 23:50 and trains past
          midnight was left with a read-only page and NO FINISH BUTTON — the
          marker could never be written and the workout was unfinishable forever.
          The marker's date comes from the URL, not the clock, so writing it for
          yesterday is exactly right. */}
      {!finished && (editable || totalDone > 0) ? (
        <NeonButton
          title={totalDone > 0 ? `FINISH WORKOUT · ${totalDone}/${totalTarget} SETS` : 'LOG A SET TO FINISH'}
          onPress={onFinishPress}
          disabled={totalDone === 0}
          busy={finishWorkout.isPending}
          testID="finish-workout"
        />
      ) : null}

      <SummarySheet
        data={sheet}
        onClose={() => setSheet(null)}
        onFinish={finish}
        onSaveRoutine={
          performed().length > 0
            ? (name) => {
                savedInCeremonyRef.current = true; // 065: no double offer
                saveRoutine.mutate({ name, exercises: performed() });
              }
            : undefined
        }
        defaultRoutineName={workoutName}
        // GHOST (migration 037): one tap publishes this session's combat
        // snapshot (numbers only) for friends to battle from the Arena.
        onShareGhost={() =>
          publishGhost.mutate({
            workout: workoutName,
            date,
            champion: championForBranch(ghostBranch),
            ownerName: (session?.user?.email ?? 'Athlete').split('@')[0],
            input: { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore },
            headline: { sets: totalDone },
          })
        }
      />

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(e) => {
          addExercise(workoutName, { exercise: e.name, sets: 3, reps: '8-12' });
          setPickerOpen(false);
        }}
        excludeNames={plan.map((p) => p.exercise)}
        programExercises={plan.map((p) => p.exercise)}
      />

      {/* FINISH EARLY: the day still owes sets — say so, let them finish anyway. */}
      {confirmRemaining ? (
        <Modal transparent animationType="fade" onRequestClose={() => setConfirmRemaining(false)}>
          <Pressable
            className="flex-1 justify-center px-s5"
            style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
            onPress={() => setConfirmRemaining(false)}
          >
            <Pressable
              onPress={() => undefined}
              className="rounded-xl border p-s4"
              style={{ borderColor: `${colors.warn}40`, backgroundColor: colors.surface }}
            >
              <Text
                className="mb-s1 text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                FINISH WORKOUT
              </Text>
              <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
                You have {remaining} {remaining === 1 ? 'set' : 'sets'} remaining
              </Text>
              <Text className="mb-s3 text-2xs text-text-mute">
                Finishing now marks the day partial. Skip what you don’t owe, or keep lifting.
              </Text>
              <View className="gap-s2">
                <NeonButton
                  title="FINISH ANYWAY"
                  onPress={() => {
                    setConfirmRemaining(false);
                    proceedToFinish();
                  }}
                  testID="finish-anyway"
                />
                <NeonButton
                  title="KEEP TRAINING"
                  variant="ghost"
                  onPress={() => setConfirmRemaining(false)}
                  testID="finish-cancel"
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* SAVE CHANGES: the day was edited — does the edit become the template? */}
      {savePrompt ? (
        <Modal transparent animationType="fade" onRequestClose={() => setSavePrompt(false)}>
          <Pressable
            className="flex-1 justify-center px-s5"
            style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
            onPress={() => setSavePrompt(false)}
          >
            <Pressable
              onPress={() => undefined}
              className="rounded-xl border p-s4"
              style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface }}
            >
              <Text
                className="mb-s1 text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                YOU CHANGED THIS WORKOUT
              </Text>
              <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
                Save changes?
              </Text>
              <View className="mb-s3 gap-s1">
                {(edits?.substitutions ?? []).map((s) => (
                  <Text key={`sub-${s.from}`} className="text-2xs text-text-dim">
                    ⇄ {s.from} → {s.to}
                  </Text>
                ))}
                {(edits?.added ?? []).map((a) => (
                  <Text key={`add-${a.exercise}`} className="text-2xs text-text-dim">
                    ＋ {a.exercise} · {a.sets} sets
                  </Text>
                ))}
                {(edits?.removed ?? []).map((r) => (
                  <Text key={`rem-${r}`} className="text-2xs text-text-dim">
                    ✕ {r}
                  </Text>
                ))}
                {(edits?.setChanges ?? []).map((c) => (
                  <Text key={`set-${c.exercise}`} className="text-2xs text-text-dim">
                    {c.exercise}: {c.from} → {c.to} sets
                  </Text>
                ))}
                {edits?.supersetChanged ? (
                  <Text className="text-2xs text-text-dim">⚡ Superset pairing changed</Text>
                ) : null}
              </View>
              <Text className="mb-s3 text-2xs text-text-mute">
                Saving updates this workout for every future session. Just today keeps the plan as
                it was — these changes expire at midnight.
              </Text>
              <View className="gap-s2">
                <NeonButton
                  title="SAVE CHANGES"
                  onPress={() => {
                    setSavePrompt(false);
                    saveEdits();
                    setSheet(buildSummary());
                  }}
                  testID="save-edits"
                />
                <NeonButton
                  title="JUST TODAY"
                  variant="ghost"
                  onPress={() => {
                    setSavePrompt(false);
                    setSheet(buildSummary());
                  }}
                  testID="skip-save-edits"
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* SUPERSET pair-picker: link this exercise with another from today. */}
      {pairFor !== null ? (
        <Modal transparent animationType="fade" onRequestClose={() => setPairFor(null)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setPairFor(null)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${colors.epic}40`, backgroundColor: colors.surface, maxHeight: 480 }}
            >
              <Text className="mb-s1 text-text-mute" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}>
                SUPERSET · PICK THE PARTNER
              </Text>
              <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
                {pairFor}
              </Text>
              <View className="flex-row flex-wrap gap-s2">
                {plan
                  .filter((e) => e.exercise !== pairFor && !e.skipped)
                  .map((e) => (
                    <Pressable
                      key={e.exercise}
                      onPress={() => {
                        toggleSuperset(workoutName, pairFor, e.exercise);
                        setPairFor(null);
                      }}
                      accessibilityRole="button"
                      testID={`pair-${e.exercise}`}
                      className="rounded-md border border-border px-s3 py-s2"
                      style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                    >
                      <Text className="text-2xs font-bold text-text-dim">{e.exercise}</Text>
                    </Pressable>
                  ))}
              </View>
              <View className="mt-s3">
                <NeonButton title="CANCEL" variant="ghost" onPress={() => setPairFor(null)} />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Substitution sheet: same-muscle alternatives, one tap. */}
      {subFor !== null ? (
        <Modal transparent animationType="fade" onRequestClose={() => setSubFor(null)}>
          <Pressable
            className="flex-1 justify-end"
            style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
            onPress={() => setSubFor(null)}
          >
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{
                borderColor: `${colors.accent}40`,
                backgroundColor: colors.surface,
                maxHeight: 520,
              }}
            >
              <Text
                className="mb-s1 text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                SWAP · SAME MUSCLE GROUP
              </Text>
              <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
                {subFor}
              </Text>
              {/* Search swaps to ANYTHING; the same-muscle chips below stay
                  the zero-typing default. */}
              <View className="mb-s3">
                <ExerciseSearchBar
                  onPick={(alt) => swapTo(alt.name)}
                  excludeNames={plan.map((p) => p.exercise)}
                  placeholder="Or search anything…"
                  testIDPrefix="swap-search"
                />
              </View>
              <View className="flex-row flex-wrap gap-s2">
                {substitutesFor(subFor)
                  // Never offer something already in the day: swapping onto it
                  // produced TWO cards with the same key, both showing the same
                  // logged rows, and planTotals counted its sets twice.
                  .filter((alt) => !plan.some((p) => p.exercise === alt.name && p.exercise !== subFor))
                  .slice(0, 12)
                  .map((alt) => (
                    <Pressable
                      key={alt.name}
                      onPress={() => swapTo(alt.name)}
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
                    resetSubstitution(workoutName, subFor);
                    setSubFor(null);
                  }}
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </ScreenShell>
    {/* §3.2: the countdown stays on screen however deep the page scrolls.
        Outside the ScreenShell scroll on purpose; renders nothing when no
        rest is live, when collapsed via ▴, or on a locked (read-only) day. */}
    {editable ? <FloatingRestTimer /> : null}
    </View>
  );
}
