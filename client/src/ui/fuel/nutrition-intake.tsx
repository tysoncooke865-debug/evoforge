import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useProfile } from '@/data/hooks';
import { useSaveTarget } from '@/data/nutrition';
import { supabase } from '@/data/supabase';
import {
  ACTIVITY_LABEL,
  GOAL_LABEL,
  dailyTarget,
  intakeError,
  type Activity,
  type Goal,
  type Sex,
  type TargetInputs,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { todayIso as calendarToday } from '@/domain/today';
import tokens from '@/theme/tokens';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { SectionLabel } from '@/ui/core/screen-header';

/**
 * FUEL — the AI intake (nutrition branch).
 *
 * The assistant gathers FIELDS; domain/nutrition.ts computes the NUMBER; the
 * athlete confirms it on a review card before anything is saved. Three layers,
 * and the AI only ever touches the first.
 *
 * Chips are LOCAL for enumerable fields (sex, activity, goal, rate): a tap
 * writes the value directly — no model round trip to parse "moderate". Free
 * text goes to the model, which is what it is for ("about 6 foot", "180 lbs").
 * When every field is known the edge function short-circuits without an
 * OpenAI call at all.
 */

interface Question {
  field: string;
  text: string;
  chips: string[];
}

type Step =
  | { kind: 'loading' }
  | { kind: 'question'; q: Question }
  | { kind: 'review'; fields: TargetInputs }
  | { kind: 'error'; message: string };

type Known = Partial<TargetInputs>;

/** nutrition_phase (profile) → goal. 'flexible' stays a question. */
const PHASE_GOAL: Record<string, Goal> = {
  cutting: 'lose',
  maintaining: 'maintain',
  bulking: 'gain',
};

const LOCAL_CHIPS: Record<string, { label: string; value: string | number }[]> = {
  sex: [
    { label: 'Male', value: 'male' },
    { label: 'Female', value: 'female' },
  ],
  activity: (Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => ({
    label: ACTIVITY_LABEL[a],
    value: a,
  })),
  goal: (Object.keys(GOAL_LABEL) as Goal[]).map((g) => ({ label: GOAL_LABEL[g], value: g })),
  ratePerWeekKg: [
    { label: 'Gentle · 0.25 kg/wk', value: 0.25 },
    { label: 'Steady · 0.5 kg/wk', value: 0.5 },
    { label: 'Hard · 0.75 kg/wk', value: 0.75 },
    { label: 'Max · 1 kg/wk', value: 1 },
  ],
};

const NUMERIC_FIELDS = new Set(['age', 'weightKg', 'heightCm', 'ratePerWeekKg']);

async function askServer(
  known: Known,
  messages: { role: string; text: string }[]
): Promise<{ result: Record<string, unknown> | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('ai-nutrition', {
      body: { known, messages },
    });
    if (error) {
      const ctx = (error as { context?: Response }).context;
      // The mainline invoke() fix, mirrored: a FunctionsFetchError's context
      // is a plain TypeError, NOT a Response — an undeployed function must
      // show the honest message, not "e.json is not a function".
      if (ctx && typeof (ctx as Response).json === 'function') {
        const payload = await (ctx as Response).json().catch(() => null);
        return { result: null, error: payload?.error ?? error.message };
      }
      if (
        (error as { name?: string }).name === 'FunctionsFetchError' ||
        /Failed to fetch|Load failed/i.test(String(error.message))
      ) {
        return { result: null, error: 'The intake assistant is not deployed yet — set the target manually.' };
      }
      return { result: null, error: error.message };
    }
    if (data?.error) return { result: null, error: String(data.error) };
    return { result: (data?.result ?? null) as Record<string, unknown> | null, error: data?.result ? null : 'Empty response.' };
  } catch (e) {
    return {
      result: null,
      error:
        e instanceof Error && /Failed to fetch|FunctionsFetchError/i.test(String(e))
          ? 'The intake assistant is not deployed yet — set the target manually.'
          : String(e),
    };
  }
}

