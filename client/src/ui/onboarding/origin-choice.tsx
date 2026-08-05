/**
 * ONBOARDING V3 — "Choose your Origin" (docs/ONBOARDING_V3_SPEC.md §4).
 *
 * All FIVE, as a straight choice. No recommendation, no shortlist, no
 * "recommended for you" ribbon — at this point in v3 the app knows a goal
 * string and an experience band, and a confident-looking suggestion built
 * from that would be a fabricated number wearing a badge.
 *
 * Above all it is not derived from a PHOTOGRAPH. An athlete short on
 * confidence reads a photo-assigned character as the app deciding they are
 * not lean or muscular enough to be the one they liked.
 *
 * Copy comes from ORIGIN_PATH_CONFIGS (name / promise / description) — the
 * same table the Evolution Path renders. Components never invent strings.
 */

import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import { ORIGIN_PATH_CONFIGS } from '@/domain/origin-path/config';
import { ORIGIN_IDS, type OriginId } from '@/domain/origin/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';

/** Stage-1 art for a path, in the athlete's chosen presentation. */
function artFor(originId: OriginId, sex: 'male' | 'female') {
  const branch = originId as BranchV2;
  return stillAvatar(branch, 1, sex) ?? avatarArtV2(branch, 1, sex).source ?? null;
}

export function OriginChoice({
  sex,
  selected,
  onSelect,
}: {
  sex: 'male' | 'female';
  selected: OriginId | null;
  onSelect: (id: OriginId) => void;
}) {
  const colors = useThemeColors();
  return (
    <View>
      {ORIGIN_IDS.map((id) => {
        const config = ORIGIN_PATH_CONFIGS[id];
        const on = selected === id;
        const art = artFor(id, sex);
        return (
          <Pressable
            key={id}
            onPress={() => onSelect(id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${config.name} — ${config.promise}`}
            testID={`origin-pick-${id}`}
            className="mb-s3 w-full flex-row items-center gap-s3 rounded-xl border p-s3"
            style={{
              minHeight: 88,
              borderColor: on ? `${colors.legendary}a0` : colors.border,
              backgroundColor: on ? 'rgba(250,204,21,0.07)' : 'rgba(13,21,36,0.6)',
            }}
          >
            <View
              className="items-center justify-center overflow-hidden rounded-lg"
              style={{ width: 62, height: 72, backgroundColor: 'rgba(2,5,11,0.5)' }}
            >
              {art ? (
                <Image source={art} style={{ width: 58, height: 68 }} contentFit="contain" />
              ) : (
                <Text className="text-2xl text-text-mute">?</Text>
              )}
            </View>
            <View className="flex-1">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 15, color: on ? colors.legendary : colors.text, ...pixelFont() }}
              >
                {on ? '✓ ' : ''}
                {config.name.toUpperCase()}
              </Text>
              <Text className="mt-s1 text-xs text-text-dim">{config.promise}</Text>
              <Text className="mt-s1 text-2xs text-text-mute">{config.description}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The champion's presentation. This is an ART choice and it is asked here
 * rather than in a "who are you" step, because it is the only thing in the
 * whole of v3 that needs it — the stage art is drawn per line — and because
 * asking it beside the character makes it obviously about the character.
 */
export function ChampionPresentation({
  sex,
  onChange,
}: {
  sex: 'male' | 'female';
  onChange: (s: 'male' | 'female') => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="mb-s4">
      <Text
        className="mb-s2 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        YOUR CHAMPION
      </Text>
      <View className="flex-row gap-s2">
        {(['male', 'female'] as const).map((s) => {
          const on = sex === s;
          return (
            <Pressable
              key={s}
              onPress={() => onChange(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`champion-${s}`}
              className="flex-1 items-center justify-center rounded-lg border px-s3"
              style={{
                minHeight: 48,
                borderColor: on ? `${colors.accent}a0` : colors.border,
                backgroundColor: on ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
              }}
            >
              <Text
                allowFontScaling={false}
                style={{ fontSize: 12, color: on ? colors.accent : colors['text-dim'], ...pixelFont() }}
              >
                {s === 'male' ? '♂ MASCULINE' : '♀ FEMININE'}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
