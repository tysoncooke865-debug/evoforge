/**
 * ONBOARDING V3 — "Your Forge is ready" (docs/ONBOARDING_V3_SPEC.md §2, step 5).
 *
 * The payoff, and the last screen before real training. It shows the
 * champion, the plan, the specific next workout, roughly how long it takes
 * and what it trains — and then exactly ONE action. Five competing buttons
 * here is how a reveal becomes another decision.
 *
 * Every number is derived from the plan that was actually seeded
 * (estimateMinutes over the real set count, muscles from the real exercise
 * list). Nothing on this screen is illustrative.
 */

import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import type { BranchV2 } from '@/domain/branches-v2';
import { evolutionNameV2 } from '@/domain/branches-v2';
import { libraryMuscleFor } from '@/domain/muscle-lookup';
import { muscleIdsFor, pillLabelsFor } from '@/domain/muscle-map';
import { ORIGIN_PATH_CONFIGS } from '@/domain/origin-path/config';
import type { OriginId } from '@/domain/origin/types';
import { estimateMinutes, splitWorkoutName } from '@/domain/workout-estimates';
import { inferMuscleGroup } from '@/domain/workouts';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';
import { GlowCard } from '@/ui/core/shell';

export function MissionReveal({
  originId,
  sex,
  planName,
  missionDay,
  inDays,
  nextScheduled,
  exercises,
  testID,
}: {
  originId: OriginId;
  sex: 'male' | 'female';
  /** The seeded plan's name, or null when the athlete brought their own. */
  planName: string | null;
  /** The workout being handed over, or null when there is no plan yet. */
  missionDay: string | null;
  /** 0 = today. Always 0 now — what is handed over is dated today. */
  inDays: number;
  /** When today is not a scheduled day, what the week does next. */
  nextScheduled?: { day: string; inDays: number } | null;
  /** [exercise, sets] for that day — the real seeded entries. */
  exercises: readonly (readonly [string, number])[];
  testID?: string;
}) {
  const colors = useThemeColors();
  const branch = originId as BranchV2;
  const art = stillAvatar(branch, 1, sex) ?? avatarArtV2(branch, 1, sex).source ?? null;
  const config = ORIGIN_PATH_CONFIGS[originId];

  const totalSets = exercises.reduce((n, [, s]) => n + s, 0);
  const minutes = estimateMinutes(totalSets);
  const pills = pillLabelsFor(
    muscleIdsFor(exercises.map(([e]) => libraryMuscleFor(e) ?? inferMuscleGroup(e)))
  );
  const name = missionDay ? splitWorkoutName(missionDay) : null;

  return (
    <View testID={testID}>
      <GlowCard glow={colors.legendary} padding={18}>
        <View className="items-center">
          <View className="items-center justify-center" style={{ width: 150, height: 168 }}>
            {art ? (
              <Image source={art} style={{ width: 144, height: 162 }} contentFit="contain" />
            ) : (
              <Text className="text-4xl text-text-mute">?</Text>
            )}
          </View>
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 18, letterSpacing: 0, ...pixelFont() }}
          >
            {evolutionNameV2(branch, 1).toUpperCase()}
          </Text>
          <Text
            className="mt-s1 text-legendary"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont() }}
          >
            {config.name.toUpperCase()} · STAGE 1
          </Text>
        </View>
      </GlowCard>

      {missionDay ? (
        <View className="mt-s4">
          <GlowCard padding={16}>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              {inDays === 0 ? 'YOUR FIRST WORKOUT · TODAY' : inDays === 1 ? 'YOUR FIRST WORKOUT · TOMORROW' : `YOUR FIRST WORKOUT · IN ${inDays} DAYS`}
            </Text>
            <Text className="mt-[2px] text-2xs text-text-mute">
              {nextScheduled
                ? `Your week proper starts ${nextScheduled.inDays === 1 ? 'tomorrow' : `in ${nextScheduled.inDays} days`} with ${nextScheduled.day} — this one is yours to do now.`
                : 'Ready when you are.'}
            </Text>
            <Text
              className="mt-s1 text-text"
              allowFontScaling={false}
              style={{ fontSize: 20, letterSpacing: 0, ...pixelFont() }}
            >
              {(name?.title ?? missionDay).toUpperCase()}
            </Text>
            {name?.sub ? <Text className="text-xs text-text-dim">{name.sub}</Text> : null}

            <View className="mt-s3 flex-row flex-wrap items-center gap-s2">
              <Stat label={`${minutes} MIN`} />
              <Stat label={`${exercises.length} EXERCISES`} />
              <Stat label={`${totalSets} SETS`} />
            </View>

            {pills.length > 0 ? (
              <Text className="mt-s3 text-2xs text-text-mute">
                TRAINS · {pills.join(' · ').toUpperCase()}
              </Text>
            ) : null}

            {planName ? (
              <Text className="mt-s3 text-2xs text-text-mute">
                Part of {planName} — every exercise, set and day is yours to change.
              </Text>
            ) : null}
          </GlowCard>
        </View>
      ) : (
        <View className="mt-s4">
          <GlowCard padding={16}>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              YOUR FIRST WORKOUT
            </Text>
            <Text className="mt-s1 text-sm text-text-dim">
              You said you already have a program — nothing has been seeded over it. Start an empty
              workout whenever you are ready and log straight into it.
            </Text>
          </GlowCard>
        </View>
      )}
    </View>
  );
}

function Stat({ label }: { label: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="rounded-md px-s2 py-[3px]"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont() }}
      >
        {label}
      </Text>
    </View>
  );
}
