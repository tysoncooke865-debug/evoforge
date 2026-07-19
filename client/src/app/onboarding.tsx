import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique } from '@/data/ai';
import { track } from '@/data/analytics';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { ORIGIN_FLAGS } from '@/data/origin';
import { saveUserPlanDirect } from '@/data/user-plans';
import { supabase } from '@/data/supabase';
import { defaultScheduleFor, seedPlanForSplit, SPLITS } from '@/domain/exercise-library';
import { nameError } from '@/domain/leaderboard';
import type { BattleStylePref, PrimaryGoal } from '@/domain/origin/types';
import { rankName } from '@/domain/profile';
import { pyFloat } from '@/domain/py';
import {
  derivedLeannessDefault,
  derivedPhysiqueDefault,
  startingLevelV2,
  type NutritionPhase,
} from '@/domain/starting-level-v2';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';
import { OriginFlow } from '@/ui/origin/origin-flow';
import { ScanFrame, type ScanState } from '@/ui/train/scan-frame';
import { todayIso } from '@/domain/today';

/**
 * CHARACTER CREATION V2 — now a TWO-ACT flow (docs/ORIGIN_ONBOARDING_SPEC.md):
 *
 *   Act I  (this form, local state only, unchanged loss semantics)
 *     1. WHO    — sex, height, bodyweight
 *     2. LIFTS  — bench / squat / deadlift 1RM + training years
 *     3. FUEL   — cutting / maintaining / bulking / flexible
 *     4. DRIVE  — primary goal + battle style (the Destined/Anomaly inputs)
 *     5. SCAN   — AI physique + body fat (skippable; derived defaults)
 *     6. TRAINING — a split (seeds plan AND week; default SKIP)
 *     7. PROFILE — public identity
 *   Act II (<OriginFlow/> — rating reveal → 3 candidates → bind → awakening)
 *
 * A SAVED PROFILE ROW IS STILL THE ONBOARDED FLAG. The insert never includes
 * user_id (DEFAULT auth.uid() fills it). physique/leanness scores stored on
 * the profile come from the AI scan or the derived defaults -- the athlete
 * never grades themself. The insert also stamps onboarding_flow_version = 2,
 * which is what lets the (main) gate return an interrupted Act II athlete
 * here WITHOUT trapping legacy users (their flow version is NULL).
 */

const PHASES: { key: NutritionPhase; label: string }[] = [
  { key: 'cutting', label: '🔪 Cutting' },
  { key: 'maintaining', label: '⚖️ Maintaining' },
  { key: 'bulking', label: '🍚 Bulking' },
  { key: 'flexible', label: '🍕 Eat whatever' },
];

/** A curated few — every split the builder offers would be a wall of choice
 *  on day one, and only seedable splits belong here. */
const ONBOARDING_SPLITS = SPLITS.filter((s) => ['ppl3', 'ul4', 'cbal3', 'fb3'].includes(s.key));

const GOALS: { key: PrimaryGoal; label: string }[] = [
  { key: 'strength', label: '🏋️ Strength' },
  { key: 'muscle_gain', label: '💪 Build muscle' },
  { key: 'fat_loss', label: '🔥 Lose fat' },
  { key: 'cardio', label: '🫀 Engine' },
  { key: 'aesthetics', label: '✨ Aesthetics' },
];

