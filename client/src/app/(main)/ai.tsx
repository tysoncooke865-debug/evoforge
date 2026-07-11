import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique, type BodyfatResult, type PhysiqueResult } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { EdgeLabel } from '@/ui/hud';
import { NeonButton } from '@/ui/neon-button';
import { ScanFrame, type ScanState } from '@/ui/scan-frame';
import { ScreenHeader, SectionLabel } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * The unified AI page: physique rating and body-fat estimate together (they
 * used to be separate views; one page, one mental model). Photos live in
 * component state only, go to the Edge Function, and are dropped -- never
 * persisted, never in a store. Results are written server-side with the
 * caller's JWT; this screen only displays what came back.
 */
export default function AiScreen() {
  return (
    <ScreenShell><ScreenHeader kicker="THE ORACLE" title="AI ANALYSIS" />
        <PhysiqueSection />
        <BodyfatSection />
        <Text className="text-center text-2xs text-text-mute">
          Photos are analysed in memory and never stored. Scans are rate-limited hourly; identical
          photos return the cached verdict without a new analysis.
        </Text>
    </ScreenShell>
  );
}

function PhotoSlot({ label, uri, onPick }: { label: string; uri: string | null; onPick: () => void }) {
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label.toLowerCase()} photo`}
      className="flex-1 items-center rounded-md p-s2"
      style={{
        borderWidth: 1,
        borderStyle: uri ? 'solid' : 'dashed',
        borderColor: uri ? `${tokens.colors.accent}8c` : tokens.colors.border,
        backgroundColor: uri ? 'rgba(34,211,238,0.06)' : tokens.colors['surface-2'],
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: 72, height: 96, borderRadius: 6 }} contentFit="cover" />
      ) : (
        <View className="h-[96px] w-[72px] items-center justify-center">
          <Text className="text-2xl text-text-mute">＋</Text>
          <Text className="mt-s1 text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            TAP
          </Text>
        </View>
      )}
      <Text
        className={`mt-s1 text-2xs font-bold ${uri ? 'text-accent' : 'text-text-mute'}`}
        style={{ letterSpacing: 1.5 }}
      >
        {uri ? `${label} ✓` : label}
      </Text>
    </Pressable>
  );
}

/** A verdict row: label, static fill to /15, the number loud. */
function ScoreRow({ label, value, colour, max = 15 }: { label: string; value: number; colour: string; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <View className="mb-s2">
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          {label.toUpperCase()}
        </Text>
        <Text className="text-sm font-bold" style={{ color: colour }}>
          {value}
          <Text className="text-2xs text-text-mute"> / {max}</Text>
        </Text>
      </View>
      <View className="h-s2 overflow-hidden rounded-pill bg-surface-3">
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: colour,
            minWidth: value > 0 ? 4 : 0,
            shadowColor: colour,
            shadowOpacity: 0.5,
            shadowRadius: 6,
          }}
        />
      </View>
    </View>
  );
}

function PhysiqueSection() {
  const { summary, stats } = useAvatarData();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PhysiqueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (i: number) => async () => {
    const uri = await pickPhoto();
    if (uri) setPhotos((prev) => prev.map((p, j) => (j === i ? uri : p)));
  };

  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    const { result: r, error: err } = await runAiPhysique(images, {
      level: summary.level,
      total_sets: summary.totalSets,
      bench_e1rm: stats.benchE1rm,
      squat_e1rm: stats.squatE1rm,
      bodyweight: stats.bodyweight,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setResult(r);
    setPhotos([null, null, null]); // analysed and dropped
    queryClient.invalidateQueries({ queryKey: ['physique_ratings', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'PHYSIQUE RATED', subtitle: 'Saved to your history' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const state = physiqueScanState(busy, error, result !== null, anyPhoto);

  return (
    <GlowCard glow={state === 'complete' ? tokens.colors.success : anyPhoto ? tokens.colors.accent : undefined}>
      <SectionLabel>AI PHYSIQUE RATING</SectionLabel>
      <ScanFrame state={state}>
        <View className="flex-row gap-s2">
          <PhotoSlot label="FRONT" uri={photos[0]} onPick={pick(0)} />
          <PhotoSlot label="SIDE" uri={photos[1]} onPick={pick(1)} />
          <PhotoSlot label="BACK" uri={photos[2]} onPick={pick(2)} />
        </View>
      </ScanFrame>
      <View className="mb-s4" />
      {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
      <NeonButton title="RATE PHYSIQUE" onPress={() => void run()} disabled={!anyPhoto} busy={busy} testID="run-physique" />

      {result ? (
        <View
          className="mt-s4 rounded-xl p-s4"
          style={{ borderWidth: 1, borderColor: `${tokens.colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
        >
          <View className="mb-s3">
            <EdgeLabel
              right={
                <Text
                  className="text-xl font-bold"
                  style={{ color: tokens.colors.epic, textShadowColor: 'rgba(168,85,247,0.6)', textShadowRadius: 14 }}
                >
                  {result.physique_score}
                  <Text className="text-2xs text-text-mute"> / 15</Text>
                </Text>
              }
            >
              THE ORACLE&apos;S VERDICT
            </EdgeLabel>
          </View>
          <ScoreRow label="Leanness" value={result.leanness_score} colour={tokens.colors.success} />
          <ScoreRow label="Symmetry" value={result.symmetry_score} colour={tokens.colors.mythic} />
          <ScoreRow label="Muscularity" value={result.muscularity_score} colour={tokens.colors.epic} />
          <Text className="mt-s1 text-xs text-text-dim">{result.summary}</Text>
          {result.improvements?.slice(0, 3).map((im) => (
            <Text key={im} className="mt-s1 text-2xs text-text-mute">
              • {im}
            </Text>
          ))}
        </View>
      ) : null}
    </GlowCard>
  );
}

