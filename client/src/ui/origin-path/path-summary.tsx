import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useOriginPathState } from '@/data/origin-path';
import { originConfig, levelAsset } from '@/domain/origin-path/config';
import { REWARD_KIND_LABEL } from '@/domain/origin-path/rewards';
import { weekProgress } from '@/domain/origin-path/qualification';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { GlowCard } from '@/ui/core/shell';

/**
 * HOME's Evolution Path strip.
 *
 * Sits directly under the mission card and answers three questions in one
 * glance: which Origin am I, how far into the path, and what does the NEXT
 * qualified week buy me. It never competes with START WORKOUT — no button,
 * no glow, one tap target that opens the full path.
 *
 * Renders NOTHING when the flag is off, the state is loading, or the athlete
 * has no path. A system without its backend is hidden, never mocked.
 */
export function PathSummary() {
  const colors = useThemeColors();
  const state = useOriginPathState();

  const s = state.data;
  if (state.isPending || !s || !s.hasPath || !s.originPathId) return null;
  const cfg = originConfig(s.originPathId);
  if (!cfg) return null;

  const level = levelAsset(cfg, s.currentLevel);
  const dormant = s.currentLevel === 0;
  const week = s.thisWeek;
  const done = week?.completedSessions ?? 0;
  const need = week?.requiredSessions ?? 0;
  const pct = weekProgress(done, need);
  const remaining = Math.max(0, need - done);

  return (
    <Pressable
      onPress={() => router.push('/evolution' as never)}
      accessibilityRole="button"
      accessibilityLabel={`${cfg.name} path, level ${s.currentLevel}, ${level.name}. Qualified week ${s.qualifiedWeeks} of 48. Opens your Evolution Path.`}
      testID="path-summary"
    >
      <GlowCard glow={colors.epic} padding={14}>
        <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }} numberOfLines={1}>
            {cfg.name.toUpperCase()} PATH — LEVEL {s.currentLevel}
          </Text>
          <Text className="text-2xs text-text-mute" numberOfLines={1} style={{ letterSpacing: 1 }}>
            {dormant ? 'DORMANT' : `WEEK ${Math.min(48, s.qualifiedWeeks + 1)} / 48`}
          </Text>
        </View>

        {/* DORMANT is the one state that gets an instruction rather than a
            statistic: there is exactly one thing to do and no progress to
            report yet. */}
        {dormant ? (
          <Text className="mt-s2 text-sm text-text-dim">
            Your Origin is chosen but not awakened. Complete your first workout to unlock Level 1.
          </Text>
        ) : (
          <>
            <View className="mt-s2 flex-row items-center" style={{ gap: 10 }}>
              <View className="flex-1 overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
                <View style={{ width: `${pct * 100}%`, minWidth: pct > 0 ? 4 : 0, height: '100%', borderRadius: 999, backgroundColor: colors.epic }} />
              </View>
              <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ ...pixelFont(false) }}>
                {done}/{need} THIS WEEK
              </Text>
            </View>

            {s.nextReward ? (
              <View className="mt-s2">
                <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
                  NEXT REWARD · {REWARD_KIND_LABEL[s.nextReward.kind]}
                </Text>
                <Text className="text-text" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 13, ...pixelFont() }}>
                  {s.nextReward.label}
                </Text>
                <Text className="text-2xs text-text-dim">
                  {remaining === 0
                    ? 'Week complete — reward unlocking'
                    : `${remaining} qualifying workout${remaining === 1 ? '' : 's'} remaining`}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </GlowCard>
    </Pressable>
  );
}
