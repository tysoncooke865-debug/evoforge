import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import { companionLine } from '@/domain/branches-v2';
import {
  AURAS,
  EFFECTS,
  EMOTES,
  SKINS,
  cosmeticUnlocked,
  unlockLabel,
  type CosmeticUnlock,
  type Selection,
  type UnlockContext,
} from '@/domain/customise';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import type { Sex } from '@/ui/character/avatar-art';
import { SpriteAvatar } from '@/ui/character/sprite-avatar';
import { Chip } from '@/ui/core/neon-button';
import { playSelect } from '@/ui/core/sound';

import { formArt } from './art';

type Tab = 'outfit' | 'aura' | 'effects' | 'emotes';

/**
 * CUSTOMISE §cosmetics — OUTFIT (the palette-swap skins), AURA (real
 * colour fields over the podium), EFFECTS (the platform; future entries
 * honestly marked incoming) and EMOTES (the real companion animations —
 * the equipped one drives the header sprite everywhere).
 *
 * Locked items PREVIEW on tap (the panel updates) but cannot equip —
 * equipState turns the primary button into the unlock requirement.
 */
export function CosmeticTabs({
  selection,
  branch,
  stage,
  sex,
  unlockCtx,
  onChange,
}: {
  selection: Selection;
  branch: BranchV2;
  stage: number;
  sex: Sex;
  unlockCtx: UnlockContext;
  onChange: (next: Partial<Selection>) => void;
}) {
  const [tab, setTab] = useState<Tab>('outfit');

  return (
    <View>
      <View className="flex-row" style={{ gap: 6 }}>
        {(['outfit', 'aura', 'effects', 'emotes'] as const).map((t) => (
          <Chip key={t} label={t.toUpperCase()} active={tab === t} onPress={() => setTab(t)} testID={`cosmetic-tab-${t}`} />
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-s3"
        contentContainerStyle={{ gap: 8, paddingRight: 8 }}
      >
        {tab === 'outfit'
          ? SKINS.map((skin) => {
              const art = formArt(branch, stage, sex, skin.id);
              const applies = skin.id === 'standard' || art.still !== undefined || art.painted !== formArt(branch, stage, sex, 'standard').painted;
              return (
                <CosmeticCard
                  key={skin.id}
                  name={skin.name}
                  selected={selection.skinId === skin.id}
                  unlock={{ kind: 'free' }}
                  unlockCtx={unlockCtx}
                  testID={`skin-${skin.id}`}
                  onPress={() => onChange({ skinId: skin.id })}
                  thumb={
                    applies ? (
                      <Image
                        source={art.still ?? art.painted}
                        style={{ width: 44, height: 50, ...(art.still ? ({ imageRendering: 'pixelated' } as object) : {}) }}
                        contentFit="contain"
                      />
                    ) : (
                      <Swatch colour={skin.swatch ?? tokens.colors.border} />
                    )
                  }
                />
              );
            })
          : null}

        {tab === 'aura'
          ? AURAS.map((aura) => (
              <CosmeticCard
                key={aura.id}
                name={aura.name}
                selected={selection.auraId === aura.id}
                unlock={aura.unlock}
                unlockCtx={unlockCtx}
                testID={`aura-${aura.id}`}
                onPress={() => onChange({ auraId: aura.id })}
                thumb={<Swatch colour={aura.colour ?? tokens.colors.accent} rainbow={aura.colour === null} />}
              />
            ))
          : null}

        {tab === 'effects'
          ? EFFECTS.map((effect) => (
              <CosmeticCard
                key={effect.id}
                name={effect.name}
                selected={selection.effectId === effect.id}
                unlock={effect.unlock}
                unlockCtx={unlockCtx}
                testID={`effect-${effect.id}`}
                // Incoming effects have no art to preview — selection stays.
                onPress={effect.unlock.kind === 'incoming' ? undefined : () => onChange({ effectId: effect.id })}
                thumb={
                  effect.id === 'podium' ? (
                    <Image source={require('../../assets/podium.png')} style={{ width: 52, height: 28 }} contentFit="contain" />
                  ) : (
                    <Text style={{ fontSize: 20, opacity: 0.35 }}>✨</Text>
                  )
                }
              />
            ))
          : null}

        {tab === 'emotes'
          ? EMOTES.map((emote) => (
              <CosmeticCard
                key={emote.id}
                name={emote.name}
                selected={selection.emoteId === emote.id}
                unlock={emote.unlock}
                unlockCtx={unlockCtx}
                testID={`emote-${emote.id}`}
                onPress={() => onChange({ emoteId: emote.id })}
                thumb={
                  <SpriteAvatar
                    anim={emote.id}
                    stage={Math.max(1, Math.min(4, stage)) as 1 | 2 | 3 | 4}
                    sex={sex}
                    line={companionLine(branch)}
                    height={44}
                  />
                }
              />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function CosmeticCard({
  name,
  thumb,
  selected,
  unlock,
  unlockCtx,
  onPress,
  testID,
}: {
  name: string;
  thumb: ReactNode;
  selected: boolean;
  unlock: CosmeticUnlock;
  unlockCtx: UnlockContext;
  onPress?: () => void;
  testID: string;
}) {
  const unlocked = cosmeticUnlocked(unlock, unlockCtx);
  const label = unlockLabel(unlock);
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              playSelect();
              onPress();
            }
          : undefined
      }
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}${unlocked ? '' : `, locked, ${label.toLowerCase()}`}${selected ? ', selected' : ''}`}
      testID={testID}
      className="items-center rounded-xl border p-s2"
      style={{
        width: 92,
        minHeight: 100,
        justifyContent: 'space-between',
        borderColor: selected ? `${tokens.colors.accent}b3` : unlocked ? tokens.colors.border : 'rgba(120,170,220,0.10)',
        backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
        shadowColor: tokens.colors.accent,
        shadowOpacity: selected ? 0.4 : 0,
        shadowRadius: 10,
        elevation: selected ? 4 : 0,
        opacity: onPress ? 1 : 0.6,
      }}
    >
      <View className="items-center justify-center" style={{ height: 52, opacity: unlocked ? 1 : 0.45 }}>
        {thumb}
        {!unlocked ? <Text style={{ position: 'absolute', bottom: -2, right: -6, fontSize: 10 }}>🔒</Text> : null}
      </View>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 7.5, color: selected ? tokens.colors.accent : tokens.colors.text, fontFamily: PIXEL_BOLD }}
      >
        {name.toUpperCase()}
      </Text>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 6.5, color: selected && unlocked ? tokens.colors.success : tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}
      >
        {unlocked ? (selected ? '✓ SELECTED' : 'OWNED') : label}
      </Text>
    </Pressable>
  );
}

function Swatch({ colour, rainbow = false }: { colour: string; rainbow?: boolean }) {
  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: `${colour}b3`,
        backgroundColor: `${colour}33`,
        shadowColor: colour,
        shadowOpacity: 0.6,
        shadowRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {rainbow ? <Text style={{ fontSize: 12 }}>◆</Text> : null}
    </View>
  );
}