const BATTLE_STYLES: { key: BattleStylePref; label: string }[] = [
  { key: 'force', label: '▲ FORCE — overwhelm' },
  { key: 'form', label: '◆ FORM — out-technique' },
  { key: 'flow', label: '● FLOW — out-last' },
];

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const { session, loading } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();

  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('175');
  const [bodyweight, setBodyweight] = useState('75');
  const [bench, setBench] = useState('60');
  const [squat, setSquat] = useState('80');
  const [deadlift, setDeadlift] = useState('100');
  const [years, setYears] = useState('1');
  const [phase, setPhase] = useState<NutritionPhase>('maintaining');

  const [photo, setPhoto] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [aiPhysique, setAiPhysique] = useState<number | null>(null);
  const [aiLeanness, setAiLeanness] = useState<number | null>(null);
  const [bfNote, setBfNote] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicName, setPublicName] = useState('');
  // PRIVATE BY DEFAULT — being seen is opted INTO, never out of.
  const [goPublic, setGoPublic] = useState(false);
  const savePublic = useSavePublicIdentity();
  // STAGE 1: null = skip (the default — onboarding stays fast),
  // 'builder' = take me to the routine builder, else a split key to seed.
  const [splitKey, setSplitKey] = useState<string | null>(null);
  // DRIVE (047): the Destined + Anomaly calibration inputs. Optional — a
  // skipped goal falls back to the nutrition phase, never a dead end.
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | null>(null);
  const [battleStyle, setBattleStyle] = useState<BattleStylePref | null>(null);
  // Act II: set by forge() when the origin ceremony takes over the route.
  const [ceremony, setCeremony] = useState(false);

  // A flow-v2 athlete WITHOUT an origin belongs in Act II — fresh from
  // forge() (ceremony) or RESUMED here by the (main) gate after an
  // interruption. Legacy users (flow version NULL) never match.
  const needsOriginResume =
    ORIGIN_FLAGS.originOnboardingEnabled &&
    profile.data != null &&
    (profile.data.onboarding_flow_version ?? 0) >= 2 &&
    profile.data.origin_path == null;

  const mountTracked = useRef(false);
  useEffect(() => {
    if (mountTracked.current || profile.isPending) return;
    if (profile.data == null) {
      mountTracked.current = true;
      track('onboarding_started', { flow_version: 2, calibration_version: 5, user_type: 'new' });
    } else if (needsOriginResume) {
      mountTracked.current = true;
      track('onboarding_resumed', {
        flow_version: 2, calibration_version: 5, user_type: 'new', resume_step: 'rating',
      });
    }
  }, [profile.isPending, profile.data, needsOriginResume]);

  if (!loading && !session) return <Redirect href="/sign-in" />;
  if (ceremony || needsOriginResume) {
    return (
      <OriginFlow
        sex={profile.data?.sex ?? sex}
        userType="new"
        onComplete={() => {
          // AWAIT the refetch: navigating with a stale null profile makes
          // the (main) gate bounce the just-finished athlete straight back
          // to /onboarding (caught by the O-series tour).
          void (async () => {
            await queryClient.invalidateQueries({ queryKey: ['profile'] });
            // BUILD MY OWN / SCAN MY PLAN still land where Act I promised.
            router.replace(
              (splitKey === 'builder' ? '/routine' : splitKey === 'scan' ? '/routine?import=1' : '/') as never,
            );
          })();
        }}
      />
    );
  }
  // An onboarded athlete who asked to BUILD MY OWN lands in the builder, not
  // on Home — that was the whole point of the tap. SCAN MY PLAN lands there
  // too, with the import sheet already open (PLAN SCAN).
  if (profile.data)
    return (
      <Redirect
        href={
          (splitKey === 'builder' ? '/routine' : splitKey === 'scan' ? '/routine?import=1' : '/') as never
        }
      />
    );

  const nums = {
    height: pyFloat(height) ?? 0,
    bodyweight: pyFloat(bodyweight) ?? 0,
    bench: pyFloat(bench) ?? 0,
    squat: pyFloat(squat) ?? 0,
    deadlift: pyFloat(deadlift) ?? 0,
    years: pyFloat(years) ?? 0,
  };
  const valid =
    nums.height >= 100 && nums.height <= 230 &&
    nums.bodyweight >= 30 && nums.bodyweight <= 200 &&
    nums.bench >= 0 && nums.bench <= 300 &&
    nums.squat >= 0 && nums.squat <= 400 &&
    nums.deadlift >= 0 && nums.deadlift <= 450 &&
    nums.years >= 0 && nums.years <= 30;

  // The USERNAME is the real hard gate (mandatory + unique). Fold it into the
  // button's disabled state so an empty/invalid name can't sail past the tap
  // and fail silently at the bottom of a long scroll (2026-07-19).
  const nameOk = publicName.trim().length >= 3 && nameError(publicName) === null;

  const clamp15 = (v: unknown) => Math.max(0, Math.min(15, Math.round(Number(v) || 0)));

  const previewLevel = valid
    ? startingLevelV2({
        benchE1rm: nums.bench,
        squatE1rm: nums.squat,
        deadliftE1rm: nums.deadlift,
        trainingYears: nums.years,
        aiPhysique,
        aiLeanness,
        phase,
      })
    : null;

  const scanState: ScanState = scanBusy
    ? 'analysing'
    : scanError
      ? 'error'
      : aiPhysique !== null
        ? 'complete'
        : photo
          ? 'ready'
          : 'idle';

  const runScan = async () => {
    if (!photo) return;
    setScanBusy(true);
    setScanError(null);
    const [phys, fat] = await Promise.all([
      runAiPhysique([photo], { height_cm: nums.height, bodyweight: nums.bodyweight, context: 'onboarding' }),
      runAiBodyfat([photo], { height_cm: nums.height, weight_kg: nums.bodyweight, save: true }),
    ]);
    setScanBusy(false);
    setPhoto(null); // analysed and dropped
    if (phys.result) {
      setAiPhysique(clamp15(phys.result.physique_score));
      setAiLeanness(clamp15(phys.result.leanness_score));
    } else if (phys.error) {
      setScanError(phys.error);
    }
    if (fat.result) {
      setBfNote(`${fat.result.bf_mid.toFixed(1)}% body fat saved as your first reading.`);
    }
  };

  const forge = async () => {
    if (busy) return; // re-entrancy: the button disables, the handler guards too
    if (!valid || previewLevel === null) {
      setError('Check the highlighted numbers.');
      return;
    }
    // §6.3 (2026-07-19): the username is MANDATORY and must be unique. It
    // saves BEFORE the profile insert — the profile row is the onboarded
    // flag, and a taken name must re-prompt, not slip past the gate. The
    // 004 unique index is the arbiter (no pre-check RPC to race against).
    const nameProblem = nameError(publicName);
    if (nameProblem !== null) {
      setError(`Username: ${nameProblem}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await savePublic.mutateAsync({ displayName: publicName.trim(), isPublic: goPublic });
    } catch (e) {
      // 'That display name is already taken.' from useSavePublicIdentity —
      // block and re-prompt until they pick a free one.
      setError(e instanceof Error ? e.message : 'That username is taken — choose another.');
      setBusy(false);
      return;
    }
    track('initial_assessment_started', {
      flow_version: 2, calibration_version: 5, user_type: 'new',
      has_scan: aiPhysique !== null, split_chosen: splitKey !== null,
    });
    const physiqueScore = aiPhysique ?? derivedPhysiqueDefault(nums.bench, nums.squat, nums.deadlift);
    const leannessScore = aiLeanness ?? derivedLeannessDefault(phase);
    const { error: err } = await supabase.from('profile').insert({
      height_cm: nums.height,
      bodyweight_kg: nums.bodyweight,
      bench_e1rm: nums.bench,
      squat_e1rm: nums.squat,
      deadlift_e1rm: nums.deadlift,
      training_years: nums.years,
      physique_score: physiqueScore,
      leanness_score: leannessScore,
      sex,
      nutrition_phase: phase,
      base_level: previewLevel,
      primary_goal: primaryGoal,
      battle_style: battleStyle,
      onboarding_flow_version: 2,
      created_at: new Date().toISOString().slice(0, 19),
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    track('initial_assessment_completed', { flow_version: 2, calibration_version: 5, user_type: 'new' });
    // (The public identity saved BEFORE the profile insert — see above. The
    // old optional/swallowed save let a name collision vanish silently.)

    // STAGE 1: seed the chosen split — the plan AND the week it implies. Same
    // "never blocks" rule as GO PUBLIC: the profile row is the onboarded flag,
    // and a dead network here must not trap a new athlete on the wizard. They
    // land on the built-in routine and can build their own any time.
    if (splitKey !== null && splitKey !== 'builder' && splitKey !== 'scan') {
      try {
        const seed = seedPlanForSplit(splitKey);
        if (seed) {
          // A split the athlete chose is THEIR plan (MY PLAN), not the AI's.
          await saveUserPlanDirect('custom', { plan_name: seed.plan_name, days: seed.days });
          const week = defaultScheduleFor(splitKey);
          if (week) {
            await supabase
              .from('workout_schedule')
              .upsert(
                { effective_from: todayIso(), plan: week },
                { onConflict: 'user_id,effective_from' }
              );
          }
        }
      } catch {
        /* never block onboarding */
      }
    }

    // ACT II HANDOFF (047): the origin ceremony takes over this route. The
    // ['profile'] invalidation is deliberately withheld — profile.data
    // flipping non-null is what fires the legacy redirect, and Act II must
    // hold the route until binding completes. OriginFlow's onComplete does
    // the invalidation and the final navigation.
    if (ORIGIN_FLAGS.originOnboardingEnabled) {
      setCeremony(true);
      setBusy(false);
      return;
    }

    try {
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors['bg-deep'] }}>
      {/* The shell's ambient light rig — creation sits on the same stage. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: -220, left: -200, width: 440, height: 440, borderRadius: 220, backgroundColor: 'rgba(34, 211, 238, 0.05)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -200, right: -220, width: 400, height: 400, borderRadius: 200, backgroundColor: 'rgba(168, 85, 247, 0.045)' }} />
    <ScrollView className="flex-1" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[480px]">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          CHARACTER CREATION
        </Text>
        <Text
          className="mb-s5 text-accent"
          allowFontScaling={false}
          style={{
            fontSize: 30,
            lineHeight: 36,
            letterSpacing: 0,
            textShadowColor: 'rgba(34,211,238,0.55)',
            textShadowRadius: 18,
            ...pixelFont(),
          }}
        >
          FORGE YOUR CHARACTER
        </Text>

        {/* 1 · WHO */}
        <Section n="1" title="WHO ARE YOU">
          <View className="mb-s3 flex-row gap-s2">
            <Chip label="♂ Male" active={sex === 'male'} onPress={() => setSex('male')} testID="sex-male" />
            <Chip label="♀ Female" active={sex === 'female'} onPress={() => setSex('female')} testID="sex-female" />
          </View>
          <View className="flex-row gap-s2">
            <Num label="HEIGHT CM" value={height} onChange={setHeight} testID="height_cm" />
            <Num label="BODYWEIGHT KG" value={bodyweight} onChange={setBodyweight} testID="bodyweight_kg" />
          </View>
        </Section>

        {/* 2 · LIFTS */}
        <Section n="2" title="YOUR LIFTS (1RM, BEST GUESS IS FINE)">
          <View className="mb-s2 flex-row gap-s2">
            <Num label="BENCH KG" value={bench} onChange={setBench} testID="bench_e1rm" />
            <Num label="SQUAT KG" value={squat} onChange={setSquat} testID="squat_e1rm" />
            <Num label="DEADLIFT KG" value={deadlift} onChange={setDeadlift} testID="deadlift_e1rm" />
          </View>
          <Num label="TRAINING YEARS" value={years} onChange={setYears} testID="training_years" />
        </Section>

        {/* 3 · FUEL */}
        <Section n="3" title="HOW ARE YOU EATING">
          <View className="flex-row flex-wrap gap-s2">
            {PHASES.map((p) => (
              <Chip key={p.key} label={p.label} active={phase === p.key} onPress={() => setPhase(p.key)} testID={`phase-${p.key}`} />
            ))}
          </View>
        </Section>

        {/* 4 · DRIVE (047): who you want to become + how you like to fight.
            These feed the Destined and Anomaly candidates in Act II —
            skipped, the nutrition phase infers the goal instead. */}
        <Section n="4" title="YOUR DRIVE (OPTIONAL)">
          <Text
            className="mb-s2 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            PRIMARY GOAL
          </Text>
          <View className="mb-s3 flex-row flex-wrap gap-s2">
            {GOALS.map((g) => (
              <Chip
                key={g.key}
                label={g.label}
                active={primaryGoal === g.key}
                onPress={() => setPrimaryGoal(primaryGoal === g.key ? null : g.key)}
                testID={`goal-${g.key}`}
              />
            ))}
          </View>
          <Text
            className="mb-s2 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            BATTLE STYLE
          </Text>
          <View className="flex-row flex-wrap gap-s2">
            {BATTLE_STYLES.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                active={battleStyle === s.key}
                onPress={() => setBattleStyle(battleStyle === s.key ? null : s.key)}
                testID={`style-${s.key}`}
              />
            ))}
          </View>
        </Section>

        {/* 5 · SCAN */}
        <Section n="5" title="THE SCAN (OPTIONAL BUT HONEST)">
          <Text className="mb-s3 text-2xs text-text-mute">
            One physique photo: the AI rates physique and leanness and saves your first body-fat
            reading. Skip it and conservative defaults from your lifts and eating phase apply —
            you never grade yourself either way. Analysed in memory, never stored.
          </Text>
          <ScanFrame state={scanState}>
            <View className="flex-row items-center gap-s3 p-s2">
              <Pressable
                onPress={async () => {
                  const uri = await pickPhoto();
                  if (uri) {
                    setPhoto(uri);
                    setScanError(null);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Pick physique photo"
                className="items-center justify-center rounded-md border border-border bg-surface-2"
                style={{ width: 72, height: 92 }}
              >
                {photo ? (
                  <Image source={{ uri: photo }} style={{ width: 64, height: 84, borderRadius: 6 }} contentFit="cover" />
                ) : (
                  <Text className="text-2xl text-text-mute">＋</Text>
                )}
              </Pressable>
              <View className="flex-1">
                {aiPhysique !== null ? (
                  <Text className="text-sm text-text">
                    Physique <Text className="font-bold text-accent">{aiPhysique}</Text>
                    <Text className="text-text-mute"> / 15   ·   </Text>
                    Leanness <Text className="font-bold text-accent">{aiLeanness}</Text>
                    <Text className="text-text-mute"> / 15</Text>
                  </Text>
                ) : (
                  <Text className="text-xs text-text-mute">No scan yet — defaults will apply.</Text>
                )}
                {bfNote ? <Text className="mt-s1 text-2xs text-success">{bfNote}</Text> : null}
                {scanError ? <Text className="mt-s1 text-2xs text-danger">{scanError}</Text> : null}
              </View>
            </View>
          </ScanFrame>
          <View className="mt-s3">
            <NeonButton
              title={scanBusy ? 'ANALYSING' : 'RUN SCAN'}
              variant="ghost"
              onPress={runScan}
              disabled={!photo}
              busy={scanBusy}
              testID="ai-assist"
            />
          </View>
        </Section>

        {/* 6 · TRAINING (STAGE 1). A curated few splits, one tap, default
            SKIP — onboarding stays fast, and an athlete with no plan still
            gets the built-in routine on Train. Seeding NEVER gates the
            redirect (same rule as GO PUBLIC below). */}
        <Section n="6" title="YOUR TRAINING WEEK (OPTIONAL)">
          <Text className="mb-s3 text-2xs text-text-mute">
            Pick a split and we&apos;ll fill it with staples and map your week. Skip it and you
            get the built-in routine — you can build your own any time.
          </Text>
          <View className="flex-row flex-wrap gap-s2">
            {ONBOARDING_SPLITS.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setSplitKey(splitKey === s.key ? null : s.key)}
                accessibilityRole="button"
                testID={`onboard-split-${s.key}`}
                className="rounded-md border px-s3 py-s2"
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  borderColor: splitKey === s.key ? `${colors.accent}8c` : colors.border,
                  backgroundColor: splitKey === s.key ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Text
                  className={splitKey === s.key ? 'text-accent' : 'text-text-dim'}
                  allowFontScaling={false}
                  style={{ fontSize: 11, ...pixelFont() }}
                >
                  {s.name}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setSplitKey('builder')}
              accessibilityRole="button"
              testID="onboard-split-builder"
              className="rounded-md border px-s3 py-s2"
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderColor: splitKey === 'builder' ? `${colors.epic}8c` : colors.border,
                backgroundColor: splitKey === 'builder' ? 'rgba(168,85,247,0.08)' : 'rgba(13,21,36,0.6)',
              }}
            >
              <Text
                className={splitKey === 'builder' ? 'text-epic' : 'text-text-dim'}
                allowFontScaling={false}
                style={{ fontSize: 11, ...pixelFont() }}
              >
                ⚒ BUILD MY OWN
              </Text>
            </Pressable>
            {/* PLAN SCAN: already have a program on paper? Photograph it right
                after your character is forged. */}
            <Pressable
              onPress={() => setSplitKey('scan')}
              accessibilityRole="button"
              testID="onboard-split-scan"
              className="rounded-md border px-s3 py-s2"
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderColor: splitKey === 'scan' ? `${colors.accent}8c` : colors.border,
                backgroundColor: splitKey === 'scan' ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
              }}
            >
              <Text
                className={splitKey === 'scan' ? 'text-accent' : 'text-text-dim'}
                allowFontScaling={false}
                style={{ fontSize: 11, ...pixelFont() }}
              >
                📷 SCAN MY PLAN
              </Text>
            </Pressable>
          </View>
          {splitKey === null ? (
            <Text className="mt-s2 text-2xs text-text-mute">Skipping — the built-in routine it is.</Text>
          ) : null}
        </Section>

        {/* 7 · YOUR PROFILE. §6.3 (2026-07-19): the USERNAME is mandatory
            and unique — social identifies athletes by it. It saves before
            the profile insert (forge()), and a taken name re-prompts. The
            PUBLIC/PRIVATE switch is visibility only. */}
        <Section n="7" title="YOUR PROFILE">
          <Text
            className="mb-s1 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            USERNAME (3–24 CHARS) · REQUIRED
          </Text>
          <TextInput
            className="mb-s2 rounded-md border border-border bg-surface-2 p-s3 text-text"
            value={publicName}
            onChangeText={setPublicName}
            autoCapitalize="none"
            placeholder="Unique — friends find you by it"
            placeholderTextColor="#64758f"
            testID="onboard-public-name"
          />
          {publicName.trim() && nameError(publicName) ? (
            <Text className="mb-s2 text-2xs text-warn">{nameError(publicName)}</Text>
          ) : null}
          {/* Tyson 2026-07-14: the privacy choice is now an EXPLICIT two-way
              switch, made BEFORE the name field. It was a toggle underneath a
              blank input — which reads as "off by default" whichever way it is
              set, and leaves an athlete unsure what they just agreed to. */}
          <View className="mb-s3 flex-row gap-s2">
            {([false, true] as const).map((isPublic) => (
              <Pressable
                key={String(isPublic)}
                onPress={() => setGoPublic(isPublic)}
                accessibilityRole="button"
                accessibilityState={{ selected: goPublic === isPublic }}
                testID={isPublic ? 'onboard-public' : 'onboard-private'}
                className="flex-1 items-center justify-center rounded-md border px-s3 py-s2"
                style={{
                  minHeight: 48,
                  borderColor: goPublic === isPublic ? `${colors.accent}8c` : colors.border,
                  backgroundColor: goPublic === isPublic ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Text
                  className={goPublic === isPublic ? 'text-accent' : 'text-text-dim'}
                  allowFontScaling={false}
                  style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont() }}
                >
                  {goPublic === isPublic ? '✓ ' : ''}
                  {isPublic ? '🌐 PUBLIC' : '🔒 PRIVATE'}
                </Text>
                <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
                  {isPublic ? 'On the leaderboard' : 'Nobody sees you'}
                </Text>
              </Pressable>
            ))}
          </View>

          {goPublic ? (
            <Text className="text-2xs text-text-mute">
              The leaderboard shows your username, level and XP — NEVER body data. You can leave
              or rejoin any time from Rank.
            </Text>
          ) : (
            <Text className="text-2xs text-text-mute">
              Your username exists so friends can find you; your character, lifts and body data
              stay yours alone until you go public.
            </Text>
          )}
        </Section>

        {previewLevel !== null ? (
          <View
            className="mb-s4 flex-row items-center justify-between rounded-xl p-s4"
            style={{ borderWidth: 1, borderColor: 'rgba(34,211,238,0.34)', backgroundColor: 'rgba(34,211,238,0.06)' }}
          >
            <View>
              <Text
                className="text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                YOU START AT
              </Text>
              <Text className="text-sm text-text-dim">{rankName(previewLevel)}</Text>
            </View>
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 30,
                lineHeight: 36,
                color: colors.accent,
                textShadowColor: 'rgba(34,211,238,0.6)',
                textShadowRadius: 14,
                ...pixelFont(),
              }}
            >
              LV {previewLevel}
            </Text>
          </View>
        ) : (
          <Text className="mb-s4 text-2xs text-warn">Some numbers are out of range.</Text>
        )}

        {error ? <Text className="mb-s3 text-sm text-danger">{error}</Text> : null}

        {!nameOk ? (
          <Text className="mb-s1 text-center text-2xs text-warn">
            {publicName.trim().length === 0 ? 'Pick a username in step 7 to forge your character.' : 'Choose a valid username to continue.'}
          </Text>
        ) : null}
        <NeonButton title="FORGE CHARACTER" onPress={forge} busy={busy} disabled={!valid || !nameOk} testID="forge" />
      </View>
    </ScrollView>
    </View>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View className="mb-s4">
      <Text
        className="mb-s2 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        {n} · {title}
      </Text>
      <GlowCard padding={14}>{children}</GlowCard>
    </View>
  );
}

function Num({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testID?: string;
}) {
  return (
    <View className="flex-1">
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <TextInput
        className="rounded-md border border-border bg-surface-2 p-s3 text-text"
        inputMode="decimal"
        value={value}
        onChangeText={onChange}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}
