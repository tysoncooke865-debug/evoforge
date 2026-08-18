/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers and effects by design; the compiler lint
   cannot see that .value writes are UI-thread animation state, not render
   state. (The same documented exception as neon-button.tsx.) */
/**
 * SAGA — THE MONUMENT. The live Home splits identity across three stacked
 * modules with three overlapping tap zones (forge hint, Evo crest, champion
 * podium). This fuses them into ONE composition with ONE Pressable: the
 * champion LARGE under a living aura, the Evo Rating engraved on a plaque
 * beneath the art (numeral · gloss · tier/form line), and the forge level +
 * XP as a slim plinth line at the base — the HomeHeader's job folded in, so
 * no masthead competes above it. The whole slab opens /avatar.
 *
 * SCALE: home-scale.ts's viewport-tier idiom, one tier bolder. The live rig
 * gives a `tall` phone a 112pt champion and a 71pt numeral; the monument's
 * own table starts near live's `xl` and grows from there, because the whole
 * first viewport belongs to identity here — the mission left the scroll for
 * the docked bar and no longer needs the fold.
 *
 * MOTION: the variant's ONE ambient loop lives in this component — the AURA
 * glows (a slow breath on opacity + scale). The champion is deliberately
 * STILL: the frozen south pose always, never the rotating GIF, because a
 * monument does not fidget and a sprite GIF is itself an ambient loop the
 * budget cannot afford. Press feedback is a one-shot spring.
 */

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { progressPercent } from '@/domain/xp';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

import type { HomeModel } from '../shared/use-home-model';

/**
 * The viewport tiers, one step bolder than ui/home/home-scale.ts: live spends
 * the fold on champion + rating + mission + CTA; SAGA's first viewport holds
 * the monument alone, so each tier's numbers sit roughly where live's NEXT
 * tier does. Width still caps the art (the ScreenShell column is 560 max,
 * padded 16 each side) so the slab never runs under the page padding.
 */
const TIERS = {
  compact: { champion: 128, rating: 66 },
  regular: { champion: 148, rating: 76 },
  tall: { champion: 162, rating: 85 },
  xl: { champion: 192, rating: 100 },
} as const;

function monumentScale(width: number, height: number) {
  const tier =
    height < 700 ? 'compact' : height < 820 ? 'regular' : height < 900 ? 'tall' : 'xl';
  const base = TIERS[tier];
  const usable = Math.min(width, 560) - 32;
  return { champion: Math.min(base.champion, Math.floor(usable * 0.72)), rating: base.rating };
}

/** Sprite rotation frames carry ~24% transparent rows under the feet
 *  (measured in avatar-stage.tsx); the monument crops that dead band so the
 *  champion stands ON the plaque, not a frame-height above it. */
const SPRITE_ART = 1.35;
const SPRITE_BOTTOM_PAD = 0.22;

