import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { buildCorpus } from '@/data/exercise-corpus';
import type { Routine } from '@/data/routines';
import { buildSections } from '@/domain/exercise-sections';
import type { SessionExercise } from '@/domain/session-plan';
import { inferMuscleGroup } from '@/domain/workouts';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';

/**
 * QUICK WORKOUT sheet. Keeps the name/picks state LOCAL so typing renders only
 * this sheet, never the carousel/week-bars/muscle-maps behind it (perf,
 * 2026-07-23). State dies with the sheet — reopening starts clean. Every
 * testID is verbatim from the inline modal it replaced.
 *
 * ITS OWN MODULE (WO-006), which is the point of this file existing rather
 * than the component sitting in `today.tsx`. It reaches `buildCorpus` and
 * `buildSections`, and through them the whole ~1,109-entry `EXERCISE_LIBRARY`
 * plus the ranking engine and the taxonomy. While it lived in the Train screen
 * all of that rode the TRAIN ROUTE CHUNK — the chunk a newly onboarded athlete
 * waits for between pressing the Train tab and seeing a usable screen, which
 * is the exact span `ms_to_interactive` measures on `activation_step` /
 * `train_opened`. This sheet is two taps deep and is only reached by an
 * athlete who has decided NOT to train their plan, so none of it belongs on
 * that path.
 *
 * `today.tsx` pulls it in with `lazy()` and mounts it only while open, so the
 * chunk request is the tap. Deliberately NOT preloaded: the 2026-07-23 perf
 * pass kept this library out of the boot chunk, and warming it on idle would
 * put it back on a thread that is still rendering Home.
 *
 * The corpus inputs arrive as `corpusData` rather than being read from hooks
 * here on purpose — the parent already holds those queries, and re-subscribing
 * would make opening the sheet a fresh set of round trips.
 */
export function QuickWorkoutSheet({
  corpusData,
  routines,
  scanRow,
  onStart,
  onStartRoutine,
  onDeleteRoutine,
  onClose,
}: {
  corpusData: Parameters<typeof buildCorpus>[0];
  routines: readonly Routine[];
  scanRow: (testID: string) => React.ReactNode;
  onStart: (name: string, picks: SessionExercise[]) => void;
  onStartRoutine: (name: string, exercises: SessionExercise[]) => void;
  onDeleteRoutine: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [name, setName] = useState('');
  // Exercises picked in the sheet BEFORE starting — they seed the ad-hoc.
  const [picks, setPicks] = useState<SessionExercise[]>([]);

  /** PREFILL RECOMMENDED (Tyson, 2026-07-19): one tap seeds the QUICK WORKOUT
   *  with the exercises the athlete would most likely pick — the SAME corpus +
   *  ranking engine the search bar runs on. If they typed a name we can read a
   *  muscle from (e.g. "Chest Day"), it drives SUGGESTED FOR TODAY; otherwise it
   *  falls back to POPULAR staples. Only ADDS — never eats a pick already made. */
  const prefill = () => {
    const corpus = buildCorpus(corpusData, {
      programExercises: [],
      excludeNames: picks.map((p) => p.exercise),
    });
    const guessed = name.trim() ? inferMuscleGroup(name.trim()) : null;
    const sections = buildSections({
      library: corpus.library,
      program: [],
      history: corpus.history,
      favourites: corpus.context.favourites,
      hidden: corpus.context.hidden,
      targetMuscles: new Set(guessed ? [guessed] : []),
      alreadyAdded: new Set(picks.map((p) => p.exercise.toLowerCase())),
    });
    const names: string[] = [];
    for (const key of ['suggested', 'popular']) {
      const sec = sections.find((s) => s.key === key);
      if (sec) for (const e of sec.exercises) if (!names.includes(e.name)) names.push(e.name);
    }
    const add = names.slice(0, 6);
    if (add.length === 0) {
      useToastStore.getState().push({ kind: 'info', title: 'NOTHING TO SUGGEST', subtitle: 'Type a name or search instead.' });
      return;
    }
    setPicks((cur) => {
      const have = new Set(cur.map((x) => x.exercise));
      return [...cur, ...add.filter((n) => !have.has(n)).map((n) => ({ exercise: n, sets: 3, reps: '8-12' }))];
    });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: 560 }}
        >
          <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            QUICK WORKOUT
          </Text>
          <TextInput
            className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
            style={{ borderColor: colors.border }}
            placeholder="Workout name (optional)"
            placeholderTextColor="#64758f"
            value={name}
            onChangeText={setName}
            maxLength={40}
            testID="adhoc-name"
          />
          {/* One tap fills it with recommended exercises (name it first for a
              muscle-matched set; otherwise popular staples). */}
          <Pressable
            onPress={prefill}
            accessibilityRole="button"
            testID="adhoc-prefill"
            className="mt-s3 items-center rounded-md border"
            style={{ minHeight: 44, justifyContent: 'center', borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
          >
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
            >
              ⚡ PREFILL WITH RECOMMENDED EXERCISES
            </Text>
          </Pressable>
          {/* Seed exercises before you even start — optional; the workout
              page can add more. Type a letter, tap a box. */}
          <View className="mt-s3">
            <ExerciseSearchBar
              onPick={(e) =>
                setPicks((p) =>
                  p.some((x) => x.exercise === e.name)
                    ? p
                    : [...p, { exercise: e.name, sets: 3, reps: '8-12' }]
                )
              }
              excludeNames={picks.map((p) => p.exercise)}
              placeholder="Choose exercises (optional)"
              testIDPrefix="adhoc-search"
            />
          </View>
          {picks.length > 0 ? (
            <View className="mt-s2 flex-row flex-wrap gap-s2">
              {picks.map((p) => (
                <Pressable
                  key={p.exercise}
                  onPress={() => setPicks((cur) => cur.filter((x) => x.exercise !== p.exercise))}
                  accessibilityRole="button"
                  accessibilityLabel={`remove ${p.exercise}`}
                  testID={`adhoc-pick-${p.exercise}`}
                  className="rounded-md border px-s3 py-s2"
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    borderColor: `${colors.success}8c`,
                    backgroundColor: 'rgba(52,211,153,0.08)',
                  }}
                >
                  <Text className="text-2xs font-bold text-success">✓ {p.exercise} ✕</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* Spec item 8: PLAN SCAN is reachable from here too — a written
              page IS an empty workout waiting to be read. */}
          <View className="mt-s3">{scanRow('empty-scan')}</View>
          <View className="mt-s3">
            <NeonButton title="START WORKOUT" pixel onPress={() => onStart(name, picks)} testID="adhoc-start" />
            <Text className="mt-s1 text-center text-2xs text-text-mute">Add exercises as you train</Text>
          </View>

          {routines.length > 0 ? (
            <View className="mt-s4">
              <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                MY ROUTINES
              </Text>
              <ScrollView style={{ maxHeight: 240 }}>
                {routines.map((r) => (
                  <View key={r.id} className="mb-s2 flex-row items-center gap-s2">
                    <Pressable
                      onPress={() => onStartRoutine(r.name, r.payload?.exercises ?? [])}
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
                      onPress={() => onDeleteRoutine(r.id)}
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
            <NeonButton title="CANCEL" variant="ghost" onPress={onClose} testID="adhoc-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
