import { Text, View } from 'react-native';

import { avatarRarity } from '@/domain/avatar-stats';

/**
 * The rarity badge, coloured by domain/avatar-stats' avatarRarity -- the
 * PYTHON badge palette, exactly as ui/avatar_cards.py injects it inline via
 * --rarity-colour today. The aura around the avatar uses the CSS token
 * palette instead; the two knowingly disagree (see client/CLAUDE.md).
 */
export function RarityBadge({ level }: { level: number }) {
  const { name, icon, colour } = avatarRarity(level);
  return (
    <View
      className="self-start rounded-pill border px-s3 py-s1"
      style={{ borderColor: `${colour}73`, backgroundColor: `${colour}1f` }}
    >
      <Text className="text-xs font-bold" style={{ color: colour }}>
        {icon} {name} FORM
      </Text>
    </View>
  );
}
