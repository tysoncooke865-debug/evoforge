/**
 * PAGE LAB — CALCULATOR: the RECALCULATE sheet (new for this variant,
 * prototyped 2026-08-21). The live ✦ RECALCULATE opens the AI intake, which
 * short-circuits to a read-only review — effectively a dead end. This sheet
 * is the replacement thesis: a LOCAL, fully editable calculator. Every
 * number comes from domain maths on the device (dualRateTargets over
 * Mifflin–St Jeor); no network, no AI, and the CUT and BULK rates are
 * independent selections (./model — the variant's one real idea).
 *
 * Structure is the ManualTargetSheet's bottom-sheet Modal (fuel.tsx),
 * scrollable because four sections outgrow one screen. APPLY writes through
 * the lab save-target shim — same mutation shape as the live intake, with
 * `rateGainKgPerWeek` riding the inputs jsonb beside the cut rate.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentStats } from '@/data/use-current-stats';
import {
  ACTIVITY_LABEL,
  GOAL_SHORT,
  type Activity,
  type Goal,
  type TargetInputs,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { useLabSaveTarget as useSaveTarget } from '@/lab/mock/mutations';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NumberField } from '@/ui/core/number-field';
import { SectionLabel } from '@/ui/core/screen-header';

import {
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  dualIntakeError,
  dualRateInputsFromStored,
  dualRateTargets,
  legWithinDb,
  type DualRateInputs,
} from './model';

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];
const ACTIVITIES: readonly Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very'];
/** The rate chips, both rows — [0, MAX_RATE_KG_PER_WEEK] in plate steps. */
const RATE_STEPS = [0.25, 0.5, 0.75, 1] as const;
/** The cut-rate seed when no stored row carries one — the moderate-cut
 *  convention, NOT tied to the bulk default (independence is the point). */
const DEFAULT_LOSS_RATE_KG_PER_WEEK = 0.5;

/** One decimal, or blank — a null stat prefills as EMPTY, never a guess. */
const fmtOrBlank = (n: number | null): string => (n === null ? '' : String(Math.round(n * 10) / 10));

/** The numbered section headers — 10px pixel on text-dim (the craft floor:
 *  below 12px is text-dim, never text-mute). */
