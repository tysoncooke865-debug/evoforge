import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { useSaveSet } from '@/data/mutations';
import { lastPerformance, prefillForSet } from '@/domain/last-performance';
import { pyFloat, pyInt } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { FloatingXP } from '@/ui/floating-xp';
import { NumberField } from '@/ui/number-field';
import { schemeSentence } from '@/ui/scheme-sentence';
import { GlowCard } from '@/ui/shell';

/** Item 10: both value boxes share one fixed 4-char width (tabular-nums). */
const FIELD_WIDTH = 64;

/**
 * The exercise logging card — EXTRACTED from today.tsx (2026-07-12) so the
 * Arena's Volume Duel can be a Today-screen twin. Behaviour is identical to
 * the Today original (prefill from last session, update-in-place, FloatingXP
 * on real inserts only, PR callback); two seams were added:
 *   tint     — the competitive skin. Today omits it (standard cyan accent);
 *              the duel passes a battle colour and every accent-coloured
 *              element (glow, NEXT cue, pips, LOG button) follows.
 *   onLogged — fires with the confirmed SetVerdict after ANY successful
 *              save; the duel uses insert verdicts (rowId) to post
 *              battle_events. Today omits it.
 * The Today rendering-contract rules ride along: never celebrate an
 * unconfirmed save, and parents must key cards by day (SetRow seeds its
 * typed state once on mount).
 */

function firstUnlogged(
  loggedRows: import('@/domain/summary').WorkoutRow[],
  targetSets: number
): number | null {
  for (let n = 1; n <= targetSets; n++) {
    if (!loggedRows.some((r) => (pyInt(r.set) ?? 0) === n)) return n;
  }
  return null;
}

/** One pip per target set: filled = logged. Quest steps. */
function SetPips({ done, target, tint }: { done: number; target: number; tint: string }) {
  return (
    <View className="flex-row gap-s1">
      {Array.from({ length: target }, (_, i) => (
        <View
          key={i}
          style={{
            width: 14,
            height: 6,
            borderRadius: 3,
            backgroundColor: i < done ? tint : tokens.colors['surface-3'],
            shadowColor: tint,
            shadowOpacity: i < done ? 0.6 : 0,
            shadowRadius: 4,
          }}
        />
      ))}
    </View>
  );
}

export function ExerciseCard({
  date,
  workout,
  exercise,
  targetSets,
  scheme,
  loggedRows,
  allRows,
  doneCount,
  isNext,
  onPr,
  tint = tokens.colors.accent,
  onLogged,
}: {
  date: string;
  workout: string;
  exercise: string;
  targetSets: number;
  scheme: string;
  loggedRows: import('@/domain/summary').WorkoutRow[];
  allRows: import('@/domain/summary').WorkoutRow[];
  doneCount: number;
  isNext: boolean;
  onPr: () => void;
  tint?: string;
  onLogged?: (verdict: SetVerdict) => void;
}) {
  const done = doneCount >= targetSets;
  // What this athlete did LAST session on this exercise (IMPROVEMENT_PLAN #2).
  const last = lastPerformance(allRows, exercise, date);
  return (
    <GlowCard glow={done ? tokens.colors.success : isNext ? tint : undefined}>
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-bold text-text">{exercise}</Text>
        {isNext && !done ? (
          <Text className="mr-s2 text-xs font-bold" style={{ color: tint, letterSpacing: 1 }}>
            ▸ NEXT
          </Text>
        ) : null}
        <Text className={`text-xs font-bold ${done ? 'text-success' : 'text-text-mute'}`}>
          {done ? '✓ DONE' : `${doneCount}/${targetSets}`}
        </Text>
      </View>
      <View className="mb-s4 flex-row items-center justify-between">
        <Text className="text-xs text-text-dim">{schemeSentence(scheme)}</Text>
        <SetPips done={doneCount} target={targetSets} tint={tint} />
      </View>
      {/* Item 1.6: column headers mirror the row skeleton (same widths and
          gap classes as SetRow) so alignment is structural, not tuned. */}
      <View className="mb-s1 flex-row items-center gap-s1 px-[2px]">
        <View className="w-s10" />
        <View className="flex-row items-center gap-s1">
          <Text className="text-center text-2xs font-bold text-text-mute" style={{ width: FIELD_WIDTH, letterSpacing: 1 }}>
            WEIGHT (KG)
          </Text>
          <View style={{ width: 32 }} />
        </View>
        <View className="flex-row items-center gap-s1">
          <Text className="text-center text-2xs font-bold text-text-mute" style={{ width: FIELD_WIDTH, letterSpacing: 1 }}>
            REPS
          </Text>
          <View style={{ width: 32 }} />
        </View>
      </View>
      {Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
        const existing = loggedRows.find((r) => (pyInt(r.set) ?? 0) === setNo);
        const prefill = existing ? null : prefillForSet(last, setNo);
        // Item 1.2: the active set — first unlogged, only on the NEXT card,
        // so exactly one highlighted row exists on screen.
        const active = isNext && !existing && setNo === firstUnlogged(loggedRows, targetSets);
        return (
          <SetRow
            key={setNo}
            date={date}
            workout={workout}
            exercise={exercise}
            setNo={setNo}
            initialWeight={existing ? String(pyFloat(existing.weight) ?? '') : ''}
            initialReps={existing ? String(pyInt(existing.reps) ?? '') : ''}
            prefill={prefill}
            active={active}
            onPr={onPr}
            tint={tint}
            onLogged={onLogged}
          />
        );
      })}
    </GlowCard>
  );
}

