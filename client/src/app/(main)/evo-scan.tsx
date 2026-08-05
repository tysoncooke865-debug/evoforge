/**
 * PROGRESSION_OVERHAUL P6 — the guided Evo Scan (spec §15C). Front/side/
 * back photos + bodyweight + waist, judged server-side (evo-scan edge
 * function), photos NEVER persisted. Large changes come back
 * pending_confirmation and this screen explains the confirmation scan.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { pickPhoto } from '@/data/ai';
import { track } from '@/data/analytics';
import { usePhotoPrefs, useSavePhotoPrefs } from '@/data/photo-prefs';
import { progressionFeatures } from '@/data/progression/features';
import { awardEvoScan } from '@/data/progression/award-xp';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { PATH_NAMES } from '@/data/origin';
import { useToastStore } from '@/state/toast-store';
import { playPowerUp } from '@/ui/core/sound';
import { supabase } from '@/data/supabase';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { PhotoConsentSheet } from '@/ui/progression/physique-baseline-card';

/* Neutral and clinical, never appearance-focused. "Stand naturally, no
   flexing" is the first line on purpose: the guidance an athlete reads
   before photographing themselves sets whether this is a measurement or a
   performance (docs/ONBOARDING_V3_SPEC.md §6). There is deliberately no
   model photo beside these — a lean example body turns a private
   measurement into a comparison. */
const GUIDE = [
  'Stand naturally. No flexing is required.',
  'Similar lighting and camera height each scan',
  'Neutral background, no filters or editing',
  'Consistent relaxed pose — no exaggerated twisting',
  'Ideally not straight after training (no pump)',
];

const SLOTS = ['FRONT', 'SIDE', 'BACK'] as const;

