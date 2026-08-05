import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { ORIGIN_FLAGS, useBindOrigin } from '@/data/origin';
import { enablePush } from '@/data/push';
import { supabase } from '@/data/supabase';
import { saveUserPlanDirect } from '@/data/user-plans';
import { seedPlanForSplit } from '@/domain/exercise-library';
import {
  EQUIPMENT,
  EQUIPMENT_LABEL,
  EXPERIENCE_LABEL,
  EXPERIENCE_LEVELS,
  firstMissionDay,
  GOAL_LABEL,
  GOAL_TO_PRIMARY,
  ONBOARDING_GOALS,
  recommendSplit,
  scheduleForSplit,
  SESSION_MINUTES,
  splitName,
  startingLevelV3,
  trainingYearsFor,
  type EquipmentAccess,
  type ExperienceLevel,
  type OnboardingGoal,
  type TrainingRoute,
} from '@/domain/onboarding-v3';
import type { OriginId } from '@/domain/origin/types';
import { todayIso } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ForgeLoader } from '@/ui/core/forge-loader';
import { GlowCard } from '@/ui/core/shell';
import { MissionReveal } from '@/ui/onboarding/mission-reveal';
import { ChampionPresentation, OriginChoice } from '@/ui/onboarding/origin-choice';
import { CreationBackdrop, OptionRow, PillRow, StepFrame } from '@/ui/onboarding/step-kit';
import { OriginFlow } from '@/ui/origin/origin-flow';

/**
 * ONBOARDING V3 — earn the information, don't demand it.
 * The contract is docs/ONBOARDING_V3_SPEC.md; domain/onboarding-v3.ts is the
 * pure core; this file is only the step machine and the two writes.
 *
 *   intro → goal → experience → route → [plan] → origin → ready → [schedule]
 *
 * WHAT V2 ASKED FOR AND V3 DOES NOT: height, bodyweight, bench/squat/deadlift
 * 1RMs, training years typed as a number, an eating phase, a physique photo,
 * and a globally-unique username — all before handing over anything at all.
 * Four of the fourteen athletes who opened that form never submitted it. Each
 * of those is still collected, later, where it earns its keep (spec §2).
 *
 * TWO WRITES, IN THIS ORDER, AND THE ORDER MATTERS:
 *   1. the profile row — which IS the onboarded flag, stamped
 *      onboarding_flow_version = 3;
 *   2. assign_origin_path — which READS that row (migration 135 lets a v3
 *      athlete pick any of the five, because at this point the candidate
 *      model has no evidence to narrow it with).
 * Seeding the plan comes after both and NEVER blocks: a dead network at that
 * point must not trap a new athlete on a wizard whose work is already saved.
 *
 * RESUME: a flow-3 profile with no origin returns to the `origin` step with
 * its answers read back off the row — the (main) gate sends them here, and
 * every answer v3 collects is already persisted by then.
 */

type Step = 'intro' | 'goal' | 'experience' | 'route' | 'plan' | 'origin' | 'forging' | 'ready' | 'schedule';

const FLOW_PROPS = { flow_version: 3, calibration_version: 5, user_type: 'new' as const };

const WEEKDAYS: { key: string; label: string }[] = [
  { key: '1', label: 'MON' }, { key: '2', label: 'TUE' }, { key: '3', label: 'WED' },
  { key: '4', label: 'THU' }, { key: '5', label: 'FRI' }, { key: '6', label: 'SAT' },
  { key: '0', label: 'SUN' },
];

/** What an athlete who already has a program wants to do about it. */
type ExistingPlanAction = 'builder' | 'scan' | 'empty' | 'later';

