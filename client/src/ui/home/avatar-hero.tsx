/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see
   that .value writes are UI-thread animation state, not render state.
   (The same documented exception as neon-button.tsx.) */
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useCoinTotal } from '@/data/coins';
import type { Branch } from '@/domain/avatar-stats';
import { formatCompact } from '@/domain/format';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { HeroStage } from '@/ui/character/hero-stage';
import { CoinIcon } from '@/ui/core/coin-icon';
import { PixelShirt } from '@/ui/core/pixel-icons';

import type { HomeFeatures } from './home-features';
import { HOME_ART_SCALE, useHomeScale } from './home-scale';

/**
 * HOME §2 (redesigned 2026-08-03) — THE CHAMPION, and nothing else.
 *
 * The page now has ONE focal point, so this section lost the five modules
 * that used to flank it. What went where, and why nothing was deleted:
 *
 *  - THE FORGE HINT moved ABOVE the rating (ui/home/forge-hint.tsx) — the
 *    brief puts the page's central interaction directly under the masthead,
 *    and it is now visible even for an athlete whose form has no art yet.
 *  - THE STREAK BADGE moved to the WEEK STRIP, where the seven pips it was
 *    counting already live. Two flames on one page was the duplicate.
 *  - NEXT EVOLUTION % left the fold: the EvolutionTeaser below it shows the
 *    same readiness with the silhouette of the form it buys.
 *
 * CURRENT FORM, CUSTOMISE and the coin balance stay, as floating chips in
 * the stage's dead corners — they cost ZERO vertical budget there, which is
 * the whole reason the champion, the rating and the mission can share one
 * screen. The champion itself scales with the viewport (home-scale.ts) and
 * keeps every living detail it already had: the breathing float, the aura
 * pulse, the podium's neon, the contact shadow, the drifting motes and the
 * XP-reactive spotlight bloom — all already gated by useAmbient.
 */
