import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { captureCameraPhoto, pickPhoto, runAiReadPlan } from '@/data/ai';
import { useUserExercises } from '@/data/exercises';
import { EXERCISE_LIBRARY } from '@/domain/exercise-library';
import type { LibraryExercise } from '@/domain/exercise-taxonomy';
import {
  mapImportedPlan,
  parseSetsReps,
  type ImportedDay,
  type MappedDay,
} from '@/domain/workout-import';
import tokens from '@/theme/tokens';
import { NeonButton } from '@/ui/neon-button';
import { ScanFrame, type ScanState } from '@/ui/scan-frame';
import { SectionLabel } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';

/**
 * PLAN SCAN — photograph a written workout (or paste its text) and the AI
 * reads it into a draft (2026-07-15).
 *
 * The photo goes to the ai-plan-scan edge function IN MEMORY and is
 * discarded (the solo-photo doctrine). The AI only transcribes; every name
 * it returns is re-mapped deterministically onto the exercise corpus by
 * domain/workout-import.ts before the caller ever sees it. The caller (the
 * routine builder) receives the mapped draft and owns the editing.
 */

const MAX_PHOTOS = 3;

export function PlanImportSheet({
  onClose,
  onImported,
}: {
  onClose: () => void;
  /** The mapped draft — the builder seeds its editor from this. */
  onImported: (draft: { planName: string; days: MappedDay[] }) => void;
}) {
  const [mode, setMode] = useState<0 | 1>(0); // 0 = PHOTO, 1 = TYPE IT
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userExercises = useUserExercises();

  const filled = photos.filter((p): p is string => p !== null);
  const canScan = !busy && (mode === 0 ? filled.length > 0 : text.trim().length > 0);
  const scanState: ScanState = busy ? 'analysing' : error ? 'error' : canScan ? 'ready' : 'idle';

  const addPhoto = async (source: 'camera' | 'gallery') => {
    if (filled.length >= MAX_PHOTOS) return;
    const uri = source === 'camera' ? await captureCameraPhoto() : await pickPhoto();
    if (!uri) return;
    setPhotos((prev) => {
      const i = prev.findIndex((p) => p === null);
      return i === -1 ? prev : prev.map((p, j) => (j === i ? uri : p));
    });
    setError(null);
  };

  const scan = async () => {
    setBusy(true);
    setError(null);
    const { result, error: err } = await runAiReadPlan(
      mode === 0 ? { images: filled } : { text: text.trim() }
    );
    setBusy(false);
    if (err || !result) {
      setError(err ?? 'The scan came back empty.');
      return;
    }
    // Defence in depth: if a reps string still encodes sets ("5x5"), fold it.
    const days: ImportedDay[] = (result.days ?? []).map((d) => ({
      day: d.day,
      exercises: d.exercises.map((e) => {
        const parsed = parseSetsReps(e.reps);
        return parsed ? { ...e, sets: parsed.sets, reps: parsed.reps } : e;
      }),
    }));
    // The athlete's own exercises are part of the corpus here too.
    const library: LibraryExercise[] = [
      ...(userExercises.data ?? []).map((u) => ({ name: u.name, muscle: u.muscle, popularity: 90 })),
      ...EXERCISE_LIBRARY,
    ];
    const mapped = mapImportedPlan(days, library);
    if (mapped.length === 0) {
      setError('No readable exercises came back — try a clearer photo or paste the text.');
      return;
    }
    onImported({ planName: result.plan_name || 'Imported Workout', days: mapped });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={busy ? undefined : onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${tokens.colors.accent}40`, backgroundColor: tokens.colors.surface, maxHeight: 640 }}
        >
          <SectionLabel>SCAN A WRITTEN WORKOUT</SectionLabel>
          <SegmentedTabs left="PHOTO" right="TYPE IT" active={mode} onChange={setMode} testIDPrefix="import-mode" />

          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {mode === 0 ? (
              <View className="mt-s3">
                <ScanFrame state={scanState}>
                  <View className="flex-row justify-center gap-s2 py-s2">
                    {photos.map((p, i) => (
                      <Pressable
                        key={i}
                        onPress={() => {
                          // Tap a filled slot to clear it.
                          if (p) setPhotos((prev) => prev.map((x, j) => (j === i ? null : x)));
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={p ? `remove page ${i + 1}` : `page ${i + 1} empty`}
                        testID={`import-photo-${i}`}
                        className="items-center justify-center rounded-md"
                        style={{
                          width: 72,
                          height: 96,
                          borderWidth: 1,
                          borderStyle: p ? 'solid' : 'dashed',
                          borderColor: p ? `${tokens.colors.accent}8c` : tokens.colors.border,
                          overflow: 'hidden',
                        }}
                      >
                        {p ? (
                          <Image source={{ uri: p }} style={{ width: 72, height: 96 }} resizeMode="cover" />
                        ) : (
                          <Text className="text-2xs text-text-mute">PAGE {i + 1}</Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </ScanFrame>
                <View className="mt-s2 flex-row gap-s2">
                  <View className="flex-1">
                    <NeonButton title="📷 CAMERA" variant="ghost" onPress={() => void addPhoto('camera')} testID="import-camera" />
                  </View>
                  <View className="flex-1">
                    <NeonButton title="🖼 GALLERY" variant="ghost" onPress={() => void addPhoto('gallery')} testID="import-gallery" />
                  </View>
                </View>
                <Text className="mt-s2 text-2xs text-text-mute">
                  Handwritten or typed, up to {MAX_PHOTOS} pages. The photo is read and discarded — never stored.
                </Text>
              </View>
            ) : (
              <View className="mt-s3">
                <TextInput
                  className="rounded-xl border bg-surface-2 px-s3 py-s2 text-sm text-text"
                  style={{ borderColor: tokens.colors.border, minHeight: 160, textAlignVertical: 'top' }}
                  placeholder={'Paste it — e.g.\nPush Day\nBench 5x5\nIncline DB Press 3x8-12\nLateral Raise 3x15'}
                  placeholderTextColor="#64758f"
                  value={text}
                  onChangeText={(v) => {
                    setText(v);
                    setError(null);
                  }}
                  multiline
                  maxLength={4000}
                  testID="import-text"
                />
              </View>
            )}

            {error ? (
              <Text className="mt-s2 text-2xs" style={{ color: tokens.colors.danger }} testID="import-error">
                {error}
              </Text>
            ) : null}
          </ScrollView>

          <View className="mt-s3">
            <NeonButton
              title={busy ? 'READING…' : 'READ MY WORKOUT'}
              onPress={() => void scan()}
              disabled={!canScan}
              busy={busy}
              testID="import-scan"
            />
          </View>
          <View className="mt-s2">
            <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="import-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
