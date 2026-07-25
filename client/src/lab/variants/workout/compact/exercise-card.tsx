import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useExercisePrefs, unitFor, useSetExerciseUnit } from '@/data/exercise-prefs';
import { lastPerformance, prefillForSet } from '@/domain/last-performance';
import { pyFloat, pyInt } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { displayWeight, type WeightUnit } from '@/domain/units';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

import { CardHeader } from './card-header';
import { badgeText, collapsedSummary, logButtonState } from './model';
import { OverflowMenu } from './overflow-menu';
import { CompactSetRow } from './set-row';
import { TargetLastRows } from './target-last-rows';

/**
 * COMPACT variant ExerciseCard — the redesigned card (reqs 4-20), forked
 * from the baseline logger. Structure: CardHeader → TARGET/LAST rows →
 * superset chip → set rows (three-state LOG via logButtonState) → footer
 * with all four actions always visible. Frame is a flat View (rounded-lg,
 * 1px border) — GlowCard's gradient + padding fought the density budget.
 * Purple marks ONLY the active (isNext) exercise (req 14).
 *
 * Known limitations (data model, not UI): no rest-time field exists, and
 * weight increments are global per unit (WEIGHT_STEP) — never per exercise.
 */
export function CompactExerciseCard({
  date,
  workout,
  exercise,
  position,
  targetSets,
  scheme,
  loggedRows,
  allRows,
  doneCount,
  isNext,
  onPr,
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
  collapsed,
  onToggleCollapsed,
  removeDegradesToSkip,
}: {
  date: string;
  workout: string;
  exercise: string;
  /** 1-based position — the two-digit badge. */
  position: number;
  targetSets: number;
  scheme: string;
  loggedRows: import('@/domain/summary').WorkoutRow[];
  allRows: import('@/domain/summary').WorkoutRow[];
  doneCount: number;
  isNext: boolean;
  onPr: () => void;
  onLogged?: (verdict: SetVerdict) => void;
  durable?: boolean;
  onSubstitute?: () => void;
  onRemove?: () => void;
  onSkip?: () => void;
  skipped?: boolean;
  onAddSet?: () => void;
  /** Undefined when at the floor — the button renders DISABLED, not hidden
   *  (req 16 divergence from the live card's absent-at-floor). */
  onRemoveSet?: () => void;
  supersetWith?: string | null;
  onSuperset?: () => void;
  readOnly?: boolean;
  /** Page-owned (survives reorder remounts). Absent key = expanded. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** removeAction(facts) !== 'remove' — the menu says so honestly. */
  removeDegradesToSkip: boolean;
}) {
  const colors = useThemeColors();
  const done = doneCount >= targetSets;
  const [menuOpen, setMenuOpen] = useState(false);
  // KG ⇄ LB, PER EXERCISE (migration 020) — the unit is a lens, not a fact.
  const prefs = useExercisePrefs();
  const setExerciseUnit = useSetExerciseUnit();
  const unit: WeightUnit = unitFor(prefs.data, exercise);
  const last = lastPerformance(allRows, exercise, date);
  const loggedSetNos = loggedRows
    .map((r) => pyInt(r.set) ?? 0)
    .filter((n) => n >= 1 && n <= targetSets);

  const frame = {
    borderRadius: 18,
    borderWidth: isNext ? 1.5 : 1,
    borderColor: done
      ? `${colors.success}59`
      : isNext
        ? colors.epic
        : colors.border,
    backgroundColor: colors.surface,
    ...(isNext
      ? { shadowColor: colors.epic, shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 }
      : null),
  };

  // SKIPPED = "not today" — the baseline's ghost row, verbatim behaviour.
  if (skipped) {
    return (
      <View
        className="flex-row items-center justify-between px-s4 py-s3"
        style={{ ...frame, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.4)' }}
      >
        <View className="flex-1 pr-s2">
          <Text className="text-sm font-bold text-text-mute">{exercise}</Text>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, color: colors['text-mute'], ...pixelFont(false) }}
          >
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
            <Text
              allowFontScaling={false}
              style={{ fontSize: 11, letterSpacing: 1, color: colors.accent, ...pixelFont() }}
            >
              UNDO
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // COLLAPSED (req 15): one row — badge · name · n/N SETS · ⌄. Data intact.
  if (collapsed) {
    return (
      <Pressable
        onPress={onToggleCollapsed}
        accessibilityRole="button"
        accessibilityLabel={`expand ${exercise}`}
        accessibilityState={{ expanded: false }}
        className="flex-row items-center gap-s2 px-s3"
        style={{ ...frame, minHeight: 48 }}
        testID={`${exercise}-collapsed`}
      >
        <Text
          allowFontScaling={false}
          style={{ fontSize: 12, color: done ? colors.success : isNext ? colors.epic : colors['text-dim'], ...pixelFont() }}
        >
          {badgeText(position)}
        </Text>
        <Text className="flex-1 text-sm font-bold text-text" numberOfLines={1}>
          {exercise}
        </Text>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 0.5, color: done ? colors.success : colors['text-mute'], ...pixelFont(false) }}
        >
          {done ? '✓ DONE' : collapsedSummary(doneCount, targetSets)}
        </Text>
        <Text className="text-sm text-text-dim">⌄</Text>
      </Pressable>
    );
  }

  if (readOnly) {
    const rows = Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
      const r = loggedRows.find((x) => (pyInt(x.set) ?? 0) === setNo);
      const w = r ? (pyFloat(r.weight) ?? 0) : 0;
      const reps = r ? (pyInt(r.reps) ?? 0) : 0;
      return { setNo, w, reps, done: Boolean(r) && w >= 0 && reps > 0 };
    });
    return (
      <View style={{ ...frame, padding: 12 }}>
        <CardHeader
          position={position}
          exercise={exercise}
          isNext={false}
          done={done}
          collapsed={false}
          onToggleCollapsed={onToggleCollapsed}
        />
        {rows.map((l) => (
          <View key={l.setNo} className="flex-row items-center justify-between py-s1">
            <Text
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1, color: colors['text-mute'], ...pixelFont(false) }}
            >
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
      </View>
    );
  }

  const footerAction = (
    label: string,
    color: string,
    onPress: (() => void) | undefined,
    testID: string,
    pushRight = false
  ) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label.toLowerCase()} — ${exercise}`}
      accessibilityState={{ disabled: !onPress }}
      className={`items-center justify-center px-s2 ${pushRight ? 'ml-auto' : ''}`}
      style={{ minHeight: 44, opacity: onPress ? 1 : 0.35 }}
      testID={testID}
    >
      <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, color, ...pixelFont() }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ ...frame, padding: 12 }}>
      <CardHeader
        position={position}
        exercise={exercise}
        isNext={isNext}
        done={done}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
        onSubstitute={onSubstitute}
        onOpenMenu={onRemove || onSkip || onSubstitute ? () => setMenuOpen(true) : undefined}
      />
      <View style={{ marginTop: 8, marginBottom: 12 }}>
        <TargetLastRows
          exercise={exercise}
          scheme={scheme}
          unit={unit}
          onToggleUnit={() => setExerciseUnit.mutate({ exercise, unit: unit === 'kg' ? 'lb' : 'kg' })}
        />
      </View>
      {supersetWith ? (
        <View
          className="mb-s2 self-start rounded-pill border px-s2 py-s1"
          style={{ borderColor: `${colors.epic}59`, backgroundColor: 'rgba(168,85,247,0.08)' }}
        >
          <Text
            allowFontScaling={false}
            className="text-2xs font-bold text-epic"
            style={{ letterSpacing: 0.5 }}
            testID={`${exercise}-superset-chip`}
          >
            SUPERSET · {supersetWith.toUpperCase()}
          </Text>
        </View>
      ) : null}

      {Array.from({ length: targetSets }, (_, i) => i + 1).map((setNo) => {
        const existing = loggedRows.find((r) => (pyInt(r.set) ?? 0) === setNo);
        const prefill = existing ? null : prefillForSet(last, setNo);
        return (
          <CompactSetRow
            key={setNo}
            date={date}
            workout={workout}
            exercise={exercise}
            setNo={setNo}
            initialWeight={existing ? String(pyFloat(existing.weight) ?? '') : ''}
            initialReps={existing ? String(pyInt(existing.reps) ?? '') : ''}
            initialNotes={existing ? String((existing as Record<string, unknown>).notes ?? '') : ''}
            prefill={prefill}
            logState={logButtonState(setNo, loggedSetNos, targetSets, isNext)}
            onPr={onPr}
            onLogged={onLogged}
            durable={durable}
            unit={unit}
          />
        );
      })}

      {/* Footer (req 16): all four actions ALWAYS visible; the floor renders
          − SET disabled, never hidden — removing a set and deleting an
          exercise stay separate actions (deletion lives in the ⋯ menu). */}
      <View
        className="flex-row items-center border-t border-border-soft"
        style={{ marginTop: 4, paddingTop: 8, paddingBottom: 2 }}
      >
        {footerAction('＋ SET', colors.accent, onAddSet, `${exercise}-add-set`)}
        {footerAction('− SET', `${colors.accent}8c`, onRemoveSet, `${exercise}-remove-set`)}
        {footerAction(
          supersetWith ? 'UNPAIR' : '⛓ SUPERSET',
          supersetWith ? colors.epic : `${colors.epic}cc`,
          onSuperset,
          `${exercise}-superset`
        )}
        {footerAction('SKIP TODAY', colors['text-mute'], onSkip, `${exercise}-skip`, true)}
      </View>

      <OverflowMenu
        visible={menuOpen}
        exercise={exercise}
        onClose={() => setMenuOpen(false)}
        onSubstitute={onSubstitute}
        onSkip={onSkip}
        onRemove={onRemove}
        removeDegradesToSkip={removeDegradesToSkip}
      />
    </View>
  );
}
