import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { pickPhoto } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { pushNotify } from '@/data/push';
import { useFriends } from '@/data/social';
import { useCreatePost, type CreatePostInput } from '@/data/social-feed';
import { uploadSocialPhotos } from '@/data/social-photos';
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
type Mode = 'update' | 'workout' | 'pr' | 'photo' | 'level_up';
const VIS: readonly Visibility[] = ['friends', 'public', 'private'];
const MAX_PHOTOS = 4;

export function CreatePostModal({
  onClose,
  initialWorkout,
  initialLevelUp,
  initialMode,
}: {
  onClose: () => void;
  /** Share this specific finished workout (from the post-workout prompt). */
  initialWorkout?: { workout: string; date: string };
  /** Share a level-up (from the level-up ceremony). Adds a level_up mode. */
  initialLevelUp?: { from: number; to: number };
  /** Open directly in a given mode (e.g. 'pr' from a PR celebration). */
  initialMode?: Mode;
}) {
  const colors = useThemeColors();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const workouts = useWorkoutLog();
  const sessions = useWorkoutSessions();
  const prefs = useExercisePrefs();
  const friends = useFriends();
  const create = useCreatePost();

  const [mode, setMode] = useState<Mode>(
    initialMode ?? (initialLevelUp ? 'level_up' : initialWorkout ? 'workout' : 'update')
  );
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('friends');
  const [photos, setPhotos] = useState<string[]>([]); // local data URLs, uploaded on POST
  const [uploading, setUploading] = useState(false);
  const [tagged, setTagged] = useState<{ id: string; name: string }[]>([]);
  const toggleTag = (id: string, name: string) =>
    setTagged((cur) => (cur.some((t) => t.id === id) ? cur.filter((t) => t.id !== id) : [...cur, { id, name }]));

  // The workout payload: the specific one the prompt handed us, else the latest
  // finished session.
  const workout = (() => {
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
  })();

  // Latest PR → a real PR payload (in the athlete's display unit).
  const pr = (() => {
    const r = recentPr(workouts.data);
    if (!r) return null;
    const unit = unitFor(prefs.data, r.exercise);
    const value = unit === 'lb' ? Math.round(kgToLb(r.weightKg)) : Math.round(r.weightKg);
    return { exercise: r.exercise, new_value: value, unit };
  })();

  const canPost =
    mode === 'update' ? caption.trim() !== ''
    : mode === 'workout' ? !!workout
    : mode === 'pr' ? !!pr
    : mode === 'level_up' ? !!initialLevelUp
    : photos.length > 0; // photo
  const showPhotos = mode === 'photo' || mode === 'workout';

  const addPhoto = async () => {
    if (photos.length >= MAX_PHOTOS) return;
    const uri = await pickPhoto();
    if (uri) setPhotos((p) => [...p, uri]);
  };

  const post = async () => {
    if (!canPost) return;
    let paths: string[] = [];
    if (showPhotos && photos.length > 0 && uid) {
      setUploading(true);
      paths = await uploadSocialPhotos(uid, photos);
      setUploading(false);
    }
    let type: PostType;
    let payload: Record<string, unknown>;
    if (mode === 'update') {
      type = 'status';
      payload = {};
    } else if (mode === 'workout' && workout) {
      type = 'workout';
      payload = { ...workout, ...(paths.length ? { photo_urls: paths } : {}) };
    } else if (mode === 'pr' && pr) {
      type = 'pr';
      payload = { ...pr, prev_value: null };
    } else if (mode === 'level_up' && initialLevelUp) {
      type = 'level_up';
      payload = { prev_level: initialLevelUp.from, new_level: initialLevelUp.to };
    } else {
      type = 'photo';
      payload = {
        photo_urls: paths,
        ...(workout ? { workout_name: workout.workout_name, minutes: workout.minutes, sets: workout.sets } : {}),
      };
    }
    if (tagged.length > 0) payload.tagged = tagged;
    const input: CreatePostInput = {
      postType: type,
      visibility,
      caption: caption.trim() === '' ? null : caption.trim(),
      payload,
    };
    create.mutate(input, {
      onSuccess: () => {
        // The DB trigger creates the in-app mention notifications; fire the push
        // twin per tagged friend.
        for (const t of tagged) pushNotify({ type: 'mention', toUser: t.id });
        onClose();
      },
    });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable onPress={() => undefined} className="overflow-hidden rounded-t-xl border-t" style={{ borderColor: `${colors.epic}40`, backgroundColor: colors.surface, maxHeight: '86%' }}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
            <Text className="mb-s3 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}>
              SHARE TO YOUR FEED
            </Text>

            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {initialLevelUp ? <ModeTab label="LEVEL UP" active={mode === 'level_up'} onPress={() => setMode('level_up')} /> : null}
              <ModeTab label="UPDATE" active={mode === 'update'} onPress={() => setMode('update')} />
              <ModeTab label="WORKOUT" active={mode === 'workout'} onPress={() => setMode('workout')} disabled={!workout} />
              <ModeTab label="PR" active={mode === 'pr'} onPress={() => setMode('pr')} disabled={!pr} />
              <ModeTab label="PHOTO" active={mode === 'photo'} onPress={() => setMode('photo')} />
            </View>

            {/* Preview of what will attach. */}
            <View className="mt-s3 rounded-lg border p-s3" style={{ borderColor: colors.border, backgroundColor: 'rgba(6,12,24,0.5)' }}>
              {mode === 'level_up' && initialLevelUp ? (
                <>
                  <Text className="text-sm font-bold text-text">REACHED FORGE LEVEL {initialLevelUp.to}</Text>
                  <Text className="mt-s1 text-2xs text-text-mute">Lv. {initialLevelUp.from} → {initialLevelUp.to}</Text>
                </>
              ) : mode === 'update' ? (
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
              ) : mode === 'photo' ? (
                <Text className="text-2xs text-text-mute">
                  {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''} attached.` : 'Add up to 4 photos to share.'}
                </Text>
              ) : (
                <Text className="text-2xs text-text-mute">Log a {mode} first and it will appear here to share.</Text>
              )}
            </View>

            {/* Photo attach — photo mode, or extra photos on a workout post. */}
            {showPhotos ? (
              <View className="mt-s3">
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {photos.map((uri, i) => (
                    <View key={`${uri}:${i}`} style={{ width: 66, height: 66 }}>
                      <Image source={{ uri }} style={{ width: 66, height: 66, borderRadius: 8 }} contentFit="cover" />
                      <Pressable
                        onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))}
                        accessibilityRole="button"
                        accessibilityLabel="remove photo"
                        testID={`create-photo-remove-${i}`}
                        className="absolute items-center justify-center rounded-pill"
                        style={{ top: -6, right: -6, width: 22, height: 22, backgroundColor: colors.danger }}
                      >
                        <Text style={{ fontSize: 11, color: '#fff', fontWeight: '900' }}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <Pressable
                      onPress={() => void addPhoto()}
                      accessibilityRole="button"
                      accessibilityLabel="add a photo"
                      testID="create-add-photo"
                      className="items-center justify-center rounded-lg border"
                      style={{ width: 66, height: 66, borderStyle: 'dashed', borderColor: `${colors.accent}8c` }}
                    >
                      <Text style={{ fontSize: 22, color: colors.accent }}>＋</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

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

            {/* Tag friends — they get a mention notification + push. */}
            {(friends.data ?? []).length > 0 ? (
              <>
                <Text className="mb-s1 mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
                  TAG FRIENDS{tagged.length > 0 ? ` · ${tagged.length}` : ''}
                </Text>
                <View className="flex-row flex-wrap gap-s2">
                  {(friends.data ?? []).map((f) => (
                    <Chip
                      key={f.id}
                      label={`@${f.display_name}`}
                      active={tagged.some((t) => t.id === f.id)}
                      onPress={() => toggleTag(f.id, f.display_name)}
                      testID={`create-tag-${f.id}`}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Text className="mb-s1 mt-s3 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>VISIBILITY</Text>
            <View className="flex-row flex-wrap gap-s2">
              {VIS.map((v) => (
                <Chip key={v} label={v.toUpperCase()} active={visibility === v} onPress={() => setVisibility(v)} testID={`create-vis-${v}`} />
              ))}
            </View>

            <View className="mt-s4">
              <NeonButton title={uploading ? 'UPLOADING…' : 'POST'} variant="epic" onPress={() => void post()} busy={create.isPending || uploading} disabled={!canPost} testID="create-post" />
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
