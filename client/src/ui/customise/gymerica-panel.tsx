import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { GymericaSkin, PremiumCharacter, Selection } from '@/domain/customise';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { HeroStage } from '@/ui/character/hero-stage';
import { gymericaAnimated, gymericaStill } from '@/ui/character/gymerica-art';
import { EdgeLabel } from '@/ui/core/hud';
import { CoinIcon } from '@/ui/core/coin-icon';
import { playSelect } from '@/ui/core/sound';

/**
 * CUSTOMISE §premium — Captain Gymerica's own panel (he is an equipped
 * OVERLAY, not a training class, so he gets a dedicated preview + a
 * 2-stage selector + his two looks rather than the branch components).
 * Locked (unbought) shows the price and previews the hero anyway.
 */
export function GymericaPanel({
  character,
  selection,
  owned,
  auraColour,
  onChange,
}: {
  character: PremiumCharacter;
  selection: Selection;
  owned: boolean;
  auraColour: string;
  onChange: (next: Partial<Selection>) => void;
}) {
  const stage = Math.max(1, Math.min(character.stageNames.length, selection.characterStage));
  const look = selection.characterSkin;

  return (
    <View>
      <View
        className="rounded-xl p-s4"
        style={{ borderWidth: 1, borderColor: `${tokens.colors.accent}33`, backgroundColor: 'rgba(10,16,30,0.55)' }}
      >
        <View className="flex-row items-start justify-between">
          <View style={{ flexShrink: 1 }}>
            <Text
              className="text-xl font-bold"
              numberOfLines={1}
              style={{ color: tokens.colors.accent, textShadowColor: `${tokens.colors.accent}66`, textShadowRadius: 14, ...pixelFont() }}
            >
              {character.stageNames[stage - 1].toUpperCase()}
            </Text>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
              {character.icon} PREMIUM HERO · STAGE {stage} / {character.stageNames.length}
            </Text>
          </View>
          {!owned ? (
            <View className="flex-row items-center rounded-md border px-s2 py-s1" style={{ gap: 4, borderColor: `${tokens.colors.legendary}59` }}>
              <CoinIcon size={12} />
              <Text allowFontScaling={false} style={{ fontSize: 11, color: tokens.colors.legendary, ...pixelFont() }}>
                {character.price}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ opacity: owned ? 1 : 0.85 }}>
          {/* stage={4} drives the growth math to full stage-4 size (Tyson);
              the ART uses the real 1/2 stage via the source props. */}
          <HeroStage
            branch="aesthetic"
            stage={4}
            auraColour={auraColour}
            size={190}
            source={gymericaStill(stage, look)}
            animatedSource={gymericaAnimated(stage, look)}
            stillSource={gymericaStill(stage, look)}
            silhouette={false}
          />
        </View>
        {!owned ? (
          <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
            🔒 PREVIEW — BUY BELOW TO EQUIP
          </Text>
        ) : null}
        <Text className="mt-s2 text-center text-2xs text-text-mute">
          An equipped hero overlay — your training class and stats stay yours underneath.
        </Text>
      </View>

      {/* Stage selector — both unlocked with the single purchase. */}
      <View className="mt-s4">
        <EdgeLabel>STAGES</EdgeLabel>
        <View className="mt-s2 flex-row" style={{ gap: 8 }}>
          {character.stageNames.map((name, i) => {
            const s = i + 1;
            const selected = stage === s;
            return (
              <Pressable
                key={name}
                onPress={() => {
                  playSelect();
                  onChange({ characterStage: s });
                }}
                accessibilityRole="button"
                accessibilityLabel={`stage ${s}, ${name}${selected ? ', selected' : ''}`}
                testID={`gymerica-stage-${s}`}
                className="flex-1 items-center rounded-xl border p-s2"
                style={{
                  borderColor: selected ? `${tokens.colors.accent}b3` : tokens.colors.border,
                  backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Image
                  source={gymericaStill(s, look)}
                  style={{ width: 56, height: 62, ...({ imageRendering: 'pixelated' } as object) }}
                  contentFit="contain"
                />
                <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 8, color: tokens.colors.text, fontFamily: PIXEL_BOLD }}>
                  {name.toUpperCase()}
                </Text>
                <Text allowFontScaling={false} style={{ fontSize: 7, color: selected ? tokens.colors.accent : tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
                  {selected ? 'SELECTED' : owned ? 'OWNED' : 'LOCKED'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Looks — the standard and the United States of Aesthetics. */}
      <View className="mt-s4">
        <EdgeLabel>LOOK</EdgeLabel>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-s2" contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {character.looks.map((l) => {
            const selected = look === l.id;
            return (
              <Pressable
                key={l.id}
                onPress={() => {
                  playSelect();
                  onChange({ characterSkin: l.id as GymericaSkin });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${l.name}${selected ? ', selected' : ''}`}
                testID={`gymerica-look-${l.id}`}
                className="items-center rounded-xl border p-s2"
                style={{
                  width: 110,
                  borderColor: selected ? `${tokens.colors.accent}b3` : tokens.colors.border,
                  backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                }}
              >
                <Image
                  source={gymericaStill(stage, l.id)}
                  style={{ width: 48, height: 54, ...({ imageRendering: 'pixelated' } as object) }}
                  contentFit="contain"
                />
                <Text numberOfLines={2} allowFontScaling={false} style={{ marginTop: 2, fontSize: 7.5, textAlign: 'center', color: selected ? tokens.colors.accent : tokens.colors.text, fontFamily: PIXEL_BOLD }}>
                  {l.name.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
