/**
 * HOME 2026-08-03 — the ONE place Home's first-screen sizes live.
 *
 * The redesign asks four things to share one screen: the Evo Rating (big
 * enough to become the athlete's identity), the champion (the visual reward),
 * the rank rail, and a START button that cannot be ignored. On a 390x844
 * phone the content viewport is only ~709pt once the safe area and the
 * 54+inset tab bar are gone, so those four have a REAL budget and the old
 * constants (a 192pt champion inside a 360pt rig) spent all of it on the rig
 * alone.
 *
 * So the rig scales with the viewport instead of being a constant. Four
 * tiers, and the numbers are MEASURED, not guessed — the tour in
 * scratchpad/home_tour.mjs reads every section's rect out of the real build
 * and compares it against the fold a REAL phone has, which is meaner than a
 * desktop browser's by ~63pt: a browser gives paddingTop 14 and a 58pt tab
 * bar, an iPhone PWA gives paddingTop 47 (the island) and 88 (54 + the home
 * indicator). Tune against the phone number or START MISSION lands under the
 * nav on the device and above it in the screenshot.
 *
 *   compact  <700pt   iPhone SE          — cannot fit the CTA at any size
 *   regular  700-819  small/landscape web
 *   tall     820-899  iPhone 12-15 class — the fold this is tuned to
 *   xl       >=900    Pro Max / desktop  — spends the extra height on the art
 *
 * Width is a second ceiling: HeroStage draws its podium at 1.5x the champion
 * size, so a narrow screen clamps the champion rather than letting the disc
 * run under the page padding.
 *
 * ---- PREMIUM PASS (2026-08-03, second brief) ----
 *
 * Two structural merges bought the budget this pass spends, so the CTA still
 * clears the phone's fold with MORE room than before, not less:
 *
 *   −58pt  NEXT RANK stopped being a card and became a rail inside the Evo
 *          crest (one purple identity block instead of two).
 *   −20pt  the forge hint stopped owning a slot and became an overlay on the
 *          podium's front face, where it costs nothing vertically.
 *   +9pt   the rating numeral grew ~15% (the brief's ask: the rating IS the
 *          product, so it must out-weigh everything else on the page).
 *   +16pt  the "OVERALL FITNESS SCORE" subtitle — the one line that stops the
 *          page assuming the athlete already knows what the number means.
 *   +8%    the champion, because the brief asks for MORE emotional emphasis
 *          on it and the merges finally paid for it.
 */

import { useWindowDimensions } from 'react-native';

export type HomeSizeTier = 'compact' | 'regular' | 'tall' | 'xl';

export interface HomeScale {
  tier: HomeSizeTier;
  /** HeroStage `size` — the champion art's box; the podium derives from it. */
  champion: number;
  /** Sky above the champion's head, as a multiple of `size`. The stage's own
   *  default is 0.25; Home now spends that space on the Evo Rating instead,
   *  and the aura still has room to bloom at 0.08. */
  headroom: number;
  /** The Evo Rating numeral — the single loudest thing on the page. */
  rating: number;
  /** "OVERALL FITNESS SCORE" under the numeral. Small on purpose: it is a
   *  gloss on the number, never a competitor to it. */
  ratingSub: number;
  /** The mission card's workout name. */
  missionTitle: number;
  /** Vertical rhythm inside the identity block (label -> number -> tier). */
  heroGap: number;
}

const TIERS: Record<HomeSizeTier, Omit<HomeScale, 'tier'>> = {
  compact: { champion: 100, headroom: 0.08, rating: 55, ratingSub: 8.5, missionTitle: 19, heroGap: 2 },
  regular: { champion: 114, headroom: 0.08, rating: 64, ratingSub: 9, missionTitle: 21, heroGap: 3 },
  tall: { champion: 126, headroom: 0.08, rating: 71, ratingSub: 9.5, missionTitle: 23, heroGap: 4 },
  xl: { champion: 152, headroom: 0.08, rating: 85, ratingSub: 11, missionTitle: 25, heroGap: 6 },
};

/**
 * Home draws the champion ART 1.5x inside its rig (AvatarStage's `artScale`).
 * A rotation frame is ~59% transparent, so at 1x a 116pt champion reads only
 * ~67pt tall — SMALLER than the 192pt rig this redesign replaced, which is
 * the opposite of "increase visual emphasis". 1.5 puts the athlete back at
 * ~100pt while the rig stays ~198pt, and the extra pixels spill into sky the
 * sprite was already wasting.
 */
export const HOME_ART_SCALE = 1.5;

export function homeScaleFor(width: number, height: number): HomeScale {
  const tier: HomeSizeTier =
    height < 700 ? 'compact' : height < 820 ? 'regular' : height < 900 ? 'tall' : 'xl';
  const base = TIERS[tier];
  // ScreenShell pads px-s4 (16 each side) and caps content at 560. The podium
  // is 1.5x the champion; keep 8% of clearance so its glow never clips.
  const usable = Math.min(width, 560) - 32;
  const widthCap = Math.floor((usable / 1.5) * 0.92);
  return { tier, ...base, champion: Math.min(base.champion, widthCap) };
}

export function useHomeScale(): HomeScale {
  const { width, height } = useWindowDimensions();
  return homeScaleFor(width, height);
}
