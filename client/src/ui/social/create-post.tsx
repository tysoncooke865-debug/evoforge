import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useCreatePost, type CreatePostInput } from '@/data/social-feed';
import { useExercisePrefs, unitFor } from '@/data/exercise-prefs';
import { useWorkoutLog } from '@/data/hooks';
import { useWorkoutSessions } from '@/data/sessions';
import { recentPr } from '@/domain/recent-pr';
import { workoutPostPayload, type PostType, type Visibility } from '@/domain/social-feed';
import { normaliseWorkoutLog } from '@/domain/summary';
import { kgToLb } from '@/domain/units';
import { estimateMinutes } from '@/domain/workout-estimates';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';

/**
 * CREATE POST — user-initiated sharing (the spec's rule: nothing auto-publishes).
 * Three honest modes, each from the athlete's OWN confirmed data: a text
 * UPDATE, their latest WORKOUT (real sets/volume from workout_log), or their
 * latest PR (recentPr). Visibility is chosen here; a preview shows exactly what
 * lands before POST.
 */
type Mode = 'update' | 'workout' | 'pr';
const VIS: readonly Visibility[] = ['friends', 'public', 'private'];

export function CreatePostModal({
  onClose,
  initialWorkout,
}: {
  onClose: () => void;
  /** Share this specific finished workout (from the post-workout prompt). */
  initialWorkout?: { workout: string; date: string };
}) {
  const colors = useThemeColors();
  const workouts = useWorkoutLog();
  const sessions = useWorkoutSessions();
  const prefs = useExercisePrefs();
  const create = useCreatePost();

  const [mode, setMode] = useState<Mode>(initialWorkout ? 'workout' : 'update');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('friends');

  // The workout payload: the specific one the prompt handed us, else the latest
  // finished session.
  const workout = useMemo(() => {
    const rows = normaliseWorkoutLog(workouts.data ?? []);
    const target = initialWorkout
      ? { date: initialWorkout.date, workout: initialWorkout.workout }
      : (() => {
          const finished = [...(sessions.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
          return finished ? { date: String(finished.date), workout: String(finished.workout) } : null;
        })();
    if (!target) return null;
    const p = workoutPostPayload(rows, target.date.slice(0, 10), target.workout);
    if (p.sets === 0) return null;
    return { ...p, minutes: estimateMinutes(p.sets), pr_count: 0 };
  }, [workouts.data, sessions.data, initialWorkout]);

  // Latest PR → a real PR payload (in the athlete's display unit).
  const pr = useMemo(() => {
    const r = recentPr(workouts.data);
    if (!r) return null;
    const unit = unitFor(prefs.data, r.exercise);
    const value = unit === 'lb' ? Math.round(kgToLb(r.weightKg)) : Math.round(r.weightKg);
    return { exercise: r.exercise, new_value: value, unit };
  }, [workouts.data, prefs.data]);

  const build = (): { type: PostType; payload: Record<string, unknown> } | null => {
    if (mode === 'update') return caption.trim() ? { type: 'status', payload: {} } : null;
    if (mode === 'workout') return workout ? { type: 'workout', payload: workout } : null;
    if (mode === 'pr') return pr ? { type: 'pr', payload: { ...pr, prev_value: null } } : null;
    return null;
  };
  const built = build();

  const post = () => {
    if (!built) return;
    const input: CreatePostInput = {
      postType: built.type,
      visibility,
      caption: caption.trim() === '' ? null : caption.trim(),
      payload: built.payload,
    };
    create.mutate(input, { onSuccess: onClose });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable onPress={() => undefined} className="overflow-hidden rounded-t-xl border-t" style={{ borderColor: `${colors.epic}40`, backgroundColor: colors.surface, maxHeight: '86%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}>
              SHARE TO YOUR FEED
            </Text>

            <View className="flex-row" style={{ gap: 8 }}>
              <ModeTab label="UPDATE" active={mode === 'update'} onPress={() => setMode('update')} />
              <ModeTab label="WORKOUT" active={mode === 'workout'} onPress={() => setMode('workout')} disabled={!workout} />
              <ModeTab label="PR" active={mode === 'pr'} onPress={() => setMode('pr')} disabled={!pr} />
            </View>

            {/* Preview of what will attach. */}
            <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: colors.border, backgroundColor: 'rgba(6,12,24,0.5)' }}>
              {mode === 'update' ? (
                <Text className="text-2xs text-text-mute">A text update — your caption is the post.</Text>
              ) : mode === 'workout' && workout ? (
                <>
                  <Text className="text-sm font-bold text-text">{workout.workout_name.toUpperCase()}</Text>
                  <Text className="mt-s1 text-2xs text-text-mute">{workout.minutes} min · {workout.sets} sets · {workout.volume_kg.toLocaleString()} kg · +{workout.xp} XP</Text>
                </>
              ) : mode === 'pr' && pr ? (
                <>
                  <Text className="text-sm font-bold text-text">{pr.exercise.toUpperCase()}</Text>
                  <Text className="mt-s1 text-2xs text-legendary">{pr.new_value} {pr.unit} — new personal record</Text>
                </>
              ) : (
                <Text className="text-2xs text-text-mute">Log a {mode} first and it will appear here to share.</Text>
              )}
            </View>

            <TextInput
              multiline
              className="mt-s3 w-full rounded-md border bg-surface-2 px-s3 py-s3 text-base text-text"
              style={{ borderColor: `${colors.epic}59`, minHeight: 84, textAlignVertical: 'top' }}
              placeholder={mode === 'update' ? "What's the win? (required)" : 'Add a caption (optional)'}
              placeholderTextColor="#64758f"
              value={caption}
              onChangeText={setCaption}
              maxLength={500}
              testID="create-caption"
            />

            <Text className="mb-s1 mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>VISIBILITY</Text>
            <View className="flex-row flex-wrap gap-s2">
              {VIS.map((v) => (
                <Chip key={v} label={v.toUpperCase()} active={visibility === v} onPress={() => setVisibility(v)} testID={`create-vis-${v}`} />
              ))}
            </View>

            <View className="mt-s4">
              <NeonButton title="POST" variant="epic" onPress={post} busy={create.isPending} disabled={!built} testID="create-post" />
            </View>
            <View className="mt-s2">
              <NeonButton title="CANCEL" variant="ghost" onPress={onClose} testID="create-cancel" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ModeTab({ label, active, onPress, disabled = false }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      testID={`create-mode-${label.toLowerCase()}`}
      className="flex-1 items-center justify-center rounded-md border"
      style={{ minHeight: 44, opacity: disabled ? 0.4 : 1, borderColor: active ? `${colors.epic}8c` : colors.border, backgroundColor: active ? 'rgba(168,85,247,0.12)' : colors['surface-2'] }}
    >
      <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, color: active ? colors.epic : colors['text-dim'], ...pixelFont(false) }}>{label}</Text>
    </Pressable>
  );
}