function StepLabel({ children }: { children: string }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      className="mb-s2 mt-s3"
      style={{ fontSize: 10, letterSpacing: 1.5, color: colors['text-dim'], ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}

/** The small caption above each NumberField — same floor as StepLabel. */
function FieldLabel({ children }: { children: string }) {
  const colors = useThemeColors();
  return (
    <Text
      allowFontScaling={false}
      className="mb-s1"
      style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}
    >
      {children}
    </Text>
  );
}

export function RecalculateSheet({
  open,
  stored,
  currentGoal,
  todayIso,
  onClose,
}: {
  open: boolean;
  /** The target row's inputs jsonb — may predate the dual-rate model. */
  stored: (Partial<TargetInputs> & { rateGainKgPerWeek?: unknown }) | null;
  currentGoal: Goal;
  todayIso: string;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const stats = useCurrentStats();
  const save = useSaveTarget();

  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [age, setAge] = useState('');
  const [activity, setActivity] = useState<Activity>('moderate');
  const [cutRate, setCutRate] = useState<number>(DEFAULT_LOSS_RATE_KG_PER_WEEK);
  const [gainRate, setGainRate] = useState<number>(DEFAULT_GAIN_RATE_KG_PER_WEEK);
  const [goal, setGoal] = useState<Goal>(currentGoal);

  // Prefill ONCE per open (the ref guards it): a bodyweight-log refetch
  // mid-edit must never clobber typed values. Stored inputs win; missing
  // fields fall to useCurrentStats (fresher than the profile snapshot the
  // stored blob froze); age has no live seam, so it stays EMPTY and the
  // validation gates APPLY — a birthday is never invented.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const parsed = dualRateInputsFromStored(stored);
      setSex(parsed?.sex ?? stats.sex);
      setWeight(parsed ? String(parsed.weightKg) : fmtOrBlank(stats.bodyweightKg));
      setHeight(parsed ? String(parsed.heightCm) : fmtOrBlank(stats.heightCm));
      setAge(parsed ? String(parsed.age) : '');
      setActivity(parsed?.activity ?? 'moderate');
      setCutRate(parsed?.rateLossKgPerWeek ?? DEFAULT_LOSS_RATE_KG_PER_WEEK);
      setGainRate(parsed?.rateGainKgPerWeek ?? DEFAULT_GAIN_RATE_KG_PER_WEEK);
      setGoal(currentGoal);
    }
    wasOpen.current = open;
  }, [open, stored, currentGoal, stats]);

  // Recomputed every render — the preview must never lag a keystroke.
  const candidate: DualRateInputs = {
    sex,
    weightKg: pyFloat(weight) ?? NaN,
    heightCm: pyFloat(height) ?? NaN,
    age: pyFloat(age) ?? NaN,
    activity,
    rateLossKgPerWeek: cutRate,
    rateGainKgPerWeek: gainRate,
  };
  const err = dualIntakeError(candidate);
  const triple = err === null ? dualRateTargets(candidate) : null;
  const selectedValid = triple !== null && legWithinDb(triple[goal]);

  const apply = () => {
    if (triple === null || !legWithinDb(triple[goal])) return;
    // BOTH rates ride the inputs jsonb: `ratePerWeekKg` stays the cut rate
    // (live readers keep working) and `rateGainKgPerWeek` sits beside it —
    // no migration (the model's storage note). Typed as a const so the
    // extra key passes the mutation's Partial<TargetInputs> parameter.
    const inputs: Partial<TargetInputs> & { rateGainKgPerWeek: number } = {
      sex: candidate.sex,
      weightKg: candidate.weightKg,
      heightCm: candidate.heightCm,
      age: candidate.age,
      activity: candidate.activity,
      goal,
      ratePerWeekKg: candidate.rateLossKgPerWeek,
      rateGainKgPerWeek: candidate.rateGainKgPerWeek,
    };
    save.mutate(
      { effectiveFrom: todayIso, dailyKcal: triple[goal], goal, inputs, triple },
      { onSuccess: onClose }
    );
  };

  return (
    <Modal transparent animationType="fade" visible={open} onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => undefined}
          accessibilityLabel="Recalculate your calorie target"
          className="rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.accent}40`, backgroundColor: colors.surface, maxHeight: '85%' }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <SectionLabel size="lg">RECALCULATE</SectionLabel>
            <Text
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}
            >
              LOCAL MATHS · EDIT ANYTHING · NOTHING LEAVES THE DEVICE
            </Text>

            <StepLabel>1 · YOU</StepLabel>
            <View className="flex-row flex-wrap gap-s2">
              <Chip
                label="MALE"
                active={sex === 'male'}
                onPress={() => setSex('male')}
                testID="fuel-recalc-sex-male"
              />
              <Chip
                label="FEMALE"
                active={sex === 'female'}
                onPress={() => setSex('female')}
                testID="fuel-recalc-sex-female"
              />
            </View>
            <View className="mt-s3 flex-row flex-wrap" style={{ gap: 12 }}>
              <View>
                <FieldLabel>WEIGHT · KG</FieldLabel>
                <NumberField
                  value={weight}
                  onChange={setWeight}
                  step={0.5}
                  quickSteps={[0.5, 1, 2.5, 5]}
                  placeholder="kg"
                  label="WEIGHT · KG"
                  width={84}
                  testID="fuel-recalc-weight"
                />
              </View>
              <View>
                <FieldLabel>HEIGHT · CM</FieldLabel>
                <NumberField
                  value={height}
                  onChange={setHeight}
                  step={1}
                  placeholder="cm"
                  label="HEIGHT · CM"
                  width={84}
                  testID="fuel-recalc-height"
                />
              </View>
              <View>
                <FieldLabel>AGE</FieldLabel>
                <NumberField
                  value={age}
                  onChange={setAge}
                  step={1}
                  integer
                  placeholder="years"
                  label="AGE"
                  width={72}
                  testID="fuel-recalc-age"
                />
              </View>
            </View>

            <StepLabel>2 · ACTIVITY</StepLabel>
            <View className="flex-row flex-wrap gap-s2">
              {ACTIVITIES.map((a) => (
                <Chip
                  key={a}
                  label={ACTIVITY_LABEL[a]}
                  active={a === activity}
                  onPress={() => setActivity(a)}
                  testID={`fuel-recalc-activity-${a}`}
                />
              ))}
            </View>

            {/* THE VARIANT'S POINT: two rows, two selections. Picking a 1 kg
                cut no longer prices the bulk at +1 kg — each leg owns its
                rate, and the preview quotes both. */}
            <StepLabel>3 · RATES</StepLabel>
            <FieldLabel>CUT · KG/WK</FieldLabel>
            <View className="flex-row flex-wrap gap-s2">
              {RATE_STEPS.map((v) => (
                <Chip
                  key={`cut-${v}`}
                  label={String(v)}
                  active={cutRate === v}
                  onPress={() => setCutRate(v)}
                  testID={`fuel-recalc-rate-cut-${v}`}
                />
              ))}
            </View>
            <View className="mt-s2">
              <FieldLabel>BULK · KG/WK</FieldLabel>
            </View>
            <View className="flex-row flex-wrap gap-s2">
              {RATE_STEPS.map((v) => (
                <Chip
                  key={`gain-${v}`}
                  label={String(v)}
                  active={gainRate === v}
                  onPress={() => setGainRate(v)}
                  testID={`fuel-recalc-rate-gain-${v}`}
                />
              ))}
            </View>

            {/* PREVIEW — the validation error verbatim, or the asymmetric
                triple styled like the hero's switcher. Tapping a box picks
                what APPLY writes; a leg outside the DB's 1,000–6,000 CHECK
                is dimmed and unselectable, with the range named. */}
            <StepLabel>4 · PREVIEW</StepLabel>
            {err !== null ? (
              <Text style={{ fontSize: 12, color: colors.warn }} testID="fuel-recalc-error">
                {err}
              </Text>
            ) : triple !== null ? (
              <View className="flex-row" style={{ gap: 8 }}>
                {GOALS.map((g) => {
                  const value = triple[g];
                  const valid = legWithinDb(value);
                  const selected = g === goal;
                  const caption =
                    g === 'lose' ? `−${cutRate} kg/wk` : g === 'gain' ? `+${gainRate} kg/wk` : null;
                  return (
                    <Pressable
                      key={g}
                      onPress={() => valid && setGoal(g)}
                      disabled={!valid}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: !valid }}
                      accessibilityLabel={
                        valid
                          ? `apply as ${GOAL_SHORT[g]}, ${value.toLocaleString()} kilocalories`
                          : `${GOAL_SHORT[g]} is outside the savable 1,000 to 6,000 range`
                      }
                      testID={`fuel-recalc-preview-${g}`}
                      className="flex-1 items-center justify-center rounded-md border px-s1"
                      style={{
                        minHeight: 64,
                        paddingVertical: 8,
                        borderColor: selected ? colors.accent : colors.border,
                        backgroundColor: selected ? 'rgba(34,211,238,0.12)' : 'rgba(13,21,36,0.6)',
                        opacity: valid ? 1 : 0.4,
                      }}
                    >
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={{
                          fontSize: 10,
                          letterSpacing: 1,
                          color: selected ? colors.accent : colors['text-dim'],
                          ...pixelFont(false),
                        }}
                      >
                        {GOAL_SHORT[g]}
                      </Text>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={{
                          fontSize: 12,
                          marginTop: 3,
                          color: selected ? colors.accent : colors.text,
                          ...pixelFont(),
                        }}
                      >
                        {value.toLocaleString()} kcal
                      </Text>
                      {caption !== null ? (
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          style={{ fontSize: 10, marginTop: 2, color: colors['text-dim'], ...pixelFont(false) }}
                        >
                          {caption}
                        </Text>
                      ) : null}
                      {!valid ? (
                        <Text
                          allowFontScaling={false}
                          numberOfLines={1}
                          style={{ fontSize: 10, marginTop: 2, color: colors['text-dim'], ...pixelFont(false) }}
                        >
                          1,000–6,000 kcal
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View className="mt-s4">
              {/* The button quotes what it will save — the manual sheet's
                  no-guessing rule, kept. */}
              <NeonButton
                title={triple !== null ? `APPLY · ${triple[goal].toLocaleString()} KCAL` : 'APPLY'}
                onPress={apply}
                busy={save.isPending}
                disabled={err !== null || !selectedValid}
                testID="fuel-recalc-apply"
              />
            </View>
            <View className="mt-s2">
              <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="fuel-recalc-close" />
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
