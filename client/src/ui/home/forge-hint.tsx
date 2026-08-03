/**
 * HOME — THE CHAMPION'S NAMEPLATE (rewritten 2026-08-03, premium pass).
 *
 * WHAT THIS FILE USED TO BE: a full-width breathing line of cyan text sitting
 * between the masthead and the Evo Rating — "◈ TAP YOUR CHAMPION TO ENTER THE
 * FORGE ›". Two things were wrong with it, and both are hierarchy problems
 * rather than styling ones:
 *
 *   1. It spent the most valuable strip on the page — the one directly under
 *      the masthead, where the athlete's eye lands first — on an INSTRUCTION.
 *      That strip belongs to identity. Nothing may compete with the rating
 *      there.
 *   2. It taught the interaction from 200pt away from the thing it described.
 *
 * WHAT IT IS NOW: a plaque across the podium's front face, carrying the
 * champion's FORM NAME with the hint beneath it. It costs ZERO vertical
 * budget (it is an overlay on art that was already there), it teaches the tap
 * at the exact place the tap happens, and it gives the champion the one thing
 * a trophy has and a sprite does not — a name on a plate.
 *
 * IT ALSO ABSORBED THE "CURRENT FORM" CHIP that floated on the champion's left
 * flank. That chip was the brief's "THE GRIND card" — audited and judged worth
 * KEEPING (the form name is real identity and the door to the Forge) but not
 * worth a floating card competing with the rating. Same words, same door,
 * integrated with the champion instead of orbiting it, and the left flank is
 * now empty on purpose. See avatar-hero.tsx.
 *
 * Deliberately STILL. The deck below it already carries a rotating ring, a
 * light sweep and three chasing LEDs; a breathing label on top of that is the
 * "busy" the brief bans. Prestige is stillness next to motion.
 */

import { Text, View } from 'react-native';

import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

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
          style={{ fontSize: 8, letterSpacing: 1.4, color: colors['text-mute'], ...pixelFont(false) }}
        >
          TAP TO ENTER THE FORGE ›
        </Text>
      </View>
    </View>
  );
}
