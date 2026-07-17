import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { buildCorpus } from '@/data/exercise-corpus';
import { useExercisePrefs } from '@/data/exercise-prefs';
import { useCreateUserExercise, useUserExercises } from '@/data/exercises';
import { useWorkoutLog } from '@/data/hooks';
import { rankExercises } from '@/domain/exercise-rank';
import { muscleOptionsForCreate } from '@/domain/exercise-taxonomy';
import { useThemeColors } from '@/theme/use-theme';

import type { PickedExercise } from './exercise-picker';

/**
 * THE INLINE SEARCH BAR — type a letter, get the exercise, right where you
 * are (2026-07-15). Embedded on every surface that adds exercises: the active
 * workout, the routine builder, the empty-workout sheet, the swap sheet.
 *
 * The contract, verbatim from the brief: NOTHING renders until the first
 * letter; each further letter narrows the boxes; tapping one adds it where
 * you stand. Matching is the full ranking engine (exercise-rank.ts), so
 * "incline press" finds "Smith Machine Incline Bench Press" — the all-tokens
 * branch — and popularity only orders within a match class.
 *
 * PERF: the corpus (2,500-row history digest + 960-entry merge) is built ONLY
 * while a query exists — the empty-input render does no work at all. That is
 * both the requirement and the picker's hard-learned PERF rule.
 */

const SEARCH_DEBOUNCE_MS = 120;

export function ExerciseSearchBar({
  onPick,
  excludeNames = [],
  programExercises = [],
  placeholder = 'Type to find an exercise…',
  limit = 12,
  testIDPrefix = 'exsearch',
}: {
  onPick: (e: PickedExercise) => void;
  /** Already in the plan/day — rendered sunk, not hidden (you did add it). */
  excludeNames?: readonly string[];
  /** Drives target-muscle ranking, same as the picker. */
  programExercises?: readonly string[];
  placeholder?: string;
  limit?: number;
  testIDPrefix?: string;
}) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);

  const userExercises = useUserExercises();
  const prefs = useExercisePrefs();
  const workouts = useWorkoutLog();
  const create = useCreateUserExercise();

  // The picker's keystroke rule: 120ms is below "typing feels laggy" and
  // above the rate a thumb produces characters.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = debounced.trim();
  const searching = trimmed.length > 0;

  const pick = (e: PickedExercise) => {
    onPick(e);
    setQuery('');
    setDebounced('');
    setCreating(false);
  };

  // NOTHING UNTIL THE FIRST LETTER — and no corpus work either.
  let boxes: { name: string; muscle: string; sunk: boolean }[] = [];
  let canCreate = false;
  if (searching) {
    const corpus = buildCorpus(
      { userExercises: userExercises.data, prefRows: prefs.data, workoutRows: workouts.data },
      { programExercises, excludeNames }
    );
    const excluded = new Set(excludeNames.map((n) => n.toLowerCase()));
    boxes = rankExercises(corpus.library, {
      query: trimmed,
      context: corpus.context,
      isCustom: corpus.isCustom,
      limit,
    }).map((s) => ({
      name: s.exercise.name,
      muscle: s.exercise.muscle,
      sunk: excluded.has(s.exercise.name.toLowerCase()),
    }));
    canCreate =
      trimmed.length >= 2 &&
      !corpus.library.some((e) => e.name.toLowerCase() === trimmed.toLowerCase());
  }

  return (
    <View>
      <TextInput
        className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
        style={{ borderColor: searching ? `${colors.accent}66` : colors.border }}
        placeholder={placeholder}
        placeholderTextColor="#64758f"
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          if (v.trim() === '') setCreating(false);
        }}
        autoCorrect={false}
        maxLength={60}
        testID={`${testIDPrefix}-input`}
      />

      {searching && !creating ? (
        <View className="mt-s2 flex-row flex-wrap gap-s2">
          {boxes.map((b) => (
            <Pressable
              key={b.name}
              onPress={b.sunk ? undefined : () => pick({ name: b.name, muscle: b.muscle })}
              disabled={b.sunk}
              accessibilityRole="button"
              accessibilityLabel={b.sunk ? `${b.name}, already added` : `add ${b.name}`}
              testID={`${testIDPrefix}-hit-${b.name}`}
              className="rounded-md border border-border px-s3 py-s2"
              style={{
                minHeight: 44,
                justifyContent: 'center',
                backgroundColor: 'rgba(13,21,36,0.7)',
                opacity: b.sunk ? 0.45 : 1,
              }}
            >
              <Text className="text-2xs font-bold text-text">
                {b.name}
                {b.sunk ? ' ✓' : ''}
              </Text>
              <Text className="text-2xs text-text-mute">{b.muscle}</Text>
            </Pressable>
          ))}
          {canCreate ? (
            <Pressable
              onPress={() => setCreating(true)}
              accessibilityRole="button"
              testID={`${testIDPrefix}-create`}
              className="rounded-md border px-s3 py-s2"
              style={{
                minHeight: 44,
                justifyContent: 'center',
                borderColor: `${colors.accent}8c`,
                backgroundColor: 'rgba(34,211,238,0.08)',
              }}
            >
              <Text className="text-2xs font-bold text-accent">＋ CREATE “{trimmed}”</Text>
            </Pressable>
          ) : null}
          {boxes.length === 0 && !canCreate ? (
            <Text className="text-2xs text-text-mute">No match — keep typing, or add a letter less.</Text>
          ) : null}
        </View>
      ) : null}

      {searching && creating ? (
        <View className="mt-s2">
          <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            “{trimmed}” — WHAT DOES IT TRAIN?
          </Text>
          {muscleOptionsForCreate().map((section) => (
            <View key={section.label} className="mb-s2 flex-row flex-wrap gap-s2">
              {section.muscles.map((m) => (
                <Pressable
                  key={m}
                  onPress={() =>
                    create.isPending
                      ? undefined
                      : create.mutate(
                          { name: trimmed, muscle: m },
                          { onSuccess: (made) => pick({ name: made.name, muscle: made.muscle }) }
                        )
                  }
                  disabled={create.isPending}
                  accessibilityRole="button"
                  testID={`${testIDPrefix}-muscle-${m}`}
                  className="rounded-md border border-border px-s3 py-s2"
                  style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                >
                  <Text className="text-2xs font-bold text-text-dim">{m}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          <Pressable
            onPress={() => setCreating(false)}
            accessibilityRole="button"
            testID={`${testIDPrefix}-create-back`}
            className="items-center justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
              BACK TO RESULTS
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
