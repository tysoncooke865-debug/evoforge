import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import type { SkinId, StageOption } from '@/domain/customise';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import type { Sex } from '@/ui/character/avatar-art';
import { EdgeLabel } from '@/ui/core/hud';
import { playSelect } from '@/ui/core/sound';

import { formArt } from './art';

const CARD_WIDTH = 108;

/**
 * CUSTOMISE §stages — the horizontal evolution selector. Every row of the
 * REAL ladder (level-gated, or body-fat-gated for the Shredder) is a
 * snapping card; locked stages stay previewable — selecting one updates
 * the main preview and turns the primary button into its requirement.
 */
export function StageCarousel({
  branch,
  options,
  selectedKey,
  sex,
  skin,
  onSelect,
}: {
  branch: BranchV2;
  options: StageOption[];
  /** null = the current form (no explicit stage pick). */
  selectedKey: string | null;
  sex: Sex;
  skin: SkinId;
  onSelect: (key: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View>
      <EdgeLabel>EVOLUTION STAGES</EdgeLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_WIDTH + 8}
        decelerationRate="fast"
        className="mt-s2"
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {options.map((option, i) => {
          const selected = selectedKey === option.key || (selectedKey === null && option.current);
          const art = formArt(branch, option.stage, sex, skin);
          const status = selected ? 'SELECTED' : option.current ? 'CURRENT' : option.unlocked ? 'OWNED' : option.requirement;
          const statusColour = selected
            ? tokens.colors.accent
            : option.unlocked
              ? tokens.colors.success
              : tokens.colors['text-mute'];
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                playSelect();
                // Re-selecting the current form clears the explicit pick so
                // the loadout keeps following future evolutions.
                onSelect(option.current ? null : option.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={`stage ${i + 1}, ${option.name}, ${option.unlocked ? 'owned' : `locked, ${option.requirement.toLowerCase()}`}${selected ? ', selected' : ''}`}
              testID={`stage-card-${option.key}`}
              className="rounded-xl border p-s2"
              style={{
                width: CARD_WIDTH,
                borderColor: selected ? `${tokens.colors.accent}b3` : option.unlocked ? tokens.colors.border : 'rgba(120,170,220,0.10)',
                backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
                shadowColor: tokens.colors.accent,
                shadowOpacity: selected ? 0.4 : 0,
                shadowRadius: 12,
                elevation: selected ? 4 : 0,
              }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 8, textAlign: 'center', color: tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
                STAGE {i + 1}
              </Text>
              <View className="items-center" style={{ height: 72, justifyContent: 'center' }}>
                <Image
                  source={art.still ?? art.painted}
                  style={{
                    width: 62,
                    height: 68,
                    opacity: option.unlocked ? 1 : 0.35,
                    ...(art.still ? ({ imageRendering: 'pixelated' } as object) : {}),
                  }}
                  contentFit="contain"
                />
                {!option.unlocked ? (
                  <Text style={{ position: 'absolute', bottom: 0, right: 6, fontSize: 10 }}>🔒</Text>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{ fontSize: 8, textAlign: 'center', color: tokens.colors.text, fontFamily: PIXEL_BOLD }}
              >
                {option.name.toUpperCase()}
              </Text>
              <Text
                numberOfLines={1}
                allowFontScaling={false}
                style={{ marginTop: 2, fontSize: 7, textAlign: 'center', color: statusColour, fontFamily: PIXEL, letterSpacing: 0.5 }}
              >
                {status}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
