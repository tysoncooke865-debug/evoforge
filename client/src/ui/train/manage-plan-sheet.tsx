/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see that
   .value writes are UI-thread animation state, not render state. Same
   documented exception as ui/core/neon-button.tsx. */
/**
 * MANAGE PLAN (2026-08-03, TRAIN brief) — "The bottom sheet should feel like
 * choosing a loadout."
 *
 * Every door that used to be a grey card under the hero now lives here:
 * switch plans, import a workout, quick workout, edit schedule, create or edit
 * a plan, forge an AI plan — plus SWAP TODAY'S DAY, which was already in the
 * old CHANGE WORKOUT sheet. Nothing was removed; the page above simply stopped
 * offering six administrative decisions next to its one action.
 *
 * ---- WHY THERE ARE NO STARS ----
 *
 * The brief's mock rated the current plan "★★★★★ Personalised". Nothing in the
 * app rates a plan, so five stars would be an ornament dressed as a
 * measurement — and the first athlete to notice that every plan has five would
 * stop trusting the numbers that ARE real. What each loadout shows instead is
 * true and is more useful for choosing: what the plan is, how many training
 * days it holds, and which days those are.
 *
 * Every testID here is verbatim from the sheet it replaces (today-source-N,
 * swap-day-*, change-scan, build-routine / create-my-plan, forge-ai-plan,
 * change-close) so existing tours keep passing; start-empty and edit-week
 * moved in from the deleted utility row and kept THEIR ids too.
 */

import * as Haptics from 'expo-haptics';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { SourceIndex } from '@/domain/plan-sources';
import { splitWorkoutName } from '@/domain/workout-estimates';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelCalendar, PixelCamera, PixelPencil, PixelPlusSquare } from '@/ui/core/pixel-icons';

export interface LoadoutSource {
  index: SourceIndex;
  label: string;
  /** What this plan IS — one line. */
  hint: string;
  /** The plan's own training days, for the honest "5 days · Push · Pull …". */
  days: readonly string[];
  /** No plan of this kind exists yet — the row still opens its door. */
  empty: boolean;
}

export function ManagePlanSheet({
  sources,
  active,
  onPickSource,
  swapDays,
  onPickSwapDay,
  onScan,
  onQuickWorkout,
  onEditSchedule,
  onEditPlan,
  onAiPlan,
  hasMyPlan,
  onClose,
}: {
  sources: readonly LoadoutSource[];
  active: SourceIndex;
  onPickSource: (i: SourceIndex) => void;
  /** Other days in the active plan — today's own is excluded by the caller. */
  swapDays: readonly string[];
  onPickSwapDay: (day: string) => void;
  onScan: () => void;
  onQuickWorkout: () => void;
  onEditSchedule: () => void;
  onEditPlan: () => void;
  onAiPlan: () => void;
  hasMyPlan: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: 620 }}
          testID="manage-plan-sheet"
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <SectionLabel>SELECT LOADOUT</SectionLabel>
            {sources.map((s) => (
              <Loadout
                key={s.label}
                source={s}
                active={s.index === active}
                onPress={() => onPickSource(s.index)}
              />
            ))}

            {swapDays.length > 0 ? (
              <View className="mt-s3">
                <SectionLabel>SWAP TODAY&apos;S DAY</SectionLabel>
                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                  {swapDays.map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => onPickSwapDay(d)}
                      accessibilityRole="button"
                      testID={`swap-day-${d}`}
                      className="rounded-md border px-s3 py-s2"
                      style={{
                        minHeight: 44,
                        justifyContent: 'center',
                        borderColor: colors.border,
                        backgroundColor: 'rgba(13,21,36,0.6)',
                      }}
                    >
                      <Text className="text-2xs font-bold text-text" style={{ letterSpacing: 0.5 }}>
                        {splitWorkoutName(d).title}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View className="mt-s4">
              <SectionLabel>MISSION CONTROL</SectionLabel>
              <Door
                icon={<PixelCamera size={16} color={colors.accent} />}
                title="IMPORT WORKOUT"
                subtitle="Scan a photo, screenshot or written page"
                onPress={onScan}
                testID="change-scan"
              />
              <Door
                icon={<PixelPlusSquare size={16} color={colors.accent} />}
                title="QUICK WORKOUT"
                subtitle="Train today without a plan"
                onPress={onQuickWorkout}
                testID="start-empty"
              />
              <Door
                icon={<PixelCalendar size={16} color={colors.accent} />}
                title="EDIT SCHEDULE"
                subtitle="Set which days you train"
                onPress={onEditSchedule}
                testID="edit-week"
              />
              <Door
                icon={<PixelPencil size={16} color={colors.accent} />}
                title={hasMyPlan ? 'EDIT MY PLAN' : 'CREATE A PLAN'}
                subtitle="Build the workouts themselves"
                onPress={onEditPlan}
                testID={hasMyPlan ? 'build-routine' : 'create-my-plan'}
              />
              <Door
                icon={<Text style={{ color: colors.epic, fontSize: 14 }}>✦</Text>}
                title="CREATE AI PLAN"
                subtitle="Forge a program around your goals"
                onPress={onAiPlan}
                testID="forge-ai-plan"
                tint={colors.epic}
              />
            </View>

            <View className="mt-s3">
              <NeonButton title="CLOSE" variant="ghost" pixel onPress={onClose} testID="change-close" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
      {children}
    </Text>
  );
}

