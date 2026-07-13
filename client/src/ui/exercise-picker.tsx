import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useCreateUserExercise, useUserExercises } from '@/data/exercises';
import { MINE, muscleOptions, searchExercises } from '@/domain/exercise-search';
import tokens from '@/theme/tokens';

import { NeonButton } from './neon-button';

/**
 * PHASE_3 Stage 1 — the exercise picker.
 *
 * Search the library, or CREATE what the gym has and the library doesn't.
 * The CREATE row only appears when nothing matches EXACTLY (case-insensitively)
 * — offering to create "Face Pull" when Face Pull exists would mint a
 * duplicate that migration 016's unique index then rejects with a database
 * error instead of a UI answer.
 *
 * Creating asks for a muscle, because that tag is what makes a custom lift
 * show up in the right place in the heat map instead of the fallback bucket.
 * The tags offered are exactly the library's own vocabulary (muscleOptions),
 * so a custom lift grades beside its built-in neighbours.
 */

export interface PickedExercise {
  name: string;
  muscle: string;
}

export function ExercisePicker({
  visible,
  onClose,
  onPick,
  excludeNames = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (e: PickedExercise) => void;
  /** Already in today's workout — shown as ✓ and not pickable twice. */
  excludeNames?: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const userExercises = useUserExercises();
  const create = useCreateUserExercise();

  const result = useMemo(
    () => searchExercises(query, userExercises.data ?? []),
    [query, userExercises.data]
  );

  const close = () => {
    setQuery('');
    setCreating(false);
    onClose();
  };

  const pick = (name: string, muscle: string) => {
    onPick({ name, muscle });
    setQuery('');
    setCreating(false);
  };

  const trimmed = query.trim();
  const canCreate = trimmed.length >= 2 && !result.hasExactMatch;
  const already = new Set(excludeNames);

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={close} visible>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={close}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 620 }}
        >
          <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            {creating ? 'WHAT DOES IT TRAIN?' : 'ADD AN EXERCISE'}
          </Text>

          {creating ? (
            <CreateMuscle
              name={trimmed}
              busy={create.isPending}
              onCancel={() => setCreating(false)}
              onChoose={(muscle) => {
                create.mutate(
                  { name: trimmed, muscle },
                  // Only add it to the workout once the row really exists —
                  // otherwise a rejected create leaves a phantom exercise in
                  // the day that no stat will ever attribute.
                  { onSuccess: (created) => pick(created.name, created.muscle) }
                );
              }}
            />
          ) : (
            <>
              <TextInput
                className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
                style={{ borderColor: tokens.colors.border }}
                placeholder="Search — or type a new exercise"
                placeholderTextColor="#64758f"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                testID="picker-search"
              />

              <ScrollView className="mt-s3" keyboardShouldPersistTaps="handled">
                {canCreate ? (
                  <Pressable
                    onPress={() => setCreating(true)}
                    accessibilityRole="button"
                    testID="picker-create"
                    className="mb-s3 rounded-md px-s3 py-s2"
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      borderWidth: 1,
                      borderColor: `${tokens.colors.legendary}66`,
                      backgroundColor: 'rgba(250,204,21,0.08)',
                    }}
                  >
                    <Text className="text-sm font-bold" style={{ color: tokens.colors.legendary }}>
                      ＋ CREATE &ldquo;{trimmed}&rdquo;
                    </Text>
                    <Text className="text-2xs text-text-mute">Not in the library — make it yours.</Text>
                  </Pressable>
                ) : null}

                {result.count === 0 && !canCreate ? (
                  <Text className="py-s5 text-center text-xs text-text-mute">
                    Nothing matches. Type a name to create it.
                  </Text>
                ) : null}

                {result.sections.map((section) => (
                  <View key={section.label} className="mb-s3">
                    <Text
                      className="mb-s2 text-2xs font-bold"
                      style={{
                        letterSpacing: 2,
                        color: section.label === MINE ? tokens.colors.legendary : tokens.colors['text-mute'],
                      }}
                    >
                      {section.label.toUpperCase()}
                    </Text>
                    <View className="flex-row flex-wrap gap-s2">
                      {section.exercises.map((e) => {
                        const inWorkout = already.has(e.name);
                        return (
                          <Pressable
                            key={`${section.label}:${e.name}`}
                            onPress={() => (inWorkout ? undefined : pick(e.name, e.muscle))}
                            disabled={inWorkout}
                            accessibilityRole="button"
                            testID={`pick-${e.name}`}
                            className="rounded-md border px-s3 py-s2"
                            style={{
                              minHeight: 44,
                              justifyContent: 'center',
                              borderColor: inWorkout ? `${tokens.colors.success}66` : tokens.colors.border,
                              backgroundColor: inWorkout ? 'rgba(34,197,94,0.08)' : 'rgba(13,21,36,0.7)',
                              opacity: inWorkout ? 0.7 : 1,
                            }}
                          >
                            <Text
                              className="text-2xs font-bold"
                              style={{ color: inWorkout ? tokens.colors.success : tokens.colors['text-dim'] }}
                            >
                              {inWorkout ? '✓ ' : ''}
                              {e.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          <View className="mt-s2">
            <NeonButton title="CLOSE" variant="ghost" onPress={close} testID="picker-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The muscle tags, under their gym-familiar section headers. */
function CreateMuscle({
  name,
  busy,
  onChoose,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onChoose: (muscle: string) => void;
  onCancel: () => void;
}) {
  return (
    <View>
      <Text className="mb-s3 text-lg font-bold text-text">{name}</Text>
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {muscleOptions().map((section) => (
          <View key={section.label} className="mb-s3">
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {section.label.toUpperCase()}
            </Text>
            <View className="flex-row flex-wrap gap-s2">
              {section.muscles.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => (busy ? undefined : onChoose(m))}
                  disabled={busy}
                  accessibilityRole="button"
                  testID={`muscle-${m}`}
                  className="rounded-md border border-border px-s3 py-s2"
                  style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                >
                  <Text className="text-2xs font-bold text-text-dim">{m}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <View className="mt-s2">
        <NeonButton title="BACK" variant="ghost" onPress={onCancel} testID="picker-create-back" />
      </View>
    </View>
  );
}
