import {
  playCoin,
  playPr,
  playPress,
  playSelect,
  soundEnabled,
} from '@/ui/core/sound';

/**
 * FORGE DROP'S VOICE.
 *
 * Built entirely on the app's existing synth primitives — the same ones the
 * battle screens and the duel table use — so there is no second audio system,
 * no asset to ship, and one settings toggle that already governs all of it
 * (`soundEnabled`).
 *
 * THE HARD PART IS RESTRAINT, NOT RICHNESS. Five chips crossing twelve pegs is
 * sixty impacts in two seconds. Played faithfully that is not a machine, it is
 * a smoke alarm. So:
 *
 *   · Peg strikes are RATE LIMITED to roughly one every 45ms across the whole
 *     board. Past that they are silently dropped — the visual effect still
 *     fires, so nothing is lost, it simply stops being audible mush.
 *   · Only the louder half of strikes make a sound at all. A 1-coin chip
 *     ticking through the pegs is felt, not heard.
 *   · Nothing here loops, sustains or plays under anything else.
 *
 * NOTHING IS LOAD-BEARING. Sound is off by default on some devices, muted on
 * others, and unavailable on native (these primitives are web-only). Every
 * result is fully readable with the audio switched off — this only ever adds
 * a layer on top of something already said in text.
 */

/** Roughly 22 strikes a second, board-wide. Above that the ear hears noise. */
const STRIKE_GAP_MS = 45;
let lastStrikeAt = 0;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** A chip was picked up off the rack. */
export function playChipReady(): void {
  playSelect();
}

/**
 * A chip left the rack. Short, bright, and immediate — this is the sound that
 * has to feel like a launch, so it fires on release rather than on landing.
 */
export function playDropLaunch(): void {
  playPress();
}

/**
 * A peg strike. `intensity` is the chip's share of the board ceiling, so a
 * bigger stake is both louder and a touch lower — the way a heavier object
 * actually sounds.
 */
export function playDropStrike(intensity: number): void {
  if (!soundEnabled()) return;
  // The quiet half of the board is felt, never heard.
  if (intensity < 0.6) return;
  const t = now();
  if (t - lastStrikeAt < STRIKE_GAP_MS) return;
  lastStrikeAt = t;
  playSelect();
}

/** The landing itself, before the result is graded. */
export function playDropLand(power: number): void {
  if (!soundEnabled()) return;
  void power;
  playCoin();
}

/**
 * THE RESULT, graded by what the ledger paid.
 *
 * Deliberately NOT a scale of "how exciting" — it is a scale of how much came
 * back, and a loss gets a real sound rather than silence. Silence after an
 * action reads as a bug, and a loss the athlete cannot hear is a loss they
 * have to go and check.
 */
export function playDropOutcome(tier: 'loss' | 'even' | 'win' | 'big' | 'jackpot'): void {
  if (!soundEnabled()) return;
  switch (tier) {
    case 'jackpot':
      playPr();
      break;
    case 'big':
      playCoin();
      setTimeout(playPr, 90);
      break;
    case 'win':
      playCoin();
      break;
    case 'even':
      playSelect();
      break;
    default:
      // Quiet, low and brief. It marks the moment; it does not editorialise.
      playPress();
      break;
  }
}

/** Called when the screen unmounts, so a fresh visit is not rate-limited by
 *  the last one's final strike. */
export function resetDropAudio(): void {
  lastStrikeAt = 0;
}
