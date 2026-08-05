import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { runAiPlan } from '@/data/ai';
import { usePhysiqueRatings, useWorkoutLog } from '@/data/hooks';
import { useAcceptPlan } from '@/data/mutations';
import { muscleHeatMap } from '@/domain/avatar-stats-calc';
import { type CustomPlan } from '@/domain/custom-plan';
import { attributeLines, goalCompatibility, mainWeakness, recommendedGoal, type RoutineGoalKey } from '@/domain/oracle';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import {
  PixelBars,
  PixelDumbbell,
  PixelFlame,
  PixelHeart,
  PixelMuscle,
  PixelSwap,
} from '@/ui/core/pixel-icons';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard } from '@/ui/core/shell';

/**
 * ORACLE_REDESIGN — AI ROUTINE. Goal CARDS (not three buttons): each a
 * pixel-iconed, selectable tile that glows when chosen. The Oracle summary is
 * REAL — before forging it names the athlete's weakest attribute from their
 * latest verdict; after, it shows the plan's own rationale. The goal string
 * flows straight to the same ai-plan edge function; accept/discard unchanged.
 */
type GoalIcon = (p: { size?: number; color?: string }) => React.ReactNode;

const GOALS: readonly { key: RoutineGoalKey; label: string; blurb: string; Icon: GoalIcon }[] = [
  { key: 'Aesthetics', label: 'AESTHETICS', blurb: 'Symmetry & the classic V-taper', Icon: PixelMuscle },
  { key: 'Strength', label: 'STRENGTH', blurb: 'Heavier compounds, lower reps', Icon: PixelDumbbell },
  { key: 'Recomposition', label: 'RECOMP', blurb: 'Build muscle, shed fat', Icon: PixelSwap },
  { key: 'Fat Loss', label: 'FAT LOSS', blurb: 'Higher density, a leaner frame', Icon: PixelFlame },
  { key: 'Athletic Performance', label: 'ATHLETIC', blurb: 'Power, speed & conditioning', Icon: PixelHeart },
  { key: 'Powerlifting', label: 'POWERLIFTING', blurb: 'Squat, bench & deadlift focus', Icon: PixelBars },
];

