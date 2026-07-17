import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useDeleteRoutine, useRoutines } from '@/data/routines';
import { supabase } from '@/data/supabase';
import { useSaveUserPlan } from '@/data/user-plans';
import type { CustomPlan, PlanExercise } from '@/domain/custom-plan';
import {
  exercisesFor,
  LIBRARY_SECTIONS,
  presetFor,
  REP_SCHEMES,
  scheduleForDays,
  SPLITS,
} from '@/domain/exercise-library';
import { todayIso } from '@/domain/today';
import { type MappedDay, type MatchConfidence } from '@/domain/workout-import';
import { useSessionStore } from '@/state/session-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ExercisePicker } from '@/ui/train/exercise-picker';
import { ExerciseSearchBar } from '@/ui/train/exercise-search-bar';
import { PlanImportSheet } from '@/ui/train/plan-import';
import { EdgeLabel } from '@/ui/core/hud';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * THE ROUTINE BUILDER (Tyson, 2026-07-13): pick a split, tap exercises
 * in, save — three steps, no typing required. Writes the SAME
 * custom_workout_plan storage the AI plan uses, so Train's MY PLAN
 * source, completion, XP and logging all work unchanged. Tap an added
 * exercise to remove it; sets cycle 2→5 on the pill; rep scheme cycles
 * through the four standards.
 */

