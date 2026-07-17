/**
 * RETRO SFX (Tyson, 2026-07-16) — synthesized square-wave blips.
 *
 * WEB AUDIO, not HTMLAudioElement (Tyson: "music stops playing whenever
 * EvoForge plays sound"). An <audio> element claims the platform MEDIA
 * SESSION — on iOS that pauses Spotify/Music for a 90ms blip. Oscillator
 * nodes through an AudioContext mix WITH background audio instead of
 * taking focus, and they synthesize the exact same square-wave chirps the
 * old WAVs held, so the assets are gone too.
 *
 * WEB ONLY for now: native stays silent until a native build brings
 * expo-audio (and must use the AMBIENT/mixWithOthers category when it
 * does — same rule, native spelling). Always triggered by a user gesture
 * (press handlers), so autoplay policies never block; the context is
 * created lazily on the first blip and resumed if the OS suspended it.
 * Gated on the settings toggle; every failure is swallowed — sound is
 * seasoning, never an error surface.
 */

import { Platform } from 'react-native';

import { useSettingsStore } from '@/state/settings-store';

type AudioContextCtor = new () => AudioContext;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One square-wave blip: frequency ramp + exponential fade. The envelope
 *  ends at (near) zero so there is never a click at note-off. */
function blip(freqFrom: number, freqTo: number, seconds: number, volume: number, type: OscillatorType = 'square', delay = 0): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const c = context();
  if (!c) return;
  const t0 = c.currentTime + delay;
  blipAt(c, freqFrom, freqTo, seconds, volume, type, t0);
}

function blipAt(c: AudioContext, freqFrom: number, freqTo: number, seconds: number, volume: number, type: OscillatorType, t0: number): void {
  try {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t0);
    if (freqTo !== freqFrom) {
      osc.frequency.linearRampToValueAtTime(freqTo, t0 + seconds);
    }
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + seconds);
  } catch {
    /* an unsupported browser just stays quiet */
  }
}

/** The press chirp — the same 700→1050Hz rise the old press.wav held. */
export const playPress = () => blip(700, 1050, 0.09, 0.12);
/** The selection tick — the old select.wav's 1500Hz blip. */
export const playSelect = () => blip(1500, 1500, 0.04, 0.08);

// ---- Battle SFX (Tyson turn-based beta) — same Web Audio path; web-only,
// settings-gated, mixes with background audio (no media element). ----
/** A dull impact thud. */
export const playHit = () => blip(220, 90, 0.14, 0.14, 'triangle');
/** A bright crunchy crit — thud + high sparkle. */
export const playCrit = () => { blip(260, 80, 0.16, 0.16, 'square'); blip(1400, 1900, 0.12, 0.08, 'square', 0.02); };
/** A soft rising heal. */
export const playHeal = () => blip(520, 880, 0.16, 0.09, 'sine');
/** A rising victory arpeggio. */
export const playVictory = () => { blip(523, 523, 0.12, 0.1, 'square', 0); blip(659, 659, 0.12, 0.1, 'square', 0.12); blip(784, 784, 0.12, 0.1, 'square', 0.24); blip(1046, 1046, 0.22, 0.1, 'square', 0.36); };
/** A falling defeat tone. */
export const playDefeat = () => { blip(392, 392, 0.16, 0.09, 'sawtooth', 0); blip(311, 311, 0.16, 0.09, 'sawtooth', 0.16); blip(233, 233, 0.3, 0.09, 'sawtooth', 0.32); };

// ---- Progression SFX (Tyson 2026-07-17: "more retro 8-bit sounds") — the
// reward moments of the core loop. Same Web Audio path; web-only, gated. ----
/** The coin "bling" — banking a set. The classic quick B5→E6 pickup. */
export const playCoin = () => { blip(988, 988, 0.05, 0.1, 'square', 0); blip(1319, 1319, 0.14, 0.1, 'square', 0.05); };
/** A personal-record fanfare — brighter than a coin, with a sparkle tail. */
export const playPr = () => { blip(1046, 1046, 0.06, 0.1, 'square', 0); blip(1319, 1319, 0.06, 0.1, 'square', 0.06); blip(1568, 1568, 0.08, 0.1, 'square', 0.12); blip(2093, 2637, 0.2, 0.07, 'square', 0.2); };
/** Level up — a triumphant rising major run, the final note held. */
export const playLevelUp = () => { const n = [523, 659, 784, 1046, 1319]; n.forEach((f, i) => blip(f, f, i === 4 ? 0.32 : 0.11, 0.1, 'square', i * 0.09)); };
/** Power-up — a fast stepped rise for an unlock / new character. */
export const playPowerUp = () => { const n = [330, 494, 659, 988, 1319]; n.forEach((f, i) => blip(f, f, 0.06, 0.09, 'square', i * 0.05)); };
/** A cash-register cascade for a coin purchase. */
export const playPurchase = () => { blip(1319, 1319, 0.05, 0.09, 'square', 0); blip(1047, 1047, 0.05, 0.09, 'square', 0.06); blip(1568, 1568, 0.18, 0.09, 'square', 0.12); };
/** Rest-over chime — a gentle two-tone alert (softer triangle, not the coin). */
export const playRestOver = () => { blip(784, 784, 0.12, 0.09, 'triangle', 0); blip(1046, 1046, 0.24, 0.09, 'triangle', 0.13); };
/** Workout complete — a fuller victory jingle, distinct from the battle win. */
export const playComplete = () => { const n = [523, 659, 784, 1046, 784, 1046, 1319]; n.forEach((f, i) => blip(f, f, i === 6 ? 0.36 : 0.1, 0.1, 'square', i * 0.1)); };

