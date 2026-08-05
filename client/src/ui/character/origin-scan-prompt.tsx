import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import { ORIGIN_FLAGS, useClassification, useOriginStatus } from '@/data/origin';
import { usePhotoPrefs } from '@/data/photo-prefs';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * ORIGIN PROMPT — the nudge for an athlete who has not chosen a character.
 *
 * IT NO LONGER LEADS WITH A PHOTOGRAPH (ONBOARDING V3, spec §4). It used to
 * open with "run an EvoGuide scan" and send every origin-less athlete to the
 * camera, because that was how the Origin got assigned. Assigning a
 * character from a photo is the one thing this flow must never do: someone
 * short on confidence reads it as the app deciding they are not lean or
 * muscular enough to be the character they liked. The nudge now points at
 * the CHOICE — the Forge, where the candidate cards live — and the scan is
 * one optional way to sharpen a rating, offered elsewhere and on its own
 * terms.
 *
 * It also respects `photo_prompts_disabled`, because a prompt that mentions
 * photos to somebody who said "never again" is the promise being broken by
 * the second surface rather than the first.
 *
 * Once per DAY, never blocking: LATER dismisses.
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
  // HOME ONLY (Tyson, 2026-07-19): it's mounted globally, so it used to fade in
  // over WHATEVER tab you were on. Confine it to Home — the one place the
  // always-visible "FORGE YOUR ORIGIN" button also lives — so it never
  // interrupts Train/Social/Arena mid-task.
  const pathname = usePathname();
  const onHome = pathname === '/';

  const photo = usePhotoPrefs();
  const eligible =
    ORIGIN_FLAGS.originRevealEnabled && status.data != null && status.data.origin_path == null;
  const statusKey = `${status.data?.origin_path ?? 'none'}:${status.data?.migration_status ?? ''}`;
  // When the last scan already classifies (the raw ±5 rule holding a CHOICE
  // open), the nudge points at the Forge reveal, not another scan.
  const classification = useClassification(eligible);
  const choiceReady = classification.data?.ok === true;

  useEffect(() => {
    if (!eligible || !onHome || promptedThisLaunch) return;
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
  }, [eligible, onHome, statusKey]);

  if (!open || !onHome) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View className="flex-1 items-center justify-center px-s5" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }}>
        <View className="w-full max-w-[360px] rounded-xl border p-s5" style={{ borderColor: `${colors.legendary}59`, backgroundColor: colors.surface }}>
          <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.legendary, letterSpacing: 2, ...pixelFont(false) }}>
            ✦ DISCOVER YOUR ORIGIN
          </Text>
          <Text className="mt-s2 text-sm text-text">
            Your Origin is waiting to be chosen on the Forge. Pick who you want to become — the
            choice is yours, and it is permanent.
          </Text>
          {/* The scan is mentioned as an OPTION and only to athletes who have
              not opted out of photo prompts. It is never the way in. */}
          {photo.mayAsk && !choiceReady ? (
            <Text className="mt-s1 text-2xs text-text-mute">
              An optional physique scan can sharpen the recommendation, but it is not needed to
              choose — and your champion is never assigned from a photograph.
            </Text>
          ) : null}
          <View className="mt-s4 gap-s2">
            <NeonButton
              title="CHOOSE MY ORIGIN"
              pixel
              onPress={() => {
                setOpen(false);
                router.push('/avatar' as never);
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
