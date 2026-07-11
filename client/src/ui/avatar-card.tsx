import { Text, View } from 'react-native';

import { evolutionName, getBranchStage, raritySlug, type Branch } from '@/domain/avatar-stats';
import { branchDisplayName } from '@/domain/avatar-stats';
import tokens from '@/theme/tokens';

import { AvatarStage } from './avatar-stage';
import { RarityBadge } from './rarity-badge';

/**
 * The Home avatar card: the living stage (idleFloat/breathe/auraPulse/
 * groundPulse) inside a rarity-tinted frame, evolution name, branch and rank.
 * The AURA colour comes from the CSS token palette (tokens.colors[slug])
 * while the BADGE uses the Python palette -- the shipped app disagrees the
 * same way, pinned on purpose.
 */
export function AvatarCard({ branch, level }: { branch: Branch; level: number }) {
  const stage = getBranchStage(branch, level);
  const slug = raritySlug(level);
  const auraColour = (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;

  return (
    <View
      className="w-full items-center rounded-lg border bg-surface p-s6"
      style={{ borderColor: `${auraColour}40` }}
    >
      <AvatarStage branch={branch} stage={stage} auraColour={auraColour} />

      <View className="mt-s4 items-center gap-s2">
        <RarityBadge level={level} />
        <Text className="text-xl font-bold text-text">{evolutionName(branch, level)}</Text>
        <Text className="text-sm text-text-dim">
          {branchDisplayName(branch)} • Level {level}
        </Text>
      </View>
    </View>
  );
}
