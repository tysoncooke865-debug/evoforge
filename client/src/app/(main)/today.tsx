import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useCustomPlan, useWorkoutLog } from '@/data/hooks';
import { useClaimCoin } from '@/data/coins';
import { useWorkoutSchedule } from '@/data/schedule';
import { useAvatarData } from '@/data/use-avatar-data';
import { CARDIO_TYPES } from '@/domain/cardio';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { pyFloat } from '@/domain/py';
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
  const days = useAi && aiPlan.data ? aiPlan.data.days.map((d) => d.day) : builtInDays;
  // Clamp at render, not in an effect (react-hooks/set-state-in-effect):
  // switching source can leave the chosen chip outside the new day list —
  // the EFFECTIVE day falls back to the list's first entry, and the raw
  // choice is restored if the athlete toggles back.
  const day = days.includes(dayChoice) ? dayChoice : days[0];
  // Tyson 2026-07-13: session-level exercise substitution (same muscle).
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [subFor, setSubFor] = useState<string | null>(null);

  // P2 C3: LIFT | CARDIO mode; cardio type hoisted so the header sprite can
  // train what's being logged (the old log.tsx rationale, relocated).
  const [mode, setMode] = useState<0 | 1>(0);
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);

  // IMPROVEMENT_PLAN #11: default the day chip to today's SCHEDULED day
  // once a schedule exists; manual override stays (it's just useState).
  const schedule = useWorkoutSchedule();
  const scheduledDefaultRef = useRef(false);
  useEffect(() => {
    if (scheduledDefaultRef.current) return;
    const rows = schedule.data;
    if (!rows || rows.length === 0) return;
    scheduledDefaultRef.current = true;
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

  const builtIn = ROUTINE[day] ?? [];
  const aiDay = useAi ? aiPlan.data?.days.find((d) => d.day === day) : null;
  // The same [exercise, sets, scheme] tuple shape either way — with any
  // session substitutions applied (key `day:original` -> replacement).
  const basePlan: readonly (readonly [string, number, string])[] = aiDay
    ? aiDay.exercises.map((e) => [e.exercise, e.sets, e.reps] as const)
    : builtIn;
  const plan: readonly (readonly [string, number, string])[] = basePlan.map(
    ([ex, sets, scheme]) => [subs[`${day}:${ex}`] ?? ex, sets, scheme] as const
  );
  const totalTarget = plan.reduce((acc, [, sets]) => acc + sets, 0);
  const totalDone = plan.reduce(
    (acc, [exercise, sets]) => acc + Math.min(validRowsFor(exercise).length, sets),
    0
  );
  const complete = totalTarget > 0 && totalDone >= totalTarget;
  // The quest cursor: the first exercise still short of its target sets.
  const nextExercise = plan.find(([exercise, sets]) => validRowsFor(exercise).length < sets)?.[0] ?? null;


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

      {plan.map(([exercise, sets, scheme]) => (
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
          scheme={scheme}
          loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
          allRows={workouts.data ?? []}
          doneCount={validRowsFor(exercise).length}
          isNext={exercise === nextExercise}
          onPr={() => {
            prCountRef.current += 1;
            prNamesRef.current.push(exercise);
          }}
          durable
          onSubstitute={() => setSubFor(exercise)}
        />
      ))}

      {totalDone > 0 && !complete ? (
        <NeonButton
          title={`FINISH WORKOUT · ${totalDone}/${totalTarget} SETS`}
          variant="ghost"
          onPress={finishEarly}
          testID="finish-workout"
        />
      ) : null}
      </View>

      <View style={{ display: mode === 1 ? 'flex' : 'none', gap: 16 }}>
        <CardioCard type={cardioType} setType={setCardioType} />
      </View>
      <SummarySheet data={sheet} onClose={() => setSheet(null)} />

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
