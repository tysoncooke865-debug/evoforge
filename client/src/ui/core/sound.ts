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
function blip(freqFrom: number, freqTo: number, seconds: number, volume: number): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const c = context();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freqFrom, c.currentTime);
    if (freqTo !== freqFrom) {
      osc.frequency.linearRampToValueAtTime(freqTo, c.currentTime + seconds);
    }
    const gain = c.createGain();
    gain.gain.setValueAtTime(volume, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + seconds);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + seconds);
  } catch {
    /* an unsupported browser just stays quiet */
  }
}

/** The press chirp — the same 700→1050Hz rise the old press.wav held. */
export const playPress = () => blip(700, 1050, 0.09, 0.12);
/** The selection tick — the old select.wav's 1500Hz blip. */
export const playSelect = () => blip(1500, 1500, 0.04, 0.08);
