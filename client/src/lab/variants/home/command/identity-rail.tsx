import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { useEvoRatingCurrent } from '@/data/progression/use-evo-rating';
import { progressPercent } from '@/domain/xp';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarImage } from '@/ui/character/avatar-images';

import type { HomeModel } from '../shared/use-home-model';

/**
 * COMMAND §2 — THE IDENTITY RAIL.
 *
 * The live Home spends ~340pt on identity: the crest, its entrance, the
 * champion on a lit podium. COMMAND compresses the same identity to ONE
 * horizontal band for the athlete who already knows who they are: the Evo
 * Rating number (32px, still the purple thing on the page), its "OVERALL
 * FITNESS SCORE" gloss, tier + form name, the forge level with a condensed
 * XP bar, and a small still portrait of the champion. The whole rail is one
 * Pressable to /avatar — the same door the champion's podium opens live.
 *
 * STATIONARY BY DOCTRINE: no entrance choreography, no ambient loops, no
 * Reanimated at all. The rating simply IS there, every open, instantly —
 * which is itself the veteran's reward.
 *
 * PORTRAIT SOURCE ORDER mirrors avatar-stage for a HUD that never moves:
 * stillSource first (the deliberate stationary frame), then paintedSource,
 * then the branch/stage sprite sheet; !hasArt renders the silhouette
 * treatment (tintColor prop — the style variant is unreliable on web).
 *
 * ORIGIN UNSET: the rail becomes the FORGE YOUR ORIGIN state instead,
 * routed exactly as avatar-hero routes it (choice open → /avatar reveal,
 * otherwise → /evo-scan), with one plain line saying what the scan is.
 */
