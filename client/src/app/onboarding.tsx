import { useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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
