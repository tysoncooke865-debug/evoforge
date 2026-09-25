/**
 * THE RECALCULATE SHEET (promoted 2026-09-25 from the page lab's
 * COUNTERWEIGHT batch; the thesis dates to the culled CALCULATOR variant,
 * 2026-08-21). ✦ RECALCULATE used to open the AI intake, which
 * short-circuited to a read-only review of the numbers already in force —
 * effectively a dead end. This sheet is the replacement: a LOCAL, fully
 * editable calculator. Every number comes from domain maths on the device
 * (dualRateTargets over Mifflin–St Jeor); no network, no AI.
 *
 * The GOAL is picked as a button row (section 3), ONE rate row edits the
 * chosen goal's rate (hidden for maintain — the other rate is carried, both
 * persist), and the preview mirrors the hero's goal + maintain boxes.
 *
 * PERSISTENCE IS THE SCREEN'S JOB: APPLY hands the finished
 * SaveTargetPayload (domain/nutrition.ts::buildSavePayload) to `onApply` —
 * this component holds no mutation, so the page lab's fork of the screen
 * stays mock-safe by swapping its own useSaveTarget import, without ever
 * forking this file.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentStats } from '@/data/use-current-stats';
import {
  ACTIVITY_LABEL,
  DEFAULT_GAIN_RATE_KG_PER_WEEK,
  DEFAULT_LOSS_RATE_KG_PER_WEEK,
  GOAL_SHORT,
  buildSavePayload,
  dualIntakeError,
  dualRateInputsFromStored,
  dualRateTargets,
  legWithinDb,
  type Activity,
  type DualRateInputs,
  type Goal,
  type SaveTargetPayload,
  type TargetInputs,
} from '@/domain/nutrition';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { NumberField } from '@/ui/core/number-field';
import { SectionLabel } from '@/ui/core/screen-header';

const GOALS: readonly Goal[] = ['lose', 'maintain', 'gain'];
const ACTIVITIES: readonly Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very'];
/** The rate buttons — [0, MAX_RATE_KG_PER_WEEK] in plate steps. */
const RATE_STEPS = [0.25, 0.5, 0.75, 1] as const;

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
  busy = false,
  onApply,
  onClose,
}: {
  open: boolean;
  /** The target row's inputs jsonb — may predate the dual-rate model. */
  stored: (Partial<TargetInputs> & { rateGainKgPerWeek?: unknown }) | null;
  currentGoal: Goal;
  todayIso: string;
  /** The owning screen's save-in-flight state. */
  busy?: boolean;
  /** Receives the finished payload; the screen saves and closes. */
  onApply: (payload: SaveTargetPayload) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const stats = useCurrentStats();

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

  // ONE visible rate row, owned by the chosen goal; maintain hides it (the
  // other rate is carried in state and persists — nothing is forgotten).
  const rated = goal !== 'maintain';
  const activeRate = goal === 'gain' ? gainRate : cutRate;
  const setActiveRate = goal === 'gain' ? setGainRate : setCutRate;
  const previewStep = rated ? '5' : '4';

  const apply = () => {
    const payload = buildSavePayload(candidate, goal, todayIso);
    if (payload === null) return;
    onApply(payload);
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

            {/* The GOAL is a decision, not a tab: picked here, shown as the
                hero's left box afterwards. */}
            <StepLabel>3 · GOAL</StepLabel>
            <View className="flex-row flex-wrap gap-s2">
              {GOALS.map((g) => (
                <Chip
                  key={g}
                  label={GOAL_SHORT[g]}
                  active={g === goal}
                  onPress={() => setGoal(g)}
                  testID={`fuel-recalc-goal-${g}`}
                />
              ))}
            </View>

            {/* ONE rate row — the chosen goal's. The other rate is carried
                (dual-rate model: a 1 kg cut never prices a +1 kg bulk). */}
            {rated ? (
              <>
                <StepLabel>4 · RATE</StepLabel>
                <FieldLabel>
                  {goal === 'lose' ? 'KG LOST PER WEEK' : 'KG GAINED PER WEEK'}
                </FieldLabel>
                <View className="flex-row flex-wrap gap-s2">
                  {RATE_STEPS.map((v) => (
                    <Chip
                      key={`rate-${v}`}
                      label={String(v)}
                      active={activeRate === v}
                      onPress={() => setActiveRate(v)}
                      testID={`fuel-recalc-rate-${v}`}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* PREVIEW — the validation error verbatim, or the hero's own
                two-box layout: the chosen goal left, MAINTAIN right (one
                full-width box when the goal IS maintain). Display only —
                the goal was chosen in section 3. */}
            <StepLabel>{`${previewStep} · PREVIEW`}</StepLabel>
            {err !== null ? (
              <Text style={{ fontSize: 12, color: colors.warn }} testID="fuel-recalc-error">
                {err}
              </Text>
            ) : triple !== null ? (
              <View className="flex-row" style={{ gap: 8 }}>
                <View
                  className="flex-1 items-center justify-center rounded-md border px-s1"
                  style={{
                    minHeight: 64,
                    paddingVertical: 8,
                    borderColor: selectedValid ? colors.accent : colors.warn,
                    backgroundColor: 'rgba(34,211,238,0.12)',
                  }}
                  testID="fuel-recalc-preview-goal"
                >
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={{ fontSize: 10, letterSpacing: 1, color: colors.accent, ...pixelFont(false) }}
                  >
                    {GOAL_SHORT[goal]}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={{ fontSize: 12, marginTop: 3, color: colors.accent, ...pixelFont() }}
                  >
                    {triple[goal].toLocaleString()} kcal
                  </Text>
                  {rated ? (
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{ fontSize: 10, marginTop: 2, color: colors['text-dim'], ...pixelFont(false) }}
                    >
                      {goal === 'lose' ? `−${cutRate} kg/wk` : `+${gainRate} kg/wk`}
                    </Text>
                  ) : null}
                  {!selectedValid ? (
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{ fontSize: 10, marginTop: 2, color: colors.warn, ...pixelFont(false) }}
                    >
                      1,000–6,000 kcal
                    </Text>
                  ) : null}
                </View>
                {rated ? (
                  <View
                    className="flex-1 items-center justify-center rounded-md border px-s1"
                    style={{
                      minHeight: 64,
                      paddingVertical: 8,
                      borderColor: colors.border,
                      backgroundColor: 'rgba(13,21,36,0.6)',
                    }}
                    testID="fuel-recalc-preview-maintain"
                  >
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{ fontSize: 10, letterSpacing: 1, color: colors['text-dim'], ...pixelFont(false) }}
                    >
                      MAINTAIN
                    </Text>
                    <Text
                      allowFontScaling={false}
                      numberOfLines={1}
                      style={{ fontSize: 12, marginTop: 3, color: colors.text, ...pixelFont() }}
                    >
                      {triple.maintain.toLocaleString()} kcal
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View className="mt-s4">
              {/* The button quotes what it will save — the manual sheet's
                  no-guessing rule, kept. */}
              <NeonButton
                title={triple !== null ? `APPLY · ${triple[goal].toLocaleString()} KCAL` : 'APPLY'}
                onPress={apply}
                busy={busy}
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
