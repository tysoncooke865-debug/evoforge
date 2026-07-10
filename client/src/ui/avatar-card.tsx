import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { evolutionName, getBranchStage, raritySlug, type Branch } from '@/domain/avatar-stats';
import { branchDisplayName } from '@/domain/avatar-stats';
import { rankName } from '@/domain/profile';
import tokens from '@/theme/tokens';

import { avatarImage } from './avatar-images';
import { RarityBadge } from './rarity-badge';

/**
 * The Home avatar card: stage PNG inside a rarity aura, evolution name,
 * branch and rank. The AURA colour comes from the CSS token palette
 * (tokens.colors[raritySlug]) while the BADGE uses the Python palette --
 * the shipped app disagrees the same way, pinned on purpose.
 */
export function AvatarCard({ branch, level }: { branch: Branch; level: number }) {
  const stage = getBranchStage(branch, level);
  const slug = raritySlug(level);
  const auraColour =
    (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;

  return (
    <View className="w-full rounded-lg border border-border bg-surface p-s6">
      <View className="items-center">
        <View
          className="items-center justify-center rounded-xl p-s4"
          style={{
            backgroundColor: `${auraColour}14`,
            borderWidth: 1,
            borderColor: `${auraColour}40`,
            shadowColor: auraColour,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            elevation: 8,
          }}
        >
          <Image
            source={avatarImage(branch, stage)}
            style={{ width: 220, height: 220 }}
            contentFit="contain"
            accessibilityLabel="Current form"
          />
        </View>

        <View className="mt-s4 items-center gap-s2">
          <RarityBadge level={level} />
          <Text className="text-xl font-bold text-text">{evolutionName(branch, level)}</Text>
          <Text className="text-sm text-text-dim">
            {branchDisplayName(branch)} • Level {level}
          </Text>
          <Text className="text-sm text-text-mute">{rankName(level)}</Text>
        </View>
      </View>
    </View>
  );
}