export function SagaMonument({
  identity,
  level,
  xpIntoLevel,
  xpNeeded,
}: {
  identity: HomeModel['identity'];
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
}) {
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  const scale = monumentScale(width, height);
  const ambient = useAmbient();

  const current = useEvoRatingCurrent();
  const row = (current.data ?? null) as Record<string, unknown> | null;
  const rating = row ? Number(row.displayed_rating ?? 1) : null;

  // ---- THE ONE AMBIENT LOOP: the aura's breath. Everything else is still. ----
  const t = useSharedValue(0);
  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 5600, easing: Easing.linear }), -1);
  }, [ambient, t]);
  // ANIMATED NODES CARRY INLINE STYLES ONLY (the xp-bar lesson).
  const auraStyle = useAnimatedStyle(() => {
    const breath = (1 - Math.cos(t.value * Math.PI * 2)) / 2;
    return {
      opacity: 0.42 + breath * 0.34,
      transform: [{ scale: 0.96 + breath * 0.07 }],
    };
  });

  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  // ---- ORIGIN UNSET: the monument becomes the invitation. One gold CTA on
  // the same slab, routed exactly where avatar-hero routes its own gold
  // button, plus the plain-language line the jargon critique asked for. ----
  if (identity.originUnset) {
    return (
      <View
        testID="saga-monument-origin"
        className="items-center rounded-xl border px-s4 py-s6"
        style={{
          marginHorizontal: -16,
          borderColor: `${colors.legendary}33`,
          backgroundColor: 'rgba(13,21,36,0.55)',
          minHeight: Math.round(scale.champion * 1.4),
          justifyContent: 'center',
        }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 12, letterSpacing: 2, color: colors.legendary, ...pixelFont(false) }}
        >
          YOUR LEGEND NEEDS AN ORIGIN
        </Text>
        <View className="mt-s4 w-full items-center">
          <Pressable
            onPress={() => router.push((identity.originChoiceReady ? '/avatar' : '/evo-scan') as never)}
            accessibilityRole="button"
            accessibilityLabel={
              identity.originChoiceReady
                ? 'Choose your Origin on the Forge'
                : 'Forge your Origin — run an EvoGuide scan'
            }
            testID="saga-forge-origin"
            className="items-center justify-center rounded-xl px-s5"
            style={{
              minHeight: 56,
              minWidth: 220,
              backgroundColor: colors.legendary,
              shadowColor: colors.legendary,
              shadowOpacity: 0.55,
              shadowRadius: 18,
              elevation: 8,
            }}
          >
            <Text
              allowFontScaling={false}
              style={{ fontSize: 13, color: '#1a1305', letterSpacing: 1, ...pixelFont() }}
            >
              {identity.originChoiceReady ? 'CHOOSE YOUR ORIGIN' : 'FORGE YOUR ORIGIN'}
            </Text>
          </Pressable>
        </View>
        {/* Plain language, not lore: what the scan actually is. Accurate to
            evo-scan.tsx — three photos plus bodyweight, judged server-side,
            photos never stored (the persistence doctrine). */}
        <Text className="mt-s3 max-w-[320px] text-center text-xs text-text-dim">
          {identity.originChoiceReady
            ? 'Your scan scores are close — pick the path that fits how you want to train.'
            : 'A two-minute check-in: three photos and your bodyweight set your starting champion and fitness score. The photos are never stored.'}
        </Text>
        <PlinthLine level={level} xpIntoLevel={xpIntoLevel} xpNeeded={xpNeeded} />
      </View>
    );
  }

  // The frozen pose when the rotation set exists; the painted portrait
  // otherwise. NEVER the animated GIF — see the motion note in the docblock.
  const stillArt = identity.stillSource ?? identity.paintedSource;
  const sprite = identity.stillSource != null;
  const artSize = sprite ? Math.round(scale.champion * SPRITE_ART) : scale.champion;
  const artBox = sprite ? Math.round(artSize * (1 - SPRITE_BOTTOM_PAD)) : scale.champion;
  const ratingOn = progressionFeatures.newProgressionEnabled;

  const a11y = [
    `Your champion: ${identity.formName}, ${identity.tierName} tier.`,
    ratingOn
      ? rating !== null
        ? `Evo Rating ${rating} — your overall fitness score.`
        : 'Evo Rating calibrating.'
      : null,
    `Forge level ${level}.`,
    'Opens the Forge.',
  ]
    .filter(Boolean)
    .join(' ');

  const open = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSelect();
    router.push('/avatar' as never);
  };

  return (
    <Animated.View style={[{ marginHorizontal: -16 }, pressStyle]}>
      <Pressable
        onPress={open}
        onPressIn={() => {
          press.value = withSpring(0.988, { damping: 20, stiffness: 300 });
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 16, stiffness: 260 });
        }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        testID="saga-monument"
        className="items-center"
      >
        {/* THE STAGE — sky, aura, the still champion. */}
        <View className="items-center justify-end" style={{ height: artBox + 10, width: '100%' }}>
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                bottom: Math.round(artBox * 0.02),
                width: Math.round(scale.champion * 0.94),
                height: Math.round(scale.champion * 0.94),
                borderRadius: Math.round(scale.champion * 0.47),
                backgroundColor: `${identity.auraColour}2e`,
                shadowColor: identity.auraColour,
                shadowOpacity: 0.55,
                shadowRadius: 42,
                elevation: 12,
              },
              auraStyle,
            ]}
          />
          <Image
            source={stillArt}
            tintColor={identity.hasArt ? undefined : '#070d1a'}
            contentFit="contain"
            accessibilityLabel={identity.hasArt ? 'Current form' : 'Unforged form silhouette'}
            style={{
              width: artSize,
              height: artSize,
              // The crop: push the sprite's transparent under-feet rows below
              // the box so the champion contacts the plaque line.
              transform: sprite ? [{ translateY: Math.round(artSize * SPRITE_BOTTOM_PAD) }] : undefined,
              ...({ imageRendering: 'pixelated' } as object),
            }}
          />
        </View>
        {!identity.hasArt ? (
          <Text
            className="text-text-dim"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 2, ...pixelFont(false) }}
          >
            FORM NOT YET FORGED — ART INCOMING
          </Text>
        ) : null}

        {/* THE PLAQUE — the Evo Rating engraved into the monument's base.
            Fused, not stacked: it tucks up under the champion's ground line. */}
        <View
          className="w-full items-center rounded-xl border px-s4 pb-s3 pt-s2"
          style={{
            marginTop: -6,
            borderColor: `${colors.epic}38`,
            // Darker than the shell so it reads as machined stone the champion
            // stands on, not a card floating behind him.
            backgroundColor: 'rgba(6,10,20,0.78)',
          }}
        >
          {ratingOn ? (
            current.isPending ? (
              // Hold the numeral's height so the deck never jumps when it lands.
              <View style={{ height: Math.round(scale.rating * 1.06) }} testID="saga-rating-loading" />
            ) : rating !== null ? (
              <Text
                allowFontScaling={false}
                testID="saga-rating"
                style={{
                  fontSize: scale.rating,
                  lineHeight: Math.round(scale.rating * 1.06),
                  letterSpacing: 0,
                  color: colors.text,
                  // The one loud glow on the page — the neon policy's identity
                  // moment, purple because purple IS the rating.
                  textShadowColor: 'rgba(168,85,247,0.6)',
                  textShadowRadius: Math.round(scale.rating * 0.32),
                  ...pixelFont(),
                }}
              >
                {rating}
              </Text>
            ) : (
              // No confirmed rating yet: CALIBRATING says the app is working
              // on it, and never a fake 0 (the evo-hero doctrine).
              <Text
                allowFontScaling={false}
                testID="saga-rating-calibrating"
                style={{
                  fontSize: Math.round(scale.rating * 0.36),
                  lineHeight: Math.round(scale.rating * 0.5),
                  letterSpacing: 1,
                  color: colors['text-dim'],
                  ...pixelFont(),
                }}
              >
                CALIBRATING
              </Text>
            )
          ) : null}

          {ratingOn ? (
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 10,
                letterSpacing: 3,
                color: colors['text-dim'],
                ...pixelFont(false),
              }}
            >
              OVERALL FITNESS SCORE
            </Text>
          ) : null}

          {/* The engraving line: who this monument is OF. */}
          <View
            className="mt-s2 flex-row items-center"
            style={{ gap: 8, maxWidth: '94%' }}
          >
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              style={{ fontSize: 13, letterSpacing: 1.2, color: colors.epic, ...pixelFont() }}
            >
              {identity.tierName}
            </Text>
            <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: colors['text-mute'] }} />
            <Text
              allowFontScaling={false}
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ flexShrink: 1, fontSize: 13, letterSpacing: 1.2, color: colors.accent, ...pixelFont() }}
            >
              {identity.formName.toUpperCase()}
            </Text>
          </View>

          <PlinthLine level={level} xpIntoLevel={xpIntoLevel} xpNeeded={xpNeeded} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The plinth — HomeHeader's whole job in one slim line at the monument's
 * base: forge level, a thin XP track, exact XP to next. Read-only here (the
 * monument above it is the door); numbers are the confirmed forge
 * progression, never a recomputation.
 */
function PlinthLine({
  level,
  xpIntoLevel,
  xpNeeded,
}: {
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
}) {
  const colors = useThemeColors();
  const pct = progressPercent(xpIntoLevel, xpNeeded);
  const toNext = Math.max(0, xpNeeded - xpIntoLevel);
  return (
    <View
      className="mt-s3 w-full flex-row items-center"
      style={{ gap: 10 }}
      accessible
      accessibilityLabel={`Forge level ${level}. ${toNext} XP to level ${Math.min(level + 1, 100)}.`}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 11, letterSpacing: 1, color: colors['text-dim'], ...pixelFont(false) }}
      >
        {`FORGE LV ${level}`}
      </Text>
      <View
        style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors['surface-2'], overflow: 'hidden' }}
      >
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 2,
            backgroundColor: colors.accent,
          }}
        />
      </View>
      <Text
        allowFontScaling={false}
        style={{ fontSize: 11, letterSpacing: 1, color: colors['text-dim'], ...pixelFont(false) }}
      >
        {`${toNext} XP TO LV ${Math.min(level + 1, 100)}`}
      </Text>
    </View>
  );
}
