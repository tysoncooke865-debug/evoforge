import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { useSaveSet } from '@/data/mutations';
import { lastPerformance, prefillForSet } from '@/domain/last-performance';
import { pyFloat, pyInt } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { FloatingXP } from '@/ui/floating-xp';
import { NumberField } from '@/ui/number-field';
import { startRest } from '@/ui/rest-timer';
import { schemeSentence } from '@/ui/scheme-sentence';
import { GlowCard } from '@/ui/shell';

/** Item 10: both value boxes share one fixed 4-char width (tabular-nums).
 *  Sub-360px screens (iPhone SE1/5s) drop to the compact metrics — the only
 *  width where the row otherwise clips its LOG button (P2 size sweep). */
const FIELD_WIDTH = 64;
const FIELD_WIDTH_COMPACT = 48;
const useCompact = () => useWindowDimensions().width < 360;

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
  durable = false,
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
  /** TRANSFORM P2: offline-first queued inserts (Today/Train). Battles
   *  stay direct — battle_events need a server-confirmed row. */
  durable?: boolean;
}) {
  const done = doneCount >= targetSets;
  const compact = useCompact();
  const fieldW = compact ? FIELD_WIDTH_COMPACT : FIELD_WIDTH;
  const stepperW = compact ? 26 : 32;
  // What this athlete did LAST session on this exercise (IMPROVEMENT_PLAN #2).
  const last = lastPerformance(allRows, exercise, date);
  // Tyson 2026-07-13: the purple "you are here" highlight belongs to the
  // WHOLE exercise card, not one set row. Battles follow their tint.
  const activeColor = tint === tokens.colors.accent ? tokens.colors.epic : tint;
  return (
    <GlowCard glow={done ? tokens.colors.success : isNext ? activeColor : undefined}>
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-bold text-text">{exercise}</Text>
        {isNext && !done ? (
          <Text className="mr-s2 text-xs font-bold" style={{ color: activeColor, letterSpacing: 1 }}>
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
        <View style={{ width: compact ? 30 : 40 }} />
        <View className="flex-row items-center gap-s1">
          <Text className="text-center text-2xs font-bold text-text-mute" style={{ width: fieldW, letterSpacing: 1 }} numberOfLines={1}>
            {compact ? 'KG' : 'WEIGHT (KG)'}
          </Text>
          <View style={{ width: stepperW }} />
        </View>
        <View className="flex-row items-center gap-s1">
          <Text className="text-center text-2xs font-bold text-text-mute" style={{ width: fieldW, letterSpacing: 1 }}>
            REPS
          </Text>
          <View style={{ width: stepperW }} />
        </View>
      </View>
      {Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
        const existing = loggedRows.find((r) => (pyInt(r.set) ?? 0) === setNo);
        const prefill = existing ? null : prefillForSet(last, setNo);
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
            onPr={onPr}
            tint={tint}
            onLogged={onLogged}
            durable={durable}
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
  onPr,
  tint,
  onLogged,
  durable = false,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
  /** Last session's numbers for this set — shown editable, saved only on LOG. */
  prefill?: { weight: number; reps: number } | null;
  onPr: () => void;
  tint: string;
  onLogged?: (verdict: SetVerdict) => void;
  durable?: boolean;
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
        durable,
      },
      {
        // Confirmed state only: the float fires on a REAL insert verdict,
        // never optimistically -- a failed save must not celebrate.
        onSuccess: (verdict) => {
          if (verdict.action === 'insert') {
            setFloatXp(true);
            // P2: the rest clock starts the moment a NEW set banks.
            startRest();
          }
          if ((verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr) onPr();
          onLogged?.(verdict);
        },
      }
    );
  };

  const standardTint = tint === tokens.colors.accent;
  const compact = useCompact();
  const fieldW = compact ? FIELD_WIDTH_COMPACT : FIELD_WIDTH;
  return (
    <View className="mb-s2 flex-row items-center gap-s1 px-[2px] py-s1">
      {floatXp ? <FloatingXP amount={XP_PER_SET} onDone={() => setFloatXp(false)} /> : null}
      <View className="justify-center" style={{ width: compact ? 30 : 40 }}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: compact ? 0 : 1 }}>
          {compact ? `S${setNo}` : `SET ${setNo}`}
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
        width={fieldW}
        narrow={compact}
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
        width={fieldW}
        narrow={compact}
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
            {logged ? (compact ? '✓' : 'UPDATE') : 'LOG'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