export function RoutineForgeCard({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const colors = useThemeColors();
  const physique = usePhysiqueRatings();
  const workouts = useWorkoutLog();
  const accept = useAcceptPlan();
  const [goal, setGoal] = useState<RoutineGoalKey>(GOALS[0].key);
  const [busy, setBusyState] = useState(false);
  const setBusy = (v: boolean) => {
    setBusyState(v);
    onBusyChange?.(v);
  };
  const [preview, setPreview] = useState<CustomPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const forge = async () => {
    setBusy(true);
    setError(null);
    const volume: Record<string, number> = {};
    for (const [muscle, sets] of muscleHeatMap(workouts.data ?? [])) volume[muscle] = sets;
    const { result, error: err } = await runAiPlan({ goal, physique: physique.data ?? null, volume });
    setBusy(false);
    if (err || !result) {
      setError(err ?? 'The coach returned nothing.');
      return;
    }
    setPreview(result);
  };

  // The pre-forge summary is REAL: the weakest of the latest verdict's three
  // attributes, named. No verdict yet → a plain prompt, never a fabricated
  // read. While the FIRST read of physique_ratings is still in flight this
  // stays null too — deliberately, so a returning athlete with a real verdict
  // never sees a flash of "you haven't scanned" before their real data lands.
  const p = physique.data;
  const lines =
    p && p.muscularity_score !== null && p.leanness_score !== null && p.symmetry_score !== null
      ? attributeLines({
          muscularity_score: p.muscularity_score,
          leanness_score: p.leanness_score,
          symmetry_score: p.symmetry_score,
        })
      : null;
  const weakest = lines ? mainWeakness(lines) : null;
  // ARCHETYPE COMPATIBILITY (2026-08-05): real per-goal match against the
  // latest verdict's sub-scores — goalCompatibility, not a fabricated
  // "96% match". Absent lines → every tile stays a plain card with no % and
  // no RECOMMENDED badge, same honesty rule as the summary text below.
  const best = lines ? recommendedGoal(GOALS.map((g) => g.key), lines) : null;

  return (
    <GlowCard glow={preview ? colors.epic : colors.accent}>
      <SectionLabel size='lg'>AI CUSTOM ROUTINE</SectionLabel>
      {!preview ? (
        <>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {GOALS.map((g) => {
              const active = goal === g.key;
              const match = lines ? goalCompatibility(g.key, lines) : null;
              const recommended = best !== null && g.key === best;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGoal(g.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${g.label} goal${match !== null ? `, ${match}% match` : ''}${recommended ? ', recommended' : ''}`}
                  testID={`goal-${g.key.toLowerCase().replace(/\s+/g, '-')}`}
                  className="rounded-lg border p-s3"
                  style={{
                    width: '48%',
                    minHeight: 92,
                    borderColor: active ? `${colors.epic}8c` : colors.border,
                    backgroundColor: active ? 'rgba(168,85,247,0.1)' : colors['surface-2'],
                    shadowColor: colors.epic,
                    shadowOpacity: active ? 0.35 : 0,
                    shadowRadius: 12,
                  }}
                >
                  <View className="flex-row items-start justify-between">
                    <g.Icon size={18} color={active ? colors.epic : colors['text-dim']} />
                    {recommended ? (
                      <View
                        className="rounded-pill border px-s1"
                        style={{ borderColor: `${colors.legendary}8c`, backgroundColor: `${colors.legendary}1a`, paddingVertical: 1 }}
                      >
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          style={{ fontSize: 7, letterSpacing: 0.5, color: colors.legendary, ...pixelFont(false) }}
                        >
                          RECOMMENDED
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    className={active ? 'text-text' : 'text-text-dim'}
                    allowFontScaling={false}
                    style={{ fontSize: 11, letterSpacing: 0.5, marginTop: 8, ...pixelFont() }}
                  >
                    {g.label}
                  </Text>
                  <Text className="mt-s1 text-2xs text-text-mute" numberOfLines={2}>
                    {g.blurb}
                  </Text>
                  {match !== null ? (
                    <Text
                      className="mt-s1"
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{ fontSize: 10, letterSpacing: 0.5, color: colors.epic, ...pixelFont() }}
                      testID={`goal-match-${g.key.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {match}% MATCH
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Oracle summary — real read of the latest verdict. */}
          <View
            className="mt-s3 rounded-lg border p-s3"
            style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(6,12,24,0.5)' }}
          >
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              ORACLE SUMMARY
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              {physique.isPending
                ? 'Reading your latest scan…'
                : weakest
                  ? `${weakest.label.charAt(0) + weakest.label.slice(1).toLowerCase()} is your lowest-scoring attribute. Your AI will bias volume toward it for the ${goalLabel(goal)} goal.`
                  : `Run an AI physique analysis first and the Oracle will tailor this plan to your weak points. It forges a six-day routine for the ${goalLabel(goal)} goal from your training volume.`}
            </Text>
          </View>

          {error ? <Text className="mt-s2 text-xs text-danger">{error}</Text> : null}
          <View className="mt-s3">
            <NeonButton title="FORGE MY PROGRAM" variant="epic" onPress={() => void forge()} busy={busy} size="hero" testID="forge-plan" />
          </View>
        </>
      ) : (
        <>
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 18, ...pixelFont() }}>
            {preview.plan_name}
          </Text>
          {preview.rationale ? <Text className="mb-s2 text-2xs text-text-mute">{preview.rationale}</Text> : null}
          {preview.days.map((day) => (
            <View
              key={day.day}
              className="mb-s2 rounded-md p-s3"
              style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(6,12,24,0.5)' }}
            >
              <Text className="text-text" allowFontScaling={false} style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont() }}>
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

function goalLabel(key: string): string {
  return GOALS.find((g) => g.key === key)?.label.toLowerCase() ?? key.toLowerCase();
}
