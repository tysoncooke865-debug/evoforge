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
