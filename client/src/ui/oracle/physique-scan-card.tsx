import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { runAiPhysique, type PhysiqueResult } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useAvatarData } from '@/data/use-avatar-data';
import { useToastStore } from '@/state/toast-store';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';
import { type ScanState } from '@/ui/train/scan-frame';
import { BodyScanner } from '@/ui/oracle/body-scanner';
import { ConditionsConfirm } from '@/ui/oracle/conditions-confirm';
import { EvolutionImpactCard } from '@/ui/oracle/evolution-impact-card';
import { PhysiqueReveal } from '@/ui/oracle/physique-result';

/**
 * ORACLE_REDESIGN — AI PHYSIQUE ANALYSIS, the page's headline system. The
 * flow is unchanged and REAL: estimate pass (save:false, nothing persisted) →
 * confirm conditions → finalize (cache hit or re-judge, saves physique_ratings
 * under the caller's JWT). Photos live in state only and drop the moment the
 * verdict saves. The redesign is the surface: a premium scanner, an animated
 * reveal, and the honest Evolution Impact beneath.
 */
export function PhysiqueScanCard() {
  const colors = useThemeColors();
  const { summary, stats } = useAvatarData();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const [provisional, setProvisional] = useState<PhysiqueResult | null>(null);
  const [lighting, setLighting] = useState('neutral');
  const [pump, setPump] = useState('none');
  const [result, setResult] = useState<PhysiqueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (i: number) => {
    const { pickPhoto } = await import('@/data/ai');
    const uri = await pickPhoto();
    if (uri) setPhotos((prev) => prev.map((p, j) => (j === i ? uri : p)));
  };

  const scanStats = () => ({
    level: summary.level,
    total_sets: summary.totalSets,
    bench_e1rm: stats.benchE1rm,
    squat_e1rm: stats.squatE1rm,
    bodyweight: stats.bodyweight,
  });

  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null); // a fresh scan re-opens the confirm gate (result never clears otherwise)
    const { result: r, error: err } = await runAiPhysique(images, scanStats(), { save: false });
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
    const { result: r, error: err } = await runAiPhysique(images, scanStats(), {
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
    setPhotos([null, null, null]); // saved — NOW the photos drop
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    queryClient.invalidateQueries({ queryKey: ['physique_ratings', session?.user.id ?? null] });
    queryClient.invalidateQueries({ queryKey: ['physique_history', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'PHYSIQUE RATED', subtitle: 'Saved to your history' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const confirming = provisional !== null && result === null;
  const state: ScanState = confirming && !busy ? 'confirm' : physiqueScanState(busy, error, result !== null, anyPhoto);

  return (
    <>
      <GlowCard glow={state === 'complete' ? colors.success : colors.accent}>
        <SectionLabel size='lg'>AI PHYSIQUE ANALYSIS</SectionLabel>
        <Text className="mb-s3 text-2xs text-text-mute">
          Upload three clear photos in good lighting — shirtless, relaxed pose. The Oracle rates
          your frame and never stores the images.
        </Text>
        <BodyScanner
          labels={['FRONT', 'SIDE', 'BACK']}
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
            title="RUN ANALYSIS"
            onPress={() => void run()}
            disabled={!anyPhoto}
            busy={busy}
            size="hero"
            testID="run-physique"
          />
        )}

        {result ? <PhysiqueReveal result={result} /> : null}
      </GlowCard>

      {/* The honest progression tie-in — shown only when a real Evo Rating
          exists, and only after a fresh verdict this session. */}
      {result ? <EvolutionImpactCard /> : null}
    </>
  );
}

function physiqueScanState(busy: boolean, error: string | null, hasResult: boolean, anyPhoto: boolean): ScanState {
  if (busy) return 'analysing';
  if (error) return 'error';
  if (hasResult) return 'complete';
  if (anyPhoto) return 'ready';
  return 'idle';
}
