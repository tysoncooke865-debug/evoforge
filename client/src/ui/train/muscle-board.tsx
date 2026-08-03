/**
 * THE MUSCLE LOAD BOARD (2026-08-03) — "it's hard to press on the individual
 * muscles on phone due to a small screen size."
 *
 * ---- WHY THE FIX IS A BIGGER FIGURE, NOT A SMARTER TAP ----
 *
 * On the Train card the figure is ~130pt wide, so an individual muscle is a
 * 15–30pt blob: about four millimetres on glass, well under the 44pt floor,
 * and a MISS did something worse than nothing — it flipped the figure, which
 * reads as the app malfunctioning. Expanding the hit paths would have made the
 * targets overlap each other long before they became comfortable, and
 * resolving a tap to the "nearest" muscle would have meant the athlete could
 * not tell what they were about to open.
 *
 * So the card's figure stopped being a precision control and became a DOOR.
 * Tapping it anywhere opens this board, where the same figure is drawn at the
 * full width of the sheet — roughly 2.5× the linear size and SIX times the tap
 * area — and every muscle is comfortably pressable. The flip moved to its own
 * 44pt button, which it always deserved.
 *
 * ---- AND THE FIGURE IS NEVER THE ONLY WAY IN ----
 *
 * Every muscle the day targets also has a ROW here, and the card's PRIMARY
 * MUSCLES chips open this board with that muscle already selected. Three
 * regions — traps on the front view, the adductors and the abductors — have
 * hand-painted mask artwork but no hit geometry, so on the figure alone they
 * would be unreachable at ANY size. A labelled list is not a fallback for the
 * figure; it is the reliable path, and the figure is the pleasurable one.
 *
 * Selecting a muscle ISOLATES it on the figure. That is the payoff the small
 * card could never give: you see exactly which shape the name refers to.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { MUSCLE_FUNCTION } from '@/domain/mission-brief';
import { MUSCLE_LABEL, focusFor, type MuscleId, type MuscleView } from '@/domain/muscle-map';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { MuscleMap, bestViewFor } from '@/ui/muscle-map/muscle-map';

/** The weekly set count growth research broadly converges on as a floor. */
export const WEEKLY_SET_TARGET = 10;

export interface MuscleLoad {
  muscle: MuscleId;
  /** Today's planned exercises that tag it, with their set counts. */
  exercises: readonly { exercise: string; sets: number }[];
  /** Sets LOGGED this week whose exercise tags it. Real, not planned. */
  weekSets: number;
}

