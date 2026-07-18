import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { runAiBodyfat, type BodyfatResult } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useCurrentStats } from '@/data/use-current-stats';
import { massSplit } from '@/domain/oracle';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';
import { type ScanState } from '@/ui/train/scan-frame';
import { BodyScanner } from '@/ui/oracle/body-scanner';
import { BodyfatScale } from '@/ui/oracle/bodyfat-scale';
import { ConditionsConfirm } from '@/ui/oracle/conditions-confirm';
import { useCountUp, useReveal } from '@/ui/oracle/oracle-anim';

/**
 * ORACLE_REDESIGN — AI BODY FAT ESTIMATE. The flow is the real two-photo
 * estimate→confirm path, unchanged; the surface gains the scanner, the
 * count-up reveal, the four-band scale, and the lean/fat-mass split (shown
 * only when a real bodyweight is known — never a fabricated frame).
 */
export function BodyfatScanCard() {
  const colors = useThemeColors();
  const current = useCurrentStats();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [photos, setPhotos] = useState<(string | null)[]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [provisional, setProvisional] = useState<BodyfatResult | null>(null);
  const [lighting, setLighting] = useState('neutral');
  const [pump, setPump] = useState('none');
  const [result, setResult] = useState<BodyfatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (i: number) => {
    const { pickPhoto } = await import('@/data/ai');
    const uri = await pickPhoto();
    if (uri) setPhotos((prev) => prev.map((p, j) => (j === i ? uri : p)));
  };

  const scanContext = () => ({
    height_cm: current.heightCm ?? 0,
    weight_kg: current.bodyweightKg ?? 77,
  });

  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null); // a fresh scan re-opens the confirm gate (result never clears otherwise)
    const { result: r, error: err } = await runAiBodyfat(images, scanContext(), { save: false });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setProvisional(r);
    setLighting(String(r?.conditions?.lighting ?? 'neutral'));
    setPump(String(r?.conditions?.pump ?? 'none'));
  };

  const finalize = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0 || !provisional) return;
    const corrected =
      lighting !== String(provisional.conditions?.lighting ?? 'neutral') ||
      pump !== String(provisional.conditions?.pump ?? 'none');
    setBusy(true);
    setError(null);
    const { result: r, error: err } = await runAiBodyfat(images, scanContext(), {
      save: true,
      confirmedConditions: corrected ? { lighting, pump } : undefined,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setResult(r);
    setProvisional(null);
    setPhotos([null, null]);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ['bodyfat_series', session?.user.id ?? null] });
    queryClient.invalidateQueries({ queryKey: ['bodyfat_history', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'BODY FAT ESTIMATED', subtitle: 'Saved to your log' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const confirming = provisional !== null && result === null;
  const state: ScanState = confirming && !busy ? 'confirm' : bodyfatScanState(busy, error, result !== null, anyPhoto);

  return (
    <GlowCard glow={state === 'complete' ? colors.success : colors.accent}>
      <SectionLabel size='lg'>AI BODY FAT ESTIMATE</SectionLabel>
      <Text className="mb-s3 text-2xs text-text-mute">
        Front and back photos in similar conditions. Optional — it sharpens your Size and Aesthetics
        evidence.
      </Text>
      <BodyScanner
        labels={['FRONT', 'BACK']}
        photos={photos}
        onPick={(i) => void pick(i)}
        state={state}
      />
      <View className="mb-s4" />
      {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
      {confirming ? (
        <ConditionsConfirm
          estimate={provisional?.conditions ?? null}
          lighting={lighting}
          pump={pump}
          onLighting={setLighting}
          onPump={setPump}
          corrected={
            lighting !== String(provisional?.conditions?.lighting ?? 'neutral') ||
            pump !== String(provisional?.conditions?.pump ?? 'none')
          }
          busy={busy}
          onConfirm={() => void finalize()}
        />
      ) : (
        <NeonButton
          title="ESTIMATE BODY FAT"
          onPress={() => void run()}
          disabled={!anyPhoto}
          busy={busy}
          testID="run-bodyfat"
        />
      )}

      {result ? <BodyfatReveal result={result} bodyweightKg={current.bodyweightKg} /> : null}
    </GlowCard>
  );
}

function BodyfatReveal({ result, bodyweightKg }: { result: BodyfatResult; bodyweightKg: number | null }) {
  const colors = useThemeColors();
  const phase = useReveal(true);
  const done = phase === 'done';
  const shown = useCountUp(result.bf_mid, done, 900);
  const split = massSplit(bodyweightKg, result.bf_mid);

  if (!done) {
    return (
      <View
        className="mt-s4 items-center rounded-xl p-s5"
        style={{ borderWidth: 1, borderColor: `${colors.success}45`, backgroundColor: `${colors.success}0f` }}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 14, letterSpacing: 3, color: phase === 'complete' ? colors.success : colors.accent, ...pixelFont() }}
        >
          {phase === 'complete' ? '✓ ANALYSIS COMPLETE' : 'SCANNING…'}
        </Text>
      </View>
    );
  }

  return (
    <View
      className="mt-s4 items-center rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: `${colors.success}45`, backgroundColor: `${colors.success}0f` }}
      testID="bodyfat-result"
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        ESTIMATED BODY FAT
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 42,
          lineHeight: 48,
          color: colors.success,
          textShadowColor: `${colors.success}99`,
          textShadowRadius: 16,
          ...pixelFont(),
        }}
      >
        {shown.toFixed(1)}%
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
      >
        RANGE {result.bf_low.toFixed(1)}–{result.bf_high.toFixed(1)}% · {String(result.confidence).toUpperCase()} CONFIDENCE
      </Text>

      <BodyfatScale bfMid={result.bf_mid} />

      {split ? (
        <View className="mt-s3 w-full flex-row" style={{ gap: 10 }}>
          <MassTile label="LEAN MASS" value={`${split.leanKg} kg`} colour={colors.accent} />
          <MassTile label="FAT MASS" value={`${split.fatKg} kg`} colour={colors.warn} />
        </View>
      ) : null}

      {result.notes ? <Text className="mt-s3 text-center text-xs text-text-dim">{result.notes}</Text> : null}
      <Text className="mt-s2 text-center text-2xs text-text-mute">
        This estimate influences your Evo Rating.
      </Text>
    </View>
  );
}

function MassTile({ label, value, colour }: { label: string; value: string; colour: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-1 items-center rounded-lg border p-s2"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(6,12,24,0.5)' }}
    >
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}
      >
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 16, color: colour, ...pixelFont() }}>
        {value}
      </Text>
    </View>
  );
}

function bodyfatScanState(busy: boolean, error: string | null, hasResult: boolean, anyPhoto: boolean): ScanState {
  if (busy) return 'analysing';
  if (error) return 'error';
  if (hasResult) return 'complete';
  if (anyPhoto) return 'ready';
  return 'idle';
}
