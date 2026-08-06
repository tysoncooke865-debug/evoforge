import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useState } from 'react';

import { useEvolutionPathEnabled, useOriginPathState } from '@/data/origin-path';
import { levelAsset, originConfig } from '@/domain/origin-path/config';
import { REWARD_KIND_LABEL } from '@/domain/origin-path/rewards';
import { weekProgress, weeksToNextLevel } from '@/domain/origin-path/qualification';
import type { ChapterId } from '@/domain/origin-path/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenShell } from '@/ui/core/shell';
import { GlowCard } from '@/ui/core/shell';
import { SectionLabel } from '@/ui/core/screen-header';

/**
 * THE EVOLUTION PATH — the skill tree's replacement.
 *
 * FOUR CHAPTERS, NOT FORTY-EIGHT NODES. A 48-node horizontal rail is
 * unreadable on a phone and unusable one-handed; the brief bans it and it
 * would have been the obvious thing to build. Chapters open into their weeks
 * instead, and the ACTIVE week is the visually dominant element on the page
 * because it is the only one the athlete can act on.
 *
 * Future chapters render as locked previews with real requirements — never
 * as fake progress, and never as content that does not exist.
 */
export default function EvolutionScreen() {
  const colors = useThemeColors();
  const enabled = useEvolutionPathEnabled();
  const state = useOriginPathState();
  const s = state.data;
  const cfg = originConfig(s?.originPathId ?? null);
  const [open, setOpen] = useState<ChapterId | null>(null);

  // The flag is off, or the migration has not been applied: the Path simply
  // does not exist here, and the athlete is sent somewhere real rather than
  // shown an empty shell.
  if (!enabled) {
    return (
      <ScreenShell>
        <SectionLabel size="lg">EVOLUTION PATH</SectionLabel>
        <Text className="text-sm text-text-dim">
          The Evolution Path is not enabled for your account yet.
        </Text>
        <View className="mt-s3">
          <NeonButton title="BACK TO THE FORGE" variant="ghost" pixel onPress={() => router.push('/avatar' as never)} testID="path-disabled-back" />
        </View>
      </ScreenShell>
    );
  }

  if (state.isPending) {
    return (
      <ScreenShell>
        <SectionLabel size="lg">EVOLUTION PATH</SectionLabel>
        <View className="rounded-md bg-surface-2" style={{ height: 90 }} />
        <View className="mt-s2 rounded-md bg-surface-2" style={{ height: 120 }} />
      </ScreenShell>
    );
  }

  if (state.isError) {
    return (
      <ScreenShell>
        <SectionLabel size="lg">EVOLUTION PATH</SectionLabel>
        <Text className="text-sm text-text-dim">We couldn&apos;t load your path. Your training is safe.</Text>
        <View className="mt-s3">
          <NeonButton title="RETRY" variant="ghost" pixel onPress={() => void state.refetch()} testID="path-retry" />
        </View>
      </ScreenShell>
    );
  }

  if (!s || !s.hasPath || !cfg) {
    return (
      <ScreenShell>
        <SectionLabel size="lg">EVOLUTION PATH</SectionLabel>
        <Text className="text-sm text-text-dim">
          Choose an Origin to begin your path.
        </Text>
        <View className="mt-s3">
          <NeonButton title="CHOOSE YOUR ORIGIN" pixel onPress={() => router.push('/evo-scan' as never)} testID="path-choose-origin" />
        </View>
      </ScreenShell>
    );
  }

  const level = levelAsset(cfg, s.currentLevel);
  const toNext = weeksToNextLevel(s.qualifiedWeeks);
  const week = s.thisWeek;
  const done = week?.completedSessions ?? 0;
  const need = week?.requiredSessions ?? 0;
  const activeChapter = s.activeChapter;

  return (
    <ScreenShell>
      {/* WHO YOU ARE — the identity header. */}
      <GlowCard glow={colors.epic} padding={16}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          {cfg.name.toUpperCase()} PATH
        </Text>
        {/* EVOLUTION STAGE, not "LV." (2026-08-06). This is the champion's
            form — Cyber Recruit, Bulwark, Juggernaut — and it is a different
            progression from the Forge Level in the masthead. Sharing the word
            "level" between them is what made both look broken. */}
        <View className="mt-s1 flex-row items-baseline" style={{ gap: 10 }}>
          <Text allowFontScaling={false} style={{ fontSize: 34, lineHeight: 38, color: colors.epic, ...pixelFont() }}>
            STAGE {s.currentLevel}
          </Text>
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            {level.name.toUpperCase()}
          </Text>
        </View>
        <Text className="mt-s1 text-sm text-text-dim">{level.blurb}</Text>
        <Text className="mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
          {s.qualifiedWeeks} QUALIFIED WEEK{s.qualifiedWeeks === 1 ? '' : 'S'} ·{' '}
          {toNext == null ? 'FINAL STAGE' : `${toNext} TO STAGE ${s.currentLevel + 1}`}
        </Text>
      </GlowCard>

      {/* THIS WEEK — the dominant element, because it is the only actionable one. */}
      {s.currentLevel === 0 ? (
        <GlowCard glow={colors.accent} padding={16}>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>DORMANT</Text>
          <Text className="mt-s1 text-text" allowFontScaling={false} style={{ fontSize: 18, ...pixelFont() }}>
            AWAKEN YOUR ORIGIN
          </Text>
          <Text className="mt-s1 text-sm text-text-dim">
            Your Origin has been selected, but it has not been awakened. Complete your first workout to unlock Stage 1.
          </Text>
          <View className="mt-s3">
            <NeonButton title="BEGIN FIRST WORKOUT" pixel size="hero" onPress={() => router.push('/today' as never)} testID="path-begin-first" />
          </View>
        </GlowCard>
      ) : (
        <GlowCard glow={colors.accent} padding={16}>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            THIS WEEK — WEEK {Math.min(48, s.qualifiedWeeks + 1)} OF 48
          </Text>
          <View className="mt-s2 flex-row items-center" style={{ gap: 10 }}>
            <View className="flex-1 overflow-hidden rounded-pill" style={{ height: 10, backgroundColor: colors['surface-3'] }}>
              <View
                style={{
                  width: `${weekProgress(done, need) * 100}%`,
                  minWidth: done > 0 ? 6 : 0,
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: week?.qualifiedAt ? colors.success : colors.accent,
                }}
              />
            </View>
            <Text className="text-text" allowFontScaling={false} style={{ fontSize: 15, ...pixelFont() }}>
              {done}/{need}
            </Text>
          </View>
          <Text className="mt-s1 text-2xs text-text-dim">
            {week?.qualifiedAt
              ? 'Week qualified. Anything more this week is a bonus — it cannot skip ahead.'
              : `${Math.max(0, need - done)} more qualifying session${need - done === 1 ? '' : 's'} to bank this week.`}
          </Text>
          {s.nextReward ? (
            <View className="mt-s3 rounded-md border px-s3 py-s2" style={{ borderColor: `${colors.epic}45` }}>
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
                NEXT REWARD · {REWARD_KIND_LABEL[s.nextReward.kind]}
              </Text>
              <Text className="text-text" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
                {s.nextReward.label}
              </Text>
              {s.nextReward.description ? (
                <Text className="mt-s1 text-2xs text-text-dim">{s.nextReward.description}</Text>
              ) : null}
            </View>
          ) : null}
        </GlowCard>
      )}

      {/* THE FOUR CHAPTERS. */}
      <SectionLabel size="lg">THE PATH</SectionLabel>
      {cfg.chapters.map((ch) => {
        const isActive = ch.id === activeChapter;
        const isDone = s.qualifiedWeeks >= ch.toWeek;
        const isOpen = open === ch.id;
        const banked = Math.max(0, Math.min(ch.toWeek - ch.fromWeek + 1, s.qualifiedWeeks - (ch.fromWeek - 1)));
        const span = ch.toWeek - ch.fromWeek + 1;
        return (
          <Pressable
            key={ch.id}
            onPress={() => setOpen(isOpen ? null : ch.id)}
            accessibilityRole="button"
            accessibilityState={{ expanded: isOpen }}
            accessibilityLabel={`${ch.name}. ${isDone ? 'Complete' : isActive ? 'In progress' : 'Locked'}. ${banked} of ${span} weeks banked.`}
            testID={`chapter-${ch.id}`}
            style={{ minHeight: 44 }}
          >
            <GlowCard glow={isActive ? colors.accent : undefined} padding={14}>
              <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text
                  className="text-text"
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={{ flex: 1, fontSize: 13, opacity: isActive || isDone ? 1 : 0.6, ...pixelFont() }}
                >
                  {ch.name.toUpperCase()}
                </Text>
                <Text className="text-2xs" style={{ letterSpacing: 1, color: isDone ? colors.success : isActive ? colors.accent : colors['text-mute'] }}>
                  {isDone ? 'COMPLETE' : isActive ? 'IN PROGRESS' : 'LOCKED'}
                </Text>
              </View>
              <Text className="mt-s1 text-2xs text-text-dim">{ch.summary}</Text>
              <View className="mt-s2 overflow-hidden rounded-pill" style={{ height: 5, backgroundColor: colors['surface-3'] }}>
                <View
                  style={{
                    width: `${(banked / span) * 100}%`,
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: isDone ? colors.success : colors.accent,
                  }}
                />
              </View>
              <Text className="mt-s1 text-2xs text-text-mute">
                {banked}/{span} weeks · unlocks Stage {ch.unlocksLevel}
              </Text>

              {isOpen ? (
                ch.authored ? (
                  <View className="mt-s3" style={{ gap: 6 }}>
                    {cfg.weeklyRewards
                      .filter((r) => r.weekIndex >= ch.fromWeek && r.weekIndex <= ch.toWeek)
                      .map((r) => {
                        const unlocked = s.unlockedRewards.some((u) => u.rewardId === r.rewardId);
                        const current = r.weekIndex === s.qualifiedWeeks + 1;
                        return (
                          <View
                            key={r.rewardId}
                            className="flex-row items-center rounded-md border px-s2 py-s2"
                            style={{
                              gap: 8,
                              borderColor: current ? colors.accent : colors.border,
                              borderWidth: current ? 1.5 : 1,
                              backgroundColor: current ? `${colors.accent}14` : 'transparent',
                            }}
                          >
                            <Text style={{ fontSize: 11, color: unlocked ? colors.success : colors['text-mute'] }}>
                              {unlocked ? '●' : '○'}
                            </Text>
                            <Text className="text-2xs text-text-mute" style={{ width: 34 }}>
                              W{r.weekIndex}
                            </Text>
                            <Text
                              className="text-text"
                              numberOfLines={1}
                              allowFontScaling={false}
                              style={{ flex: 1, fontSize: 11, opacity: unlocked || current ? 1 : 0.65, ...pixelFont() }}
                            >
                              {r.label}
                            </Text>
                            <Text className="text-2xs text-text-mute">{REWARD_KIND_LABEL[r.kind]}</Text>
                          </View>
                        );
                      })}
                  </View>
                ) : (
                  <Text className="mt-s3 text-2xs text-text-mute">
                    Rewards for this chapter are revealed as you approach it.
                  </Text>
                )
              ) : null}
            </GlowCard>
          </Pressable>
        );
      })}

      {/* THE LONG-TERM GOAL — stated plainly, and measured in the real world. */}
      <GlowCard padding={14}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>STAGE 4 — THE ORIGIN STANDARD</Text>
        <Text className="mt-s1 text-sm text-text-dim">{cfg.promise}</Text>
        {cfg.assessmentRules.map((a) => (
          <Text key={a.id} className="mt-s1 text-2xs text-text-mute">
            · {a.label}
          </Text>
        ))}
        <Text className="mt-s2 text-2xs text-text-mute">
          Measured from your logged training. Time alone never unlocks it.
        </Text>
      </GlowCard>
    </ScreenShell>
  );
}
