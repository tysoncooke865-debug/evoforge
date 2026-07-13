import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAcceptPlan } from '@/data/mutations';
import type { CustomPlan, PlanExercise } from '@/domain/custom-plan';
import {
  exercisesFor,
  LIBRARY_SECTIONS,
  REP_SCHEMES,
  SPLITS,
} from '@/domain/exercise-library';
import tokens from '@/theme/tokens';
import { ExercisePicker } from '@/ui/exercise-picker';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * THE ROUTINE BUILDER (Tyson, 2026-07-13): pick a split, tap exercises
 * in, save — three steps, no typing required. Writes the SAME
 * custom_workout_plan storage the AI plan uses, so Train's MY PLAN
 * source, completion, XP and logging all work unchanged. Tap an added
 * exercise to remove it; sets cycle 2→5 on the pill; rep scheme cycles
 * through the four standards.
 */

export default function RoutineBuilderScreen() {
  const router = useRouter();
  const accept = useAcceptPlan();
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const [dayIx, setDayIx] = useState(0);
  const [section, setSection] = useState(0);
  const [plan, setPlan] = useState<Record<string, PlanExercise[]>>({});
  // STAGE 1: the section chips show the library; the picker also SEARCHES it
  // and can create what the library doesn't have.
  const [pickerOpen, setPickerOpen] = useState(false);

  const split = SPLITS.find((s) => s.key === splitKey) ?? null;
  const day = split?.days[dayIx] ?? null;
  const dayList = day ? (plan[day] ?? []) : [];

  const addExercise = (name: string) => {
    if (!day) return;
    setPlan((p) => {
      const cur = p[day] ?? [];
      if (cur.some((e) => e.exercise === name)) return p; // no dupes
      return { ...p, [day]: [...cur, { exercise: name, sets: 3, reps: '8-12', reason: '' }] };
    });
  };
  const removeExercise = (name: string) => {
    if (!day) return;
    setPlan((p) => ({ ...p, [day]: (p[day] ?? []).filter((e) => e.exercise !== name) }));
  };
  const cycleSets = (name: string) => {
    if (!day) return;
    setPlan((p) => ({
      ...p,
      [day]: (p[day] ?? []).map((e) =>
        e.exercise === name ? { ...e, sets: e.sets >= 5 ? 2 : e.sets + 1 } : e
      ),
    }));
  };
  const cycleReps = (name: string) => {
    if (!day) return;
    setPlan((p) => ({
      ...p,
      [day]: (p[day] ?? []).map((e) => {
        if (e.exercise !== name) return e;
        const i = REP_SCHEMES.indexOf(e.reps as (typeof REP_SCHEMES)[number]);
        return { ...e, reps: REP_SCHEMES[(i + 1) % REP_SCHEMES.length] };
      }),
    }));
  };

  const emptyDays = split ? split.days.filter((d) => (plan[d] ?? []).length === 0) : [];
  const canSave = split !== null && emptyDays.length === 0 && !accept.isPending;

  const save = () => {
    if (!split) return;
    const built: CustomPlan = {
      plan_name: split.name,
      rationale: 'Built by hand in the Routine Builder',
      days: split.days.map((d) => ({ day: d, goal: '', exercises: plan[d] ?? [] })),
    };
    accept.mutate(built, { onSuccess: () => router.replace('/today') });
  };

  return (
    <ScreenShell>
      <ScreenHeader kicker="BUILD YOUR OWN" title="MY ROUTINE" />

      {/* Step 1 — the split. */}
      <View>
        <EdgeLabel>1 · PICK YOUR SPLIT</EdgeLabel>
        <View className="mt-s2 flex-row flex-wrap gap-s2">
          {SPLITS.map((s) => (
            <Chip
              key={s.key}
              label={s.name}
              active={splitKey === s.key}
              onPress={() => {
                setSplitKey(s.key);
                setDayIx(0);
              }}
              testID={`split-${s.key}`}
            />
          ))}
        </View>
      </View>

      {split ? (
        <>
          {/* Step 2 — build each day. */}
          <View>
            <EdgeLabel>2 · BUILD EACH DAY</EdgeLabel>
            <View className="mt-s2 flex-row flex-wrap gap-s2">
              {split.days.map((d, i) => (
                <Chip
                  key={d}
                  label={`${d}${(plan[d] ?? []).length > 0 ? ` · ${(plan[d] ?? []).length}` : ''}`}
                  active={i === dayIx}
                  onPress={() => setDayIx(i)}
                />
              ))}
            </View>
          </View>

          <GlowCard glow={dayList.length > 0 ? tokens.colors.accent : undefined}>
            <View className="mb-s2">
              <EdgeLabel right={<Text className="text-2xs font-bold text-accent">{dayList.length} PICKED</Text>}>
                {`${(day ?? '').toUpperCase()} — TAP SETS / REPS TO ADJUST`}
              </EdgeLabel>
            </View>
            {dayList.length === 0 ? (
              <Text className="text-2xs text-text-mute">Nothing yet — tap exercises below to add them.</Text>
            ) : (
              dayList.map((e) => (
                <View key={e.exercise} className="mb-s2 flex-row items-center gap-s2">
                  <Pressable
                    onPress={() => removeExercise(e.exercise)}
                    accessibilityRole="button"
                    accessibilityLabel={`remove ${e.exercise}`}
                    className="items-center justify-center rounded-md border border-border"
                    style={{ width: 32, minHeight: 44 }}
                  >
                    <Text className="text-xs font-bold text-danger">✕</Text>
                  </Pressable>
                  <Text className="flex-1 text-xs font-bold text-text" numberOfLines={2}>
                    {e.exercise}
                  </Text>
                  <Pressable
                    onPress={() => cycleSets(e.exercise)}
                    accessibilityRole="button"
                    className="items-center justify-center rounded-pill border px-s2"
                    style={{ minHeight: 44, borderColor: `${tokens.colors.accent}59` }}
                  >
                    <Text className="text-2xs font-bold text-accent">{e.sets} SETS</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => cycleReps(e.exercise)}
                    accessibilityRole="button"
                    className="items-center justify-center rounded-pill border px-s2"
                    style={{ minHeight: 44, borderColor: `${tokens.colors.epic}59` }}
                  >
                    <Text className="text-2xs font-bold" style={{ color: tokens.colors.epic }}>
                      {e.reps}
                    </Text>
                  </Pressable>
                </View>
              ))
            )}
          </GlowCard>

          {/* The library, one muscle section at a time. */}
          <View>
            <View className="flex-row flex-wrap gap-s2">
              {LIBRARY_SECTIONS.map((s, i) => (
                <Chip key={s.label} label={s.label} active={i === section} onPress={() => setSection(i)} />
              ))}
              <Chip label="🔍 SEARCH / CUSTOM" active={false} onPress={() => setPickerOpen(true)} />
            </View>
            <View className="mt-s3 flex-row flex-wrap gap-s2">
              {exercisesFor(LIBRARY_SECTIONS[section]).map((e) => {
                const added = dayList.some((x) => x.exercise === e.name);
                return (
                  <Pressable
                    key={e.name}
                    onPress={() => (added ? removeExercise(e.name) : addExercise(e.name))}
                    accessibilityRole="button"
                    className="rounded-md border px-s3 py-s2"
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      borderColor: added ? `${tokens.colors.success}8c` : tokens.colors.border,
                      backgroundColor: added ? 'rgba(52,211,153,0.08)' : 'rgba(13,21,36,0.6)',
                    }}
                  >
                    <Text className={`text-2xs font-bold ${added ? 'text-success' : 'text-text-dim'}`}>
                      {added ? '✓ ' : '＋ '}
                      {e.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Step 3 — save. */}
          {emptyDays.length > 0 ? (
            <Text className="text-center text-2xs text-warn">
              Still empty: {emptyDays.join(' · ')}
            </Text>
          ) : null}
          <NeonButton
            title={accept.isPending ? 'FORGING…' : 'SAVE MY ROUTINE'}
            onPress={save}
            disabled={!canSave}
            busy={accept.isPending}
            testID="routine-save"
          />
        </>
      ) : (
        <Text className="text-center text-2xs text-text-mute">
          Pick a split to start — you can rebuild any time; saving replaces your current custom plan.
        </Text>
      )}

      <ExercisePicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(e) => {
          addExercise(e.name);
          setPickerOpen(false);
        }}
        excludeNames={dayList.map((e) => e.exercise)}
      />
    </ScreenShell>
  );
}