export default function RoutineBuilderScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const savePlan = useSaveUserPlan();
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const [dayIx, setDayIx] = useState(0);
  const [section, setSection] = useState(0);
  const [plan, setPlan] = useState<Record<string, PlanExercise[]>>({});
  // STAGE 1: the section chips show the library; the picker also SEARCHES it
  // and can create what the library doesn't have.
  const [pickerOpen, setPickerOpen] = useState(false);
  // STAGE 1: the `custom` split names its own days; presets prefill theirs.
  const [customDays, setCustomDays] = useState<string[]>([]);
  const [newDayName, setNewDayName] = useState('');
  const routines = useRoutines();
  const deleteRoutine = useDeleteRoutine();
  const startAdhoc = useSessionStore((s) => s.startAdhoc);

  // PLAN SCAN: `?import=1` (the onboarding tile) opens the sheet on arrival.
  const params = useLocalSearchParams<{ import?: string }>();
  const [importOpen, setImportOpen] = useState(params.import === '1');
  // The scanned program's own title — the save uses it over the split's name.
  const [importedName, setImportedName] = useState<string | null>(null);
  // day:exercise → what the page actually said, for the confidence badges —
  // and, for unmatched entries, the AI's muscle guess so SAVE can enrol them
  // in user_exercises (heat map / skill tree attribution).
  const [importMeta, setImportMeta] = useState<
    Record<string, { raw: string; confidence: MatchConfidence; muscleGuess?: string }>
  >({});

  /** The scanned draft becomes a CUSTOM split seeded into the normal editor —
   *  review/edit/confirm is the builder itself; nothing new to learn. */
  const seedFromImport = (draft: { planName: string; days: MappedDay[] }) => {
    const rec: Record<string, PlanExercise[]> = {};
    const meta: Record<string, { raw: string; confidence: MatchConfidence; muscleGuess?: string }> = {};
    for (const d of draft.days) {
      rec[d.day] = d.exercises.map(({ raw: _raw, confidence: _c, ...pe }) => pe);
      for (const e of d.exercises) {
        if (e.confidence !== 'exact')
          meta[`${d.day}:${e.exercise}`] = { raw: e.raw, confidence: e.confidence, muscleGuess: e.muscleGuess };
      }
    }
    setSplitKey('custom');
    setCustomDays(draft.days.map((d) => d.day).slice(0, 7));
    setDayIx(0);
    setPlan(rec);
    setImportedName(draft.planName);
    setImportMeta(meta);
    setImportOpen(false);
    useToastStore.getState().push({
      kind: 'info',
      title: 'WORKOUT READ',
      subtitle: 'Check the guesses, then SAVE MY PLAN.',
    });
  };

  const preset = SPLITS.find((s) => s.key === splitKey) ?? null;
  // A custom split's days live in component state, not in the preset table.
  const split =
    preset && preset.key === 'custom' ? { ...preset, days: customDays } : preset;
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

  /** One tap fills the day with its staples — the fastest honest start. Only
   *  ADDS: anything already picked stays, so it never eats a choice. */
  const prefill = () => {
    if (!split || !day) return;
    const staples = presetFor(split, day);
    if (staples.length === 0) return;
    setPlan((p) => {
      const cur = p[day] ?? [];
      const have = new Set(cur.map((e) => e.exercise));
      const add = staples
        .filter(([name]) => !have.has(name))
        .map(([exercise, sets, reps]) => ({ exercise, sets, reps, reason: '' }));
      return { ...p, [day]: [...cur, ...add] };
    });
  };

  const addDay = () => {
    const name = newDayName.trim();
    if (name.length < 2) return;
    if (customDays.some((d) => d.toLowerCase() === name.toLowerCase())) {
      useToastStore.getState().push({ kind: 'error', title: 'ALREADY A DAY', subtitle: name });
      return;
    }
    if (customDays.length >= 7) {
      useToastStore.getState().push({ kind: 'error', title: 'SEVEN DAYS IS A WEEK', subtitle: 'That is the ceiling.' });
      return;
    }
    setCustomDays((d) => [...d, name]);
    setDayIx(customDays.length);
    setNewDayName('');
  };

  const emptyDays = split ? split.days.filter((d) => (plan[d] ?? []).length === 0) : [];
  const canSave =
    split !== null && split.days.length > 0 && emptyDays.length === 0 && !savePlan.isPending;

  /** PLAN SCAN: enrol unmatched imported exercises in user_exercises with the
   *  AI's muscle guess. This is what makes their logged sets attribute to the
   *  heat map, skill tree and branch stats like any library movement — XP and
   *  PRs were already name-agnostic. Best-effort, one-by-one (the unique index
   *  makes re-imports duplicate-safe), never blocks the plan save. */
  const enrolUnmatched = (days: readonly string[]) => {
    const creates: { name: string; muscle: string }[] = [];
    const seen = new Set<string>();
    for (const d of days) {
      for (const e of plan[d] ?? []) {
        const m = importMeta[`${d}:${e.exercise}`];
        const key = e.exercise.toLowerCase();
        if (m?.confidence === 'unmatched' && m.muscleGuess && !seen.has(key)) {
          seen.add(key);
          creates.push({ name: e.exercise, muscle: m.muscleGuess });
        }
      }
    }
    if (creates.length === 0) return;
    void (async () => {
      let made = 0;
      for (const c of creates) {
        const { error } = await supabase.from('user_exercises').insert({ name: c.name, muscle: c.muscle });
        if (!error) made += 1; // duplicates and outages alike: quiet, re-runnable
      }
      if (made > 0) {
        void queryClient.invalidateQueries({ queryKey: ['user_exercises', userId] });
        useToastStore.getState().push({
          kind: 'info',
          title: `${made} CUSTOM EXERCISE${made === 1 ? '' : 'S'} ADDED`,
          subtitle: 'From your scan — findable in search, counted in your stats.',
        });
      }
    })();
  };

  const save = () => {
    if (!split) return;
    enrolUnmatched(split.days);
    const built: CustomPlan = {
      plan_name: importedName ?? split.name,
      rationale: importedName ? 'Imported from a written workout (PLAN SCAN)' : 'Built by hand in the Routine Builder',
      days: split.days.map((d) => ({ day: d, goal: '', exercises: plan[d] ?? [] })),
    };
    // TYSON 2026-07-14: MY PLAN has its OWN slot now (migration 018). Saving a
    // hand-built split can no longer destroy the AI's plan — they are different
    // things, and Train offers both.
    savePlan.mutate(
      { kind: 'custom', plan: built },
      {
        onSuccess: () => {
          // PLAN SCAN fix: map the plan's days onto the week, so the week
          // bars / MISSED / scheduled streak know this program exists.
          // Effective-dated (today onward) — history is untouched. Best
          // effort: a failed upsert must not un-save the plan.
          const week = scheduleForDays(split.days);
          if (week) {
            void supabase
              .from('workout_schedule')
              .upsert({ effective_from: todayIso(), plan: week }, { onConflict: 'user_id,effective_from' })
              .then(({ error }) => {
                if (!error) void queryClient.invalidateQueries({ queryKey: ['workout_schedule', userId] });
              });
          }
          useToastStore.getState().push({
            kind: 'info',
            title: 'MY PLAN SAVED',
            subtitle: 'Week mapped — EDIT MY WEEK on Train to adjust',
          });
          router.replace('/today');
        },
      }
    );
  };

  return (
    <ScreenShell>
      <ScreenHeader kicker="BUILD YOUR OWN" title="MY ROUTINE" />

      {/* PLAN SCAN: photograph or paste an existing program; the AI reads it,
          the corpus maps it, this editor reviews it. */}
      <NeonButton
        title="📷 SCAN A WRITTEN WORKOUT"
        variant="ghost"
        onPress={() => setImportOpen(true)}
        testID="routine-import"
      />

      {/* STAGE 1: the workouts you already saved — train one today, or bin it. */}
      {(routines.data ?? []).length > 0 ? (
        <View>
          <EdgeLabel>MY ROUTINES</EdgeLabel>
          <View className="mt-s2">
            {(routines.data ?? []).map((r) => (
              <View key={r.id} className="mb-s2 flex-row items-center gap-s2">
                <Pressable
                  onPress={() => {
                    startAdhoc({ name: r.name, exercises: r.payload?.exercises ?? [] });
                    router.replace('/today');
                  }}
                  accessibilityRole="button"
                  testID={`my-routine-${r.name}`}
                  className="flex-1 rounded-md border border-border px-s3 py-s2"
                  style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.6)' }}
                >
                  <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
                    {r.name}
                  </Text>
                  <Text className="text-2xs text-text-mute">
                    {(r.payload?.exercises ?? []).length} exercises · START TODAY
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => deleteRoutine.mutate(r.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`delete routine ${r.name}`}
                  testID={`my-routine-delete-${r.name}`}
                  className="items-center justify-center"
                  style={{ minWidth: 44, minHeight: 44 }}
                >
                  <Text className="text-sm text-text-mute">✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

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

            {/* STAGE 1: a custom split names its own days. */}
            {split.key === 'custom' ? (
              <View className="mt-s3 flex-row items-center gap-s2">
                <TextInput
                  className="min-h-[44px] flex-1 rounded-xl border bg-surface-2 px-s3 text-sm text-text"
                  style={{ borderColor: colors.border }}
                  placeholder="Name a day — e.g. Chest & Arms"
                  placeholderTextColor="#64758f"
                  value={newDayName}
                  onChangeText={setNewDayName}
                  maxLength={30}
                  testID="custom-day-name"
                />
                <Pressable
                  onPress={addDay}
                  accessibilityRole="button"
                  testID="custom-day-add"
                  className="rounded-md border px-s3"
                  style={{ minHeight: 44, justifyContent: 'center', borderColor: `${colors.accent}66` }}
                >
                  <Text
                    className="text-accent"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                  >
                    ＋ ADD DAY
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <GlowCard glow={dayList.length > 0 ? colors.accent : undefined}>
            <View className="mb-s2">
              <EdgeLabel
                right={
                  <Text
                    className="text-accent"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 0.5, ...pixelFont(false) }}
                  >
                    {dayList.length} PICKED
                  </Text>
                }
              >
                {`${(day ?? '').toUpperCase()} — TAP SETS / REPS TO ADJUST`}
              </EdgeLabel>
              {/* STAGE 1: one tap to fill the day with its staples. Only ADDS —
                  it can never eat a choice already made. */}
              {day && presetFor(split, day).length > 0 ? (
                <Pressable
                  onPress={prefill}
                  accessibilityRole="button"
                  testID="prefill-day"
                  className="mt-s2 items-center"
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text
                    className="text-accent"
                    allowFontScaling={false}
                    style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
                  >
                    ⚡ PREFILL WITH STAPLES
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {dayList.length === 0 ? (
              <Text className="text-2xs text-text-mute">Nothing yet — tap exercises below to add them.</Text>
            ) : (
              dayList.map((e) => {
                const meta = day ? importMeta[`${day}:${e.exercise}`] : undefined;
                return (
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
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-text" numberOfLines={2}>
                      {e.exercise}
                    </Text>
                    {/* PLAN SCAN confidence: the page's words, kept honest. */}
                    {meta ? (
                      <Text
                        className="text-2xs"
                        style={{
                          color:
                            meta.confidence === 'unmatched'
                              ? colors.warn
                              : colors['text-mute'],
                        }}
                        numberOfLines={1}
                        testID={`import-badge-${e.exercise}`}
                      >
                        {meta.confidence === 'unmatched'
                          ? `⚠ not in the library — ✕ and re-add, or keep as written`
                          : `≈ read as “${meta.raw}”`}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => cycleSets(e.exercise)}
                    accessibilityRole="button"
                    className="items-center justify-center rounded-pill border px-s2"
                    style={{ minHeight: 44, borderColor: `${colors.accent}59` }}
                  >
                    <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 10, ...pixelFont() }}>
                      {e.sets} SETS
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => cycleReps(e.exercise)}
                    accessibilityRole="button"
                    className="items-center justify-center rounded-pill border px-s2"
                    style={{ minHeight: 44, borderColor: `${colors.epic}59` }}
                  >
                    <Text
                      allowFontScaling={false}
                      style={{ fontSize: 10, color: colors.epic, ...pixelFont() }}
                    >
                      {e.reps}
                    </Text>
                  </Pressable>
                </View>
                );
              })
            )}
          </GlowCard>

          {/* The library, one muscle section at a time. */}
          <View>
            {/* Type a letter, get the exercise — the sections and the full
                picker stay as the browse paths. */}
            <View className="mb-s3">
              <ExerciseSearchBar
                onPick={(e) => addExercise(e.name)}
                excludeNames={dayList.map((x) => x.exercise)}
                placeholder="Add to this day — type to search…"
                testIDPrefix="routine-search"
              />
            </View>
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
                      borderColor: added ? `${colors.success}8c` : colors.border,
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
            title={savePlan.isPending ? 'SAVING…' : 'SAVE MY PLAN'}
            onPress={save}
            disabled={!canSave}
            busy={savePlan.isPending}
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

      {importOpen ? <PlanImportSheet onClose={() => setImportOpen(false)} onImported={seedFromImport} /> : null}
    </ScreenShell>
  );
}
