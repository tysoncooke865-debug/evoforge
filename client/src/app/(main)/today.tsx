import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useCustomPlan, useWorkoutLog } from '@/data/hooks';
import { useClaimCoin } from '@/data/coins';
import { useDeleteRoutine, useRoutines, useSaveRoutine } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
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
import { normaliseWorkoutLog } from '@/domain/summary';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { Link } from 'expo-router';

import { substitutesFor } from '@/domain/exercise-library';
import { CardioCard, cardioAnim } from '@/ui/cardio-logger';
import { RestTimerBar } from '@/ui/rest-timer';
import { ExerciseCard } from '@/ui/exercise-logger';
import { ExercisePicker } from '@/ui/exercise-picker';
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
export default function TodayScreen() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const builtInDays = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);
  const [dayChoice, setDay] = useState(builtInDays[0]);

  // IMPROVEMENT_PLAN #10: the workout source. The AI plan shares the six
  // day names, so the chips, completion and logging are source-agnostic --
  // only the exercise list under each day changes.
  const aiPlan = useCustomPlan();
  const [source, setSource] = useState<0 | 1>(0);
  const useAi = source === 1 && aiPlan.data !== null && aiPlan.data !== undefined;
  // Custom plans (AI or hand-built) drive their OWN day list — builder
  // splits use names like "Upper A" that are not in ROUTINE_ORDER.
  const planDays = useAi && aiPlan.data ? aiPlan.data.days.map((d) => d.day) : builtInDays;

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
  const day = days.includes(dayChoice) ? dayChoice : days[0];
  const onAdhocDay = adhoc !== null && day === adhoc.name;
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
  const { summary, stats, bfMid } = useAvatarData();
  const [sheet, setSheet] = useState<WorkoutSummaryData | null>(null);
  const prCountRef = useRef(0);
  // P4: which lifts PR'd this session, for the ceremony's reveal phase.
  const prNamesRef = useRef<string[]>([]);
  const todayRows = useMemo(
    () =>
      normaliseWorkoutLog(workouts.data ?? []).filter(
        (r) => String(r.date) === todayIso && String(r.workout) === day
      ),
    [workouts.data, todayIso, day]
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

  const builtIn = ROUTINE[day] ?? [];
  const aiDay = useAi ? aiPlan.data?.days.find((d) => d.day === day) : null;
  // The same [exercise, sets, scheme] tuple shape whatever the source — an
  // ad-hoc workout's "plan" is simply whatever it was started with (empty, or
  // a saved routine's exercises).
  const basePlan: readonly (readonly [string, number, string])[] = onAdhocDay
    ? (adhoc?.exercises ?? []).map((e) => [e.exercise, e.sets, e.reps] as const)
    : aiDay
      ? aiDay.exercises.map((e) => [e.exercise, e.sets, e.reps] as const)
      : builtIn;
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
    if (complete && announcedRef.current !== sessionKey) {
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
        title={mode === 1 ? 'CARDIO' : day.split(' - ')[0].toUpperCase()}
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
      {aiPlan.data ? (
        <SegmentedTabs left="BUILT-IN" right="MY PLAN" active={source} onChange={setSource} testIDPrefix="today-source" />
      ) : (
        <Link href={'/routine' as never} asChild>
          <Pressable accessibilityRole="button" testID="build-routine" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              ⚒ BUILD MY OWN ROUTINE →
            </Text>
          </Pressable>
        </Link>
      )}

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

      <GlowCard glow={complete ? tokens.colors.success : undefined}>
        <View className="mb-s4 flex-row flex-wrap gap-s2">
          {days.map((d) => (
            <Chip key={d} label={d} active={d === day} onPress={() => setDay(d)} />
          ))}
        </View>

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

      {plan.map((entry) => {
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
            onSubstitute={() => setSubFor(exercise)}
            skipped={skipped}
            onRemove={() => removeOrSkip(exercise)}
            onSkip={() => toggleSkip(day, exercise)}
            onAddSet={canAddSet(sets) ? () => bumpSets(day, exercise, 1) : undefined}
            // Absent, not disabled, at the floor — the row below it is logged.
            onRemoveSet={canRemoveSet(sets, facts) ? () => bumpSets(day, exercise, -1) : undefined}
          />
        );
      })}

      {/* STAGE 1: the plan is a suggestion, not a cage. */}
      <NeonButton
        title="＋ ADD EXERCISE"
        variant="ghost"
        onPress={() => setPickerOpen(true)}
        testID="add-exercise"
      />

      {totalDone > 0 && !complete ? (
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
            setDay(planDays[0]);
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
      />

      <View style={{ display: mode === 1 ? 'flex' : 'none', gap: 16 }}>
        <CardioCard type={cardioType} setType={setCardioType} />
      </View>
      <SummarySheet
        data={sheet}
        onClose={() => {
          // The ceremony closing IS the end of the workout: a cold start after
          // this reopens Home, not a workout the athlete already finished.
          setSheet(null);
          clearActive();
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
