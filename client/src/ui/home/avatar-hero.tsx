/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers and effects by design; the compiler lint
   cannot see that .value writes are UI-thread animation state, not render
   state. (The same documented exception as neon-button.tsx.) */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useCoinTotal } from '@/data/coins';
import type { Branch } from '@/domain/avatar-stats';
import { formatCompact } from '@/domain/format';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { HeroStage } from '@/ui/character/hero-stage';
import { CoinIcon } from '@/ui/core/coin-icon';
import { PixelShirt } from '@/ui/core/pixel-icons';
import { playSelect } from '@/ui/core/sound';
import { useAmbient } from '@/ui/core/use-ambient';

import { ForgeNameplate } from './forge-hint';
import type { HomeFeatures } from './home-features';
import { HOME_ART_SCALE, useHomeScale } from './home-scale';

/**
 * HOME §2 — THE CHAMPION, and nothing else.
 *
 * The page has ONE focal point, so this section carries no modules that read
 * rather than act. What went where, and why nothing was deleted:
 *
 *  - THE STREAK BADGE moved to the WEEK STRIP, where the seven pips it was
 *    counting already live. Two flames on one page was the duplicate.
 *  - NEXT EVOLUTION % left the fold: the EvolutionTeaser below it shows the
 *    same readiness with the silhouette of the form it buys.
 *  - CURRENT FORM stopped being a floating chip on the champion's left flank
 *    and became the PLAQUE ON THE PODIUM (forge-hint.tsx). It was the brief's
 *    "THE GRIND card": audited, judged worth keeping — the form name is real
 *    identity and the only door to the Forge — but not worth a card orbiting
 *    the champion and competing with the rating. The forge hint moved onto the
 *    same plaque, out of the identity strip under the masthead.
 *
 * THE LEFT FLANK IS NOW DELIBERATELY EMPTY. The brief's rule for this page is
 * "do not fill empty space"; air beside a champion is what makes it read as a
 * champion rather than a dashboard tile.
 *
 * THE RIGHT FLANK IS ONE CLUSTER, not two chips: CUSTOMISE over the coin
 * balance inside a single outlined module, because they are one idea — the
 * champion's controls. Both float in the stage's dead corner and cost ZERO
 * vertical budget, which is the whole reason the champion, the rating and the
 * mission can share one screen.
 *
 * The champion itself scales with the viewport (home-scale.ts) and keeps every
 * living detail: the breathing float, the weight shift, the aura pulse, the
 * podium's rotating ring and light sweep, the contact shadow, the drifting
 * pixels and the XP-reactive spotlight bloom — all gated by useAmbient.
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
  // The cluster overlays the stage's dead corner wherever it FITS beside the
  // champion. 320 is the floor (it was 380, written for the 192pt rig), and it
  // matters more than it looks: below the threshold the controls wrap into a
  // stacked row UNDER the stage that costs ~200pt of the first screen — on a
  // 375pt phone that was the single biggest thing pushing START MISSION off
  // it. Checked at 320 against the sprite's own transparent side margin
  // (~25% of the frame), which is wider than the overlap.
  const overlay = width >= 320;
  const sideWidth = Math.max(80, Math.min(104, Math.round(width * 0.26)));

  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const openCharacter = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    playSelect();
    router.push('/avatar' as never);
  };

  if (originUnset) {
    // Tyson 2026-07-18: keep the REAL podium/stage — just no champion on it.
    // A 1px transparent source lets HeroStage render its podium + gold aura
    // with an invisible character; the gold FORGE YOUR ORIGIN button stands
    // where the champion usually does.
    //
    // THIS PIXEL WAS NEVER TRANSPARENT (found 2026-08-02, fixed since). The
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

  // ONE control cluster. (LOADOUT deleted 2026-07-19 — its flag was
  // permanently false; D4. TIER left Home 2026-07-19; STREAK and NEXT
  // EVOLUTION left 2026-08-03; CURRENT FORM became the podium plaque.)
  const controls = features.showCustomise ? (
    <View
      className="overflow-hidden rounded-lg border"
      style={{
        borderWidth: 1.5,
        borderColor: `${colors.accent}45`,
        backgroundColor: 'rgba(13,21,36,0.74)',
        shadowColor: colors.accent,
        shadowOpacity: 0.28,
        shadowRadius: 12,
      }}
      testID="hero-controls"
    >
      <QuickAction
        icon={<PixelShirt size={22} color={colors.accent} />}
        label="CUSTOMISE"
        testID="hero-customise"
        onPress={() => router.push('/customise' as never)}
        accessibilityHint="Opens the champion select and customiser"
      />
      <View style={{ height: 1, backgroundColor: `${colors.accent}26` }} />
      <CoinRow />
    </View>
  ) : null;

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
          {/* The plaque rides the podium's front face — inside the champion's
              own Pressable, so tapping the name is tapping the champion. */}
          <ForgeNameplate formName={formName} />
        </Pressable>
      </Animated.View>
      {silhouette ? (
        <Text className="text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : null}

      {overlay ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 4, right: 0, width: sideWidth }}
        >
          {controls}
        </View>
      ) : (
        <View className="mt-s2" style={{ alignItems: 'stretch' }}>
          {controls}
        </View>
      )}
    </View>
  );
}

