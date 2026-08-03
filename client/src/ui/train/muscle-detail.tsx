/**
 * TAP A MUSCLE (2026-08-03, TRAIN brief) — "Muscle Name / Exercises / Sets /
 * Estimated Growth / Primary Function. Do not interrupt workflow."
 *
 * Four of those five are real and are here. ESTIMATED GROWTH is not, and is
 * not: nothing in the app can say how much a muscle will grow from a planned
 * session, and a number that looked like it could would be the same
 * fabrication `domain/progression/session-evidence.ts` refuses on the Evo
 * side. What replaces it is the thing an athlete can actually act on — THIS
 * WEEK'S VOLUME on that muscle, counted from their own logged sets, against
 * the 10-set-a-week floor the training literature agrees on for growth. That
 * turns a tap into "you are three sets short on lats this week", which is a
 * decision; "+0.3 cm" would only have been a lie.
 *
 * "Do not interrupt workflow" is why this is a bottom sheet with one dismiss
 * and no navigation: it answers and gets out of the way. It never leaves the
 * Train page.
 */

import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { MUSCLE_FUNCTION } from '@/domain/mission-brief';
import { MUSCLE_LABEL, type MuscleId } from '@/domain/muscle-map';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/** The weekly set count growth research broadly converges on as a floor. */
export const WEEKLY_SET_TARGET = 10;

export function MuscleDetailSheet({
  muscle,
  exercises,
  weekSets,
  onClose,
}: {
  muscle: MuscleId;
  /** Today's planned exercises that tag this muscle, with their set counts. */
  exercises: readonly { exercise: string; sets: number }[];
  /** Sets LOGGED this week whose exercise tags this muscle. Real, not planned. */
  weekSets: number;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const title = MUSCLE_LABEL[muscle].toUpperCase();
  const todaySets = exercises.reduce((n, e) => n + e.sets, 0);
  const pct = Math.min(100, Math.round(((weekSets + todaySets) / WEEKLY_SET_TARGET) * 100));

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
        onPress={onClose}
        testID="muscle-detail-backdrop"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: 520 }}
          testID="muscle-detail"
        >
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <View style={{ width: 8, height: 8, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 6 }} />
            <Text
              className="text-text"
              allowFontScaling={false}
              style={{ fontSize: 20, letterSpacing: 0, ...pixelFont() }}
              testID="muscle-detail-title"
            >
              {title}
            </Text>
          </View>
          <Text className="mt-s2 text-sm text-text-dim">{MUSCLE_FUNCTION[muscle]}</Text>

          {/* ---- TODAY ---- */}
          <Text
            className="mt-s4 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
          >
            IN TODAY&apos;S MISSION
          </Text>
          {exercises.length === 0 ? (
            <Text className="mt-s1 text-2xs text-text-mute">
              Nothing today targets this directly — it assists the lifts that do.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 168 }} className="mt-s1">
              {exercises.map((e) => (
                <View
                  key={e.exercise}
                  className="mb-s1 flex-row items-center justify-between rounded-md border px-s3"
                  style={{ minHeight: 40, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
                >
                  <Text className="text-sm text-text" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {e.exercise}
                  </Text>
                  <Text
                    className="text-accent"
                    allowFontScaling={false}
                    style={{ fontSize: 11, letterSpacing: 0, ...pixelFont() }}
                  >
                    {e.sets} {e.sets === 1 ? 'SET' : 'SETS'}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}

          {/* ---- THIS WEEK — the decision, not a growth promise ---- */}
          <View className="mt-s3">
            <View className="flex-row items-end justify-between">
              <Text
                className="text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
              >
                THIS WEEK&apos;S VOLUME
              </Text>
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{ fontSize: 13, letterSpacing: 0, ...pixelFont() }}
                testID="muscle-detail-volume"
              >
                {weekSets + todaySets} / {WEEKLY_SET_TARGET} SETS
              </Text>
            </View>
            <View
              className="mt-s1 self-stretch overflow-hidden rounded-pill"
              style={{ height: 6, backgroundColor: colors['surface-3'] }}
            >
              <View
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: pct >= 100 ? colors.success : colors.accent,
                  minWidth: pct > 0 ? 4 : 0,
                }}
              />
            </View>
            <Text className="mt-s1 text-2xs text-text-mute">
              {weekSets} logged{todaySets > 0 ? `, ${todaySets} planned today` : ''}. Ten weekly sets is the
              growth floor most training research agrees on.
            </Text>
          </View>

          <View className="mt-s4">
            <NeonButton title="BACK TO THE MISSION" variant="ghost" pixel onPress={onClose} testID="muscle-detail-close" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
