import { Image } from 'expo-image';
import { View } from 'react-native';

import type { Branch } from '@/domain/avatar-stats';
import { useThemeColors } from '@/theme/use-theme';

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
  rim,
  tint,
  wash = 0.55,
}: {
  branch: Branch;
  stage: number;
  width?: number;
  height?: number;
  rim?: string;
  /**
   * The silhouette's fill. Defaults to near-black, which is correct for a
   * LOCKED form: the shape must tease and the art must not leak.
   *
   * A DUEL OPPONENT IS NOT A LOCKED SECRET — they are a real athlete whose
   * champion we simply do not publish — so that context passes a readable
   * slate instead. Near-black on a near-black card is not mystery, it is an
   * empty box (found in the browser, 2026-08-07).
   */
  tint?: string;
  /** The darkening wash over the art. Lower it wherever the shape must read. */
  wash?: number;
}) {
  const colors = useThemeColors();
  const rimColor = rim ?? colors.epic;
  return (
    <View
      style={{
        width: width + 8,
        height: height + 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        backgroundColor: 'rgba(4,7,14,0.8)',
        shadowColor: rimColor,
        shadowOpacity: 0.45,
        shadowRadius: 10,
        overflow: 'hidden',
      }}
    >
      <Image
        source={avatarImage(branch, stage)}
        tintColor={tint ?? '#070d1a'}
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
          backgroundColor: `rgba(4,7,14,${wash})`,
        }}
      />
    </View>
  );
}
