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

/**
 * HOME_REDESIGN §2 — the avatar hero: the character owns the first screen.
 * HeroStage (podium, aura, particles, XP-reactive bloom) centred, with the
 * mock's side modules flanking it — LEFT the identity badges (tier, current
 * form, next evolution), RIGHT the avatar actions (loadout, customise).
 *
 * Every badge value is real (rarity from level, form from the V2 resolver,
 * readiness from live requirements). LOADOUT has no backing system and is
 * hidden by its flag — never a dead button.
 *
 * RESPONSIVE: the columns overlay the stage only where they fit beside the
 * character (>=414pt); narrower screens get the same modules as a compact
 * row under the stage — the brief's own fallback, chosen over shrinking.
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
  evolutionPercent,
  streakCurrent,
  streakLabel,
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
  evolutionPercent: number;
  /** HOME v2 (2026-07-22): the workout streak badge rides the hero column
   *  (the old status grid is gone). Label is FORGE STREAK when a schedule
   *  drives the streak, DAY STREAK otherwise. */
  streakCurrent: number;
  streakLabel: string;
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
  const overlay = width >= 380;

  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const openCharacter = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/avatar' as never);
  };

  if (originUnset) {
    // Tyson 2026-07-18: keep the REAL podium/stage — just no champion on it.
    // A 1px transparent source lets HeroStage render its podium + gold aura
    // with an invisible character; the gold FORGE YOUR ORIGIN button stands
    // where the champion usually does.
    const BLANK = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
    return (
      <View testID="hero-origin-empty">
        <HeroStage branch={branch} stage={1} auraColour={colors.legendary} source={BLANK} stillSource={BLANK} animatedSource={BLANK} silhouette={false} />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
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

  const badges = (
    // Tyson 2026-07-19: the TIER badge is gone from Home — FORM and NEXT
    // EVOLUTION moved up into its place. (Tier still lives on /rank and the
    // hero's accessibility label.)
    <>
      {/* ◈ not 🔥 (HOME v2): the flame belongs to the STREAK badge below —
          two flames in one column read as the same stat twice. */}
      <StatusBadge
        icon={<Text style={{ fontSize: 14, color: colors.accent }}>◈</Text>}
        value={formName}
        label="CURRENT FORM"
        tint={colors.accent}
        testID="hero-form"
        onPress={openCharacter}
      />
      <StatusBadge
        icon={<Text style={{ fontSize: 14 }}>🔥</Text>}
        value={`${streakCurrent} DAY${streakCurrent === 1 ? '' : 'S'}`}
        label={streakLabel}
        tint={streakCurrent > 0 ? colors.legendary : colors['text-mute']}
        testID="hero-streak"
        onPress={() => router.push('/streak' as never)}
      />
      <StatusBadge
        icon={<Text style={{ fontSize: 14, color: colors.epic }}>▲</Text>}
        value={`${evolutionPercent}%`}
        label="NEXT EVOLUTION"
        tint={colors.epic}
        testID="hero-evolution"
        onPress={openCharacter}
      />
    </>
  );

  const actions = (
    <>
      {/* (LOADOUT deleted 2026-07-19 — its flag was permanently false; D4.) */}
      {features.showCustomise ? (
        // Tyson 2026-07-19: "make the customise tab bigger and more
        // prominent — approximately 4x" → the hero size (same design,
        // scaled) + the coin balance riding beneath it.
        <QuickAction
          icon={<PixelShirt size={27} color={colors.accent} />}
          label="CUSTOMISE"
          size="hero"
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
            scale.value = withSpring(0.985, { damping: 20, stiffness: 300 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 16, stiffness: 260 });
          }}
          accessibilityRole="button"
          accessibilityLabel={`Your character: ${formName}, ${tierName} tier, ${evolutionPercent} percent to the next evolution. Opens the Forge.`}
          testID="hero-avatar"
        >
          <HeroStage branch={branch} stage={stage} auraColour={auraColour} source={source} animatedSource={animatedSource} stillSource={stillSource} silhouette={silhouette} />
        </Pressable>
      </Animated.View>
      {silhouette ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : (
        // Make the Forge door discoverable — the champion IS the button.
        <Pressable
          onPress={openCharacter}
          accessibilityRole="button"
          accessibilityLabel="open the Forge"
          testID="hero-forge-hint"
          className="-mt-s1 self-center"
          style={{ minHeight: 28, justifyContent: 'center' }}
        >
          <Text className="text-center text-2xs" style={{ letterSpacing: 2, color: colors.accent }}>
            ◈ TAP YOUR CHAMPION TO ENTER THE FORGE ›
          </Text>
        </Pressable>
      )}

      {overlay ? (
        <>
          {/* Side columns float over the stage's dead corners. The action
              column is 140 wide since the CUSTOMISE hero size (2026-07-19);
              the stage keeps clear of it at ≥380 — verified 390/320 shots. */}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, left: 0, gap: 8, width: Math.min(128, Math.round(width * 0.3)) }}>
            {badges}
          </View>
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, right: 0, gap: 8, width: 140, alignItems: 'stretch' }}>
            {actions}
          </View>
        </>
      ) : (
        <View className="mt-s2 flex-row flex-wrap justify-center" style={{ gap: 8 }}>
          {badges}
          {/* Narrow screens: the hero CUSTOMISE owns a full row under the
              badges so its 4x size never squeezes the badge wrap. */}
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
      style={{ minHeight: 48, borderColor: `${tint}45`, backgroundColor: 'rgba(13,21,36,0.72)' }}
    >
      <View className="flex-row items-center" style={{ gap: 6 }}>
        {icon}
        <View style={{ flexShrink: 1 }}>
          {/* Two lines before any truncation — form names ("Elite
              Aesthetic") are longer than the mock's examples. */}
          <Text
            numberOfLines={2}
            allowFontScaling={false}
            style={{ fontSize: 10, lineHeight: 13, letterSpacing: 0, color: tint, ...pixelFont() }}
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

/** The hero's right-hand door: icon over a pixel label. `size="hero"` is the
 *  ~4x CUSTOMISE treatment (Tyson 2026-07-19) — same design, scaled. */
function QuickAction({
  icon,
  label,
  onPress,
  testID,
  accessibilityHint,
  size = 'default',
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
  accessibilityHint?: string;
  size?: 'default' | 'hero';
}) {
  const colors = useThemeColors();
  const hero = size === 'hero';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityHint={accessibilityHint}
      testID={testID}
      className="items-center rounded-md border px-s2 py-s2"
      style={{
        // Both hero dims trimmed 15% (Tyson 2026-07-19): 112→95, 132→112.
        minHeight: hero ? 95 : 56,
        minWidth: hero ? 112 : 96,
        justifyContent: 'center',
        gap: hero ? 7 : 4,
        borderColor: `${colors.accent}45`,
        backgroundColor: 'rgba(13,21,36,0.72)',
        ...(hero
          ? { borderWidth: 1.5, shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 12 }
          : null),
      }}
    >
      {icon}
      <Text
        className="text-accent"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: hero ? 14 : 9, letterSpacing: 0, ...pixelFont() }}
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
      style={{ minHeight: 34, gap: 7, borderColor: `${colors.legendary}45`, backgroundColor: 'rgba(13,21,36,0.72)' }}
    >
      <CoinIcon size={17} />
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={{ fontSize: 12, color: colors.legendary, letterSpacing: 0.5, ...pixelFont() }}
      >
        {formatCompact(total.data)}
      </Text>
    </Pressable>
  );
}