/** The champion's door: icon over a pixel label. Sized to the 2026-08-03
 *  champion — still far bigger than the pre-2026-07-19 chip (Tyson's "~4x"
 *  ask), just no longer taller than the athlete. */
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
  const press = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          playSelect();
          onPress();
        }}
        onPressIn={() => {
          press.value = withSpring(0.94, { damping: 20, stiffness: 420 });
        }}
        onPressOut={() => {
          press.value = withSpring(1, { damping: 15, stiffness: 300 });
        }}
        accessibilityRole="button"
        accessibilityLabel={label.toLowerCase()}
        accessibilityHint={accessibilityHint}
        testID={testID}
        className="items-center px-s2 py-s2"
        style={{ minHeight: 68, justifyContent: 'center', gap: 6 }}
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
    </Animated.View>
  );
}

/**
 * The forge-coin balance, inside the champion's control cluster. Null total
 * (offline, signed-out race) renders NOTHING — never a fake 0 (the ledger
 * doctrine). The compact 13.1K form is display-only; spending uses exact
 * numbers.
 *
 * THE SHINE (2026-08-03): a single highlight crosses the balance roughly once
 * every 24 seconds — the brief's "tiny shine every 20–30 seconds". It is a
 * long, mostly-idle loop rather than a pulse, so the currency catches the eye
 * on a schedule the athlete never consciously notices. Ambient-gated like
 * every other loop.
 */
function CoinRow() {
  const colors = useThemeColors();
  const total = useCoinTotal();
  const ambient = useAmbient();
  const t = useSharedValue(0);

  useEffect(() => {
    if (!ambient) {
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 24000, easing: Easing.linear }), -1);
  }, [ambient, t]);

  // The sweep owns the last 5% of the loop (~1.2s of travel in 24s).
  const shine = useAnimatedStyle(() => {
    const p = (t.value - 0.95) / 0.05;
    if (p < 0) return { opacity: 0, transform: [{ translateX: -40 }] };
    return { opacity: 1, transform: [{ translateX: -40 + p * 160 }] };
  });

  if (total.data == null) return null;
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        playSelect();
        router.push('/coins' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${total.data} forge coins — view rewards`}
      testID="hero-coins"
      className="flex-row items-center justify-center overflow-hidden px-s2 py-s2"
      style={{ minHeight: 36, gap: 6 }}
    >
      <CoinIcon size={15} />
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 11, color: colors.legendary, letterSpacing: 0.5, ...pixelFont() }}
      >
        {formatCompact(total.data)}
      </Text>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', top: 0, bottom: 0, width: 40 }, shine]}
      >
        <LinearGradient
          colors={['rgba(251,191,36,0)', 'rgba(255,240,200,0.34)', 'rgba(251,191,36,0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </Pressable>
  );
}
