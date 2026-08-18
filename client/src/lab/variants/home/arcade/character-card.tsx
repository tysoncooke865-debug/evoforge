/**
 * ARCADE §2 — THE CHARACTER-SELECT STAGE.
 *
 * The champion inside a framed character card: art large over an aura disc,
 * the aura colour as the card's edge light, tier + form on the nameplate,
 * and the Evo Rating as the cabinet's score readout ("EVO 42" over its plain
 * gloss). The WHOLE card is one Pressable to /avatar — no selector chevrons,
 * nothing that looks tappable and isn't (the house "never a dead button").
 *
 * Art selection is avatar-hero/avatar-stage's exact rule: sprite GIF when
 * ambient allows motion, the frozen still otherwise, painted art only when
 * no sprite set exists, and a rim-dark silhouette when the form has no art
 * yet. The scanline pass is STATIC Views — CRT flavour, zero loops; the one
 * useAmbient() call here only picks GIF vs still, it drives no animation.
 *
 * ORIGIN UNSET → the card IS the origin invitation: the same gold CTA and
 * destinations the live hero uses, plus one plain-language line about what
 * the scan actually is. No rating, no nameplate — there is no champion yet
 * and the card never pretends otherwise.
 */
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useAmbient } from '@/ui/core/use-ambient';

import type { HomeModel } from '../shared/use-home-model';

/** The art stage's fixed height — scanlines and the aura disc key off it. */
const STAGE_H = 236;
/** Static CRT hint: one hairline every 12px, quiet enough to read as glass. */
const SCANLINE_GAP = 12;