/**
 * One loadout. The active one is lit and says so in words as well as colour;
 * the press springs, which is the whole "animated selection" ask — a card that
 * physically reacts reads as equipping something rather than ticking a radio.
 */
function Loadout({
  source,
  active,
  onPress,
}: {
  source: LoadoutSource;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const dayList = source.days.slice(0, 4).map((d) => splitWorkoutName(d).title);
  const more = source.days.length - dayList.length;

  return (
    <Animated.View style={[{ marginBottom: 8 }, style]}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.975, { damping: 20, stiffness: 400 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 300 });
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        testID={`today-source-${source.index}`}
        className="rounded-md border px-s3 py-s2"
        style={{
          minHeight: 62,
          justifyContent: 'center',
          borderColor: active ? `${colors.accent}8c` : colors.border,
          backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
          opacity: source.empty && !active ? 0.7 : 1,
          shadowColor: colors.accent,
          shadowOpacity: active ? 0.3 : 0,
          shadowRadius: 14,
          elevation: active ? 4 : 0,
        }}
      >
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 13, letterSpacing: 0, flexShrink: 1, color: active ? colors.accent : colors.text, ...pixelFont() }}
          >
            {source.label}
          </Text>
          {active ? (
            <View className="rounded-pill px-s2" style={{ minHeight: 18, justifyContent: 'center', backgroundColor: `${colors.accent}26` }}>
              <Text className="text-2xs font-bold" style={{ color: colors.accent, letterSpacing: 1 }}>
                EQUIPPED
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
          {source.hint}
        </Text>
        {dayList.length > 0 ? (
          <Text className="mt-s1 text-2xs text-text-dim" numberOfLines={1}>
            {source.days.length} {source.days.length === 1 ? 'day' : 'days'} · {dayList.join(' · ')}
            {more > 0 ? ` +${more}` : ''}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function Door({
  icon,
  title,
  subtitle,
  onPress,
  testID,
  tint,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID: string;
  tint?: string;
}) {
  const colors = useThemeColors();
  const colour = tint ?? colors.accent;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className="mb-s2 flex-row items-center rounded-md border px-s3"
      style={{ minHeight: 52, gap: 10, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}
    >
      <View style={{ width: 18, alignItems: 'center' }}>{icon}</View>
      <View style={{ flexShrink: 1 }}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ fontSize: 11, letterSpacing: 0, color: colour, ...pixelFont() }}
        >
          {title}
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text className="ml-auto text-2xs font-bold" style={{ color: colour }}>
        ›
      </Text>
    </Pressable>
  );
}
