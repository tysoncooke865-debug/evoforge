import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useWorkoutLog } from '@/data/hooks';
import { useDeleteRoutine, useRoutines } from '@/data/routines';
import { useWorkoutSchedule } from '@/data/schedule';
import { useReopenWorkout, useWorkoutSessions } from '@/data/sessions';
import { BUILT_IN_DAYS, useDayPlan } from '@/data/use-day-plan';
import { CARDIO_TYPES } from '@/domain/cardio';
import { daysForSource, defaultSource, type SourceIndex } from '@/domain/plan-sources';
import { pyFloat } from '@/domain/py';
import { adhocNameError, type SessionExercise } from '@/domain/session-plan';
import { normaliseWorkoutLog } from '@/domain/summary';
import { todayIso as calendarToday } from '@/domain/today';
import { buildWeekBars, extraBarsForToday, scheduledDayFor } from '@/domain/week-status';
import { adhocOf, useSessionStore } from '@/state/session-store';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { CardioCard, cardioAnim } from '@/ui/cardio-logger';
import { CompanionMenuButton } from '@/ui/companion-menu';
import { ExerciseSearchBar } from '@/ui/exercise-search-bar';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';
import { ScreenShell } from '@/ui/shell';
import { WeekBarRow } from '@/ui/week-bar';

/**
 * TRAIN — THE HUB (TRAIN_PAGE_V2).
 *
 * The week at a glance, and the doors into it. The logging UI used to expand
 * INLINE here, in the middle of the same scrolling page; it is now its own page
 * (`/workout`), entered by tapping a bar. Train answers "what am I doing, and
 * how is the week going". The workout page answers "do it".
 *
 * Kept here: the plan source (MY PLAN · AI PLAN · BUILT-IN), cardio (not a
 * workout in the week's sense), starting an empty workout, and the week itself.
 */
export default function TodayScreen() {
  const todayIso = calendarToday();

  const workouts = useWorkoutLog();
  const schedule = useWorkoutSchedule();
  const sessions = useWorkoutSessions();
  const reopenWorkout = useReopenWorkout();
  const routines = useRoutines();
  const deleteRoutine = useDeleteRoutine();
  const { sources, resolveDay } = useDayPlan();

  const adhoc = useSessionStore(adhocOf);
  const startAdhoc = useSessionStore((s) => s.startAdhoc);

  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);
  const [sourceChoice, setSource] = useState<SourceIndex | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);
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

  return (
    <ScreenShell>
      <ScreenHeader
        kicker={`TODAY · ${todayIso}`}
        title={mode === 1 ? 'CARDIO' : 'TRAIN'}
        right={<CompanionMenuButton anim={mode === 1 ? cardioAnim(cardioType) : 'idle'} height={56} />}
      />

      <SegmentedTabs left="LIFT" right="CARDIO" active={mode} onChange={setMode} testIDPrefix="today-mode" />

      <View style={{ display: mode === 0 ? 'flex' : 'none', gap: 16 }}>
        {/* MY PLAN · AI PLAN · BUILT-IN — which plan the week's days come from. */}
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
                accessibilityState={{ selected: active }}
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
        {sources.has.myPlan ? (
          <Link href={'/routine' as never} asChild>
            <Pressable accessibilityRole="button" testID="build-routine" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
                ⚒ EDIT MY PLAN →
              </Text>
            </Pressable>
          </Link>
        ) : null}

        {/* ALWAYS offered. It used to hide whenever an ad-hoc existed — and since
            nothing ever cleared one, a mistyped workout with no sets could be
            neither finished nor replaced, and the athlete was capped at one
            ad-hoc a day. startAdhoc overwrites; the door stays open. */}
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
                sets={setsFor(bar.date, bar.workout)}
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
            <Link href={'/schedule' as never} asChild>
              <Pressable accessibilityRole="button" testID="edit-week" className="mt-s1 items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
                  ◫ EDIT MY WEEK →
                </Text>
              </Pressable>
            </Link>
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