export function AvatarHero({
  branch,
  stage,
  auraColour,
  source,
  animatedSource,
  stillSource,
  silhouette,
  tierName,
  formName,
  features,
  originUnset = false,
  originChoiceReady = false,
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  source?: import('react-native').ImageSourcePropType;
  animatedSource?: import('react-native').ImageSourcePropType;
  stillSource?: import('react-native').ImageSourcePropType;
  silhouette: boolean;
  /** Kept for the hero's accessibility label; the visual TIER badge was
   *  removed from Home 2026-07-19 (Tyson). */
  tierName: string;
  formName: string;
  features: HomeFeatures;
  /** ORIGIN (Tyson 2026-07-18): no Origin selected → BLANK podium, no avatar,
   *  no rating — just the gold FORGE YOUR ORIGIN button on the stage. */
  originUnset?: boolean;
  /** The raw ±5 rule (046): a CHOICE is already open from the last scan —
   *  the gold button goes to the Forge reveal instead of another scan. */
  originChoiceReady?: boolean;
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const scale = useHomeScale();
  // The chips overlay the stage's dead corners wherever they FIT beside the
  // champion. 320 is the new floor (it was 380, written for the 192pt rig),
  // and it matters more than it looks: below the threshold the chips wrap
  // into a stacked row UNDER the stage that costs ~200pt of the first
  // screen — on a 375pt phone that was the single biggest thing pushing
  // START MISSION off it. Checked at 320 against the sprite's own transparent
  // side margin (~25% of the frame), which is wider than the overlap.
  const overlay = width >= 320;
  const sideWidth = Math.max(80, Math.min(104, Math.round(width * 0.26)));

  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const openCharacter = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/avatar' as never);
  };

  if (originUnset) {
    // Tyson 2026-07-18: keep the REAL podium/stage — just no champion on it.
    // A 1px transparent source lets HeroStage render its podium + gold aura
    // with an invisible character; the gold FORGE YOUR ORIGIN button stands
    // where the champion usually does.
    //
    // THIS PIXEL WAS NEVER TRANSPARENT (found 2026-08-02, fixed here). The
    // old data URI decoded to RGBA(0, 0, 255, 127) — a HALF-OPAQUE BLUE
    // pixel — and AvatarStage stretches the champion source to
    // size × 1.35, so every athlete without an Origin met a 325×323 blue
    // slab hanging over the podium behind the gold button. It reads as a
    // broken image, and it is the first screen a new signup sees. Decoded
    // and re-checked: the bytes below are filter 0 + RGBA(0,0,0,0).
    const BLANK = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAABzenr0AAAAC0lEQVR4nGNgAAIAAAUAAY27m/MAAAAASUVORK5CYII=' };
    return (
      <View testID="hero-origin-empty">
        <HeroStage branch={branch} stage={1} auraColour={colors.legendary} size={scale.champion} headroom={scale.headroom} source={BLANK} stillSource={BLANK} animatedSource={BLANK} silhouette={false} />
        {/* The button group centres in the sky ABOVE the deck, not in the
            whole rig: with the 2026-08-03 rig being shorter, centring on the
            full height ran the caption straight across the podium art. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: Math.round(scale.champion * 0.55), alignItems: 'center', justifyContent: 'center' }}>
          <Pressable
            onPress={() => router.push((originChoiceReady ? '/avatar' : '/evo-scan') as never)}
            accessibilityRole="button"
            accessibilityLabel={
              originChoiceReady
                ? 'Choose your Origin on the Forge'
                : 'Forge your Origin — run an EvoGuide scan'
            }
            testID="forge-origin"
            className="items-center justify-center rounded-xl px-s5"
            style={{ minHeight: 56, backgroundColor: colors.legendary, shadowColor: colors.legendary, shadowOpacity: 0.55, shadowRadius: 18, elevation: 8 }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 13, color: '#1a1305', letterSpacing: 1, ...pixelFont() }}>
              {originChoiceReady ? 'CHOOSE YOUR ORIGIN' : 'FORGE YOUR ORIGIN'}
            </Text>
          </Pressable>
          <Text className="mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            {originChoiceReady
              ? 'Your scores are close — the decision is yours'
              : 'Run an EvoGuide scan to discover your path'}
          </Text>
        </View>
      </View>
    );
  }

  // ONE identity chip. (TIER left Home 2026-07-19; STREAK and NEXT EVOLUTION
  // left 2026-08-03 — see the header note.)
  const badges = (
    <StatusBadge
      icon={<Text style={{ fontSize: 13, color: colors.accent }}>◈</Text>}
      value={formName}
      label="CURRENT FORM"
      tint={colors.accent}
      testID="hero-form"
      onPress={openCharacter}
    />
  );

  const actions = (
    <>
      {/* (LOADOUT deleted 2026-07-19 — its flag was permanently false; D4.) */}
      {features.showCustomise ? (
        <QuickAction
          icon={<PixelShirt size={22} color={colors.accent} />}
          label="CUSTOMISE"
          testID="hero-customise"
          onPress={() => router.push('/customise' as never)}
          accessibilityHint="Opens the champion select and customiser"
        />
      ) : null}
      {features.showCustomise ? <CoinRow /> : null}
    </>
  );

  return (
    <View>
      <Animated.View style={pressStyle}>
        <Pressable
          onPress={openCharacter}
          onPressIn={() => {
            press.value = withSpring(0.985, { damping: 20, stiffness: 300 });
          }}
          onPressOut={() => {
            press.value = withSpring(1, { damping: 16, stiffness: 260 });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Your champion: ${formName}, ${tierName} tier. Opens the Forge.`}
          testID="hero-avatar"
        >
          <HeroStage branch={branch} stage={stage} auraColour={auraColour} size={scale.champion} headroom={scale.headroom} artScale={HOME_ART_SCALE} source={source} animatedSource={animatedSource} stillSource={stillSource} silhouette={silhouette} />
        </Pressable>
      </Animated.View>
      {silhouette ? (
        <Text className="text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : null}

      {overlay ? (
        <>
          {/* The chips float over the stage's dead corners. Both columns are
              narrower than the champion's transparent sprite margin, so they
              never crowd the art at the sizes home-scale.ts hands out. */}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 4, left: 0, gap: 8, width: sideWidth }}>
            {badges}
          </View>
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 4, right: 0, gap: 8, width: sideWidth, alignItems: 'stretch' }}>
            {actions}
          </View>
        </>
      ) : (
        <View className="mt-s2 flex-row flex-wrap justify-center" style={{ gap: 8 }}>
          {badges}
          <View style={{ flexBasis: '100%', alignItems: 'stretch', gap: 8 }}>{actions}</View>
        </View>
      )}
    </View>
  );
}

/** A compact identity badge — icon, loud value, whispered label. */
function StatusBadge({
  icon,
  value,
  label,
  tint,
  onPress,
  testID,
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tint: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
      className="rounded-md border px-s2 py-s2"
      style={{ minHeight: 44, borderColor: `${tint}38`, backgroundColor: 'rgba(13,21,36,0.66)' }}
    >
      <View className="flex-row items-center" style={{ gap: 5 }}>
        {icon}
        <View style={{ flexShrink: 1 }}>
          {/* Two lines before any truncation — form names ("Elite
              Aesthetic") are longer than the mock's examples. */}
          <Text
            numberOfLines={2}
            allowFontScaling={false}
            style={{ fontSize: 10, lineHeight: 12, letterSpacing: 0, color: tint, ...pixelFont() }}
          >
            {value.toUpperCase()}
          </Text>
          <Text
            className="text-text-mute"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 7, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            {label}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** The champion's right-hand door: icon over a pixel label. Sized to the
 *  smaller 2026-08-03 champion — still far bigger than the pre-2026-07-19
 *  chip (Tyson's "~4x" ask), just no longer taller than the athlete. */
function QuickAction({
  icon,
  label,
  onPress,
  testID,
  accessibilityHint,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
  accessibilityHint?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityHint={accessibilityHint}
      testID={testID}
      className="items-center rounded-md border px-s2 py-s2"
      style={{
        minHeight: 72,
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1.5,
        borderColor: `${colors.accent}45`,
        backgroundColor: 'rgba(13,21,36,0.72)',
        shadowColor: colors.accent,
        shadowOpacity: 0.3,
        shadowRadius: 10,
      }}
    >
      {icon}
      <Text
        className="text-accent"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 12, letterSpacing: 0, ...pixelFont() }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The forge-coin balance riding under CUSTOMISE. Null total (offline,
 *  signed-out race) renders NOTHING — never a fake 0 (the ledger doctrine).
 *  The compact 13.1K form is display-only; spending uses exact numbers. */
function CoinRow() {
  const colors = useThemeColors();
  const total = useCoinTotal();
  if (total.data == null) return null;
  return (
    <Pressable
      onPress={() => router.push('/coins' as never)}
      accessibilityRole="button"
      accessibilityLabel={`${total.data} forge coins — view rewards`}
      testID="hero-coins"
      className="flex-row items-center justify-center rounded-md border px-s2 py-s2"
      style={{ minHeight: 32, gap: 6, borderColor: `${colors.legendary}45`, backgroundColor: 'rgba(13,21,36,0.72)' }}
    >
      <CoinIcon size={15} />
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 11, color: colors.legendary, letterSpacing: 0.5, ...pixelFont() }}
      >
        {formatCompact(total.data)}
      </Text>
    </Pressable>
  );
}
