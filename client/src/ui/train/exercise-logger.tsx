import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';

import { useExercisePrefs, unitFor, useSetExerciseUnit } from '@/data/exercise-prefs';
import { useSaveSet } from '@/data/mutations';
import { lastPerformance, prefillForSet } from '@/domain/last-performance';
import { pyFloat, pyInt } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { WEIGHT_STEP, convertTyped, displayWeight, toKgForSave, type WeightUnit } from '@/domain/units';
import { XP_PER_SET } from '@/domain/xp';
import tokens from '@/theme/tokens';
import { FloatingXP } from '@/ui/character/floating-xp';
import { KeyPad, NumberField } from '@/ui/core/number-field';
import { playCoin, playPr, playSelect } from '@/ui/core/sound';
import { startRest } from '@/ui/train/rest-timer';
import { schemeSentence } from '@/ui/train/scheme-sentence';
import { GlowCard } from '@/ui/core/shell';

/** Item 10: both value boxes share one fixed 4-char width (tabular-nums).
 *  Sub-360px screens (iPhone SE1/5s) drop to the compact metrics — the only
 *  width where the row otherwise clips its LOG button (P2 size sweep). */
const FIELD_WIDTH = 66;
const FIELD_WIDTH_COMPACT = 50;
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
  position,
  total,
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
  onSubstitute,
  onRemove,
  onSkip,
  skipped = false,
  onAddSet,
  onRemoveSet,
  supersetWith = null,
  onSuperset,
  readOnly = false,
}: {
  date: string;
  workout: string;
  exercise: string;
  /** This exercise's 1-based place in the workout, for "EXERCISE 1 OF 4". */
  position?: number;
  total?: number;
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
  /** Tyson 2026-07-13: swap this exercise for a same-muscle alternative. */
  onSubstitute?: () => void;
  /** STAGE 1 — all optional, so the Battle Arena's usage is untouched.
   *  The caller decides what ✕ MEANS (removeAction degrades it to a skip
   *  when sets are already logged); this component only reports the tap. */
  onRemove?: () => void;
  onSkip?: () => void;
  /** Skipped = "not today": collapses to one ghost row with UNDO. */
  skipped?: boolean;
  onAddSet?: () => void;
  /** Undefined when at the floor (never orphan a logged row). */
  onRemoveSet?: () => void;
  /** SUPERSET (2026-07-18): partner exercise name when paired. */
  supersetWith?: string | null;
  /** Open the pair-picker (or unpair when already paired). */
  onSuperset?: () => void;
  /**
   * TRAIN_IMPROVEMENTS: the workout was FINISHED. Rows render as static text —
   * no inputs, no LOG. This is a UX lock, NOT a security boundary: RLS still
   * permits the write, and it does not need to stop it, because the XP contract
   * already makes an edit grant nothing. REOPEN (on the day's bar) unlocks.
   */
  readOnly?: boolean;
}) {
  const done = doneCount >= targetSets;
  const compact = useCompact();
  const fieldW = compact ? FIELD_WIDTH_COMPACT : FIELD_WIDTH;
  const stepperW = compact ? 24 : 28;
  // KG ⇄ LB, PER EXERCISE (migration 020). The unit is a lens, not a fact:
  // every stored number stays kg; SetRow converts at the input/display
  // boundary only. The pref rides user_exercise_prefs like a favourite star.
  const prefs = useExercisePrefs();
  const setExerciseUnit = useSetExerciseUnit();
  const unit: WeightUnit = unitFor(prefs.data, exercise);
  // What this athlete did LAST session on this exercise (IMPROVEMENT_PLAN #2).
  const last = lastPerformance(allRows, exercise, date);
  // Tyson 2026-07-13: the purple "you are here" highlight belongs to the
  // WHOLE exercise card, not one set row. Battles follow their tint.
  const activeColor = tint === tokens.colors.accent ? tokens.colors.epic : tint;

  // SKIPPED = "not today". The card collapses to a ghost row: the exercise is
  // still visible (you chose to skip it, you didn't imagine it), any sets you
  // already logged still count, and UNDO is one tap. Its obligation is
  // clamped by the caller's planTotals, so the day bar stays honest.
  if (skipped) {
    return (
      <View
        className="flex-row items-center justify-between rounded-xl px-s4 py-s3"
        style={{ borderWidth: 1, borderColor: tokens.colors.border, backgroundColor: 'rgba(13,21,36,0.4)' }}
      >
        <View className="flex-1 pr-s2">
          <Text className="text-sm font-bold text-text-mute">
            {exercise}
          </Text>
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
            SKIPPED{doneCount > 0 ? ` · ${doneCount} SET${doneCount === 1 ? '' : 'S'} BANKED` : ''}
          </Text>
        </View>
        {onSkip ? (
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel={`undo skip ${exercise}`}
            testID={`${exercise}-unskip`}
            className="items-center justify-center px-s2"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              UNDO
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (readOnly) {
    const logged = Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
      const r = loggedRows.find((x) => (pyInt(x.set) ?? 0) === setNo);
      const w = r ? (pyFloat(r.weight) ?? 0) : 0;
      const reps = r ? (pyInt(r.reps) ?? 0) : 0;
      return { setNo, w, reps, done: w > 0 && reps > 0 };
    });
    return (
      <GlowCard glow={done ? tokens.colors.success : undefined}>
        <View className="mb-s2 flex-row items-center justify-between">
          <Text className="flex-1 text-base font-bold text-text">{exercise}</Text>
          <Text className={`text-xs font-bold ${done ? 'text-success' : 'text-text-mute'}`}>
            {done ? '✓ DONE' : `${doneCount}/${targetSets}`}
          </Text>
        </View>
        {logged.map((l) => (
          <View key={l.setNo} className="flex-row items-center justify-between py-s1">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1 }}>
              SET {l.setNo}
            </Text>
            <Text
              className={`text-sm font-bold ${l.done ? 'text-text' : 'text-text-mute'}`}
              testID={`${exercise}-locked-${l.setNo}`}
            >
              {l.done ? `${displayWeight(l.w, unit)} ${unit} × ${l.reps}` : '—'}
            </Text>
          </View>
        ))}
      </GlowCard>
    );
  }

  return (
    <GlowCard glow={done ? tokens.colors.success : isNext ? activeColor : undefined}>
      <View className="mb-s1 flex-row items-center justify-between">
        {/* Full name, wraps — never truncated (Tyson 2026-07-17). */}
        <Text className="flex-1 pr-s2 text-base font-bold text-text">{exercise}</Text>
        {onSubstitute ? (
          <Pressable
            onPress={onSubstitute}
            accessibilityRole="button"
            accessibilityLabel={`substitute ${exercise}`}
            className="mr-s1 items-center justify-center"
            style={{ minWidth: 40, minHeight: 40 }}
            testID={`${exercise}-substitute`}
          >
            <Text className="text-base" style={{ color: tint }}>⇄</Text>
          </Pressable>
        ) : null}
        {/* "EXERCISE 1 OF 4" replaces the confusing "▸ NEXT 0/4"; set progress
            is the pips below. */}
        {done ? (
          <Text className="text-xs font-bold text-success">✓ DONE</Text>
        ) : position && total ? (
          <Text
            className="text-2xs font-bold"
            style={{ color: isNext ? activeColor : tokens.colors['text-mute'], letterSpacing: 0.5 }}
          >
            EXERCISE {position} OF {total}
          </Text>
        ) : (
          <Text className="text-xs font-bold text-text-mute">{doneCount}/{targetSets}</Text>
        )}
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`remove ${exercise}`}
            testID={`${exercise}-remove`}
            className="ml-s1 items-center justify-center"
            style={{ minWidth: 40, minHeight: 40 }}
          >
            <Text className="text-sm text-text-mute">✕</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mb-s2 flex-row items-center justify-between">
        <Text className="text-xs text-text-dim">{schemeSentence(scheme)}</Text>
        <SetPips done={doneCount} target={targetSets} tint={tint} />
      </View>
      {supersetWith ? (
        <View className="mb-s2 self-start rounded-pill border px-s2 py-s1" style={{ borderColor: `${tokens.colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.08)' }}>
          <Text allowFontScaling={false} className="text-2xs font-bold text-epic" style={{ letterSpacing: 0.5 }} testID={`${exercise}-superset-chip`}>
            SUPERSET · {supersetWith.toUpperCase()}
          </Text>
        </View>
      ) : null}

      {/* Column header. The weight header is the KG⇄LB toggle and spans the
          value+stepper so "WEIGHT · KG" no longer truncates to "WEIGH…". */}
      <View className="mb-s1 flex-row items-center gap-s1 px-[2px]">
        <View style={{ width: compact ? 30 : 40 }} />
        <Pressable
          onPress={() => setExerciseUnit.mutate({ exercise, unit: unit === 'kg' ? 'lb' : 'kg' })}
          accessibilityRole="button"
          accessibilityLabel={`switch ${exercise} to ${unit === 'kg' ? 'pounds' : 'kilograms'}`}
          testID={`${exercise}-unit`}
          style={{ width: fieldW + stepperW + 4, minHeight: 24, justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8 }}
        >
          <Text className="text-2xs font-bold" style={{ letterSpacing: 0.5, color: tint }} numberOfLines={1}>
            {compact ? `WEIGHT ${unit.toUpperCase()}` : `WEIGHT · ${unit.toUpperCase()} ⇄`}
          </Text>
        </Pressable>
        <Text
          className="text-2xs font-bold text-text-mute"
          style={{ width: fieldW + stepperW + 4, letterSpacing: 0.5 }}
        >
          REPS
        </Text>
      </View>

      {/* Every set is a full, editable row (Tyson 2026-07-17: all sets visible). */}
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
            initialNotes={existing ? String((existing as Record<string, unknown>).notes ?? '') : ''}
            prefill={prefill}
            onPr={onPr}
            tint={tint}
            onLogged={onLogged}
            durable={durable}
            unit={unit}
          />
        );
      })}

      {/* STAGE 1 — the footer controls. One VISIBLE tap per action: no kebab,
          no long-press, no hidden gesture. Rendered only when the caller
          supplies the handler, so battles get none of it. − SET is absent
          (not disabled) at the floor: there is nothing to explain, the row
          below it is logged. */}
      {onAddSet || onRemoveSet || onSkip ? (
        <View className="mt-s2 flex-row items-center border-t border-border-soft pt-s1">
          {onAddSet ? (
            <Pressable
              onPress={onAddSet}
              accessibilityRole="button"
              accessibilityLabel={`add a set to ${exercise}`}
              testID={`${exercise}-add-set`}
              className="items-center justify-center px-s2"
              style={{ minHeight: 44 }}
            >
              <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
                ＋ SET
              </Text>
            </Pressable>
          ) : null}
          {onRemoveSet ? (
            <Pressable
              onPress={onRemoveSet}
              accessibilityRole="button"
              accessibilityLabel={`remove a set from ${exercise}`}
              testID={`${exercise}-remove-set`}
              className="items-center justify-center px-s2"
              style={{ minHeight: 44 }}
            >
              <Text className="text-2xs font-bold text-text-dim" style={{ letterSpacing: 1.5 }}>
                − SET
              </Text>
            </Pressable>
          ) : null}
          {onSuperset ? (
            <Pressable
              onPress={onSuperset}
              accessibilityRole="button"
              accessibilityLabel={supersetWith ? `unpair superset for ${exercise}` : `superset ${exercise} with another exercise`}
              testID={`${exercise}-superset`}
              className="items-center justify-center px-s2"
              style={{ minHeight: 44 }}
            >
              <Text className="text-2xs font-bold" style={{ letterSpacing: 1.5, color: supersetWith ? tokens.colors.epic : tokens.colors['text-dim'] }}>
                {supersetWith ? 'UNPAIR' : 'SUPERSET'}
              </Text>
            </Pressable>
          ) : null}
          {onSkip ? (
            <Pressable
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={`skip ${exercise} today`}
              testID={`${exercise}-skip`}
              className="ml-auto items-center justify-center px-s2"
              style={{ minHeight: 44 }}
            >
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
                SKIP TODAY
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
  initialNotes = '',
  prefill = null,
  onPr,
  tint,
  onLogged,
  durable = false,
  unit,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
  /** The row's saved notes — DROPS ride here ("DROPS: 50x6, 40x5"). */
  initialNotes?: string;
  /** Last session's numbers for this set — shown editable, saved only on LOG. */
  prefill?: { weight: number; reps: number } | null;
  onPr: () => void;
  tint: string;
  onLogged?: (verdict: SetVerdict) => void;
  durable?: boolean;
  /** The lens: what the athlete types/reads. Props and saves are ALWAYS kg. */
  unit: WeightUnit;
}) {
  // Seeds arrive as kg (log rows / last-session prefill) and are painted in
  // the exercise's unit. Typed state lives in that unit until save.
  const [weight, setWeight] = useState(
    initialWeight !== ''
      ? displayWeight(pyFloat(initialWeight) ?? 0, unit)
      : prefill
        ? displayWeight(prefill.weight, unit)
        : ''
  );
  const [reps, setReps] = useState(initialReps !== '' ? initialReps : prefill ? String(prefill.reps) : '');
  // Flipping the toggle converts the string UNDER the athlete, in place —
  // dirty flags untouched, half-typed garbage left alone (convertTyped).
  // Render-time adjustment, not an effect: set-state-in-effect is a lint
  // error in this repo, and this is the React-documented derived-state form.
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setWeight(convertTyped(weight, prevUnit, unit));
  }
  // Item 1.7: prefill renders DIM until the athlete touches it. Steppers,
  // keypad DONE and desktop typing all funnel through onChange -> dirty.
  const [weightDirty, setWeightDirty] = useState(initialWeight !== '');
  const [repsDirty, setRepsDirty] = useState(initialReps !== '');
  const [floatXp, setFloatXp] = useState(false);
  // DROP SETS (2026-07-18): back-off mini-sets after the working set, stored
  // in the row's notes — ONE set row, ONE XP grant (the anti-farm contract).
  // Entry = warm keypad for weight, then reps; each drop autosaves.
  const parseDrops = (n: string) => (n.startsWith('DROPS: ') ? n.slice(7).split(', ').filter(Boolean) : []);
  const [drops, setDrops] = useState<string[]>(() => parseDrops(initialNotes));
  const [dropPad, setDropPad] = useState<null | { stage: 'w' | 'r'; w?: string; keep?: boolean }>(null);
  const save = useSaveSet();
  const logged = initialWeight !== '';

  const saveDrops = (next: string[]) => {
    setDrops(next);
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    save.mutate({
      workoutDate: date,
      workout,
      exercise,
      setNo,
      weight: toKgForSave(w, unit),
      reps: Math.trunc(r),
      notes: next.length ? `DROPS: ${next.join(', ')}` : '',
      durable,
    });
  };

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
        // THE conversion boundary: pounds become kilograms here and nowhere
        // else. kg mode passes through verbatim (no new rounding on metric).
        weight: toKgForSave(w, unit),
        reps: Math.trunc(r),
        notes: drops.length ? `DROPS: ${drops.join(', ')}` : '',
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
          const isPr = (verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr;
          if (isPr) onPr();
          // Retro reward SFX: a PR fanfare trumps the coin; a plain re-log ticks.
          if (isPr) playPr();
          else if (verdict.action === 'insert') playCoin();
          else if (verdict.action === 'update') playSelect();
          onLogged?.(verdict);
        },
      }
    );
  };

  const standardTint = tint === tokens.colors.accent;
  const compact = useCompact();
  const fieldW = compact ? FIELD_WIDTH_COMPACT : FIELD_WIDTH;
  return (
    <View className="mb-s2">
    <View className="flex-row items-center gap-s1 px-[2px] py-s1">
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
        step={WEIGHT_STEP[unit].step}
        bigStep={WEIGHT_STEP[unit].bigStep}
        quickSteps={WEIGHT_STEP[unit].quick}
        placeholder={unit}
        label={`WEIGHT · ${unit.toUpperCase()}`}
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
    {/* Drop-set chips + the add affordance (once the set is banked). */}
    {logged || drops.length > 0 ? (
      <View className="flex-row flex-wrap items-center px-[2px]" style={{ gap: 6 }}>
        {drops.map((d, i) => (
          <Pressable
            key={`${d}:${i}`}
            onPress={() => saveDrops(drops.filter((_, j) => j !== i))}
            accessibilityRole="button"
            accessibilityLabel={`remove drop ${d}`}
            className="rounded-pill border px-s2 py-s1"
            style={{ borderColor: `${tokens.colors.warn}59`, backgroundColor: 'rgba(251,191,36,0.07)' }}
            testID={`${exercise}-drop-${setNo}-${i}`}
          >
            <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: tokens.colors.warn }}>
              ↓ {d} ✕
            </Text>
          </Pressable>
        ))}
        {logged ? (
          <Pressable
            onPress={() => setDropPad({ stage: 'w' })}
            accessibilityRole="button"
            accessibilityLabel={`add a drop set to set ${setNo}`}
            className="rounded-pill border px-s2 py-s1"
            style={{ borderColor: tokens.colors.border, minHeight: 28, justifyContent: 'center' }}
            testID={`${exercise}-adddrop-${setNo}`}
          >
            <Text allowFontScaling={false} className="text-2xs font-bold text-text-dim">＋ DROP</Text>
          </Pressable>
        ) : null}
      </View>
    ) : null}
    {dropPad ? (
      <KeyPad
        label={dropPad.stage === 'w' ? `DROP WEIGHT · ${unit.toUpperCase()}` : 'DROP REPS'}
        initial=""
        integer={dropPad.stage === 'r'}
        tint={tokens.colors.warn}
        quickSteps={dropPad.stage === 'w' ? WEIGHT_STEP[unit].quick : undefined}
        onDone={(v) => {
          const n = pyFloat(v);
          if (n === null || n <= 0) return;
          if (dropPad.stage === 'w') {
            // KeyPad fires onDone THEN onClose — `keep` survives that close
            // exactly once, so the reps pad stays up.
            setDropPad({ stage: 'r', w: v, keep: true });
          } else {
            saveDrops([...drops, `${dropPad.w}×${Math.trunc(n)}`]);
            setDropPad(null);
          }
        }}
        onClose={() => setDropPad((p) => (p?.keep ? { ...p, keep: false } : null))}
      />
    ) : null}
    </View>
  );
}