export default function EvoScanScreen() {
  const colors = useThemeColors();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const prefs = usePhotoPrefs();
  const savePrefs = useSavePhotoPrefs();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [bodyweight, setBodyweight] = useState('');
  const [waist, setWaist] = useState('');
  /* HEIGHT, ASKED HERE BECAUSE HERE IS WHERE IT MATTERS (onboarding v3).
     v3 stopped demanding height at signup, so a scan can be the first time
     the app needs one — and it feeds the size score's FFMI directly. The
     field appears ONLY when the profile has none, which is progressive
     disclosure rather than a permanently longer form. */
  const storedHeight = pyFloat(String(profile.data?.height_cm ?? '')) ?? 0;
  const [height, setHeight] = useState('');
  const needsHeight = !profile.isPending && storedHeight <= 0;
  const heightValue = needsHeight ? (pyFloat(height) ?? 0) : storedHeight;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!progressionFeatures.monthlyScansEnabled) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="EVO RATING" title="EVO SCAN" onBack={() => router.back()} />
        <Text className="text-sm text-text-dim">Guided Evo Scans are not enabled yet.</Text>
      </ScreenShell>
    );
  }

  const pick = async (i: number) => {
    const uri = await pickPhoto();
    if (uri) setPhotos((p) => p.map((v, j) => (j === i ? uri : v)));
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const images = photos.filter((p): p is string => p !== null);
      const { data, error: fnError } = await supabase.functions.invoke('evo-scan', {
        body: {
          images,
          bodyweightKg: pyFloat(bodyweight) ?? 0,
          // Waist is optional (Tyson 2026-07-17): 0 = the AI estimates it
          // from the photos + height + bodyweight server-side.
          waistCm: pyFloat(waist) ?? 0,
          heightCm: heightValue,
          sex: profile.data?.sex === 'female' ? 'female' : 'male',
        },
      });
      const payload = data as { result?: { id?: string; status?: string; sizeScore?: number; aestheticsScore?: number }; error?: string } | null;
      if (fnError || !payload?.result) {
        // Surface the function's REAL message: on a non-2xx, supabase-js hides
        // the body behind error.context (the data/ai.ts lesson) — without this
        // every failure read as the useless "non-2xx status code".
        let msg = payload?.error ?? null;
        const ctx = (fnError as { context?: Response } | null)?.context;
        if (!msg && ctx && typeof ctx.json === 'function') {
          const body = await ctx.json().catch(() => null);
          msg = body?.error ?? null;
        }
        setError(msg ?? fnError?.message ?? 'The scan failed.');
        return;
      }
      const r = payload.result;
      if (r.id) void awardEvoScan(supabase, r.id);
      // Asked once, kept: the next scan and every FFMI reading get it free.
      if (needsHeight && heightValue > 0 && userId) {
        void supabase.from('profile').update({ height_cm: heightValue }).eq('user_id', userId);
      }
      // The first successful scan IS the private baseline. Only the DATE is
      // recorded — the photos are analysed and discarded, as always.
      if (!prefs.hasBaseline) savePrefs.mutate({ baseline: true });
      track('photo_baseline_completed', {
        first_baseline: !prefs.hasBaseline,
        photos: images.length,
        status: r.status ?? 'confirmed',
      });
      void queryClient.invalidateQueries({ queryKey: ['physique_assessments'] });
      // ORIGIN FROM THE SCAN (042), AMENDED by the raw ±5 rule (Tyson,
      // 2026-07-17, migration 046): the scan auto-claims ONLY a clear single
      // winner (requires_choice false — includes shredder_auto). Close
      // scores are THE PLAYER'S decision: never auto-claim; hand over to the
      // Forge reveal, where the choice buttons live. The 09:34 incident:
      // this block claimed Titan 300ms after a scan whose classification
      // said requires_choice — the choice UI never got a chance.
      try {
        const { data: cls } = await supabase.rpc('classify_evo_path');
        const c = cls as { ok?: boolean; recommended_path?: string; requires_choice?: boolean } | null;
        if (c?.ok && c.recommended_path && c.requires_choice !== true) {
          const { data: award } = await supabase.rpc('assign_origin_path', { p_path: c.recommended_path });
          if ((award as { ok?: boolean } | null)?.ok) {
            playPowerUp();
            useToastStore.getState().push({
              kind: 'achievement',
              title: 'ORIGIN FORGED',
              subtitle: `${PATH_NAMES[c.recommended_path] ?? c.recommended_path} — your champion awaits on Home`,
            });
            void queryClient.invalidateQueries({ queryKey: ['origin_status'] });
            void queryClient.invalidateQueries({ queryKey: ['user_paths'] });
            router.replace('/' as never);
            return;
          }
        } else if (c?.ok && c.requires_choice === true) {
          void queryClient.invalidateQueries({ queryKey: ['origin_classification'] });
          useToastStore.getState().push({
            kind: 'achievement',
            title: 'YOUR SCORES ARE CLOSE',
            subtitle: 'Choose your Origin on the Forge — the decision is yours, and permanent.',
          });
          router.replace('/avatar' as never);
          return;
        }
      } catch {
        /* origin already set or not yet classifiable — the scan still counts */
      }
      setOutcome(
        r.status === 'pending_confirmation'
          ? 'BIG CHANGE DETECTED — this result is pending. Take a confirmation scan within 7 days to lock it in.'
          : `Scan confirmed — Size ${Math.floor(r.sizeScore ?? 0)}, Aesthetics ${Math.floor(r.aestheticsScore ?? 0)}. Your next Evo Review will apply it.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The scan failed.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    photos.filter(Boolean).length >= 2 &&
    (pyFloat(bodyweight) ?? 0) > 0 &&
    (!needsHeight || heightValue >= 100) &&
    !busy;

  /* CONSENT BEFORE CAMERA, at the surface itself rather than at each
     entrance to it. A gate that lives on the button can be walked around by
     the next deep link; a gate that lives here cannot. */
  if (prefs.ready && !prefs.hasConsent) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="EVO RATING" title="EVO SCAN" onBack={() => router.back()} />
        <PhotoConsentSheet
          open
          onCancel={() => router.back()}
          onAgree={() => savePrefs.mutate({ consent: true })}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader kicker="EVO RATING" title="EVO SCAN" onBack={() => router.back()} />

      <GlowCard padding={16}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          GUIDED SCAN
        </Text>
        {GUIDE.map((g) => (
          <Text key={g} className="mt-s1 text-xs text-text-dim">
            · {g}
          </Text>
        ))}
        <Text className="mt-s2 text-2xs text-text-mute">
          Photos are judged and DISCARDED — never stored. Official scans unlock every 28 days.
        </Text>
      </GlowCard>

      <View className="flex-row" style={{ gap: 8 }}>
        {SLOTS.map((label, i) => (
          <Pressable
            key={label}
            onPress={() => void pick(i)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${label.toLowerCase()} photo`}
            testID={`scan-slot-${label.toLowerCase()}`}
            className="items-center justify-center rounded-md border"
            style={{
              flex: 1,
              height: 96,
              borderColor: photos[i] ? colors.success : colors.border,
              backgroundColor: photos[i] ? 'rgba(52,211,153,0.08)' : colors['surface-2'],
            }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 0, color: photos[i] ? colors.success : colors['text-dim'], ...pixelFont() }}>
              {photos[i] ? '✓ ' : '+ '}
              {label}
            </Text>
            <Text className="text-2xs text-text-mute">{i === 2 ? 'optional' : 'required'}</Text>
          </Pressable>
        ))}
      </View>

      {needsHeight ? (
        <View>
          <TextInput
            className="min-h-[48px] rounded-xl border bg-surface-2 px-s3 text-base text-text"
            style={{ borderColor: colors.border }}
            placeholder="Height (cm)"
            placeholderTextColor="#64758f"
            keyboardType="numeric"
            value={height}
            onChangeText={setHeight}
            testID="scan-height"
          />
          <Text className="mt-s1 text-2xs text-text-mute">
            Asked once. Height is what turns your bodyweight into a size score — without it the
            physique reading is a guess.
          </Text>
        </View>
      ) : null}

      <View className="flex-row" style={{ gap: 8 }}>
        <TextInput
          className="min-h-[48px] flex-1 rounded-xl border bg-surface-2 px-s3 text-base text-text"
          style={{ borderColor: colors.border }}
          placeholder="Bodyweight (kg)"
          placeholderTextColor="#64758f"
          keyboardType="numeric"
          value={bodyweight}
          onChangeText={setBodyweight}
          testID="scan-bodyweight"
        />
        <TextInput
          className="min-h-[48px] flex-1 rounded-xl border bg-surface-2 px-s3 text-base text-text"
          style={{ borderColor: colors.border }}
          placeholder="Waist cm · optional (AI estimates)"
          placeholderTextColor="#64758f"
          keyboardType="numeric"
          value={waist}
          onChangeText={setWaist}
          testID="scan-waist"
        />
      </View>

      <NeonButton title="RUN OFFICIAL SCAN" pixel size="hero" disabled={!canSubmit} busy={busy} onPress={() => void submit()} testID="scan-submit" />

      {outcome ? (
        <GlowCard glow={colors.success} padding={16}>
          <Text className="text-sm text-text">{outcome}</Text>
          <View className="mt-s2">
            <NeonButton title="BACK TO EVO RATING" variant="ghost" pixel onPress={() => router.push('/evo' as never)} testID="scan-done" />
          </View>
        </GlowCard>
      ) : null}
      {error ? <Text className="text-xs" style={{ color: colors.danger }}>{error}</Text> : null}
    </ScreenShell>
  );
}
