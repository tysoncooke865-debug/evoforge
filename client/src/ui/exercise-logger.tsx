import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useSaveSet } from '@/data/mutations';
import { lastPerformance, prefillForSet } from '@/domain/last-performance';
import { pyFloat, pyInt } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { FloatingXP } from '@/ui/floating-xp';
import { GlowCard } from '@/ui/shell';

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
        <Text className="text-xs text-text-mute">{scheme}</Text>
        <SetPips done={doneCount} target={targetSets} tint={tint} />
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
            lastDate={last?.date ?? null}
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
  lastDate = null,
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
  lastDate?: string | null;
  onPr: () => void;
  tint: string;
  onLogged?: (verdict: SetVerdict) => void;
}) {
  const [weight, setWeight] = useState(initialWeight !== '' ? initialWeight : prefill ? String(prefill.weight) : '');
  const [reps, setReps] = useState(initialReps !== '' ? initialReps : prefill ? String(prefill.reps) : '');
  const [floatXp, setFloatXp] = useState(false);
  const save = useSaveSet();
  const logged = initialWeight !== '';
  const showLast = !logged && prefill !== null;

  const onSave = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
  return (
    <View className="mb-s2 flex-row items-center gap-s2">
      {floatXp ? <FloatingXP amount={XP_PER_SET} onDone={() => setFloatXp(false)} /> : null}
      <View className="w-s10">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
          SET {setNo}
        </Text>
        {showLast ? (
          <Text className="text-2xs" style={{ color: tokens.colors['text-mute'], fontSize: 9, letterSpacing: 0.5 }}>
            LAST{lastDate ? ` ${lastDate.slice(5)}` : ''}
          </Text>
        ) : null}
      </View>
      <TextInput
        className="w-[84px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
        inputMode="decimal"
        placeholder="kg"
        placeholderTextColor="#64758f"
        value={weight}
        onChangeText={setWeight}
        testID={`${exercise}-w-${setNo}`}
      />
      <Text className="text-text-mute">×</Text>
      <TextInput
        className="w-[64px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
        inputMode="numeric"
        placeholder="reps"
        placeholderTextColor="#64758f"
        value={reps}
        onChangeText={setReps}
        testID={`${exercise}-r-${setNo}`}
      />
      <Pressable
        onPress={onSave}
        disabled={save.isPending}
        className={`ml-auto rounded-md px-s3 py-s2 ${logged ? 'border border-border bg-surface-2' : standardTint ? 'bg-accent' : ''}`}
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
