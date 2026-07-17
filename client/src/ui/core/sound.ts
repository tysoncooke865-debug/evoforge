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


// ---- Synthesis kit v2 (Tyson: "improve the sounds") — layered recipes over
// three voices: tonal blips, FILTERED WHITE NOISE (air, impacts, crowd) and a
// SUB-BASS THUD (the weight of iron on rubber). Still zero assets, still
// mixes with background audio. ----

let noiseBuf: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A filtered white-noise burst — hiss, air, crashes, camera clicks. */
function noise(
  seconds: number,
  volume: number,
  opts: { type?: BiquadFilterType; freq?: number; freqTo?: number; q?: number; delay?: number } = {}
): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const c = context();
  if (!c) return;
  try {
    const t0 = c.currentTime + (opts.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = opts.type ?? 'lowpass';
    filter.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.freqTo != null) filter.frequency.linearRampToValueAtTime(opts.freqTo, t0 + seconds);
    filter.Q.value = opts.q ?? 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(t0);
    src.stop(t0 + seconds);
  } catch {
    /* quiet on unsupported browsers */
  }
}

/** Sub-bass THUD — a plate hitting the platform. */
const thud = (delay = 0, vol = 0.26) => { blip(95, 40, 0.22, vol, 'sine', delay); noise(0.07, vol * 0.5, { freq: 320, delay }); };
/** Metallic CLANK — two detuned squares + a bandpass ring. */
const clank = (delay = 0, vol = 0.12) => { blip(2100, 1580, 0.09, vol, 'square', delay); blip(2260, 1660, 0.12, vol * 0.75, 'square', delay + 0.012); noise(0.05, vol * 0.6, { type: 'bandpass', freq: 3200, q: 6, delay }); };
/** Air WHOOSH — something big moving fast. */
const whoosh = (delay = 0, vol = 0.12, up = false) => noise(0.28, vol, { type: 'bandpass', freq: up ? 400 : 1500, freqTo: up ? 1900 : 480, q: 1.2, delay });
/** Impact CRASH — noise splash falling in pitch. */
const crash = (delay = 0, vol = 0.2) => noise(0.4, vol, { freq: 2500, freqTo: 480, delay });
/** Blade SHING — sharp sweep + high hiss. */
const shing = (delay = 0, vol = 0.11) => { blip(2600, 900, 0.12, vol, 'sawtooth', delay); noise(0.08, vol * 0.8, { type: 'highpass', freq: 4200, delay }); };
/** Camera shutter CLICK — the paparazzi. */
const click = (delay = 0) => noise(0.03, 0.12, { type: 'highpass', freq: 5200, delay });
/** Heart-monitor BEEP. */
const beep = (f = 880, delay = 0) => blip(f, f, 0.07, 0.09, 'sine', delay);

/** The press chirp — the same 700→1050Hz rise the old press.wav held. */
export const playPress = () => blip(700, 1050, 0.09, 0.12);
/** The selection tick — the old select.wav's 1500Hz blip. */
export const playSelect = () => blip(1500, 1500, 0.04, 0.08);