function BodyfatSection() {
  const profile = useProfile();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { stats } = useAvatarData();
  const [photos, setPhotos] = useState<(string | null)[]>([null, null]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BodyfatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (i: number) => async () => {
    const uri = await pickPhoto();
    if (uri) setPhotos((prev) => prev.map((p, j) => (j === i ? uri : p)));
  };

  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    const { result: r, error: err } = await runAiBodyfat(images, {
      height_cm: profile.data?.height_cm ?? 0,
      weight_kg: stats.bodyweight,
      save: true,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setResult(r);
    setPhotos([null, null]);
    queryClient.invalidateQueries({ queryKey: ['bodyfat_mid', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'BODY FAT ESTIMATED', subtitle: 'Saved to your log' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const state = physiqueScanState(busy, error, result !== null, anyPhoto);

  return (
    <GlowCard glow={state === 'complete' ? tokens.colors.success : anyPhoto ? tokens.colors.accent : undefined}>
      <SectionLabel>AI BODY FAT ESTIMATE</SectionLabel>
      <ScanFrame state={state}>
        <View className="flex-row gap-s2">
          <PhotoSlot label="FRONT" uri={photos[0]} onPick={pick(0)} />
          <PhotoSlot label="BACK" uri={photos[1]} onPick={pick(1)} />
          <View className="flex-1" />
        </View>
      </ScanFrame>
      <View className="mb-s4" />
      {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
      <NeonButton title="ESTIMATE BODY FAT" onPress={() => void run()} disabled={!anyPhoto} busy={busy} testID="run-bodyfat" />

      {result ? (
        <View
          className="mt-s4 items-center rounded-xl p-s4"
          style={{ borderWidth: 1, borderColor: `${tokens.colors.success}45`, backgroundColor: `${tokens.colors.success}0f` }}
        >
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
            ESTIMATED BODY FAT
          </Text>
          <Text
            className="text-3xl font-bold"
            style={{ color: tokens.colors.success, textShadowColor: `${tokens.colors.success}99`, textShadowRadius: 16 }}
          >
            {result.bf_mid.toFixed(1)}%
          </Text>
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            RANGE {result.bf_low.toFixed(1)}–{result.bf_high.toFixed(1)}% · {String(result.confidence).toUpperCase()} CONFIDENCE
          </Text>
          <Text className="mt-s2 text-center text-xs text-text-dim">{result.notes}</Text>
        </View>
      ) : null}
    </GlowCard>
  );
}


function physiqueScanState(busy: boolean, error: string | null, hasResult: boolean, anyPhoto: boolean): ScanState {
  if (busy) return 'analysing';
  if (error) return 'error';
  if (hasResult) return 'complete';
  if (anyPhoto) return 'ready';
  return 'idle';
}
