/**
 * STILLNESS COPY of ui/home/forge-hint.tsx (Page Lab, forked 2026-08-18).
 *
 * HOME — THE FORGE DOOR, in two parts.
 *
 * `ForgeHint` sits directly under the masthead, ABOVE the Evo Rating. Tyson
 * (2026-08-03, third brief): "it teaches interaction before the user sees the
 * Champion." It moved to the podium for one revision and moved back — the
 * argument for the top is stronger than the argument against, because an
 * athlete who has not yet learned the champion is a button never scrolls far
 * enough to find out.
 *
 * `ForgeNameplate` is the plate across the podium's front face, and it is now
 * a STATE, not an instruction: it carries the champion's form name and nothing
 * else. "Tap to enter the Forge" left it, because the hint above already says
 * that and a plaque that repeats it is a label arguing with itself. THE GRIND
 * is who the champion is right now.
 *
 * MOTION: none. The live hint breathes and nudges its chevron once per 4.4s
 * cycle; here it stands fully lit and perfectly still — a signpost, not a
 * beckoning hand. The words and the chevron already say "this goes
 * somewhere"; on a page whose only movements are the champion's breath and
 * the today pip, a wiggling caption would be the loudest thing above the
 * fold. Prestige is stillness next to motion.
 *
 * The plate is deliberately STILL for the same reason it always was: a
 * breathing label over the podium is the "busy" the brief bans.
 */

import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { playSelect } from '@/ui/core/sound';

export function ForgeHint() {
  const colors = useThemeColors();

  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        playSelect();
        router.push('/avatar' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Enter the Forge"
      testID="hero-forge-hint"
      style={{ minHeight: 20, justifyContent: 'center', alignSelf: 'center' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{
            fontSize: 10,
            letterSpacing: 1.6,
            color: colors.accent,
            textShadowColor: 'rgba(34,211,238,0.45)',
            textShadowRadius: 10,
          }}
        >
          ◈ TAP YOUR CHAMPION TO ENTER THE FORGE
        </Text>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.6, color: colors.accent, paddingLeft: 4 }}
        >
          ›
        </Text>
      </View>
    </Pressable>
  );
}

/** The champion's current STATE, engraved on the podium. No instruction. */
export function ForgeNameplate({ formName }: { formName: string }) {
  const colors = useThemeColors();
  return (
    <View
      pointerEvents="none"
      testID="hero-form"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}
    >
      <View
        className="items-center rounded-md border px-s3 py-s1"
        style={{
          maxWidth: '86%',
          borderColor: `${colors.accent}3d`,
          // Darker than the surrounding fog so the plate reads as machined
          // metal set INTO the podium, not a chip floating over it.
          backgroundColor: 'rgba(4,7,14,0.72)',
        }}
      >
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          allowFontScaling={false}
          style={{ fontSize: 13, letterSpacing: 1.2, color: colors.accent, ...pixelFont() }}
        >
          {formName.toUpperCase()}
        </Text>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{ fontSize: 7, letterSpacing: 1.4, color: colors['text-mute'], ...pixelFont(false) }}
        >
          CURRENT FORM
        </Text>
      </View>
    </View>
  );
}
