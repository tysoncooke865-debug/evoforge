import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { useSavePublicIdentity } from '@/data/mutations';
import { saveUserPlanDirect } from '@/data/user-plans';
import { supabase } from '@/data/supabase';
import { defaultScheduleFor, seedPlanForSplit, SPLITS } from '@/domain/exercise-library';
import { nameError } from '@/domain/leaderboard';
import { rankName } from '@/domain/profile';
import { pyFloat } from '@/domain/py';
import {
  derivedLeannessDefault,
  derivedPhysiqueDefault,
  startingLevelV2,
  type NutritionPhase,
} from '@/domain/starting-level-v2';
import tokens from '@/theme/tokens';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScanFrame, type ScanState } from '@/ui/scan-frame';
import { todayIso } from '@/domain/today';

/**
 * CHARACTER CREATION V2. Quick questions, zero self-scoring:
 *
 *   1. WHO    — sex, height, bodyweight
 *   2. LIFTS  — bench / squat / deadlift 1RM + training years
 *   3. FUEL   — cutting / maintaining / bulking / flexible
 *   4. SCAN   — AI physique + body fat (skippable; skipping uses the
 *               documented derived defaults, never a slider)
 *   5. TRAINING — a split (STAGE 1). Seeds the plan AND the week; default
 *               SKIP, so onboarding stays fast. BUILD MY OWN retargets the
 *               post-onboarding redirect to the routine builder.
 *
 * A SAVED PROFILE ROW IS STILL THE ONBOARDED FLAG. The insert never includes
 * user_id (DEFAULT auth.uid() fills it). physique/leanness scores stored on
 * the profile come from the AI scan or the derived defaults -- the athlete
 * never grades themself.
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

export default function OnboardingScreen() {
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

  if (!loading && !session) return <Redirect href="/sign-in" />;
  // An onboarded athlete who asked to BUILD MY OWN lands in the builder, not
  // on Home — that was the whole point of the tap.
  if (profile.data) return <Redirect href={(splitKey === 'builder' ? '/routine' : '/') as never} />;

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
    if (!valid || previewLevel === null) {
      setError('Check the highlighted numbers.');
      return;
    }
    setBusy(true);
    setError(null);
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
      created_at: new Date().toISOString().slice(0, 19),
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    // P2 C7: optional public identity, AFTER the profile insert and BEFORE
    // the invalidation that triggers the redirect. Never blocks onboarding.
    if (publicName.trim() && !nameError(publicName)) {
      try {
        await savePublic.mutateAsync({ displayName: publicName, isPublic: goPublic });
      } catch {
        /* never block onboarding; the athlete recovers via Profile/Rank */
      }
    }

    // STAGE 1: seed the chosen split — the plan AND the week it implies. Same
    // "never blocks" rule as GO PUBLIC: the profile row is the onboarded flag,
    // and a dead network here must not trap a new athlete on the wizard. They
    // land on the built-in routine and can build their own any time.
    if (splitKey !== null && splitKey !== 'builder') {
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

    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    setBusy(false);
  };

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: tokens.colors['bg-deep'] }} contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[480px]">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
          CHARACTER CREATION
        </Text>
        <Text
          className="mb-s5 text-3xl font-bold text-accent"
          style={{ textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 16 }}
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

        {/* 4 · SCAN */}
        <Section n="4" title="THE SCAN (OPTIONAL BUT HONEST)">
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

        {/* 5 · TRAINING (STAGE 1). A curated few splits, one tap, default
            SKIP — onboarding stays fast, and an athlete with no plan still
            gets the built-in routine on Train. Seeding NEVER gates the
            redirect (same rule as GO PUBLIC below). */}
        <Section n="5" title="YOUR TRAINING WEEK (OPTIONAL)">
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
                  borderColor: splitKey === s.key ? `${tokens.colors.accent}8c` : tokens.colors.border,
                  backgroundColor: splitKey === s.key ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Text
                  className={`text-2xs font-bold ${splitKey === s.key ? 'text-accent' : 'text-text-dim'}`}
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
                borderColor: splitKey === 'builder' ? `${tokens.colors.epic}8c` : tokens.colors.border,
                backgroundColor: splitKey === 'builder' ? 'rgba(168,85,247,0.08)' : 'rgba(13,21,36,0.6)',
              }}
            >
              <Text className={`text-2xs font-bold ${splitKey === 'builder' ? 'text-epic' : 'text-text-dim'}`}>
                ⚒ BUILD MY OWN
              </Text>
            </Pressable>
          </View>
          {splitKey === null ? (
            <Text className="mt-s2 text-2xs text-text-mute">Skipping — the built-in routine it is.</Text>
          ) : null}
        </Section>

        {/* 6 · GO PUBLIC (P2 C7). Optional and NEVER gating: the profile
            row IS the onboarded flag, and a failure here must not block
            the redirect — the athlete recovers via Profile/Rank. */}
        <Section n="6" title="YOUR PROFILE">
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
                  borderColor: goPublic === isPublic ? `${tokens.colors.accent}8c` : tokens.colors.border,
                  backgroundColor: goPublic === isPublic ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Text
                  className={`text-2xs font-bold ${goPublic === isPublic ? 'text-accent' : 'text-text-dim'}`}
                  style={{ letterSpacing: 1 }}
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
            <>
              <Text className="mb-s2 text-2xs text-text-mute">
                The leaderboard shows a display name, level and XP — NEVER body data. You can
                leave or rejoin any time from Rank.
              </Text>
              <Text className="mb-s1 text-xs text-text-mute">DISPLAY NAME (3–24 CHARS)</Text>
              <TextInput
                className="mb-s2 rounded-md border border-border bg-surface-2 p-s3 text-text"
                value={publicName}
                onChangeText={setPublicName}
                autoCapitalize="none"
                testID="onboard-public-name"
              />
              {publicName.trim() && nameError(publicName) ? (
                <Text className="mb-s2 text-2xs text-warn">{nameError(publicName)}</Text>
              ) : null}
              {!publicName.trim() ? (
                <Text className="text-2xs text-text-mute">
                  Pick a name to appear — no name, no listing.
                </Text>
              ) : null}
            </>
          ) : (
            <Text className="text-2xs text-text-mute">
              Your character, lifts and body data stay yours alone.
            </Text>
          )}
        </Section>

        {previewLevel !== null ? (
          <View
            className="mb-s4 flex-row items-center justify-between rounded-xl p-s4"
            style={{ borderWidth: 1, borderColor: 'rgba(34,211,238,0.34)', backgroundColor: 'rgba(34,211,238,0.06)' }}
          >
            <View>
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                YOU START AT
              </Text>
              <Text className="text-sm text-text-dim">{rankName(previewLevel)}</Text>
            </View>
            <Text
              className="text-3xl font-bold"
              style={{ color: tokens.colors.accent, textShadowColor: 'rgba(34,211,238,0.6)', textShadowRadius: 14 }}
            >
              LV {previewLevel}
            </Text>
          </View>
        ) : (
          <Text className="mb-s4 text-2xs text-warn">Some numbers are out of range.</Text>
        )}

        {error ? <Text className="mb-s3 text-sm text-danger">{error}</Text> : null}

        <NeonButton title="FORGE CHARACTER" onPress={forge} busy={busy} disabled={!valid} testID="forge" />
      </View>
    </ScrollView>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <View className="mb-s5">
      <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
        {n} · {title}
      </Text>
      {children}
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
      <Text className="mb-s1 text-2xs text-text-mute">{label}</Text>
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
