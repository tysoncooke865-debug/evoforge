/* eslint-disable react-hooks/immutability -- Reanimated shared values are
   mutated inside press handlers by design; the compiler lint cannot see
   that .value writes are UI-thread animation state, not render state.
   (The same documented exception as neon-button.tsx.) */
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { Branch } from '@/domain/avatar-stats';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { HeroStage } from '@/ui/character/hero-stage';
import { PixelHelmet, PixelShirt } from '@/ui/core/pixel-icons';

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
  tierColour,
  formName,
  evolutionPercent,
  features,
  originUnset = false,
}: {
  branch: Branch;
  stage: number;
  auraColour: string;
  source?: import('react-native').ImageSourcePropType;
  animatedSource?: import('react-native').ImageSourcePropType;
  stillSource?: import('react-native').ImageSourcePropType;
  silhouette: boolean;
  tierName: string;
  tierColour: string;
  formName: string;
  evolutionPercent: number;
  features: HomeFeatures;
  /** ORIGIN (Tyson 2026-07-18): no Origin selected → BLANK podium, no avatar,
   *  no rating — just the gold FORGE YOUR ORIGIN button on the stage. */
  originUnset?: boolean;
}) {
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
        <HeroStage branch={branch} stage={1} auraColour={tokens.colors.legendary} source={BLANK} stillSource={BLANK} animatedSource={BLANK} silhouette={false} />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Pressable
            onPress={() => router.push('/evo-scan' as never)}
            accessibilityRole="button"
            accessibilityLabel="Forge your Origin — run an EvoGuide scan"
            testID="forge-origin"
            className="items-center justify-center rounded-xl px-s5"
            style={{ minHeight: 56, backgroundColor: tokens.colors.legendary, shadowColor: tokens.colors.legendary, shadowOpacity: 0.55, shadowRadius: 18, elevation: 8 }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 13, color: '#1a1305', letterSpacing: 1, ...pixelFont() }}>
              FORGE YOUR ORIGIN
            </Text>
          </Pressable>
          <Text className="mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            Run an EvoGuide scan to discover your path
          </Text>
        </View>
      </View>
    );
  }

  const badges = (
    <>
      <StatusBadge icon={<Text style={{ fontSize: 14, color: tierColour }}>◆</Text>} value={tierName} label="TIER" tint={tierColour} testID="hero-tier" onPress={() => router.push('/rank' as never)} />
      <StatusBadge icon={<Text style={{ fontSize: 14 }}>🔥</Text>} value={formName} label="CURRENT FORM" tint={tokens.colors.accent} testID="hero-form" onPress={openCharacter} />
      <StatusBadge
        icon={<Text style={{ fontSize: 14, color: tokens.colors.epic }}>▲</Text>}
        value={`${evolutionPercent}%`}
        label="NEXT EVOLUTION"
        tint={tokens.colors.epic}
        testID="hero-evolution"
        onPress={openCharacter}
      />
    </>
  );

  const actions = (
    <>
      {features.showLoadout ? (
        <QuickAction
          icon={<PixelHelmet size={18} color={tokens.colors.accent} />}
          label="LOADOUT"
          testID="hero-loadout"
          onPress={openCharacter}
        />
      ) : null}
      {features.showCustomise ? (
        <QuickAction
          icon={<PixelShirt size={18} color={tokens.colors.accent} />}
          label="CUSTOMISE"
          testID="hero-customise"
          onPress={() => router.push('/customise' as never)}
          accessibilityHint="Opens the champion select and customiser"
        />
      ) : null}
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
      ) : null}

      {overlay ? (
        <>
          {/* Side columns float over the stage's dead corners. */}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, left: 0, gap: 8, width: Math.min(128, Math.round(width * 0.3)) }}>
            {badges}
          </View>
          <View pointerEvents="box-none" style={{ position: 'absolute', top: 8, right: 0, gap: 8, width: 100, alignItems: 'stretch' }}>
            {actions}
          </View>
        </>
      ) : (
        <View className="mt-s2 flex-row flex-wrap justify-center" style={{ gap: 8 }}>
          {badges}
          {actions}
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

/** The hero's right-hand door: icon over a pixel label. */
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.toLowerCase()}
      accessibilityHint={accessibilityHint}
      testID={testID}
      className="items-center rounded-md border px-s2 py-s2"
      style={{ minHeight: 56, minWidth: 96, justifyContent: 'center', gap: 4, borderColor: `${tokens.colors.accent}45`, backgroundColor: 'rgba(13,21,36,0.72)' }}
    >
      {icon}
      <Text
        className="text-accent"
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0, ...pixelFont() }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
