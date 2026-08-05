/**
 * THE PHYSIQUE BASELINE OFFER — after value, never as a gate
 * (docs/ONBOARDING_V3_SPEC.md §6).
 *
 * Rules this component exists to enforce, all of them checkable by reading it:
 *
 *   1. It renders NOTHING until the athlete has COMPLETED a workout. Photos
 *      are asked for after value has been received, not before.
 *   2. It renders nothing if they said don't ask again. Ever.
 *   3. All four options are equally visible. The skip is not tiny grey text
 *      under an oversized glowing upload button.
 *   4. It is never styled as an overdue task, a warning or a red error. It
 *      is an offer, and an offer that looks like a chore is not optional.
 *   5. No photograph is captured until an affirmative, plain-language
 *      consent step has been through — and that step describes the ACTUAL
 *      pipeline, third party included.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useWorkoutIndex } from '@/data/hooks';
import { usePhotoPrefs, useSavePhotoPrefs } from '@/data/photo-prefs';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';

export function PhysiqueBaselineCard({ testID }: { testID?: string }) {
  const prefs = usePhotoPrefs();
  const save = useSavePhotoPrefs();
  const index = useWorkoutIndex();
  const [dismissed, setDismissed] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  const trainedDays = index.data?.byDate.size ?? 0;
  const eligible = prefs.ready && prefs.mayAsk && !prefs.hasBaseline && trainedDays > 0 && !dismissed;

  const promptedRef = useRef(false);
  useEffect(() => {
    if (!eligible || promptedRef.current) return;
    promptedRef.current = true;
    track('photo_baseline_prompted', { trained_days: trainedDays, surface: 'home' });
  }, [eligible, trainedDays]);

  if (!eligible) return null;

  return (
    <View testID={testID}>
      {/* Deliberately the plain card treatment — no glow, no accent border.
          A tertiary offer that shouts is not tertiary. */}
      <GlowCard padding={16}>
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          OPTIONAL · WHENEVER YOU’RE READY
        </Text>
        <Text
          className="mt-s1 text-text"
          allowFontScaling={false}
          style={{ fontSize: 16, letterSpacing: 0, ...pixelFont() }}
        >
          CREATE YOUR PRIVATE STARTING POINT
        </Text>
        <Text className="mt-s2 text-xs text-text-dim">
          Add front, side and back photos to calibrate the physique part of your Evo Rating and
          compare future Reforge Days.
        </Text>
        <Text className="mt-s2 text-2xs text-text-mute">
          Photos are optional. Every training feature — your rating, your PRs, your character —
          works exactly the same without them.
        </Text>

        <View className="mt-s4 gap-s2">
          <NeonButton
            title="CREATE PRIVATE BASELINE"
            onPress={() => {
              track('photo_baseline_started', { surface: 'home' });
              // Consent first, camera second. Always in that order.
              if (prefs.hasConsent) {
                router.push('/evo-scan' as never);
                return;
              }
              setConsentOpen(true);
            }}
            testID="baseline-create"
          />
          <NeonButton
            title="USE MEASUREMENTS INSTEAD"
            variant="ghost"
            onPress={() => {
              track('photo_baseline_skipped', { choice: 'measurements' });
              router.push('/log' as never);
            }}
            testID="baseline-measurements"
          />
          <NeonButton
            title="NOT NOW"
            variant="ghost"
            onPress={() => {
              track('photo_baseline_skipped', { choice: 'not_now' });
              setDismissed(true);
            }}
            testID="baseline-not-now"
          />
          <NeonButton
            title="DON’T ASK ME AGAIN"
            variant="ghost"
            onPress={() => {
              track('photo_baseline_skipped', { choice: 'never' });
              save.mutate({ promptsDisabled: true });
            }}
            testID="baseline-never"
          />
        </View>
      </GlowCard>

      <PhotoConsentSheet
        open={consentOpen}
        onCancel={() => setConsentOpen(false)}
        onAgree={() => {
          setConsentOpen(false);
          save.mutate({ consent: true });
          router.push('/evo-scan' as never);
        }}
      />
    </View>
  );
}

/**
 * The disclosure, before any camera opens.
 *
 * It describes the WHOLE pipeline, including the third party, because
 * "your photos are only seen by AI" is only sayable if it is true end to
 * end — and here the images do leave this app. What EvoForge can promise is
 * what EvoForge actually does; what OpenAI does is named as OpenAI's.
 */
export function PhotoConsentSheet({
  open,
  onAgree,
  onCancel,
}: {
  open: boolean;
  onAgree: () => void;
  onCancel: () => void;
}) {
  const colors = useThemeColors();
  if (!open) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center px-s5" style={{ backgroundColor: 'rgba(2,5,11,0.86)' }}>
        <View
          className="w-full max-w-[400px] rounded-xl border"
          style={{ borderColor: colors.border, backgroundColor: colors.surface, maxHeight: '86%' }}
        >
          <ScrollView contentContainerClassName="p-s5">
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 12, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              BEFORE YOU ADD PHOTOS
            </Text>
            <Text className="mt-s3 text-sm text-text">
              EvoForge uses these photos to estimate physique changes and update the physique part
              of your Evo Rating. They are never posted to your profile and no other athlete can
              ever see them.
            </Text>

            <Bullet>
              They are sent over an encrypted connection to EvoForge’s scan service, and on to
              OpenAI, whose model reads them and returns scores. OpenAI’s handling is governed by
              their API terms — that part is theirs, not ours, and we will not speak for it.
            </Bullet>
            <Bullet>
              EvoForge does not keep the images. What we store is the scores, and a one-way
              fingerprint of the file so the same photo is not analysed twice.
            </Bullet>
            <Bullet>
              You can delete your physique data — every score derived from a photo — in Settings,
              at any time, and we will stop asking.
            </Bullet>
            <Bullet>
              Nothing here is required. Your rating, your PRs and your character all work without
              a single photo.
            </Bullet>

            <View className="mt-s5 gap-s2">
              <NeonButton title="I AGREE — CONTINUE" onPress={onAgree} testID="photo-consent-agree" />
              <NeonButton title="CANCEL" variant="ghost" onPress={onCancel} testID="photo-consent-cancel" />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View className="mt-s3 flex-row gap-s2">
      <Text className="text-xs text-text-mute">·</Text>
      <Text className="flex-1 text-xs text-text-dim">{children}</Text>
    </View>
  );
}