// ---- Per-move battle SFX (Tyson 2026-07-18, FireRed plan Phase A) — each
// move family gets its own chirp so attacks SOUND different too. ----
const MOVE_SFX: Record<string, () => void> = {
  precision_strike: () => { blip(300, 120, 0.08, 0.13, 'square'); blip(320, 130, 0.08, 0.13, 'square', 0.11); blip(340, 110, 0.1, 0.14, 'square', 0.22); },
  forge_smash: () => { blip(900, 200, 0.3, 0.1, 'sawtooth'); blip(180, 70, 0.16, 0.16, 'square', 0.4); }, // whoosh → clang
  colossal_pressure: () => { for (let i = 0; i < 3; i++) { blip(620, 620, 0.14, 0.11, 'triangle', i * 0.28); blip(920, 920, 0.14, 0.11, 'triangle', i * 0.28 + 0.14); } }, // LUNK ALARM siren
  rapid_strike: () => { blip(1400, 2200, 0.06, 0.08, 'square'); blip(1400, 2200, 0.06, 0.08, 'square', 0.1); blip(1500, 2400, 0.07, 0.09, 'square', 0.2); }, // speed blitz zips
  velocity_crash: () => { blip(500, 2400, 0.3, 0.1, 'sawtooth'); blip(240, 80, 0.18, 0.15, 'square', 0.34); },
  twin_slash: () => { blip(2400, 900, 0.09, 0.1, 'sawtooth'); blip(2600, 1000, 0.09, 0.1, 'sawtooth', 0.13); },
  cut_deep: () => blip(2600, 700, 0.14, 0.11, 'sawtooth'),
  final_shred: () => { blip(2600, 800, 0.1, 0.11, 'sawtooth'); blip(2800, 900, 0.1, 0.11, 'sawtooth', 0.12); blip(200, 70, 0.2, 0.15, 'square', 0.28); },
  apex_execution: () => { blip(700, 90, 0.34, 0.13, 'sawtooth'); blip(140, 60, 0.22, 0.17, 'square', 0.4); },
  titan_breaker: () => { blip(600, 80, 0.3, 0.14, 'sawtooth'); blip(120, 50, 0.26, 0.18, 'square', 0.36); },
  perfect_form: () => { blip(880, 1320, 0.16, 0.08, 'sine'); blip(1100, 1760, 0.18, 0.07, 'sine', 0.14); },
  counter_pose: () => blip(500, 740, 0.16, 0.09, 'triangle'),
  iron_guard: () => { blip(400, 400, 0.07, 0.12, 'square'); blip(300, 300, 0.12, 0.11, 'square', 0.09); },
  overclock: () => { blip(800, 1600, 0.1, 0.08, 'square'); blip(900, 1800, 0.1, 0.08, 'square', 0.12); },
  second_wind: () => blip(420, 900, 0.3, 0.08, 'sine'),
  shadow_step: () => blip(700, 220, 0.2, 0.08, 'triangle'),
  recover: () => { blip(520, 880, 0.14, 0.08, 'sine'); blip(660, 1040, 0.16, 0.08, 'sine', 0.12); },
  // Battle items (Phase C): a gulp-gulp swallow, and the pre-workout jolt.
  item_protein_shake: () => { blip(300, 180, 0.1, 0.1, 'sine'); blip(320, 190, 0.1, 0.1, 'sine', 0.14); blip(520, 900, 0.16, 0.08, 'sine', 0.3); },
  item_pre_workout: () => { const n = [440, 660, 880, 1320]; n.forEach((f, i) => blip(f, f * 1.2, 0.07, 0.09, 'square', i * 0.06)); },
};
/** The move's own sound — falls back to the press chirp for unknown ids. */
export const playMoveFx = (moveId: string) => (MOVE_SFX[moveId] ?? playPress)();

/** A soft low-HP heartbeat — two muffled thumps (FireRed's red-zone tension). */
export const playHeartbeat = () => { blip(85, 60, 0.11, 0.1, 'sine'); blip(70, 50, 0.13, 0.08, 'sine', 0.16); };
