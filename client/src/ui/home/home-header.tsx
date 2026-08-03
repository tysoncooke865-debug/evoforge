import { router } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { EMOTES, cosmeticUnlocked, type EmoteId } from '@/domain/customise';
import { progressPercent } from '@/domain/xp';
import { useLoadoutStore } from '@/state/loadout-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CompanionMenuButton } from '@/ui/character/companion-menu';

/** The equipped emote, validated against the live Forge Level. Reads the
 *  store with a selector so only emote changes re-render the header. */
function useEquippedEmote(forgeLevel: number): EmoteId {
  const emoteId = useLoadoutStore((s) => s.loadout.emoteId);
  const emote = EMOTES.find((e) => e.id === emoteId);
  // Emote gates are free/forge only (pinned by the catalogs vitest), so
  // legacyLevel 0 here can never wrongly lock one.
  return emote && cosmeticUnlocked(emote.unlock, { forgeLevel, legacyLevel: 0, ownedSkins: new Set(), ownedPalettes: new Set() }) ? emote.id : 'victory';
}

/**
 * HOME_REDESIGN §1 — the safe-area masthead. Left: the game's name and
 * creed. Right: the level module — companion portrait in the Train-style
 * outlined box beside LV. + a mini XP bar + the exact XP remaining, all one
 * door to /profile (the progression screen). The companion itself keeps its
 * own door (the profile MENU), exactly as on Train.
 *
 * Numbers are the confirmed summary the whole app levels on — never a
 * recomputation (Data accuracy rule: one level everywhere).
 */
export function HomeHeader({
  level,
  xpIntoLevel,
  xpNeeded,
}: {
  level: number;
  xpIntoLevel: number;
  xpNeeded: number;
}) {
  const colors = useThemeColors();
  const emote = useEquippedEmote(level);
  const pct = progressPercent(xpIntoLevel, xpNeeded);
  const toNext = Math.max(0, xpNeeded - xpIntoLevel);
  const nextLevel = Math.min(level + 1, 100);
  // adjustsFontSizeToFit does not exist on RN-web — the wordmark's size is
  // a pure width rule so it can never wrap ("EVOFORG / E" is exactly the
  // broken fragment the brief bans). Jersey 25 is condensed; these fit.
  //
  // 2026-08-03 PREMIUM PASS — THE WORDMARK WAS DEMOTED, and it is the single
  // highest-leverage change on the page. It used to render at 30pt with an
  // 18px cyan bloom, directly above a 62pt purple rating, and the two fought:
  // "prestige" is a CONTRAST relationship, so the rating cannot be the loudest
  // thing on the page while a glowing wordmark sits above it. The glow is gone
  // (the neon policy reserves glow for CTAs, progress fills, rarity, the aura
  // and unlock moments — a brand name is none of those) and the sizes came
  // down a step. The name is still the first thing read; it is no longer the
  // loudest thing seen.
  const { width } = useWindowDimensions();
  const brandSize = width >= 460 ? 30 : width >= 390 ? 26 : 22;
  return (
    // zIndex: the AvatarHero's oversized pressable (its 450px stage rig)
    // reaches up under this masthead; without the lift, the masthead's taps
    // (the level module) land on the character instead.
    <View className="w-full flex-row items-start justify-between" style={{ gap: 10, zIndex: 10 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          className="text-text"
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            fontSize: brandSize,
            lineHeight: brandSize + 6,
            letterSpacing: 0,
            ...pixelFont(),
          }}
        >
          EVOFORGE
        </Text>
        {width >= 360 ? (
          <Text
            className="mt-s1 text-accent"
            allowFontScaling={false}
            numberOfLines={1}
            style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            RISE · TRANSFORM · CONQUER
          </Text>
        ) : null}
      </View>

      {/* The level module — mirrors the mock's top-right chip. */}
      <View
        className="flex-row items-center rounded-lg border p-s1"
        style={{ gap: 8, borderColor: `${colors.accent}59`, backgroundColor: 'rgba(13,21,36,0.6)' }}
      >
        {/* The header companion plays the EQUIPPED EMOTE (CUSTOMISE,
            2026-07-16) — default remains the victory flex; a locked emote
            (gates re-checked against the live Forge Level) falls back. */}
        <CompanionMenuButton anim={emote} height={40} />
        <Pressable
          onPress={() => router.push('/profile' as never)}
          accessibilityRole="button"
          accessibilityLabel={`Level ${level}. ${xpIntoLevel} of ${xpNeeded} experience. Opens your profile.`}
          testID="home-level-module"
          className="justify-center pr-s2"
          style={{ minHeight: 44, minWidth: 84 }}
        >
          <View className="flex-row items-baseline" style={{ gap: 4 }}>
            <Text className="text-2xs text-text-mute" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont(false) }}>
              LV.
            </Text>
            <Text
              className="text-accent"
              allowFontScaling={false}
              // Softened with the wordmark, and for the same reason: two cyan
              // blooms in the masthead is two things competing with the rating.
              style={{ fontSize: 18, letterSpacing: 0, textShadowColor: 'rgba(34,211,238,0.35)', textShadowRadius: 6, ...pixelFont() }}
            >
              {level}
            </Text>
          </View>
          {/* Mini XP bar — same progressPercent that grants the level. */}
          <View
            className="mt-s1 overflow-hidden rounded-pill"
            style={{ height: 5, width: 88, backgroundColor: colors['surface-3'] }}
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
          <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={1}>
            {level >= 100 ? 'MAX LEVEL' : `${toNext} XP to LV. ${nextLevel}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
