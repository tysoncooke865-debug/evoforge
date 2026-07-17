import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useAuth } from '@/data/auth-context';
import { useClaimCoin } from '@/data/coins';
import { usePublishGhost } from '@/data/ghosts';
import { useWorkoutLog } from '@/data/hooks';
import { useSaveRoutine } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
import { useFinishWorkout, useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { useAvatarData } from '@/data/use-avatar-data';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { championForBranch } from '@/domain/battle-rpg/champions';
import { substitutesFor } from '@/domain/exercise-library';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { pyFloat, pyInt } from '@/domain/py';
import type { SourceIndex } from '@/domain/plan-sources';
import { nextScheduledSession } from '@/domain/scheduled-streak';
import {
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
import tokens from '@/theme/tokens';
import { playComplete } from '@/ui/core/sound';
import { ExerciseCard } from '@/ui/train/exercise-logger';
import { ExercisePicker } from '@/ui/train/exercise-picker';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';
import { NeonButton } from '@/ui/core/neon-button';
import { RestTimerBar } from '@/ui/train/rest-timer';
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
  const { summary, stats, bfMid, branchV2 } = useAvatarData();
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
  const bumpSets = useSessionStore((s) => s.bumpSets);

  const [sheet, setSheet] = useState<WorkoutSummaryData | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [subFor, setSubFor] = useState<string | null>(null);
  // SUPERSET (2026-07-18): which exercise is picking a partner.
  const [pairFor, setPairFor] = useState<string | null>(null);

  /** Swap the card being substituted for `altName` — keyed back to the
   *  ORIGINAL plan exercise so RESET TO PLAN works. One path for the
   *  same-muscle chips AND the search bar. */
  const swapTo = (altName: string) => {
    setSubs((s) => {
      const next = { ...s };
      const orig = Object.keys(next).find(
        (k) => next[k] === subFor && k.startsWith(`${workoutName}:`)
      );
      next[orig ?? `${workoutName}:${subFor}`] = altName;
      return next;
    });
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
        (pyFloat(r.weight) ?? 0) > 0 &&
        (pyFloat(r.reps) ?? 0) > 0
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
  const substituted: PlanEntry[] = basePlan.map(
    ([ex, sets, scheme]) => [subs[`${workoutName}:${ex}`] ?? ex, sets, scheme] as const
  );

  const plan = buildEffectivePlan(substituted, overrides, loggedFacts);
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
    setSubs({});
    setSubFor(null);
    setPairFor(null);
    setPickerOpen(false);
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
      setSheet(buildSummary());
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
    if (isAdhoc) endAdhoc();
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
      {!isAdhoc && resolved.from !== null ? (
        <Text
          className="text-2xs font-bold"
          style={{
            letterSpacing: 1.5,
            color: borrowedFrom !== null ? tokens.colors.warn : tokens.colors['text-mute'],
          }}
          testID="workout-source"
        >
          {borrowedFrom !== null
            ? `NOT IN ${SOURCE_LABEL[preferredSource]} — SHOWING ${SOURCE_LABEL[borrowedFrom]}`
            : `FROM ${SOURCE_LABEL[preferredSource]}`}
        </Text>
      ) : null}

      {/* Progress — kept compact (Tyson 2026-07-16: it wasted ~30% height). */}
      <GlowCard glow={complete ? tokens.colors.success : undefined} padding={12}>
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
            borderColor: `${tokens.colors.success}66`,
            backgroundColor: 'rgba(52,211,153,0.06)',
          }}
        >
          <View className="flex-1">
            <Text
              allowFontScaling={false}
              style={{ fontSize: 10, color: tokens.colors.success, letterSpacing: 1.5, ...pixelFont(false) }}
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

      {plan.map((entry, i) => {
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

      {/* FINISH — while the workout is open, whatever the clock says.
          Disabled until one real set exists: a 0-set finish would paint the day
          green with no training in it, and "past + no sets = MISSED" is
          load-bearing.
          NOT gated on `editable`: an athlete who starts at 23:50 and trains past
          midnight was left with a read-only page and NO FINISH BUTTON — the
          marker could never be written and the workout was unfinishable forever.
          The marker's date comes from the URL, not the clock, so writing it for
          yesterday is exactly right. */}
      {!finished && (editable || totalDone > 0) ? (
        <NeonButton
          title={totalDone > 0 ? `FINISH WORKOUT · ${totalDone}/${totalTarget} SETS` : 'LOG A SET TO FINISH'}
          onPress={() => setSheet(buildSummary())}
          disabled={totalDone === 0}
          busy={finishWorkout.isPending}
          testID="finish-workout"
        />
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

      <SummarySheet
        data={sheet}
        onClose={() => setSheet(null)}
        onFinish={finish}
        onSaveRoutine={
          performed().length > 0
            ? (name) => saveRoutine.mutate({ name, exercises: performed() })
            : undefined
        }
        defaultRoutineName={workoutName}
        // GHOST (migration 037): one tap publishes this session's combat
        // snapshot (numbers only) for friends to battle from the Arena.
        onShareGhost={() =>
          publishGhost.mutate({
            workout: workoutName,
            date,
            champion: championForBranch(branchV2),
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

      {/* SUPERSET pair-picker: link this exercise with another from today. */}
      {pairFor !== null ? (
        <Modal transparent animationType="fade" onRequestClose={() => setPairFor(null)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={() => setPairFor(null)}>
            <Pressable
              onPress={() => undefined}
              className="rounded-t-xl border-t p-s4"
              style={{ borderColor: `${tokens.colors.epic}40`, backgroundColor: tokens.colors.surface, maxHeight: 480 }}
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
                borderColor: `${tokens.colors.accent}40`,
                backgroundColor: tokens.colors.surface,
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