// ---- Battle SFX (Tyson turn-based beta) — same Web Audio path; web-only,
// settings-gated, mixes with background audio (no media element). ----
/** A punchy impact — noise snap + falling tone. */
export const playHit = () => { noise(0.06, 0.14, { freq: 950 }); blip(210, 80, 0.12, 0.13, 'triangle'); };
/** A crunchy crit — sub thud + band snap + high sparkle. */
export const playCrit = () => { thud(0, 0.2); noise(0.12, 0.11, { type: 'bandpass', freq: 2000, q: 2 }); blip(1500, 2100, 0.12, 0.07, 'square', 0.03); };
/** A soft rising heal. */
export const playHeal = () => blip(520, 880, 0.16, 0.09, 'sine');
/** The victory fanfare — triad chords + a crowd crash. */
export const playVictory = () => {
  const step = (f: number, d: number, len = 0.12) => { blip(f, f, len, 0.09, 'square', d); blip(f * 1.26, f * 1.26, len, 0.055, 'square', d); blip(f * 1.5, f * 1.5, len, 0.045, 'square', d); };
  step(523, 0); step(659, 0.12); step(784, 0.24); step(1046, 0.38, 0.3);
  crash(0.38, 0.12);
};
/** A falling defeat tone, ending on a heavy floor thud. */
export const playDefeat = () => { blip(392, 392, 0.16, 0.09, 'sawtooth', 0); blip(311, 311, 0.16, 0.09, 'sawtooth', 0.16); blip(233, 233, 0.3, 0.09, 'sawtooth', 0.32); thud(0.5, 0.2); };
/** The faint — a long slide down and a body-drop thud. */
export const playFaint = () => { blip(330, 55, 0.5, 0.1, 'sawtooth'); thud(0.4, 0.24); };

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
  // AESTHETIC — poses under flashbulbs.
  precision_strike: () => { click(0); blip(300, 120, 0.08, 0.12, 'square', 0.06); click(0.16); blip(330, 120, 0.09, 0.13, 'square', 0.2); noise(0.05, 0.08, { freq: 900, delay: 0.22 }); },
  perfect_form: () => { blip(660, 660, 0.1, 0.07, 'sine', 0); blip(990, 990, 0.1, 0.07, 'sine', 0.11); blip(1320, 1320, 0.18, 0.07, 'sine', 0.22); click(0.3); click(0.46); },
  counter_pose: () => { blip(360, 300, 0.14, 0.1, 'triangle'); clank(0.16, 0.08); shing(0.32, 0.05); },
  apex_execution: () => { blip(220, 1250, 0.42, 0.1, 'sawtooth'); crash(0.42, 0.2); thud(0.46, 0.22); click(0.5); click(0.62); click(0.74); },
  // TITAN — thrown and dropped iron.
  forge_smash: () => { whoosh(0, 0.14); clank(0.4, 0.14); thud(0.42, 0.24); },
  iron_guard: () => { clank(0, 0.1); clank(0.15, 0.14); blip(150, 120, 0.2, 0.12, 'triangle', 0.24); },
  colossal_pressure: () => { for (let i = 0; i < 3; i++) { blip(620, 620, 0.15, 0.12, 'sawtooth', i * 0.3); blip(930, 930, 0.15, 0.12, 'sawtooth', i * 0.3 + 0.15); } noise(0.5, 0.06, { type: 'bandpass', freq: 800, q: 2, delay: 0.1 }); },
  titan_breaker: () => { blip(160, 900, 0.4, 0.1, 'sawtooth'); thud(0.44, 0.3); clank(0.46, 0.16); crash(0.48, 0.22); thud(0.74, 0.16); },
  // APEX — pace, beeps and the sonic finish.
  rapid_strike: () => { blip(1400, 2200, 0.06, 0.08, 'square'); noise(0.03, 0.07, { type: 'highpass', freq: 4800, delay: 0.02 }); blip(1400, 2200, 0.06, 0.08, 'square', 0.11); blip(1550, 2400, 0.07, 0.09, 'square', 0.22); noise(0.04, 0.08, { type: 'highpass', freq: 4800, delay: 0.24 }); },
  overclock: () => { beep(880, 0); beep(880, 0.16); beep(990, 0.38); beep(990, 0.52); noise(0.4, 0.05, { type: 'bandpass', freq: 600, freqTo: 2400, q: 1.5, delay: 0.1 }); },
  second_wind: () => { noise(0.3, 0.07, { freq: 520 }); noise(0.34, 0.09, { freq: 760, delay: 0.4 }); blip(420, 900, 0.3, 0.07, 'sine', 0.35); },
  velocity_crash: () => { whoosh(0, 0.13, true); blip(420, 1500, 0.3, 0.09, 'sawtooth', 0.05); blip(1500, 300, 0.16, 0.09, 'sawtooth', 0.36); crash(0.5, 0.2); thud(0.52, 0.2); },
  // SHREDDER — razors.
  twin_slash: () => { shing(0); shing(0.15); },
  shadow_step: () => { blip(520, 140, 0.26, 0.09, 'triangle'); noise(0.3, 0.05, { freq: 650, freqTo: 200 }); },
  cut_deep: () => { shing(0, 0.14); blip(200, 80, 0.16, 0.14, 'square', 0.16); noise(0.1, 0.07, { type: 'highpass', freq: 5000, delay: 0.05 }); },
  final_shred: () => { shing(0); shing(0.11); shing(0.22); shing(0.33, 0.14); crash(0.5, 0.18); thud(0.56, 0.18); },
  // Shared + items.
  recover: () => { blip(520, 880, 0.14, 0.08, 'sine'); noise(0.28, 0.05, { freq: 560, delay: 0.05 }); blip(660, 1040, 0.16, 0.08, 'sine', 0.12); },
  item_protein_shake: () => { blip(250, 150, 0.1, 0.1, 'sine'); blip(240, 140, 0.1, 0.1, 'sine', 0.16); noise(0.25, 0.06, { type: 'highpass', freq: 5200, delay: 0.3 }); blip(520, 900, 0.16, 0.08, 'sine', 0.34); },
  item_pre_workout: () => { const n = [440, 660, 880, 1320]; n.forEach((f, i) => blip(f, f * 1.2, 0.07, 0.09, 'square', i * 0.06)); beep(990, 0.3); beep(1180, 0.42); noise(0.2, 0.05, { type: 'bandpass', freq: 2000, q: 3, delay: 0.28 }); },
};
/** The move's own sound — falls back to the press chirp for unknown ids. */
export const playMoveFx = (moveId: string) => (MOVE_SFX[moveId] ?? playPress)();

/** A soft low-HP heartbeat — two muffled thumps (FireRed's red-zone tension). */
export const playHeartbeat = () => { blip(85, 60, 0.11, 0.1, 'sine'); blip(70, 50, 0.13, 0.08, 'sine', 0.16); };
