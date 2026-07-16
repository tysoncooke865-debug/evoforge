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
import { NumberField } from '@/ui/core/number-field';
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
  // HERO-ROW LOGGING (Tyson 2026-07-16): only the active set is expanded;
  // the rest are compact rows. `override` = a manually-tapped set to expand;
  // `locallyLogged` advances the hero the instant a set banks (before the
  // refetch); `justLoggedText` keeps a set's value visible until the row lands.
  const [override, setOverride] = useState<number | null>(null);
  const [locallyLogged, setLocallyLogged] = useState<Set<number>>(() => new Set());
  const [justLoggedText, setJustLoggedText] = useState<Record<number, string>>({});

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
        <View className="flex-1">
          <Text className="text-sm font-bold text-text-mute" numberOfLines={1}>
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

  // Which sets are banked (a valid row, or an optimistic local log). The union
  // lets the hero advance instantly, then self-corrects when the refetch lands.
  const rowFor = (setNo: number) =>
    loggedRows.find(
      (r) => (pyInt(r.set) ?? 0) === setNo && (pyFloat(r.weight) ?? 0) > 0 && (pyInt(r.reps) ?? 0) > 0
    );
  const isLogged = (setNo: number) => locallyLogged.has(setNo) || rowFor(setNo) !== undefined;
  const setNos = Array.from({ length: targetSets }, (_, i) => i + 1);
  const firstUnlogged = setNos.find((n) => !isLogged(n)) ?? null;
  const allDone = setNos.length > 0 && firstUnlogged === null;
  // THE one expanded row: a manual pick (bounded), else the first unlogged set.
  const heroSet = override !== null && override <= targetSets ? override : firstUnlogged;

  const onSetSaved = (setNo: number, display: string) => {
    setJustLoggedText((prev) => ({ ...prev, [setNo]: display }));
    setLocallyLogged((prev) => {
      const next = new Set(prev);
      next.add(setNo);
      return next;
    });
    setOverride(null); // snap the hero forward to the next unlogged set
  };

  const displayFor = (setNo: number): string | null => {
    const r = rowFor(setNo);
    if (r) return `${displayWeight(pyFloat(r.weight) ?? 0, unit)} ${unit} × ${pyInt(r.reps) ?? 0}`;
    return justLoggedText[setNo] ?? null;
  };

  return (
    <GlowCard glow={allDone ? tokens.colors.success : isNext ? activeColor : undefined}>
      <View className="mb-s1 flex-row items-center justify-between">
        <Text className="flex-1 text-base font-bold text-text" numberOfLines={1}>{exercise}</Text>
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
        {/* "EXERCISE 1 OF 4" replaces the confusing "▸ NEXT 0/4" — sets progress
            lives in the pips + compact rows below, not jammed into the title. */}
        {allDone ? (
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

      {/* Column header — only above the hero row. The weight header is the KG⇄LB
          toggle and now spans the value+stepper so "WEIGHT · KG" no longer
          truncates to "WEIGH…" (Tyson 2026-07-16). */}
      {heroSet !== null ? (
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
      ) : null}

      {/* Previous sets (compact, above) · the ONE active set (hero) · upcoming
          sets (compact, below). Tap any compact row to expand and edit it. */}
      {setNos.map((setNo) => {
        if (setNo === heroSet) {
          const existing = rowFor(setNo);
          const prefill = existing ? null : prefillForSet(last, setNo);
          return (
            <View
              key={setNo}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: `${activeColor}3a`,
                backgroundColor: `${activeColor}0d`,
                paddingHorizontal: 4,
                paddingTop: 4,
                marginBottom: 8,
              }}
            >
              <SetRow
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
                onSaved={onSetSaved}
                durable={durable}
                unit={unit}
              />
            </View>
          );
        }
        return (
          <CompactSetRow
            key={setNo}
            setNo={setNo}
            text={displayFor(setNo)}
            logged={isLogged(setNo)}
            compact={compact}
            onPress={() => setOverride(setNo)}
            testID={`${exercise}-compact-${setNo}`}
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
  prefill = null,
  onPr,
  tint,
  onLogged,
  onSaved,
  durable = false,
  unit,
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
  /** After a confirmed save: the parent advances the hero to the next set.
   *  `display` is the "60 kg × 8" string to show on the collapsed row. */
  onSaved?: (setNo: number, display: string) => void;
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
  // Brief "✓ LOGGED" confirmation + glow before the parent collapses this row
  // and focuses the next set (Tyson 2026-07-16).
  const [justSaved, setJustSaved] = useState(false);
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
        // THE conversion boundary: pounds become kilograms here and nowhere
        // else. kg mode passes through verbatim (no new rounding on metric).
        weight: toKgForSave(w, unit),
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
          const isPr = (verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr;
          if (isPr) onPr();
          // Retro reward SFX: a PR fanfare trumps the coin; a plain re-log ticks.
          if (isPr) playPr();
          else if (verdict.action === 'insert') playCoin();
          else if (verdict.action === 'update') playSelect();
          onLogged?.(verdict);
          // Show ✓ LOGGED + glow, then hand off so the parent advances the hero.
          setJustSaved(true);
          const display = `${w} ${unit} × ${Math.trunc(r)}`;
          setTimeout(() => onSaved?.(setNo, display), 850);
        },
      }
    );
  };

  const standardTint = tint === tokens.colors.accent;
  const compact = useCompact();
  const fieldW = compact ? FIELD_WIDTH_COMPACT : FIELD_WIDTH;
  return (
    <View
      className="flex-row items-center gap-s1 rounded-lg px-[2px] py-s1"
      style={
        justSaved
          ? {
              backgroundColor: 'rgba(52,211,153,0.10)',
              shadowColor: tokens.colors.success,
              shadowOpacity: 0.5,
              shadowRadius: 12,
            }
          : undefined
      }
    >
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
        disabled={save.isPending || justSaved}
        className={`ml-auto items-center justify-center rounded-md px-s3 py-s3 ${
          justSaved ? '' : logged ? 'border border-border bg-surface-2' : standardTint ? 'bg-accent' : ''
        }`}
        style={
          justSaved
            ? { backgroundColor: tokens.colors.success, minWidth: 62 }
            : logged
              ? { minWidth: 62 }
              : {
                  minWidth: 62,
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
        ) : justSaved ? (
          <Text className="text-xs font-bold" style={{ color: '#04121a' }}>✓ LOGGED</Text>
        ) : (
          <Text className={`text-sm font-bold ${logged ? 'text-text-dim' : 'text-accent-ink'}`}>
            {logged ? (compact ? 'SAVE' : 'UPDATE') : 'LOG'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/**
 * A collapsed set (Tyson 2026-07-16): one line for a previous or upcoming set,
 * so only the ACTIVE set carries full inputs. Tap to expand and edit. `text` is
 * the "60 kg × 8" recap; absent = not logged yet. `justLogged` glows briefly
 * after a save, right before the hero focuses the next set.
 */
function CompactSetRow({
  setNo,
  text,
  logged,
  compact,
  onPress,
  testID,
}: {
  setNo: number;
  text: string | null;
  logged: boolean;
  compact: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`set ${setNo}${text ? `, ${text}` : ''}, tap to edit`}
      testID={testID}
      className="mb-s1 flex-row items-center gap-s2 rounded-lg px-s3"
      style={{
        minHeight: 40,
        borderWidth: 1,
        borderColor: logged ? tokens.colors['border-soft'] : tokens.colors.border,
        backgroundColor: logged ? 'rgba(52,211,153,0.06)' : 'rgba(13,21,36,0.3)',
      }}
    >
      <Text
        className="text-2xs font-bold text-text-mute"
        style={{ width: compact ? 28 : 44, letterSpacing: compact ? 0 : 1 }}
      >
        {compact ? `S${setNo}` : `SET ${setNo}`}
      </Text>
      {logged && text ? (
        <Text className="flex-1 text-sm font-bold text-text" numberOfLines={1}>
          {text}
        </Text>
      ) : (
        <Text className="flex-1 text-sm text-text-mute">Tap to log</Text>
      )}
      {logged ? (
        <Text className="text-sm font-bold text-success">✓</Text>
      ) : (
        <Text className="text-base text-text-mute">›</Text>
      )}
    </Pressable>
  );
}
