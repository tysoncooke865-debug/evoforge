import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { pickPhoto, runAiBodyfat, runAiPhysique, runAiPlan, type BodyfatResult, type PhotoConditions, type PhysiqueResult } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import { usePhysiqueRatings, useWorkoutLog } from '@/data/hooks';
import { useAcceptPlan } from '@/data/mutations';
import { type CustomPlan } from '@/domain/custom-plan';
import { muscleHeatMap } from '@/domain/avatar-stats-calc';
import { useAvatarData } from '@/data/use-avatar-data';
import { useCurrentStats } from '@/data/use-current-stats';
import { useToastStore } from '@/state/toast-store';
import tokens from '@/theme/tokens';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScanFrame, type ScanState } from '@/ui/scan-frame';
import { ScreenHeader, SectionLabel } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';
import { SpriteCompanion } from '@/ui/sprite-avatar';

/**
 * The unified AI page: physique rating and body-fat estimate together (they
 * used to be separate views; one page, one mental model). Photos live in
 * component state only, go to the Edge Function, and are dropped -- never
 * persisted, never in a store. Results are written server-side with the
 * caller's JWT; this screen only displays what came back.
 */
export default function AiScreen() {
  return (
    <ScreenShell><ScreenHeader kicker="THE ORACLE" title="AI ANALYSIS" right={<SpriteCompanion anim="idle" height={56} />} />
        <PhysiqueSection />
        <BodyfatSection />
        <ForgeRoutineSection />
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

const LIGHTING_OPTIONS = ['flattering', 'neutral', 'unflattering'] as const;
const PUMP_OPTIONS = ['none', 'mild', 'moderate', 'strong'] as const;

/**
 * IMPROVEMENT_PLAN #6: the estimate→confirm step. The AI's guess at the
 * photo conditions arrives pre-selected; confirming unchanged saves the
 * provisional verdict (a cache hit — no second model call); correcting
 * re-judges with the athlete's attested conditions.
 */
function ConditionsConfirm({
  estimate,
  lighting,
  pump,
  onLighting,
  onPump,
  corrected,
  busy,
  onConfirm,
}: {
  estimate: PhotoConditions | null;
  lighting: string;
  pump: string;
  onLighting: (v: string) => void;
  onPump: (v: string) => void;
  corrected: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <View
      className="mt-s3 rounded-xl p-s3"
      style={{ borderWidth: 1, borderColor: `${tokens.colors.warn}45`, backgroundColor: 'rgba(6,12,24,0.5)' }}
    >
      <Text className="text-2xs font-bold" style={{ color: tokens.colors.warn, letterSpacing: 2 }}>
        THE ORACLE READ THE CONDITIONS AS…
      </Text>
      {estimate?.estimated === false ? (
        <Text className="mt-s1 text-2xs text-text-mute">Estimate unavailable — defaults shown; correct them if needed.</Text>
      ) : null}
      <Text className="mb-s1 mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        LIGHTING
      </Text>
      <View className="flex-row flex-wrap gap-s2">
        {LIGHTING_OPTIONS.map((o) => (
          <Chip key={o} label={o.toUpperCase()} active={lighting === o} onPress={() => onLighting(o)} />
        ))}
      </View>
      <Text className="mb-s1 mt-s2 text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
        PUMP
      </Text>
      <View className="flex-row flex-wrap gap-s2">
        {PUMP_OPTIONS.map((o) => (
          <Chip key={o} label={o.toUpperCase()} active={pump === o} onPress={() => onPump(o)} />
        ))}
      </View>
      <View className="mt-s3">
        <NeonButton
          title={corrected ? 'RE-JUDGE WITH MY CORRECTIONS' : 'LOOKS RIGHT · SAVE VERDICT'}
          onPress={onConfirm}
          busy={busy}
          testID="conditions-confirm"
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
  const [provisional, setProvisional] = useState<PhysiqueResult | null>(null);
  const [lighting, setLighting] = useState('neutral');
  const [pump, setPump] = useState('none');
  const [result, setResult] = useState<PhysiqueResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (i: number) => async () => {
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

  // Estimate pass: verdict + condition guesses come back, NOTHING is saved.
  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
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

  // Confirm pass: unchanged = cache hit that persists; corrected = re-judge.
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
    queryClient.invalidateQueries({ queryKey: ['physique_ratings', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'PHYSIQUE RATED', subtitle: 'Saved to your history' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const confirming = provisional !== null && result === null;
  const state = confirming && !busy ? 'confirm' as const : physiqueScanState(busy, error, result !== null, anyPhoto);

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
        <NeonButton title="RATE PHYSIQUE" onPress={() => void run()} disabled={!anyPhoto} busy={busy} testID="run-physique" />
      )}

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

  const pick = (i: number) => async () => {
    const uri = await pickPhoto();
    if (uri) setPhotos((prev) => prev.map((p, j) => (j === i ? uri : p)));
  };

  // The seam is nullable by contract; the AI payload keeps its historical
  // explicit defaults (77 kg frame fallback, 0 = unknown height).
  const scanContext = () => ({
    height_cm: current.heightCm ?? 0,
    weight_kg: current.bodyweightKg ?? 77,
  });

  const run = async () => {
    const images = photos.filter((p): p is string => p !== null);
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
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
    queryClient.invalidateQueries({ queryKey: ['bodyfat_series', session?.user.id ?? null] });
    useToastStore.getState().push({ kind: 'info', title: 'BODY FAT ESTIMATED', subtitle: 'Saved to your log' });
  };

  const anyPhoto = photos.some((p) => p !== null);
  const confirming = provisional !== null && result === null;
  const state = confirming && !busy ? 'confirm' as const : physiqueScanState(busy, error, result !== null, anyPhoto);

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
        <NeonButton title="ESTIMATE BODY FAT" onPress={() => void run()} disabled={!anyPhoto} busy={busy} testID="run-bodyfat" />
      )}

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


const PLAN_GOALS = ['Aesthetics', 'Strength', 'Recomposition'] as const;

/**
 * IMPROVEMENT_PLAN #10: the AI custom routine. Generate → full preview with
 * per-exercise reasons → accept (writes custom_workout_plan under the
 * athlete's own RLS) or discard (nothing persisted). The built-in PPPPLA
 * routine is generated/pinned and untouched either way.
 */
function ForgeRoutineSection() {
  const physique = usePhysiqueRatings();
  const workouts = useWorkoutLog();
  const accept = useAcceptPlan();
  const [goal, setGoal] = useState<string>(PLAN_GOALS[0]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<CustomPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forge = async () => {
    setBusy(true);
    setError(null);
    const volume: Record<string, number> = {};
    for (const [muscle, sets] of muscleHeatMap(workouts.data ?? [])) volume[muscle] = sets;
    const { result, error: err } = await runAiPlan({
      goal,
      physique: physique.data ?? null,
      volume,
    });
    setBusy(false);
    if (err || !result) {
      setError(err ?? 'The coach returned nothing.');
      return;
    }
    setPreview(result);
  };

  return (
    <GlowCard glow={preview ? tokens.colors.epic : undefined}>
      <SectionLabel>AI CUSTOM ROUTINE</SectionLabel>
      {!preview ? (
        <>
          <Text className="mb-s3 text-2xs text-text-mute">
            The Oracle forges a six-day routine from your physique verdicts, training volume and goal.
            Nothing is saved until you accept it.
          </Text>
          <View className="mb-s4 flex-row flex-wrap gap-s2">
            {PLAN_GOALS.map((g) => (
              <Chip key={g} label={g.toUpperCase()} active={goal === g} onPress={() => setGoal(g)} />
            ))}
          </View>
          {error ? <Text className="mb-s2 text-xs text-danger">{error}</Text> : null}
          <NeonButton title="FORGE MY ROUTINE" onPress={() => void forge()} busy={busy} testID="forge-plan" />
        </>
      ) : (
        <>
          <Text className="text-lg font-bold text-text">{preview.plan_name}</Text>
          {preview.rationale ? <Text className="mb-s2 text-2xs text-text-mute">{preview.rationale}</Text> : null}
          {preview.days.map((day) => (
            <View
              key={day.day}
              className="mb-s2 rounded-md p-s3"
              style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(6,12,24,0.5)' }}
            >
              <Text className="text-xs font-bold text-text" style={{ letterSpacing: 1 }}>
                {day.day.toUpperCase()}
              </Text>
              {day.goal ? <Text className="mb-s1 text-2xs text-text-mute">{day.goal}</Text> : null}
              {day.exercises.map((e) => (
                <View key={e.exercise} className="mt-s1">
                  <Text className="text-2xs text-text-dim">
                    {e.exercise} · {e.sets}×{e.reps}
                  </Text>
                  {e.reason ? (
                    <Text className="text-2xs text-text-mute" style={{ fontSize: 10 }}>
                      {e.reason}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}
          <View className="mt-s2 gap-s2">
            <NeonButton
              title="ACCEPT · REPLACE MY AI PLAN"
              onPress={() => accept.mutate(preview, { onSuccess: () => setPreview(null) })}
              busy={accept.isPending}
              testID="accept-plan"
            />
            <NeonButton title="DISCARD" variant="ghost" onPress={() => setPreview(null)} testID="discard-plan" />
          </View>
        </>
      )}
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
