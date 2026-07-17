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
import { progressionFeatures } from '@/data/progression/features';
import { awardEvoScan } from '@/data/progression/award-xp';
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

const GUIDE = [
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
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [bodyweight, setBodyweight] = useState('');
  const [waist, setWaist] = useState('');
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
          heightCm: pyFloat(String(profile.data?.height_cm ?? '')) ?? 0,
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
    photos.filter(Boolean).length >= 2 && (pyFloat(bodyweight) ?? 0) > 0 && !busy;

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
