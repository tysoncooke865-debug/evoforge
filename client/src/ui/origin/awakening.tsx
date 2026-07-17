/**
 * ORIGIN ONBOARDING — the Stage 1 Awakening ceremony (Act II final step).
 *
 * One-shot, never looping: the ceremony is a staged timeout sequence (major
 * = 1200ms, the level-up contract), so a decorative failure can never block
 * completion. Reduced motion skips straight to the final frame. Sound is
 * gesture-adjacent (fired from the binding tap's continuation) and Web-Audio
 * only, per the media-session rule.
 */

import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { OriginId } from '@/domain/origin/types';
import type { BranchV2 } from '@/domain/branches-v2';
import { evolutionNameV2 } from '@/domain/branches-v2';
import { durations } from '@/theme/animations';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { animatedAvatar, avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';
import { useAmbient } from '@/ui/core/use-ambient';
import { playPowerUp } from '@/ui/core/sound';
import { GlowCard } from '@/ui/core/shell';

export function AwakeningCeremony({
  originId,
  originName,
  sex,
  testID,
}: {
  originId: OriginId;
  originName: string;
  sex: 'male' | 'female';
  testID?: string;
}) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const ambient = useAmbient();
  const [revealed, setRevealed] = useState(reduced);

  const branch = originId as BranchV2;
  const still = stillAvatar(branch, 1, sex) ?? avatarArtV2(branch, 1, sex).source ?? null;
  const animated = animatedAvatar(branch, 1, sex) ?? null;
  const art = ambient && animated ? animated : still;

  useEffect(() => {
    if (reduced) return; // reduced motion: the final frame rendered from the start
    playPowerUp();
    const t = setTimeout(() => setRevealed(true), durations.major);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GlowCard glow={colors.legendary} padding={20}>
      <View className="items-center" testID={testID}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
        >
          {revealed ? 'YOUR CHAMPION AWAKENS' : 'FORGING YOUR CHAMPION'}
        </Text>
        <View className="my-s4 items-center justify-center" style={{ width: 180, height: 200 }}>
          {art ? (
            <Image
              source={art}
              style={{
                width: 170,
                height: 190,
                opacity: revealed ? 1 : 0.35,
              }}
              contentFit="contain"
            />
          ) : (
            <Text className="text-4xl text-text-mute">?</Text>
          )}
        </View>
        {revealed ? (
          <>
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{
                fontSize: 22,
                letterSpacing: 0,
                textShadowColor: 'rgba(34,211,238,0.6)',
                textShadowRadius: 16,
                ...pixelFont(),
              }}
            >
              {evolutionNameV2(branch, 1).toUpperCase()}
            </Text>
            <Text
              className="mt-s1 text-legendary"
              allowFontScaling={false}
              style={{ fontSize: 11, letterSpacing: 1.5, ...pixelFont() }}
            >
              {originName.toUpperCase()} · STAGE 1
            </Text>
            <Text className="mt-s3 text-center text-xs text-text-dim">
              This champion is yours — Firstbound, permanently recorded. Train in the real world
              to evolve it toward Stage 2.
            </Text>
          </>
        ) : null}
      </View>
    </GlowCard>
  );
}
