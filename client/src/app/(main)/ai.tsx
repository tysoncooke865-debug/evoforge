import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique, type BodyfatResult, type PhysiqueResult } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { useProfile } from '@/data/hooks';
import { useAvatarData } from '@/data/use-avatar-data';
import { useToastStore } from '@/state/toast-store';

/**
 * The unified AI page: physique rating and body-fat estimate together (they
 * used to be separate views; one page, one mental model). Photos live in
 * component state only, go to the Edge Function, and are dropped -- never
 * persisted, never in a store. Results are written server-side with the
 * caller's JWT; this screen only displays what came back.
 */
export default function AiScreen() {
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <PhysiqueSection />
        <BodyfatSection />
        <Text className="text-2xs text-text-mute">
          Photos are analysed in memory and never stored. Scans are rate-limited hourly; identical
          photos return the cached verdict without a new analysis.
        </Text>
      </View>
    </ScrollView>
  );
}

function PhotoSlot({ label, uri, onPick }: { label: string; uri: string | null; onPick: () => void }) {
  return (
    <Pressable onPress={onPick} className="flex-1 items-center rounded-md border border-border bg-surface-2 p-s2">
      {uri ? (
        <Image source={{ uri }} style={{ width: 72, height: 96, borderRadius: 6 }} contentFit="cover" />
      ) : (
        <View className="h-[96px] w-[72px] items-center justify-center">
          <Text className="text-2xl text-text-mute">＋</Text>
        </View>
      )}
      <Text className="mt-s1 text-2xs text-text-mute">{label}</Text>
    </Pressable>
  );
}

function ScoreRow({ label, value, max = 15 }: { label: string; value: number; max?: number }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-text-dim">{label}</Text>
      <Text className="text-sm font-bold text-accent">
        {value}
        <Text className="text-text-mute"> / {max}</Text>
      </Text>
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

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <Text className="mb-s2 text-xs text-text-mute">AI PHYSIQUE RATING</Text>
      <View className="mb-s3 flex-row gap-s2">
        <PhotoSlot label="FRONT" uri={photos[0]} onPick={pick(0)} />
        <PhotoSlot label="SIDE" uri={photos[1]} onPick={pick(1)} />
        <PhotoSlot label="BACK" uri={photos[2]} onPick={pick(2)} />
      </View>
      {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
      <Pressable
        className={`items-center rounded-md p-s3 ${anyPhoto ? 'bg-accent' : 'bg-surface-2'}`}
        onPress={run}
        disabled={busy || !anyPhoto}
        testID="run-physique"
      >
        {busy ? (
          <ActivityIndicator color="#04121a" />
        ) : (
          <Text className={`font-bold ${anyPhoto ? 'text-accent-ink' : 'text-text-mute'}`}>RATE PHYSIQUE</Text>
        )}
      </Pressable>

      {result ? (
        <View className="mt-s3 gap-s1 rounded-md border border-border-strong bg-surface-2 p-s3">
          <ScoreRow label="Physique" value={result.physique_score} />
          <ScoreRow label="Leanness" value={result.leanness_score} />
          <ScoreRow label="Symmetry" value={result.symmetry_score} />
          <ScoreRow label="Muscularity" value={result.muscularity_score} />
          <Text className="mt-s1 text-xs text-text-dim">{result.summary}</Text>
          {result.improvements?.slice(0, 3).map((im) => (
            <Text key={im} className="text-2xs text-text-mute">
              • {im}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
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

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <Text className="mb-s2 text-xs text-text-mute">AI BODY FAT ESTIMATE</Text>
      <View className="mb-s3 flex-row gap-s2">
        <PhotoSlot label="FRONT" uri={photos[0]} onPick={pick(0)} />
        <PhotoSlot label="BACK" uri={photos[1]} onPick={pick(1)} />
        <View className="flex-1" />
      </View>
      {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
      <Pressable
        className={`items-center rounded-md p-s3 ${anyPhoto ? 'bg-accent' : 'bg-surface-2'}`}
        onPress={run}
        disabled={busy || !anyPhoto}
        testID="run-bodyfat"
      >
        {busy ? (
          <ActivityIndicator color="#04121a" />
        ) : (
          <Text className={`font-bold ${anyPhoto ? 'text-accent-ink' : 'text-text-mute'}`}>ESTIMATE BODY FAT</Text>
        )}
      </Pressable>

      {result ? (
        <View className="mt-s3 rounded-md border border-border-strong bg-surface-2 p-s3">
          <Text className="text-lg font-bold text-accent">
            {result.bf_mid.toFixed(1)}%{' '}
            <Text className="text-xs text-text-mute">
              ({result.bf_low.toFixed(1)}–{result.bf_high.toFixed(1)} · {result.confidence})
            </Text>
          </Text>
          <Text className="mt-s1 text-xs text-text-dim">{result.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}
