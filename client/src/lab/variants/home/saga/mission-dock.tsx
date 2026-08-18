/**
 * SAGA — THE DOCKED MISSION BAR. The mission leaves the scroll entirely and
 * fixes to the screen's bottom edge, at the thumb, OUTSIDE ScreenShell (a
 * sibling inside the variant's flex:1 View — the shell scrolls its children,
 * so anything inside it would scroll away). Solid token surface + top border
 * so it reads over whatever passes beneath; safe-area padded so the CTA
 * never sits under a home indicator.
 *
 * Every honest state, compactly: loading holds the bar's height with a
 * skeleton, error offers RETRY (the model's retry refetches all three
 * queries), rest day and no-plan inform without shouting, completed shows
 * the banked XP with a quiet door back into the day, and scheduled /
 * in-progress carry the page's ONE dominant CTA — START or RESUME — at full
 * touch size. mission.open() is the lab's one workout door.
 */

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

import type { HomeModel } from '../shared/use-home-model';

/** The bar's content height before safe-area padding — saga.tsx's scroll
 *  spacer is sized against this so nothing hides beneath the dock. */
export const DOCK_CONTENT_HEIGHT = 76;

export function MissionDock({ mission }: { mission: HomeModel['mission'] }) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const m = mission.mission;
  const underway = m.status === 'in_progress';
  const actionable = m.status === 'scheduled' || underway;

  return (
    <View
      testID="saga-mission-dock"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: `${colors.accent}3d`,
        shadowColor: '#000000',
        shadowOpacity: 0.45,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: -6 },
        elevation: 12,
      }}
    >
      <View
        className="w-full max-w-[560px] flex-row items-center self-center px-s4"
        style={{
          minHeight: DOCK_CONTENT_HEIGHT,
          paddingTop: 10,
          paddingBottom: Math.max(insets.bottom, 12),
          gap: 12,
        }}
      >
        {mission.loading ? (
          <View
            style={{ flex: 1 }}
            accessible
            accessibilityLabel="Today's mission is loading"
            testID="saga-dock-loading"
          >
            <Kicker>TODAY&apos;S MISSION</Kicker>
            <View className="mt-s1 rounded-md bg-surface-2" style={{ height: 18, width: '58%' }} />
          </View>
        ) : mission.error ? (
          <>
            <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel="Today's mission failed to load. Your logged sets are safe.">
              <Kicker>TODAY&apos;S MISSION</Kicker>
              <Text className="text-sm font-bold text-text" numberOfLines={1}>
                Couldn&apos;t load the mission
              </Text>
              <Text className="text-xs text-text-dim" numberOfLines={1}>
                Your logged sets are safe.
              </Text>
            </View>
            <View style={{ minWidth: 110 }}>
              <NeonButton title="RETRY" variant="ghost" pixel onPress={mission.retry} testID="saga-mission-retry" />
            </View>
          </>
        ) : m.status === 'rest_day' ? (
          <View
            style={{ flex: 1 }}
            accessible
            accessibilityLabel={`Recovery day.${mission.next ? ` Next mission ${mission.next.day}.` : ''}`}
            testID="saga-dock-rest"
          >
            <Kicker>TODAY&apos;S MISSION</Kicker>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 18, letterSpacing: 0, color: colors.text, ...pixelFont() }}
            >
              RECOVERY DAY
            </Text>
            <Text className="text-xs text-text-dim" numberOfLines={1}>
              {mission.next ? `Next mission: ${mission.next.day}` : 'Rest and recover.'}
            </Text>
          </View>
        ) : m.status === 'no_plan' ? (
          <View
            style={{ flex: 1 }}
            accessible
            accessibilityLabel="No training plan set. Build one on the Train tab."
            testID="saga-dock-no-plan"
          >
            <Kicker>TODAY&apos;S MISSION</Kicker>
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 18, letterSpacing: 0, color: colors.text, ...pixelFont() }}
            >
              NO PLAN SET
            </Text>
            <Text className="text-xs text-text-dim" numberOfLines={1}>
              Build your split on the Train tab.
            </Text>
          </View>
        ) : m.status === 'completed' ? (
          <>
            <View
              style={{ flex: 1, minWidth: 0 }}
              accessible
              accessibilityLabel={`Mission complete: ${mission.title}. ${m.xpBanked} XP banked.`}
              testID="saga-dock-complete"
            >
              <Kicker colour={colors.accent}>MISSION COMPLETE</Kicker>
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{ fontSize: 18, letterSpacing: 0, color: colors.text, ...pixelFont() }}
              >
                {mission.title.toUpperCase()}
              </Text>
              <Text className="text-xs text-text-dim" numberOfLines={1}>
                {`+${m.xpBanked} XP banked today`}
              </Text>
            </View>
            <View style={{ minWidth: 110 }}>
              <NeonButton title="REVIEW" variant="ghost" pixel onPress={mission.open} testID="saga-mission-cta" />
            </View>
          </>
        ) : (
          <>
            <View
              style={{ flex: 1, minWidth: 0 }}
              accessible
              accessibilityLabel={`Today's mission: ${mission.title}${mission.sub ? ` ${mission.sub}` : ''}. ${m.doneSets} of ${m.targetSets} sets done.`}
              testID="saga-dock-mission"
            >
              <Kicker>TODAY&apos;S MISSION</Kicker>
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ fontSize: 18, letterSpacing: 0, color: colors.text, ...pixelFont() }}
              >
                {mission.title.toUpperCase()}
              </Text>
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={{ fontSize: 10, letterSpacing: 1, color: colors['text-dim'], ...pixelFont(false) }}
              >
                {`${m.doneSets}/${m.targetSets} SETS${mission.minutes > 0 ? ` · ~${mission.minutes} MIN` : ''}`}
              </Text>
            </View>
            {/* The page's one dominant action, at the thumb. No sweep: the
                variant's single ambient-loop budget is spent on the
                monument's aura. */}
            {actionable ? (
              <View style={{ minWidth: 148 }}>
                <NeonButton
                  title={underway ? 'RESUME' : 'START'}
                  variant="primary"
                  pixel
                  onPress={mission.open}
                  testID="saga-mission-cta"
                />
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

/** The bar's 10px caps label — text-dim floor, never text-mute (sub-12px
 *  contrast rule). */
function Kicker({ children, colour }: { children: ReactNode; colour?: string }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={{
        fontSize: 10,
        letterSpacing: 1.6,
        color: colour ?? colors['text-dim'],
        ...pixelFont(false),
      }}
    >
      {children}
    </Text>
  );
}