export function NutritionIntake({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const todayIso = calendarToday();
  const profile = useProfile();
  const saveTarget = useSaveTarget();

  // Prefill everything the profile already knows — most athletes should only
  // ever be asked their age and activity level.
  const seededRef = useRef(false);
  const [known, setKnown] = useState<Known>({});
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [draft, setDraft] = useState('');

  const ask = async (k: Known, msgs: { role: string; text: string }[]) => {
    setStep({ kind: 'loading' });
    const { result, error } = await askServer(k, msgs);
    if (error || !result) {
      setStep({ kind: 'error', message: error ?? 'The assistant went quiet.' });
      return;
    }
    if (result.type === 'question') {
      const q: Question = {
        field: String(result.field ?? ''),
        text: String(result.text ?? ''),
        chips: Array.isArray(result.chips) ? result.chips.map(String) : [],
      };
      setMessages([...msgs, { role: 'assistant', text: q.text }]);
      setStep({ kind: 'question', q });
      return;
    }
    if (result.type === 'result') {
      const f = result.fields as Record<string, unknown>;
      const fields: TargetInputs = {
        sex: f.sex as Sex,
        weightKg: Number(f.weightKg),
        heightCm: Number(f.heightCm),
        age: Number(f.age),
        activity: f.activity as Activity,
        goal: f.goal as Goal,
        ratePerWeekKg: Number(f.ratePerWeekKg ?? 0),
      };
      // The server validated; validate AGAIN with the client's own limits —
      // the review card must never show a target built on a bad field.
      const bad = intakeError(fields);
      if (bad !== null) {
        setStep({ kind: 'error', message: bad });
        return;
      }
      setStep({ kind: 'review', fields });
      return;
    }
    setStep({ kind: 'error', message: 'The assistant lost the thread.' });
  };

  useEffect(() => {
    if (seededRef.current || profile.data === undefined) return;
    seededRef.current = true;
    const p = profile.data;
    const seeded: Known = {};
    if (p?.sex === 'male' || p?.sex === 'female') seeded.sex = p.sex;
    if (p?.bodyweight_kg && p.bodyweight_kg > 0) seeded.weightKg = p.bodyweight_kg;
    if (p?.height_cm && p.height_cm > 0) seeded.heightCm = p.height_cm;
    const goal = p?.nutrition_phase ? PHASE_GOAL[p.nutrition_phase] : undefined;
    if (goal) seeded.goal = goal;
    setKnown(seeded);
    void ask(seeded, []);
  }, [profile.data]);

  const answerWith = (field: string, value: string | number, spoken: string) => {
    const k = { ...known, [field]: value };
    const msgs = [...messages, { role: 'user', text: spoken }];
    setKnown(k);
    setMessages(msgs);
    setDraft('');
    void ask(k, msgs);
  };

  const submitDraft = (q: Question) => {
    const text = draft.trim();
    if (text === '') return;
    // A plain number the field accepts skips the model; anything else ("about
    // 6 foot") is exactly what the model is for.
    if (NUMERIC_FIELDS.has(q.field)) {
      const n = pyFloat(text);
      if (n !== null) {
        answerWith(q.field, n, text);
        return;
      }
    }
    const msgs = [...messages, { role: 'user', text }];
    setMessages(msgs);
    setDraft('');
    void ask(known, msgs);
  };

  const confirm = (fields: TargetInputs) => {
    saveTarget.mutate(
      {
        effectiveFrom: todayIso,
        dailyKcal: dailyTarget(fields),
        goal: fields.goal,
        inputs: fields,
      },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 620 }}
        >
          <SectionLabel>CALORIE TARGET · AI INTAKE</SectionLabel>

          {step.kind === 'loading' ? (
            <View className="items-center py-s5">
              <ActivityIndicator color={tokens.colors.accent} />
              <Text className="mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
                THINKING…
              </Text>
            </View>
          ) : null}

          {step.kind === 'question' ? (
            <View>
              <Text className="mb-s3 text-base font-bold text-text">{step.q.text}</Text>
              <View className="mb-s3 flex-row flex-wrap gap-s2">
                {(LOCAL_CHIPS[step.q.field] ??
                  step.q.chips.map((c) => ({ label: c, value: c }))
                ).map((chip) => (
                  <Chip
                    key={chip.label}
                    label={chip.label}
                    active={false}
                    onPress={() => answerWith(step.q.field, chip.value, chip.label)}
                    testID={`intake-chip-${chip.label}`}
                  />
                ))}
              </View>
              <View className="flex-row items-center gap-s2">
                <TextInput
                  className="min-h-[48px] flex-1 rounded-xl border bg-surface-2 px-s3 text-base text-text"
                  style={{ borderColor: tokens.colors.border }}
                  placeholder="Type an answer…"
                  placeholderTextColor="#64758f"
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={() => submitDraft(step.q)}
                  maxLength={120}
                  testID="intake-answer"
                />
                <Pressable
                  onPress={() => submitDraft(step.q)}
                  accessibilityRole="button"
                  className="items-center justify-center rounded-xl border px-s3"
                  style={{ minHeight: 48, borderColor: `${tokens.colors.accent}8c` }}
                  testID="intake-send"
                >
                  <Text className="text-sm font-bold text-accent">→</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step.kind === 'review' ? (
            <ScrollView style={{ maxHeight: 420 }}>
              <Text className="mb-s3 text-sm text-text-dim">
                Built from your answers — the maths is on your phone, not the AI.
              </Text>
              <View className="mb-s3 rounded-xl border border-border p-s3" style={{ backgroundColor: 'rgba(13,21,36,0.6)' }}>
                {(
                  [
                    ['SEX', step.fields.sex],
                    ['AGE', String(step.fields.age)],
                    ['WEIGHT', `${step.fields.weightKg} kg`],
                    ['HEIGHT', `${step.fields.heightCm} cm`],
                    ['ACTIVITY', step.fields.activity],
                    ['GOAL', GOAL_LABEL[step.fields.goal]],
                    ...(step.fields.goal === 'maintain'
                      ? []
                      : ([['RATE', `${step.fields.ratePerWeekKg} kg / week`]] as const)),
                  ] as const
                ).map(([label, value]) => (
                  <View key={label} className="mb-s1 flex-row justify-between">
                    <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
                      {label}
                    </Text>
                    <Text className="text-2xs font-bold text-text">{String(value)}</Text>
                  </View>
                ))}
              </View>
              <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                YOUR DAILY TARGET
              </Text>
              <Text
                className="mb-s3 text-3xl font-bold text-text"
                style={{ textShadowColor: `${tokens.colors.accent}80`, textShadowRadius: 14, fontVariant: ['tabular-nums'] }}
                testID="intake-target"
              >
                {dailyTarget(step.fields).toLocaleString()} kcal
              </Text>
              <NeonButton
                title="SET AS MY TARGET"
                onPress={() => confirm(step.fields)}
                busy={saveTarget.isPending}
                testID="intake-confirm"
              />
            </ScrollView>
          ) : null}

          {step.kind === 'error' ? (
            <View>
              <Text className="mb-s3 text-sm" style={{ color: tokens.colors.danger }}>
                {step.message}
              </Text>
              <NeonButton title="TRY AGAIN" variant="ghost" onPress={() => void ask(known, messages)} testID="intake-retry" />
            </View>
          ) : null}

          <View className="mt-s3 flex-row gap-s2">
            <View className="flex-1">
              <NeonButton
                title="SET MANUALLY"
                variant="ghost"
                onPress={() => {
                  onClose();
                  onManual();
                }}
                testID="intake-manual"
              />
            </View>
            <View className="flex-1">
              <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="intake-close" />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