export function CharacterCard({ identity }: { identity: HomeModel['identity'] }) {
  const colors = useThemeColors();
  const ambient = useAmbient();

  // The score readout reads the SAME row EvoHero reads. Null (flag off, no
  // review yet, still loading) renders NO readout — never a fake hi-score.
  const current = useEvoRatingCurrent();
  const row = (current.data ?? null) as Record<string, unknown> | null;
  const rating =
    progressionFeatures.newProgressionEnabled && row !== null
      ? Math.round(Number(row.displayed_rating ?? 1))
      : null;

  // avatar-stage's exact selection: sprite (gif when ambient, still frame
  // otherwise), painted art only when no sprite set, silhouette overrides.
  const silhouette = !identity.hasArt;
  const spriteSource = silhouette
    ? undefined
    : ambient
      ? identity.animatedSource
      : (identity.stillSource ?? identity.animatedSource);
  const artSource = spriteSource ?? identity.paintedSource;

  const edge = identity.originUnset ? colors.legendary : identity.auraColour;
  const open = () =>
    router.push(
      (identity.originUnset
        ? identity.originChoiceReady
          ? '/avatar'
          : '/evo-scan'
        : '/avatar') as never
    );
  const label = identity.originUnset
    ? identity.originChoiceReady
      ? 'Choose your Origin on the Forge. Your scores are close — the decision is yours.'
      : 'Forge your Origin. Run an EvoGuide scan to create your starting champion.'
    : `Your champion: ${identity.formName}, ${identity.tierName} tier${
        rating !== null ? `, Evo rating ${rating}` : ''
      }. Opens the Forge.`;

  const scanlines = Array.from({ length: Math.floor(STAGE_H / SCANLINE_GAP) }, (_, i) => i);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="arcade-character-card"
      className="w-full overflow-hidden rounded-xl"
      style={{
        borderWidth: 2,
        borderColor: `${edge}8c`,
        shadowColor: edge,
        shadowOpacity: 0.32,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }}
    >
      <LinearGradient
        colors={[colors['surface-2'], colors.surface, colors['bg-deep']]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
      >
        {/* The cabinet's top rail: mode label left, score readout right. */}
        <View className="flex-row items-start justify-between px-s3 pt-s2" style={{ gap: 12 }}>
          <Text
            className="text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
          >
            {identity.originUnset ? 'NEW CHALLENGER' : 'CHARACTER'}
          </Text>
          {rating !== null && !identity.originUnset ? (
            <View className="items-end" testID="arcade-evo-readout">
              {/* Purple is the rating's colour everywhere on the page. */}
              <Text
                allowFontScaling={false}
                style={{ fontSize: 22, lineHeight: 24, color: colors.epic, letterSpacing: 1, ...pixelFont() }}
              >
                EVO {rating}
              </Text>
              <Text
                className="text-text-dim"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
              >
                OVERALL FITNESS SCORE
              </Text>
            </View>
          ) : null}
        </View>

        {/* The stage: aura disc behind, art in front, glass on top. */}
        <View className="items-center justify-center" style={{ height: STAGE_H }}>
          {/* The aura disc — the card's inner light in the champion's own
              colour (gold while the podium waits for an Origin). */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: 188,
              height: 188,
              borderRadius: 94,
              backgroundColor: `${edge}24`,
              shadowColor: edge,
              shadowOpacity: 0.5,
              shadowRadius: 36,
              elevation: 10,
            }}
          />
          {identity.originUnset ? (
            // THE ORIGIN INVITATION — the gold CTA stands where the champion
            // will. Visual plaque only: the card around it is the pressable.
            <View className="items-center px-s4">
              <View
                className="items-center justify-center rounded-xl px-s5"
                style={{
                  minHeight: 56,
                  backgroundColor: colors.legendary,
                  shadowColor: colors.legendary,
                  shadowOpacity: 0.55,
                  shadowRadius: 18,
                  elevation: 8,
                }}
                testID="arcade-forge-origin"
              >
                <Text
                  allowFontScaling={false}
                  style={{ fontSize: 13, color: '#1a1305', letterSpacing: 1, ...pixelFont() }}
                >
                  {identity.originChoiceReady ? 'CHOOSE YOUR ORIGIN' : 'FORGE YOUR ORIGIN'}
                </Text>
              </View>
              <Text className="mt-s2 text-center text-xs text-text-dim" style={{ maxWidth: 300 }}>
                {identity.originChoiceReady
                  ? 'Your scores are close — the decision is yours.'
                  : 'An EvoGuide scan is a short guided check of your build — it creates the champion you train as.'}
              </Text>
            </View>
          ) : (
            <Image
              source={artSource}
              tintColor={silhouette ? '#070d1a' : undefined}
              style={{
                width: 216,
                height: 216,
                // Sprite frames are pixel art: keep the pixels square on web.
                ...(spriteSource ? ({ imageRendering: 'pixelated' } as object) : null),
              }}
              contentFit="contain"
              accessibilityLabel={silhouette ? 'Unforged form silhouette' : 'Current form'}
            />
          )}

          {/* CRT glass — static hairlines, never an animation. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            {scanlines.map((i) => (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  top: i * SCANLINE_GAP,
                  left: 0,
                  right: 0,
                  height: 1,
                  backgroundColor: 'rgba(0,0,0,0.18)',
                }}
              />
            ))}
          </View>

          {/* Corner brackets — the select-frame, drawn with borders. */}
          {(
            [
              { top: 6, left: 6, borderTopWidth: 2, borderLeftWidth: 2 },
              { top: 6, right: 6, borderTopWidth: 2, borderRightWidth: 2 },
              { bottom: 6, left: 6, borderBottomWidth: 2, borderLeftWidth: 2 },
              { bottom: 6, right: 6, borderBottomWidth: 2, borderRightWidth: 2 },
            ] as const
          ).map((corner, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{ position: 'absolute', width: 16, height: 16, borderColor: `${edge}73`, ...corner }}
            />
          ))}
        </View>

        {silhouette && !identity.originUnset ? (
          <Text
            className="text-center text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
          >
            FORM NOT YET FORGED — ART INCOMING
          </Text>
        ) : null}

        {/* The nameplate — tier + form, the fighter's title bar. */}
        {identity.originUnset ? null : (
          <View
            className="items-center px-s3 py-s2"
            style={{ borderTopWidth: 1, borderTopColor: `${edge}40`, backgroundColor: 'rgba(13,21,36,0.7)' }}
          >
            <Text
              className="text-text"
              numberOfLines={1}
              allowFontScaling={false}
              style={{ fontSize: 17, letterSpacing: 0.5, ...pixelFont() }}
            >
              {identity.formName.toUpperCase()}
            </Text>
            <Text
              numberOfLines={1}
              allowFontScaling={false}
              style={{ marginTop: 2, fontSize: 10, letterSpacing: 2, color: edge, ...pixelFont(false) }}
            >
              {identity.tierName} TIER · TAP TO ENTER THE FORGE
            </Text>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}