export function CommandIdentityRail({
  identity,
  forgeProgress,
}: {
  identity: HomeModel['identity'];
  forgeProgress: HomeModel['forgeProgress'];
}) {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();

  if (identity.originUnset) {
    return (
      <View
        className="w-full rounded-xl border p-s4"
        style={{ borderColor: `${colors.legendary}59`, backgroundColor: 'rgba(13,21,36,0.72)' }}
        testID="command-origin-empty"
      >
        <Pressable
          onPress={() => router.push((identity.originChoiceReady ? '/avatar' : '/evo-scan') as never)}
          accessibilityRole="button"
          accessibilityLabel={
            identity.originChoiceReady
              ? 'Choose your Origin on the Forge'
              : 'Forge your Origin — run an EvoGuide scan'
          }
          testID="command-forge-origin"
          className="items-center justify-center rounded-xl px-s5"
          style={{
            minHeight: 52,
            backgroundColor: colors.legendary,
            shadowColor: colors.legendary,
            shadowOpacity: 0.55,
            shadowRadius: 18,
            elevation: 8,
          }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 13, color: '#1a1305', letterSpacing: 1, ...pixelFont() }}>
            {identity.originChoiceReady ? 'CHOOSE YOUR ORIGIN' : 'FORGE YOUR ORIGIN'}
          </Text>
        </Pressable>
        {/* Plain language, ≥10px, text-dim (never text-mute under 12px). */}
        <Text className="mt-s2 text-center text-text-dim" style={{ fontSize: 11, letterSpacing: 0.5 }}>
          {identity.originChoiceReady
            ? 'Your scores are close — the decision is yours.'
            : 'The EvoGuide scan reads your physique and picks your starting path.'}
        </Text>
      </View>
    );
  }

  const row = (current.data ?? null) as Record<string, unknown> | null;
  const rating = row === null ? null : Number(row.displayed_rating ?? 1);
  const showRating = progressionFeatures.newProgressionEnabled;
  const pct = progressPercent(forgeProgress.xpIntoLevel, forgeProgress.xpForNextLevel);
  const toNext = Math.max(0, forgeProgress.xpForNextLevel - forgeProgress.xpIntoLevel);
  const nextLevel = Math.min(forgeProgress.level + 1, 100);

  const a11y =
    `Your champion: ${identity.formName}, ${identity.tierName.toLowerCase()} tier.` +
    (showRating && rating !== null ? ` Evo rating ${rating}, your overall fitness score.` : '') +
    ` Forge level ${forgeProgress.level}, ${forgeProgress.xpIntoLevel} of ${forgeProgress.xpForNextLevel} XP.` +
    ' Opens the Forge.';

  return (
    <Pressable
      onPress={() => router.push('/avatar' as never)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      testID="command-identity-rail"
      className="w-full flex-row items-center rounded-xl border px-s3 py-s3"
      style={{ gap: 12, minHeight: 96, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      {/* THE RATING — still the purple thing on the page, just no longer a
          340pt crest. The glow stays: the neon policy allows it on exactly
          this number. */}
      {showRating ? (
        <View className="items-center" style={{ minWidth: 76 }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, color: colors.epic, ...pixelFont(false) }}
          >
            EVO RATING
          </Text>
          <Text
            allowFontScaling={false}
            testID="command-evo-rating"
            style={{
              fontSize: 32,
              lineHeight: 34,
              letterSpacing: 0,
              color: colors.text,
              textShadowColor: 'rgba(168,85,247,0.6)',
              textShadowRadius: 10,
              ...pixelFont(),
            }}
          >
            {current.isPending ? ' ' : rating !== null ? rating : '--'}
          </Text>
          {/* The gloss that stops the page assuming — ≥10px, text-dim. */}
          <Text
            allowFontScaling={false}
            numberOfLines={1}
            style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}
          >
            {rating !== null || current.isPending ? 'OVERALL FITNESS SCORE' : 'CALIBRATING'}
          </Text>
        </View>
      ) : null}

      <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: colors.border }} />

      {/* TIER · FORM · FORGE LEVEL — the condensed middle column. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, color: identity.auraColour, ...pixelFont(false) }}
        >
          {identity.tierName} TIER
        </Text>
        <Text
          className="text-text"
          numberOfLines={1}
          allowFontScaling={false}
          style={{ marginTop: 2, fontSize: 15, letterSpacing: 0, ...pixelFont() }}
        >
          {identity.formName.toUpperCase()}
        </Text>
        <View className="mt-s1 flex-row items-baseline" style={{ gap: 4 }}>
          <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 0, color: colors['text-dim'], ...pixelFont(false) }}>
            LV.
          </Text>
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 15, letterSpacing: 0, ...pixelFont() }}>
            {forgeProgress.level}
          </Text>
          <Text
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 0, color: colors['text-dim'], ...pixelFont(false) }}
          >
            {forgeProgress.level >= 100 ? '· MAX LEVEL' : `· ${toNext} XP TO LV.${nextLevel}`}
          </Text>
        </View>
        {/* The condensed XP bar — same progressPercent that grants the level. */}
        <View
          className="mt-s1 overflow-hidden rounded-pill"
          style={{ height: 4, backgroundColor: colors['surface-3'] }}
        >
          <View
            style={{
              width: `${pct}%`,
              minWidth: pct > 0 ? 4 : 0,
              height: '100%',
              borderRadius: 999,
              backgroundColor: colors.accent,
            }}
          />
        </View>
      </View>

      {/* THE PORTRAIT — small, still, framed in the champion's aura. */}
      <View
        style={{
          width: 80,
          height: 84,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: `${identity.auraColour}59`,
          backgroundColor: 'rgba(4,7,14,0.8)',
          shadowColor: identity.auraColour,
          shadowOpacity: 0.35,
          shadowRadius: 10,
          overflow: 'hidden',
        }}
      >
        <Image
          source={
            identity.stillSource ?? identity.paintedSource ?? avatarImage(identity.donor, identity.stage)
          }
          // The silhouette treatment when the form's art is not forged yet:
          // tintColor PROP, not style (unreliable on web — the Silhouette
          // component's founding bug).
          tintColor={identity.hasArt ? undefined : '#070d1a'}
          style={{ width: 68, height: 72 }}
          contentFit="contain"
          accessibilityLabel={identity.hasArt ? 'Current form' : 'Unforged form silhouette'}
        />
        {!identity.hasArt ? (
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
        ) : null}
      </View>
    </Pressable>
  );
}
