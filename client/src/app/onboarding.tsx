import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { supabase } from '@/data/supabase';
import { calculateStartingLevel, rankName } from '@/domain/profile';
import { pyFloat } from '@/domain/py';

/**
 * Character creation: the port of views/onboarding.py step one -- the step
 * that writes the profile row, and A SAVED PROFILE ROW IS THE ONBOARDED FLAG
 * (no extra table or column; the (main) layout gates on it).
 *
 * The insert never includes user_id: Postgres fills it from DEFAULT
 * auth.uid(), and sending an explicit value is the exact mistake the schema
 * contract in config/constants.py exists to prevent.
 */

interface Field {
  key: string;
  label: string;
  min: number;
  max: number;
  initial: string;
  help?: string;
}

const FIELDS: Field[] = [
  { key: 'height_cm', label: 'HEIGHT (CM)', min: 100, max: 230, initial: '175' },
  { key: 'bodyweight_kg', label: 'BODYWEIGHT (KG)', min: 30, max: 200, initial: '75' },
  { key: 'bench_e1rm', label: 'BENCH 1RM (KG)', min: 0, max: 250, initial: '60', help: 'Best guess is fine' },
  { key: 'squat_e1rm', label: 'SQUAT 1RM (KG)', min: 0, max: 350, initial: '80' },
  { key: 'training_years', label: 'TRAINING YEARS', min: 0, max: 30, initial: '1' },
  { key: 'physique_score', label: 'PHYSIQUE SCORE (0-15)', min: 0, max: 15, initial: '5', help: '0 beginner, 10 clearly trained, 15 very aesthetic' },
  { key: 'leanness_score', label: 'LEANNESS SCORE (0-15)', min: 0, max: 15, initial: '5', help: '0 soft, 10 lean/visible abs, 15 very lean' },
];