const EXISTING_ACTIONS: { key: ExistingPlanAction; label: string; hint: string }[] = [
  { key: 'builder', label: 'Build my routine', hint: 'Enter your days and exercises yourself.' },
  { key: 'scan', label: 'Paste or describe it with AI', hint: 'Photograph a written program, or just describe it.' },
  { key: 'empty', label: 'Start an empty workout', hint: 'Log as you go — no plan needed.' },
  { key: 'later', label: 'Do this later', hint: 'Go straight to the app.' },
];

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const { session, loading } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const bind = useBindOrigin();

  const [step, setStep] = useState<Step>('intro');
  const [goal, setGoal] = useState<OnboardingGoal | null>(null);
  const [secondary, setSecondary] = useState<OnboardingGoal[]>([]);
  const [experience, setExperience] = useState<ExperienceLevel | null>(null);
  const [route, setRoute] = useState<TrainingRoute | null>(null);
  const [existingAction, setExistingAction] = useState<ExistingPlanAction | null>(null);
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null);
  const [equipment, setEquipment] = useState<EquipmentAccess | null>(null);
  const [preferredDays, setPreferredDays] = useState<number[]>([]);
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [origin, setOrigin] = useState<OriginId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nextDay, setNextDay] = useState<number | null>(null);
  const [reminderState, setReminderState] = useState<'idle' | 'asking' | 'on' | 'refused'>('idle');

  /** Filled by forge() so the reveal describes the plan that really landed. */
  const [seeded, setSeeded] = useState<{
    splitKey: string | null;
    planName: string | null;
    missionDay: string | null;
    inDays: number;
    exercises: [string, number][];
  } | null>(null);

  const startedAt = useRef(0);
  useEffect(() => {
    if (!startedAt.current) startedAt.current = Date.now();
  }, []);

  /* A v2 athlete stranded between the profile insert and the origin bind
     still belongs in the OLD ceremony — v3 must not reinterpret a row that
     was written by a flow that asked different questions. */
  const v2Resume =
    ORIGIN_FLAGS.originOnboardingEnabled &&
    profile.data != null &&
    (profile.data.onboarding_flow_version ?? 0) === 2 &&
    profile.data.origin_path == null;

  /* A v3 athlete in the same position resumes at `origin`, with the answers
     read back off their row. Nothing else was ever held in memory. */
  const v3Resume =
    profile.data != null &&
    (profile.data.onboarding_flow_version ?? 0) >= 3 &&
    profile.data.origin_path == null;

  /* RESUME, during render rather than in an effect. React's documented
     "adjust state when the source changes" pattern: the re-render happens
     before anything is committed, so the athlete never sees step 1 flash
     before being put back on `origin`. An effect here would paint the wrong
     step first, and react-hooks/set-state-in-effect is an error for exactly
     that reason. */
  const [resumedId, setResumedId] = useState<string | null>(null);
  if (v3Resume && profile.data != null && resumedId !== profile.data.id) {
    const p = profile.data;
    setResumedId(p.id);
    setGoal((p.onboarding_goal as OnboardingGoal | null) ?? null);
    setSecondary((p.secondary_goals as OnboardingGoal[] | null) ?? []);
    setExperience((p.experience_level as ExperienceLevel | null) ?? null);
    setRoute((p.training_route as TrainingRoute | null) ?? null);
    setDaysPerWeek(p.training_days_per_week ?? null);
    setSessionMinutes(p.session_minutes ?? null);
    setEquipment((p.equipment_access as EquipmentAccess | null) ?? null);
    setPreferredDays(p.preferred_days ?? []);
    if (p.sex === 'male' || p.sex === 'female') setSex(p.sex);
    setStep('origin');
  }
  const resumeTracked = useRef(false);
  useEffect(() => {
    if (resumedId === null || resumeTracked.current) return;
    resumeTracked.current = true;
    track('onboarding_resumed', { ...FLOW_PROPS, resume_step: 'origin' });
  }, [resumedId]);

  const mountTracked = useRef(false);
  useEffect(() => {
    if (mountTracked.current || profile.isPending) return;
    if (profile.data == null) {
      mountTracked.current = true;
      track('onboarding_started', FLOW_PROPS);
    }
  }, [profile.isPending, profile.data]);

  if (!loading && !session) return <Redirect href="/sign-in" />;
  if (v2Resume) {
    return (
      <OriginFlow
        sex={profile.data?.sex ?? 'male'}
        userType="new"
        onComplete={() => {
          void (async () => {
            await queryClient.invalidateQueries({ queryKey: ['profile'] });
            router.replace('/' as never);
          })();
        }}
      />
    );
  }
  // Onboarded and bound: nothing to do here.
  if (profile.data && profile.data.origin_path != null) return <Redirect href={'/' as never} />;

  /* A LEGACY athlete (flow version NULL/0/1) with a profile but no Origin
     does NOT belong in v3's origin step. Migration 135's free five-way
     choice is scoped to flow >= 3, so a legacy athlete picking a
     non-candidate here would meet `not_offered` and a dead end. Their
     designed surface is the Forge's candidate reveal, which runs on the
     evidence they actually have. */
  if (
    profile.data &&
    profile.data.origin_path == null &&
    (profile.data.onboarding_flow_version ?? 0) < 2
  ) {
    return <Redirect href={'/avatar' as never} />;
  }

  /* ------------------------------------------------------------------ */
  /* the two writes                                                      */
  /* ------------------------------------------------------------------ */

  const empty = { splitKey: null, planName: null, missionDay: null, inDays: 0, exercises: [] as [string, number][] };

  const seedPlan = async (): Promise<typeof seeded> => {
    // The athlete who brought their own program gets nothing seeded over it.
    if (route !== 'build_for_me') return empty;
    const splitKey = recommendSplit({ goal, experience, daysPerWeek, equipment });
    const seed = seedPlanForSplit(splitKey);
    const week = scheduleForSplit(splitKey, preferredDays.length > 0 ? preferredDays : null);
    if (!seed || !week) return empty;

    // A split the athlete's answers chose is THEIR plan (MY PLAN), not the AI's.
    await saveUserPlanDirect('custom', { plan_name: seed.plan_name, days: seed.days });
    await supabase
      .from('workout_schedule')
      .upsert({ effective_from: todayIso(), plan: week }, { onConflict: 'user_id,effective_from' });

    const dow = new Date(`${todayIso()}T00:00:00Z`).getUTCDay();
    const mission = firstMissionDay(week, dow);
    const day = mission ? seed.days.find((d) => d.day === mission.day) : null;
    track('plan_created', {
      ...FLOW_PROPS,
      split: splitKey,
      split_name: splitName(splitKey),
      days_per_week: daysPerWeek,
      session_minutes: sessionMinutes,
      equipment,
      preferred_days_count: preferredDays.length,
    });
    return {
      splitKey,
      planName: seed.plan_name,
      missionDay: mission?.day ?? null,
      inDays: mission?.inDays ?? 0,
      exercises: (day?.exercises ?? []).map((e) => [e.exercise, e.sets] as [string, number]),
    };
  };

  const forge = async () => {
    if (busy || origin === null) return;
    setBusy(true);
    setError(null);
    setStep('forging');
    try {
      // 1. THE PROFILE ROW — the onboarded flag. user_id is never included
      //    (DEFAULT auth.uid() fills it). No lifts, no measurements, no
      //    physique score: none of them were asked for, and a fabricated
      //    default is worse than an honest null.
      if (profile.data == null) {
        const { error: err } = await supabase.from('profile').insert({
          sex,
          training_years: trainingYearsFor(experience),
          base_level: startingLevelV3(experience),
          primary_goal: goal ? GOAL_TO_PRIMARY[goal] : null,
          onboarding_goal: goal,
          secondary_goals: secondary.length > 0 ? secondary : null,
          experience_level: experience,
          training_route: route,
          training_days_per_week: daysPerWeek,
          session_minutes: sessionMinutes,
          equipment_access: equipment,
          preferred_days: preferredDays.length > 0 ? preferredDays : null,
          onboarding_flow_version: 3,
          created_at: new Date().toISOString().slice(0, 19),
        });
        if (err) throw new Error(err.message);
      }

      // 2. THE ORIGIN. Any of the five — migration 135.
      track('origin_binding_started', { ...FLOW_PROPS, origin_id: origin, free_choice: true });
      const r = await bind.mutateAsync(origin);
      if (!r.ok) {
        track('origin_binding_failed', { ...FLOW_PROPS, reason: r.reason ?? 'unknown' });
        setError('Your Origin could not be bound. Your answers are saved — try again.');
        setStep('origin');
        setBusy(false);
        return;
      }
      track('origin_binding_completed', {
        ...FLOW_PROPS,
        origin_id: origin,
        free_choice: true,
        followed_recommendation: r.followed_recommendation ?? null,
      });
      track('stage_one_awakened', { ...FLOW_PROPS, origin_id: origin });

      // 3. The plan. NEVER blocks — both writes above have already landed.
      let landed: typeof seeded = empty;
      try {
        landed = await seedPlan();
      } catch {
        /* the athlete still has an account, a character and the built-in routine */
      }
      setSeeded(landed);
      if (landed?.missionDay) {
        track('first_workout_viewed', { ...FLOW_PROPS, in_days: landed.inDays, source: 'onboarding_reveal' });
      }
      setStep('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — try again.');
      setStep('origin');
    } finally {
      setBusy(false);
    }
  };

  const leave = async (href: string) => {
    track('onboarding_completed', {
      ...FLOW_PROPS,
      duration_ms: Date.now() - startedAt.current,
      route,
      existing_action: existingAction,
      origin_id: origin,
    });
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    router.replace(href as never);
  };

  const startFirstWorkout = () => {
    track('first_workout_started', { ...FLOW_PROPS, source: 'onboarding_reveal' });
    if (seeded?.missionDay) {
      void leave(
        `/workout?date=${encodeURIComponent(todayIso())}&workout=${encodeURIComponent(seeded.missionDay)}&source=0&coach=1`
      );
      return;
    }
    // No seeded mission: the athlete brought their own program. Send them
    // exactly where their answer said, rather than to a plan they refused.
    void leave(
      existingAction === 'builder' ? '/routine'
        : existingAction === 'scan' ? '/routine?import=1'
        : existingAction === 'empty' ? '/today'
        : '/'
    );
  };

  /**
   * "My next session is Thursday" — made real, not just acknowledged.
   *
   * The seeded week is re-laid so the athlete's chosen day trains the
   * split's first day, keeping the split's own rest spacing. Home, Train and
   * the week strip all read that schedule, so the answer changes what the app
   * briefs tomorrow rather than being collected and dropped.
   */
  const commitNextSession = async () => {
    if (nextDay === null || !seeded?.splitKey) return;
    try {
      const { rotateScheduleToToday } = await import('@/domain/origin/first-mission');
      const week = rotateScheduleToToday(seeded.splitKey, nextDay);
      if (!week) return;
      await supabase
        .from('workout_schedule')
        .upsert({ effective_from: todayIso(), plan: week }, { onConflict: 'user_id,effective_from' });
      track('next_session_scheduled', { ...FLOW_PROPS, dow: nextDay });
    } catch {
      /* the seeded week stands — never block leaving onboarding */
    }
  };

  /* ------------------------------------------------------------------ */
  /* the steps                                                           */
  /* ------------------------------------------------------------------ */

  const total = route === 'build_for_me' ? 6 : 5;
  const planStep = route === 'build_for_me';

  if (step === 'intro') {
    return (
      <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }}>
        <CreationBackdrop />
        <ScrollView className="flex-1" contentContainerClassName="flex-grow items-center justify-center p-s6">
          <View className="w-full max-w-[480px]">
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{
                fontSize: 34,
                lineHeight: 40,
                letterSpacing: 0,
                textShadowColor: 'rgba(34,211,238,0.55)',
                textShadowRadius: 20,
                ...pixelFont(),
              }}
            >
              FORGE YOUR{'\n'}STRONGEST SELF
            </Text>
            <Text className="mt-s4 text-base text-text-dim">
              Track your training, build your Evo Rating and watch your character evolve alongside
              you.
            </Text>
            <View className="mt-s6">
              <NeonButton title="BEGIN" size="hero" onPress={() => setStep('goal')} testID="onboard-begin" />
            </View>
            <Pressable
              onPress={() => router.replace('/sign-in' as never)}
              accessibilityRole="button"
              testID="onboard-have-account"
              className="mt-s4 items-center"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text className="text-sm text-text-mute">Already have an account?</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (step === 'goal') {
    return (
      <StepFrame
        step={1}
        total={total}
        kicker="YOUR TRAINING"
        title="WHAT ARE YOU TRAINING FOR?"
        subtitle="Pick the one that matters most. Add others if you like."
        onBack={() => setStep('intro')}
        testID="step-goal"
        footer={
          <NeonButton
            title="CONTINUE"
            size="hero"
            disabled={goal === null}
            onPress={() => {
              track('goal_selected', { ...FLOW_PROPS, goal, secondary_count: secondary.length });
              setStep('experience');
            }}
            testID="goal-continue"
          />
        }
      >
        {ONBOARDING_GOALS.map((g) => (
          <OptionRow
            key={g}
            label={GOAL_LABEL[g]}
            selected={goal === g}
            onPress={() => {
              setGoal(g);
              setSecondary((s) => s.filter((x) => x !== g));
            }}
            testID={`goal-${g}`}
          />
        ))}
        {goal !== null ? (
          <View className="mt-s3">
            <Text
              className="mb-s2 text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              ALSO, IF YOU LIKE (OPTIONAL)
            </Text>
            <PillRow
              options={ONBOARDING_GOALS.filter((g) => g !== goal).map((g) => ({ key: g, label: GOAL_LABEL[g] }))}
              isSelected={(k) => secondary.includes(k as OnboardingGoal)}
              onToggle={(k) =>
                setSecondary((s) =>
                  s.includes(k as OnboardingGoal) ? s.filter((x) => x !== k) : [...s, k as OnboardingGoal]
                )
              }
              testIDPrefix="goal2"
            />
          </View>
        ) : null}
      </StepFrame>
    );
  }

  if (step === 'experience') {
    return (
      <StepFrame
        step={2}
        total={total}
        kicker="YOUR TRAINING"
        title="WHERE ARE YOU STARTING FROM?"
        subtitle="You can change this later."
        onBack={() => setStep('goal')}
        testID="step-experience"
        footer={
          <NeonButton
            title="CONTINUE"
            size="hero"
            disabled={experience === null}
            onPress={() => {
              track('experience_selected', { ...FLOW_PROPS, experience });
              setStep('route');
            }}
            testID="experience-continue"
          />
        }
      >
        {EXPERIENCE_LEVELS.map((e) => (
          <OptionRow
            key={e}
            label={EXPERIENCE_LABEL[e]}
            selected={experience === e}
            onPress={() => setExperience(e)}
            testID={`experience-${e}`}
          />
        ))}
      </StepFrame>
    );
  }

  if (step === 'route') {
    const goNext = (r: TrainingRoute, action: ExistingPlanAction | null) => {
      track('training_route_selected', { ...FLOW_PROPS, route: r, existing_action: action });
      setStep(r === 'build_for_me' ? 'plan' : 'origin');
    };
    return (
      <StepFrame
        step={3}
        total={total}
        kicker="YOUR TRAINING"
        title="HOW DO YOU WANT TO BEGIN?"
        onBack={() => setStep('experience')}
        testID="step-route"
        footer={
          route === 'have_program' ? (
            <NeonButton
              title="CONTINUE"
              size="hero"
              disabled={existingAction === null}
              onPress={() => goNext('have_program', existingAction)}
              testID="route-continue"
            />
          ) : undefined
        }
      >
        <OptionRow
          label="I already have a program"
          hint="Coming from Hevy, Strong or a spreadsheet."
          selected={route === 'have_program'}
          onPress={() => setRoute('have_program')}
          testID="route-have"
        />
        {route === 'have_program' ? (
          <View className="mb-s3 pl-s3">
            {EXISTING_ACTIONS.map((a) => (
              <OptionRow
                key={a.key}
                label={a.label}
                hint={a.hint}
                tone="epic"
                selected={existingAction === a.key}
                onPress={() => setExistingAction(a.key)}
                testID={`route-action-${a.key}`}
              />
            ))}
          </View>
        ) : null}
        <OptionRow
          label="Build a program for me"
          hint="Four quick questions and your week is set."
          selected={route === 'build_for_me'}
          onPress={() => {
            setRoute('build_for_me');
            setExistingAction(null);
            goNext('build_for_me', null);
          }}
          testID="route-build"
        />
      </StepFrame>
    );
  }

  if (step === 'plan') {
    const ready = daysPerWeek !== null && sessionMinutes !== null && equipment !== null;
    return (
      <StepFrame
        step={4}
        total={total}
        kicker="YOUR WEEK"
        title="BUILD MY PROGRAM"
        subtitle="Four answers. Everything is editable afterwards."
        onBack={() => setStep('route')}
        testID="step-plan"
        footer={
          <>
            <NeonButton
              title="CONTINUE"
              size="hero"
              disabled={!ready}
              onPress={() => setStep('origin')}
              testID="plan-continue"
            />
            <NeonButton
              title="I'M NOT SURE YET"
              variant="ghost"
              onPress={() => {
                // A sensible, statable default rather than a blocked athlete:
                // three days, an hour, and no equipment claim we cannot back.
                setDaysPerWeek(3);
                setSessionMinutes(60);
                setEquipment('unsure');
                setPreferredDays([]);
                setStep('origin');
              }}
              testID="plan-unsure"
            />
          </>
        }
      >
        <Question label="TRAINING DAYS PER WEEK">
          <PillRow
            options={[2, 3, 4, 5, 6].map((n) => ({ key: String(n), label: String(n) }))}
            isSelected={(k) => daysPerWeek === Number(k)}
            onToggle={(k) => setDaysPerWeek(Number(k))}
            testIDPrefix="plan-days"
          />
        </Question>
        <Question label="TYPICAL SESSION LENGTH">
          <PillRow
            options={SESSION_MINUTES.map((m) => ({ key: String(m), label: `${m} MIN` }))}
            isSelected={(k) => sessionMinutes === Number(k)}
            onToggle={(k) => setSessionMinutes(Number(k))}
            testIDPrefix="plan-minutes"
          />
        </Question>
        <Question label="AVAILABLE EQUIPMENT">
          {EQUIPMENT.map((e) => (
            <OptionRow
              key={e}
              label={EQUIPMENT_LABEL[e]}
              selected={equipment === e}
              onPress={() => setEquipment(e)}
              testID={`plan-equipment-${e}`}
            />
          ))}
        </Question>
        <Question label="PREFERRED TRAINING DAYS (OPTIONAL)">
          <PillRow
            options={WEEKDAYS}
            isSelected={(k) => preferredDays.includes(Number(k))}
            onToggle={(k) =>
              setPreferredDays((d) =>
                d.includes(Number(k)) ? d.filter((x) => x !== Number(k)) : [...d, Number(k)]
              )
            }
            testIDPrefix="plan-day"
          />
        </Question>
      </StepFrame>
    );
  }

  if (step === 'origin') {
    return (
      <StepFrame
        step={planStep ? 5 : 4}
        total={total}
        kicker="YOUR CHARACTER"
        title="CHOOSE YOUR ORIGIN"
        subtitle="Pick who you want to become, not what you look like today. You can re-choose for free after three workouts."
        onBack={() => setStep(planStep ? 'plan' : 'route')}
        testID="step-origin"
        footer={
          <>
            {error ? <Text className="text-sm text-danger">{error}</Text> : null}
            <NeonButton
              title="FORGE MY CHAMPION"
              size="hero"
              busy={busy}
              disabled={origin === null}
              onPress={() => void forge()}
              testID="origin-forge"
            />
          </>
        }
      >
        <ChampionPresentation sex={sex} onChange={setSex} />
        <OriginChoice
          sex={sex}
          selected={origin}
          onSelect={(id) => {
            setOrigin(id);
            track('origin_selected', { ...FLOW_PROPS, origin_id: id, free_choice: true });
          }}
        />
      </StepFrame>
    );
  }

  if (step === 'forging') {
    return (
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors['bg-deep'] }}>
        <CreationBackdrop />
        <ForgeLoader label="Forging your champion" />
      </View>
    );
  }

  if (step === 'ready' && origin !== null) {
    return (
      <StepFrame
        step={total}
        total={total}
        kicker="THE FORGE"
        title="YOUR FORGE IS READY."
        onBack={null}
        testID="step-ready"
        footer={
          <>
            <NeonButton
              title={seeded?.missionDay ? 'START FIRST WORKOUT' : 'ENTER THE FORGE'}
              size="hero"
              sweep
              onPress={startFirstWorkout}
              testID="ready-start"
            />
            <NeonButton
              title="NOT TODAY"
              variant="ghost"
              onPress={() => setStep('schedule')}
              testID="ready-not-today"
            />
          </>
        }
      >
        <MissionReveal
          originId={origin}
          sex={sex}
          planName={seeded?.planName ?? null}
          missionDay={seeded?.missionDay ?? null}
          inDays={seeded?.inDays ?? 0}
          exercises={seeded?.exercises ?? []}
          testID="mission-reveal"
        />
      </StepFrame>
    );
  }

  if (step === 'schedule') {
    return (
      <StepFrame
        step={total}
        total={total}
        kicker="THE FORGE"
        title="WHEN IS YOUR NEXT SESSION?"
        subtitle="Naming the day is the single best predictor that it happens."
        onBack={() => setStep('ready')}
        testID="step-schedule"
        footer={
          <>
            <NeonButton
              title="THAT'S MY PLAN"
              size="hero"
              onPress={() => void commitNextSession().then(() => leave('/'))}
              testID="schedule-done"
            />
          </>
        }
      >
        <PillRow
          options={WEEKDAYS}
          isSelected={(k) => nextDay === Number(k)}
          onToggle={(k) => setNextDay(Number(k))}
          testIDPrefix="next-day"
        />
        {nextDay !== null && seeded?.splitKey ? (
          <Text className="mt-s2 text-2xs text-text-mute">
            Your week will be re-laid so {WEEKDAYS.find((d) => Number(d.key) === nextDay)?.label} is
            session one, keeping the rest days the split needs.
          </Text>
        ) : null}

        <View className="mt-s5">
          <GlowCard padding={14}>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              A NUDGE ON YOUR TRAINING DAYS
            </Text>
            {/* The reminder rail (migration 085) never nudges an athlete who
                has not logged a set — deliberately, so a notification is not
                used to manufacture a habit that does not exist yet. Saying so
                is the difference between a promise and a lie. */}
            <Text className="mt-s2 text-2xs text-text-mute">
              {reminderState === 'on'
                ? 'Reminders are on. The first one arrives on a training day after your first logged workout — never before.'
                : 'We can remind you on the days your schedule says you train. Reminders start after your first logged workout, and name the actual session.'}
            </Text>
            {reminderState === 'refused' ? (
              <Text className="mt-s2 text-2xs text-warn">
                Notifications are blocked for this app — turn them on in your browser or device
                settings if you change your mind.
              </Text>
            ) : null}
            {reminderState === 'on' ? null : (
              <View className="mt-s3">
                <NeonButton
                  title={reminderState === 'asking' ? 'ASKING' : 'REMIND ME'}
                  variant="ghost"
                  busy={reminderState === 'asking'}
                  onPress={() => {
                    // Permission is requested HERE — on the tap that asks for
                    // it — and nowhere in signup.
                    setReminderState('asking');
                    void enablePush().then((s) => {
                      setReminderState(s === 'granted' ? 'on' : 'refused');
                      track(s === 'granted' ? 'reminder_enabled' : 'reminder_declined', {
                        ...FLOW_PROPS,
                        push_state: s,
                      });
                    });
                  }}
                  testID="schedule-remind"
                />
              </View>
            )}
          </GlowCard>
        </View>
      </StepFrame>
    );
  }

  // 'ready' without an origin is unreachable by construction; render the
  // loader rather than a blank screen if it ever happens.
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors['bg-deep'] }}>
      <ForgeLoader label="Preparing your forge" />
    </View>
  );
}

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mb-s5">
      <Text
        className="mb-s2 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}
