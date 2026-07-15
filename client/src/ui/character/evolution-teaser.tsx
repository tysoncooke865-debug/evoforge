import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';
import { getBranchStage } from '@/domain/avatar-stats';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import type { NextEvolution } from '@/domain/next-evolution';
import tokens from '@/theme/tokens';

import { EdgeLabel } from '@/ui/core/hud';
import { Silhouette } from './silhouette';

/**
 * The Home strip that keeps the next form in sight: silhouetted preview
 * (never the raw asset — black-tinted, dimmed, glow-rimmed), readiness %,
 * the nearest requirement as the call to action. Tap → Avatar page.
 */
export function EvolutionTeaser({
  branch,
  evolution,
}: {
  branch: Branch;
  evolution: NextEvolution;
}) {
  const readiness = evolutionReadiness(evolution.requirements);
  const nextStage = getBranchStage(branch, evolution.targetLevel);

  return (
    <Link href="/avatar" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Next evolution: ${evolution.targetName}, ${readiness.percent} percent ready`}>
        <View
          className="flex-row items-center gap-s4 rounded-xl p-s4"
          style={{
            borderWidth: 1,
            borderColor: `${tokens.colors.epic}45`,
            backgroundColor: 'rgba(168, 85, 247, 0.06)',
          }}
        >
          <Silhouette branch={branch} stage={nextStage} width={56} height={68} />

          <View className="flex-1">
            <EdgeLabel>NEXT EVOLUTION</EdgeLabel>
            <Text className="text-base font-bold text-text">{evolution.targetName}</Text>
            {readiness.nearest ? (
              <Text className="text-2xs text-text-mute">
                Next up: <Text className="text-text-dim">{readiness.nearest.label}</Text>
              </Text>
            ) : (
              <Text className="text-2xs text-success">All requirements met</Text>
            )}
          </View>

          <View className="items-center">
            <Text
              className="text-2xl font-bold"
              style={{
                color: tokens.colors.epic,
                textShadowColor: 'rgba(168,85,247,0.6)',
                textShadowRadius: 12,
              }}
            >
              {readiness.percent}%
            </Text>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              READY
            </Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