export function MuscleBoard({
  muscles,
  initialMuscle,
  loadFor,
  onClose,
}: {
  /** Every muscle today's mission targets, in the card's own order. */
  muscles: readonly MuscleId[];
  /** Opened from a chip: that muscle starts selected. */
  initialMuscle: MuscleId | null;
  /** Resolved on demand — the week scan is a walk over the log. */
  loadFor: (muscle: MuscleId) => MuscleLoad;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const [selected, setSelected] = useState<MuscleId | null>(initialMuscle);
  // The view follows the SELECTION when there is one — picking "Lats" and
  // being shown a front view with nothing lit would be the board failing at
  // its one job. `viewChoice` is the athlete overriding that.
  const [viewChoice, setViewChoice] = useState<MuscleView | null>(null);
  const view: MuscleView = viewChoice ?? bestViewFor(selected ? [selected] : muscles);

  const shown = selected ? [selected] : muscles;
  // As wide as the sheet allows — that is the whole point — but CAPPED BY
  // HEIGHT too. At the full 326pt on a 390×844 phone the figure is ~338pt tall
  // and pushes the load rows off the first screen, which trades one scroll
  // problem for another. A third of the viewport keeps the first row visible
  // and still leaves every muscle ~3× the target it had on the card.
  const figureWidth = Math.min(width, 560) - 64;
  const figureCap = Math.round(height * 0.34);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.82)' }}
        onPress={onClose}
        testID="muscle-board-backdrop"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{
            borderColor: `${colors.accent}40`,
            backgroundColor: colors.surface,
            maxHeight: height * 0.9,
          }}
          testID="muscle-board"
        >
          <View className="mb-s3 flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <View style={{ width: 8, height: 8, backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 6 }} />
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{ fontSize: 16, letterSpacing: 0, ...pixelFont() }}
              >
                MUSCLE LOAD
              </Text>
            </View>
            {selected ? (
              <Pressable
                onPress={() => setSelected(null)}
                accessibilityRole="button"
                testID="muscle-board-all"
                className="items-center justify-center px-s2"
                style={{ minHeight: 44 }}
              >
                <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
                  SHOW ALL
                </Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <SegmentedTabs
              left="FRONT"
              right="BACK"
              active={view === 'front' ? 0 : 1}
              onChange={(i) => setViewChoice(i === 0 ? 'front' : 'back')}
              testIDPrefix="board-view"
              pixelLabels
            />

            {/* THE FIGURE, big enough to actually press. */}
            <View className="mt-s3 items-center">
              <MuscleMap
                selectedMuscles={shown}
                view={view}
                width={Math.min(figureWidth, figureCap)}
                focus={focusFor(shown)}
                pulse
                interactive
                onMusclePress={(m) => setSelected((cur) => (cur === m ? null : m))}
                testID="board-map"
              />
            </View>

            {/* EVERY muscle the day targets — the reliable path in, and the
                only one for the three regions with art but no hit geometry. */}
            <View className="mt-s3">
              {muscles.map((m) => (
                <LoadRow
                  key={m}
                  load={loadFor(m)}
                  active={selected === m}
                  onPress={() => setSelected((cur) => (cur === m ? null : m))}
                />
              ))}
            </View>

            {selected ? <Detail load={loadFor(selected)} /> : (
              <Text className="mt-s3 text-center text-2xs text-text-mute">
                Tap a muscle — on the figure or in the list — for what it does and how much of
                it this week has had.
              </Text>
            )}

            <View className="mt-s4">
              <NeonButton title="BACK TO THE MISSION" variant="ghost" pixel onPress={onClose} testID="muscle-board-close" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One muscle: name, today's sets, and the week's real volume against the floor. */
function LoadRow({ load, active, onPress }: { load: MuscleLoad; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const todaySets = load.exercises.reduce((n, e) => n + e.sets, 0);
  const total = load.weekSets + todaySets;
  const pct = Math.min(100, Math.round((total / WEEKLY_SET_TARGET) * 100));
  const met = total >= WEEKLY_SET_TARGET;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={`muscle-row-${load.muscle}`}
      className="mb-s2 rounded-md border px-s3 py-s2"
      style={{
        minHeight: 52,
        justifyContent: 'center',
        borderColor: active ? `${colors.accent}8c` : colors.border,
        backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
      }}
    >
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 12, letterSpacing: 0, flexShrink: 1, color: active ? colors.accent : colors.text, ...pixelFont() }}
        >
          {MUSCLE_LABEL[load.muscle].toUpperCase()}
        </Text>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 10, letterSpacing: 0, color: colors['text-dim'], ...pixelFont() }}
        >
          {total} / {WEEKLY_SET_TARGET} SETS
        </Text>
      </View>
      <View
        className="mt-s1 self-stretch overflow-hidden rounded-pill"
        style={{ height: 5, backgroundColor: colors['surface-3'] }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: met ? colors.success : colors.accent,
            minWidth: pct > 0 ? 4 : 0,
          }}
        />
      </View>
      <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
        {load.weekSets} logged this week{todaySets > 0 ? ` · ${todaySets} planned today` : ''}
      </Text>
    </Pressable>
  );
}

/**
 * The selected muscle, expanded. Deliberately absent: any "estimated growth"
 * figure. Hypertrophy from a single planned session is not predictable from
 * sets — the same refusal domain/progression/session-evidence.ts makes on the
 * Evo side. The week's volume against the growth floor is the actionable
 * version of the same question.
 */
function Detail({ load }: { load: MuscleLoad }) {
  const colors = useThemeColors();
  return (
    <View
      className="mt-s3 rounded-md border p-s3"
      style={{ borderColor: `${colors.accent}30`, backgroundColor: 'rgba(34,211,238,0.05)' }}
      testID="muscle-board-detail"
    >
      <Text
        className="text-text"
        allowFontScaling={false}
        style={{ fontSize: 14, letterSpacing: 0, ...pixelFont() }}
        testID="muscle-board-title"
      >
        {MUSCLE_LABEL[load.muscle].toUpperCase()}
      </Text>
      <Text className="mt-s1 text-sm text-text-dim">{MUSCLE_FUNCTION[load.muscle]}</Text>

      <Text
        className="mt-s3 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.8, ...pixelFont(false) }}
      >
        IN TODAY&apos;S MISSION
      </Text>
      {load.exercises.length === 0 ? (
        <Text className="mt-s1 text-2xs text-text-mute">
          Nothing today targets this directly — it assists the lifts that do.
        </Text>
      ) : (
        load.exercises.map((e) => (
          <View key={e.exercise} className="mt-s1 flex-row items-center justify-between" style={{ gap: 8 }}>
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
        ))
      )}
      <Text className="mt-s2 text-2xs text-text-mute">
        Ten weekly sets is the growth floor most training research agrees on.
      </Text>
    </View>
  );
}
