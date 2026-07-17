import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { ORIGIN_FLAGS, useClassification, useOriginStatus } from '@/data/origin';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * ORIGIN SCAN PROMPT (Tyson 2026-07-17): from now on, every sign-in without an
 * assigned Origin asks for an EvoGuide scan — the scan feeds the Evo Rating,
 * the rating crosses the confidence gate, and the Origin reveal on the Forge
 * assigns the character. Once per app launch, never blocking: LATER dismisses.
 */
let promptedThisLaunch = false;

/** Once per DAY, not per launch (Tyson's phone, 2026-07-18): the modal was
 *  fading in 4s into EVERY launch — over whatever the athlete was doing,
 *  blocking every tap until dismissed. Mid-navigation that IS the "freeze
 *  and flash". The gold FORGE YOUR ORIGIN button on the Home podium is the
 *  always-on path; this modal is just the daily nudge. */
const PROMPT_DAY_KEY = 'evoforge-origin-prompt-day';
/** The stored value carries the account state alongside the date: a
 *  RE-ASSESSMENT (migration_status flips back to needs_assessment after an
 *  origin reset, e.g. classification v4's global re-choice) must re-prompt
 *  the SAME day — "the origin scan has not come up" (Tyson, 2026-07-17). */
function promptStamp(statusKey: string): string {
  return `${new Date().toDateString()}|${statusKey}`;
}
function alreadyPromptedToday(statusKey: string): boolean {
  try {
    return globalThis.localStorage?.getItem(PROMPT_DAY_KEY) === promptStamp(statusKey);
  } catch {
    return false;
  }
}
function markPromptedToday(statusKey: string): void {
  try {
    globalThis.localStorage?.setItem(PROMPT_DAY_KEY, promptStamp(statusKey));
  } catch {
    /* storage unavailable — fall back to once-per-launch */
  }
}

export function OriginScanPrompt() {
  const colors = useThemeColors();
  const status = useOriginStatus();
  const [open, setOpen] = useState(false);

  const eligible =
    ORIGIN_FLAGS.originRevealEnabled && status.data != null && status.data.origin_path == null;
  const statusKey = `${status.data?.origin_path ?? 'none'}:${status.data?.migration_status ?? ''}`;
  // When the last scan already classifies (the raw ±5 rule holding a CHOICE
  // open), the nudge points at the Forge reveal, not another scan.
  const classification = useClassification(eligible);
  const choiceReady = classification.data?.ok === true;

  useEffect(() => {
    if (!eligible || promptedThisLaunch) return;
    // Give the tutorial overlay / boot moment the first few seconds.
    if (alreadyPromptedToday(statusKey)) return;
    // NEVER stack on the tutorial (Tyson's phone, 2026-07-18): the two modals
    // fought — the prompt's buttons landed under the tutorial overlay, taps
    // died, and page changes flashed the pair. A fresh install replays the
    // tutorial, so this collision hit every reinstall. The prompt waits for
    // its own NEXT day once the tutorial has been completed.
    let live = true;
    const t = setTimeout(() => {
      void AsyncStorage.getItem('evoforge-tutorial-done-v1').then((done) => {
        if (!live || !done) return;
        promptedThisLaunch = true;
        markPromptedToday(statusKey);
        setOpen(true);
      });
    }, 4000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [eligible, statusKey]);

  if (!open) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View className="flex-1 items-center justify-center px-s5" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }}>
        <View className="w-full max-w-[360px] rounded-xl border p-s5" style={{ borderColor: `${colors.legendary}59`, backgroundColor: colors.surface }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.legendary, letterSpacing: 2, ...pixelFont(false) }}>
            ✦ DISCOVER YOUR ORIGIN
          </Text>
          <Text className="mt-s2 text-sm text-text">
            {choiceReady
              ? 'Your scores are in — your Origin is waiting to be chosen on the Forge. The pick is yours, and permanent.'
              : 'Run an EvoGuide scan and EvoForge will read your physique, assign your Origin Path, and forge your champion from who you actually are.'}
          </Text>
          {choiceReady ? null : (
            <Text className="mt-s1 text-2xs text-text-mute">
              Two photos and your bodyweight — the waist is optional. Your current champion and
              progress will not change.
            </Text>
          )}
          <View className="mt-s4 gap-s2">
            <NeonButton
              title={choiceReady ? 'CHOOSE MY ORIGIN' : 'SCAN NOW'}
              pixel
              onPress={() => {
                setOpen(false);
                router.push((choiceReady ? '/avatar' : '/evo-scan') as never);
              }}
              testID="origin-scan-now"
            />
            <NeonButton title="LATER" variant="ghost" onPress={() => setOpen(false)} testID="origin-scan-later" />
          </View>
        </View>
      </View>
    </Modal>
  );
}
