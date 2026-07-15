import { Image } from 'expo-image';
import { View } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';
import tokens from '@/theme/tokens';

import { avatarImage } from './avatar-images';

/**
 * A LOCKED-form preview that cannot leak the artwork. Three layers of
 * mystery: expo-image's tintColor PROP (the style variant is unreliable on
 * web -- the bug this component exists to kill), a near-black overlay wash,
 * and a rarity rim glow. The shape teases; the art stays hidden.
 */
export function Silhouette({
  branch,
  stage,
  width = 44,
  height = 48,
  rim = tokens.colors.epic,
}: {
  branch: Branch;
  stage: number;
  width?: number;
  height?: number;
  rim?: string;
}) {
  return (
    <View
      style={{
        width: width + 8,
        height: height + 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: 'rgba(4,7,14,0.8)',
        shadowColor: rim,
        shadowOpacity: 0.45,
        shadowRadius: 10,
        overflow: 'hidden',
      }}
    >
      <Image
        source={avatarImage(branch, stage)}
        tintColor="#070d1a"
        style={{ width, height }}
        contentFit="contain"
      />
      {/* Wash: even if a platform ignores tintColor, the art stays buried. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(4,7,14,0.55)',
        }}
      />
    </View>
  );
}