export default function OnboardingScreen() {
  const { session, loading } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, f.initial]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !session) {
    return <Redirect href="/sign-in" />;
  }
  if (profile.data) {
    return <Redirect href="/" />; // already onboarded
  }

  const parsed: Record<string, number | null> = {};
  const problems: string[] = [];
  for (const f of FIELDS) {
    const v = pyFloat(values[f.key]);
    parsed[f.key] = v;
    if (v === null || Number.isNaN(v) || v < f.min || v > f.max) {
      problems.push(f.label);
    }
  }

  const previewLevel =
    problems.length === 0
      ? calculateStartingLevel(
          parsed.bench_e1rm!,
          parsed.squat_e1rm!,
          parsed.training_years!,
          parsed.physique_score!,
          parsed.leanness_score!
        )
      : null;

  const forge = async () => {
    if (problems.length > 0) {
      setError(`Check: ${problems.join(', ')}`);
      return;
    }
    setBusy(true);
    setError(null);
    const baseLevel = previewLevel!;
    const { error: err } = await supabase.from('profile').insert({
      height_cm: parsed.height_cm,
      bodyweight_kg: parsed.bodyweight_kg,
      bench_e1rm: parsed.bench_e1rm,
      squat_e1rm: parsed.squat_e1rm,
      training_years: parsed.training_years,
      physique_score: parsed.physique_score,
      leanness_score: parsed.leanness_score,
      base_level: baseLevel,
      created_at: new Date().toISOString().slice(0, 19),
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['profile'] });
    // The redirect above fires once useProfile refetches the new row.
    setBusy(false);
  };

  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[480px] rounded-lg border border-border bg-surface p-s6">
        <Text className="text-xs text-text-mute">CHARACTER CREATION</Text>
        <Text className="mb-s2 text-2xl font-bold text-accent">FORGE YOUR CHARACTER</Text>
        <Text className="mb-s6 text-sm text-text-dim">
          Honest numbers place you on the curve you will actually climb.
        </Text>

        {FIELDS.map((f) => (
          <View key={f.key} className="mb-s4">
            <Text className="mb-s1 text-xs text-text-mute">{f.label}</Text>
            <TextInput
              className="rounded-md border border-border bg-surface-2 p-s3 text-text"
              inputMode="decimal"
              value={values[f.key]}
              onChangeText={(t) => setValues((prev) => ({ ...prev, [f.key]: t }))}
              testID={f.key}
            />
            {f.help ? <Text className="mt-s1 text-2xs text-text-mute">{f.help}</Text> : null}
          </View>
        ))}

        <AiAssistCard
          heightCm={parsed.height_cm ?? 0}
          weightKg={parsed.bodyweight_kg ?? 0}
          onScores={(physique, leanness) =>
            setValues((prev) => ({
              ...prev,
              physique_score: String(physique),
              leanness_score: String(leanness),
            }))
          }
        />

        {previewLevel !== null ? (
          <View className="mb-s4 rounded-md border border-border-strong bg-surface-2 p-s3">
            <Text className="text-sm text-text-dim">
              You start at <Text className="font-bold text-accent">Level {previewLevel}</Text>{' '}
              <Text className="text-text-mute">· {rankName(previewLevel)}</Text>
            </Text>
          </View>
        ) : null}

        {error ? <Text className="mb-s4 text-sm text-danger">{error}</Text> : null}

        <Pressable
          className="items-center rounded-md bg-accent p-s3"
          onPress={forge}
          disabled={busy}
          testID="forge"
        >
          {busy ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className="font-bold text-accent-ink">FORGE CHARACTER</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function AiAssistCard({
  heightCm,
  weightKg,
  onScores,
}: {
  heightCm: number;
  weightKg: number;
  onScores: (physique: number, leanness: number) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [bf, setBf] = useState<string | null>(null);

  const clamp15 = (v: unknown) => Math.max(0, Math.min(15, Math.round(Number(v) || 0)));

  const run = async () => {
    if (!photo) return;
    setBusy(true);
    setStatus(null);
    // One photo, two verdicts: the physique rating fills both self-score
    // sliders (they feed calculateStartingLevel), and the body-fat estimate
    // saves a first reading so the character starts with real leanness data.
    const [phys, fat] = await Promise.all([
      runAiPhysique([photo], { height_cm: heightCm, bodyweight: weightKg, context: 'onboarding' }),
      runAiBodyfat([photo], { height_cm: heightCm, weight_kg: weightKg, save: true }),
    ]);
    setBusy(false);
    setPhoto(null); // analysed and dropped

    if (phys.result) {
      onScores(clamp15(phys.result.physique_score), clamp15(phys.result.leanness_score));
      setStatus(`Scores set from the analysis (confidence: ${phys.result.confidence}).`);
    } else if (phys.error) {
      setStatus(phys.error);
    }
    if (fat.result) {
      setBf(`${fat.result.bf_mid.toFixed(1)}% body fat (${fat.result.bf_low.toFixed(1)}–${fat.result.bf_high.toFixed(1)}) — saved as your first reading.`);
    }
  };

  return (
    <View className="mb-s4 rounded-md border border-border bg-surface-2 p-s3">
      <Text className="mb-s1 text-xs font-bold text-accent">✦ AI ASSIST (OPTIONAL)</Text>
      <Text className="mb-s3 text-2xs text-text-mute">
        A physique photo rates you honestly and fills the two scores above — better than guessing
        your own aesthetics. Analysed in memory, never stored.
      </Text>
      <View className="flex-row items-center gap-s3">
        <Pressable
          onPress={async () => {
            const uri = await pickPhoto();
            if (uri) setPhoto(uri);
          }}
          className="items-center rounded-md border border-border bg-surface p-s2"
        >
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: 56, height: 72, borderRadius: 6 }} contentFit="cover" />
          ) : (
            <View className="h-[72px] w-[56px] items-center justify-center">
              <Text className="text-xl text-text-mute">＋</Text>
            </View>
          )}
        </Pressable>
        <Pressable
          className={`flex-1 items-center rounded-md p-s3 ${photo ? 'bg-accent' : 'bg-surface'}`}
          onPress={run}
          disabled={busy || !photo}
          testID="ai-assist"
        >
          {busy ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className={`font-bold ${photo ? 'text-accent-ink' : 'text-text-mute'}`}>ANALYSE</Text>
          )}
        </Pressable>
      </View>
      {status ? <Text className="mt-s2 text-2xs text-text-dim">{status}</Text> : null}
      {bf ? <Text className="mt-s1 text-2xs text-success">{bf}</Text> : null}
    </View>
  );
}