function SetRow({
  date,
  workout,
  exercise,
  setNo,
  initialWeight,
  initialReps,
  prefill = null,
  active = false,
  onPr,
  tint,
  onLogged,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
  /** Last session's numbers for this set — shown editable, saved only on LOG. */
  prefill?: { weight: number; reps: number } | null;
  /** The one highlighted "you are here" row (first unlogged on the NEXT card). */
  active?: boolean;
  onPr: () => void;
  tint: string;
  onLogged?: (verdict: SetVerdict) => void;
}) {
  const [weight, setWeight] = useState(initialWeight !== '' ? initialWeight : prefill ? String(prefill.weight) : '');
  const [reps, setReps] = useState(initialReps !== '' ? initialReps : prefill ? String(prefill.reps) : '');
  // Item 1.7: prefill renders DIM until the athlete touches it. Steppers,
  // keypad DONE and desktop typing all funnel through onChange -> dirty.
  const [weightDirty, setWeightDirty] = useState(initialWeight !== '');
  const [repsDirty, setRepsDirty] = useState(initialReps !== '');
  const [floatXp, setFloatXp] = useState(false);
  const save = useSaveSet();
  const logged = initialWeight !== '';

  const onSave = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Logging a prefill as-is whitens both fields immediately (before the
    // refetch flips `logged`).
    setWeightDirty(true);
    setRepsDirty(true);
    save.mutate(
      {
        workoutDate: date,
        workout,
        exercise,
        setNo,
        weight: w,
        reps: Math.trunc(r),
      },
      {
        // Confirmed state only: the float fires on a REAL insert verdict,
        // never optimistically -- a failed save must not celebrate.
        onSuccess: (verdict) => {
          if (verdict.action === 'insert') setFloatXp(true);
          if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) onPr();
          onLogged?.(verdict);
        },
      }
    );
  };

  const standardTint = tint === tokens.colors.accent;
  // Item 1.2 (owner-approved neon-policy exception): the active set carries
  // a purple border + soft glow. Battles follow their tint instead of epic.
  const activeColor = standardTint ? tokens.colors.epic : tint;
  return (
    <View
      className="mb-s2 flex-row items-center gap-s1 rounded-lg px-[2px] py-s1"
      style={{
        // Constant-layout frame: the border always exists (transparent when
        // inactive) so the highlight moving between rows never reflows.
        borderWidth: 1,
        borderColor: active ? `${activeColor}8c` : 'transparent',
        backgroundColor: active ? `${activeColor}0f` : 'transparent',
        shadowColor: active ? activeColor : 'transparent',
        shadowOpacity: active ? 0.3 : 0,
        shadowRadius: 10,
        elevation: active ? 3 : 0,
      }}
    >
      {floatXp ? <FloatingXP amount={XP_PER_SET} onDone={() => setFloatXp(false)} /> : null}
      <View className="w-s10 justify-center">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
          SET {setNo}
        </Text>
      </View>
      <NumberField
        value={weight}
        onChange={(v) => {
          setWeightDirty(true);
          setWeight(v);
        }}
        step={2.5}
        bigStep={20}
        placeholder="kg"
        label="WEIGHT · KG"
        tint={tint}
        width={FIELD_WIDTH}
        dim={!logged && prefill !== null && !weightDirty}
        testID={`${exercise}-w-${setNo}`}
      />
      <NumberField
        value={reps}
        onChange={(v) => {
          setRepsDirty(true);
          setReps(v);
        }}
        step={1}
        integer
        placeholder="reps"
        label="REPS"
        tint={tint}
        width={FIELD_WIDTH}
        dim={!logged && prefill !== null && !repsDirty}
        testID={`${exercise}-r-${setNo}`}
      />
      <Pressable
        onPress={onSave}
        disabled={save.isPending}
        className={`ml-auto rounded-md px-s2 py-s2 ${logged ? 'border border-border bg-surface-2' : standardTint ? 'bg-accent' : ''}`}
        style={
          logged
            ? undefined
            : {
                backgroundColor: standardTint ? undefined : tint,
                shadowColor: tint,
                shadowOpacity: 0.45,
                shadowRadius: 10,
                elevation: 5,
              }
        }
        testID={`${exercise}-save-${setNo}`}
      >
        {save.isPending ? (
          <ActivityIndicator size="small" color={logged ? tint : '#04121a'} />
        ) : (
          <Text className={`text-xs font-bold ${logged ? 'text-text-dim' : 'text-accent-ink'}`}>
            {logged ? 'UPDATE' : 'LOG'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
