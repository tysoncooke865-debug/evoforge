/**
 * RETRO SFX (Tyson, 2026-07-16) — synthesized square-wave blips (see the
 * generation recipe in HANDOVER; the WAVs are ORIGINAL, no licensing).
 *
 * WEB ONLY for now: HTML5 Audio, resolved through expo-asset exactly like
 * the sprite strips. Native stays silent until a native build brings
 * expo-audio. Always triggered by a user gesture (press handlers), so
 * autoplay policies never block. Gated on the settings toggle; a failed
 * play is swallowed — sound is seasoning, never an error surface.
 */

import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

import { useSettingsStore } from '@/state/settings-store';

type SfxName = 'press' | 'select';

const SOURCES: Record<SfxName, number> = {
  press: require('../../assets/sfx/press.wav'),
  select: require('../../assets/sfx/select.wav'),
};

const VOLUME: Record<SfxName, number> = { press: 0.3, select: 0.22 };

const players: Partial<Record<SfxName, HTMLAudioElement>> = {};

function play(name: SfxName): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.Audio === 'undefined') return;
  if (!useSettingsStore.getState().soundEnabled) return;
  try {
    let audio = players[name];
    if (!audio) {
      audio = new window.Audio(Asset.fromModule(SOURCES[name]).uri);
      audio.volume = VOLUME[name];
      audio.preload = 'auto';
      players[name] = audio;
    }
    // Rewind so rapid presses each blip instead of queueing silently.
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* an unsupported browser just stays quiet */
  }
}

export const playPress = () => play('press');
export const playSelect = () => play('select');
