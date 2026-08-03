/**
 * TRAIN 2026-08-03 — the ONE place the mission card's first-screen sizes live.
 *
 * The brief's hierarchy is six things deep before anything may scroll —
 * mission, objective, muscles, difficulty/time, rewards, CTA — and the card is
 * a FIXED height by design (the carousel's "equal cards" rule, Tyson
 * 2026-07-15: content never sizes a card, or swiping between days makes the
 * page jump). So the height is a budget, and this is where it is spent.
 *
 * MEASURED, NOT GUESSED, and measured against the PHONE's fold rather than a
 * desktop export's: a browser gives paddingTop 14 and a 58pt tab bar, an
 * iPhone PWA gives 47 (the island) and 88 (54 + the home indicator) — the
 * device is ~63pt meaner. On a 390×844 phone the Train page spends
 * ~47 (inset) + ~68 (header) + 12 + 44 (LIFT/CARDIO) + 12 before the card even
 * starts, and the fold is at 756. Everything below is chosen so START WORKOUT
 * lands above it with room, on every tier that can hold it.
 *
 *   compact  <700pt   iPhone SE          — the CTA needs one flick here
 *   regular  700-819  small / landscape web
 *   tall     820-899  iPhone 12-15 class — the fold this is tuned to
 *   xl       >=900    Pro Max / desktop
 */

import { useWindowDimensions } from 'react-native';

export type TrainSizeTier = 'compact' | 'regular' | 'tall' | 'xl';

export interface TrainScale {
  tier: TrainSizeTier;
  /** Every carousel card is exactly this tall — the equal-cards rule. */
  cardHeight: number;
  /** The fixed box the muscle hologram is cropped into. */
  mapHeight: number;
  /** The figure's own width inside that box. */
  figureWidth: number;
  /** The workout name — the second-loudest thing on the page after the CTA. */
  title: number;
  /** The mission objective line under it. */
  objective: number;
}

/**
 * MEASURED on the built export at four viewports (scratchpad/train_tour.mjs),
 * then tuned twice:
 *
 *   PASS 1 left ~56pt of dead air between DIFFICULTY and MISSION REWARDS,
 *   because the card was taller than its own content. The fix was not padding —
 *   it was giving the space to the figure the brief calls excellent, and taking
 *   the rest back off the card. Every tier's map is now ~6% of the card taller
 *   and every card is shorter.
 *
 *   COMPACT still had START WORKOUT 21pt UNDER the phone fold at 375×667, so it
 *   lost 22pt outright. It now clears by ~3pt there and ~26pt at 320×720 — the
 *   first time the Train CTA has fitted an SE without a flick.
 *
 * The slack left over is deliberate and small: the progress row (~23pt) appears
 * as soon as a set is logged, and the card must absorb it without the fixed
 * hologram box overflowing.
 */
const TIERS: Record<TrainSizeTier, Omit<TrainScale, 'tier'>> = {
  compact: { cardHeight: 368, mapHeight: 152, figureWidth: 116, title: 19, objective: 11.5 },
  regular: { cardHeight: 406, mapHeight: 190, figureWidth: 138, title: 22, objective: 12.5 },
  tall: { cardHeight: 428, mapHeight: 212, figureWidth: 156, title: 24, objective: 13 },
  xl: { cardHeight: 460, mapHeight: 234, figureWidth: 172, title: 27, objective: 14 },
};

export function trainScaleFor(width: number, height: number): TrainScale {
  const tier: TrainSizeTier =
    height < 700 ? 'compact' : height < 820 ? 'regular' : height < 900 ? 'tall' : 'xl';
  const base = TIERS[tier];
  // The figure owns 40% of a card that is capped at 560 wide inside 16pt
  // padding — clamp so a narrow phone crops the silhouette rather than
  // letting it push the briefing column into a two-word-per-line ribbon.
  const usable = Math.min(width, 560) - 32 - 28; // page padding + card padding
  const figureWidth = Math.min(base.figureWidth, Math.floor(usable * 0.42));
  return { tier, ...base, figureWidth };
}

export function useTrainScale(): TrainScale {
  const { width, height } = useWindowDimensions();
  return trainScaleFor(width, height);
}

/**
 * THE ENTRANCE, in milliseconds and in fractions of it.
 *
 * "Header fades in ↓ Today's Mission appears ↓ Muscle hologram powers on ↓
 * Reward chips animate ↓ Start Workout glows. Total duration 500–700ms."
 * That is a SEQUENCE, and a sequence built out of five independent timers
 * drifts; built out of five WINDOWS on one clock it cannot. Every stage below
 * is a [from, to] pair on the same 0→1 shared value, which is why the whole
 * entrance costs exactly one animation driver.
 */
export const TRAIN_INTRO_MS = 660;
export const STAGE = {
  header: [0.0, 0.2],
  mission: [0.1, 0.42],
  /** Consumed inside muscle-hologram.tsx. */
  hologram: [0.3, 0.62],
  rewards: [0.52, 0.84],
  cta: [0.72, 1.0],
} as const;

/** The ambient clock's period — the scan sweep, the bloom breath, shimmer. */
export const TRAIN_CLOCK_MS = 5500;
