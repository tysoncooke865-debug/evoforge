import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useBodyweightLog, useProfile } from '@/data/hooks';
import { useLogCardio } from '@/data/mutations';
import { cardioEventAmount } from '@/domain/cardio';
import { estimateCardioKcal } from '@/domain/cardio-estimate';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Field } from '@/ui/core/field';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { PixelClock } from '@/ui/core/pixel-icons';
import { TextField } from '@/ui/core/text-field';
import { activityFor, KMH_PER_MPH } from '@/ui/train/cardio/activities';
import { CardioRewardPreview } from '@/ui/train/cardio/reward-preview';

/**
 * CARDIO_REDESIGN — the dynamic session logger. Fields adapt to the activity
 * (irrelevant inputs never render — the cardio-logger rule), plus duration
 * presets, an optional intensity, and expandable notes. Every testID and the
 * save contract are byte-for-byte the old CardioCard: boxing derives
 * minutes = rounds × length with the round detail in notes, speed converts
 * mph→km/h on save, mins ≤ 0 is refused, the XP grant is unchanged.
 */
const DURATION_PRESETS = [15, 20, 30, 45, 60] as const;
const INTENSITIES = ['LOW', 'MODERATE', 'HIGH'] as const;

export function CardioSessionForm({ type }: { type: string }) {
  const colors = useThemeColors();
  const activity = activityFor(type);
  const fields = activity.fields;
  const boxing = Boolean(fields.rounds);

  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [incline, setIncline] = useState('');
  const [speed, setSpeed] = useState('');
  const [calories, setCalories] = useState('');
  const [speedUnit, setSpeedUnit] = useState<'kmh' | 'mph'>('kmh');
  const [rounds, setRounds] = useState('');
  const [roundLen, setRoundLen] = useState('3');
  const [intensity, setIntensity] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  // §4.2: the post-LOG budget question. null = form mode; a number = the
  // pending session's kcal awaiting the athlete's YES/NO.
  const [budgetAsk, setBudgetAsk] = useState<number | null>(null);

  const log = useLogCardio();

  // §4.1: the ESTIMATE fill-in — real bodyweight only (profile, else the
  // latest bodyweight log). Without one the pill renders disabled with the
  // reason; a number from a fabricated bodyweight would be a mock.
  const profile = useProfile();
  const bodyweights = useBodyweightLog();
  const loggedBw = (bodyweights.data ?? [])
    .map((r) => pyFloat((r as { bodyweight?: unknown }).bodyweight) ?? 0)
    .filter((v) => v > 0);
  const realBw =
    (pyFloat(profile.data?.bodyweight_kg) ?? 0) > 0
      ? (pyFloat(profile.data?.bodyweight_kg) as number)
      : loggedBw.length > 0
        ? loggedBw[loggedBw.length - 1]
        : null;

  const toggleSpeedUnit = () => {
    const v = pyFloat(speed);
    if (v != null && v > 0) {
      const conv = speedUnit === 'kmh' ? v / KMH_PER_MPH : v * KMH_PER_MPH;
      setSpeed(String(Math.round(conv * 10) / 10));
    }
    setSpeedUnit((u) => (u === 'kmh' ? 'mph' : 'kmh'));
  };

  const mins = boxing
    ? (pyFloat(rounds) ?? 0) * (pyFloat(roundLen) ?? 0)
    : (pyFloat(minutes) ?? 0);
  const xpPreview = cardioEventAmount(mins);
  const estimated = estimateCardioKcal(type, mins, realBw);

  const submit = (countTowardBudget: boolean) => {
    if (mins <= 0) return;
    setBudgetAsk(null);
    const parts = [
      intensity ? `${intensity} intensity` : '',
      boxing ? `${rounds || 0} rounds x ${roundLen || 0} min` : '',
      notes,
    ].filter(Boolean);
    const speedInput = pyFloat(speed) ?? 0;
    log.mutate(
      {
        type,
        minutes: mins,
        distanceKm: pyFloat(distance) ?? 0,
        incline: pyFloat(incline) ?? 0,
        speed: speedUnit === 'mph' ? speedInput * KMH_PER_MPH : speedInput,
        calories: pyFloat(calories) ?? 0,
        countTowardBudget,
        notes: parts.join(' — '),
      },
      {
        onSuccess: () => {
          setMinutes('');
          setDistance('');
          setIncline('');
          setSpeed('');
          setCalories('');
          setRounds('');
          setIntensity(null);
          setNotes('');
        },
      }
    );
  };

  // §4.2: LOG asks the budget question only when there are calories to add;
  // a calorie-less session logs straight through (flag true = old behaviour).
  const onLogPress = () => {
    if (mins <= 0) return;
    const kcal = pyFloat(calories) ?? 0;
    if (kcal > 0) setBudgetAsk(Math.round(kcal));
    else submit(true);
  };

  return (
    <View>
      {/* Duration presets — one tap fills the minutes field (not for boxing,
          which counts rounds). */}
      {!boxing ? (
        <View className="mb-s3 flex-row items-center" style={{ gap: 6, flexWrap: 'wrap' }}>
          <PixelClock size={12} color={colors['text-mute']} />
          {DURATION_PRESETS.map((p) => (
            <Chip
              key={p}
              label={`${p}`}
              active={minutes === String(p)}
              onPress={() => setMinutes(String(p))}
              testID={`cardio-preset-${p}`}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            />
          ))}
        </View>
      ) : null}

      {/* The adaptive fields. */}
      <View className="mb-s2 flex-row gap-s2">
        {boxing ? (
          <>
            <Field label="ROUNDS" value={rounds} onChange={setRounds} integer testID="cardio-rounds" />
            <Field label="ROUND MIN" value={roundLen} onChange={setRoundLen} integer />
          </>
        ) : (
          <Field label="MINUTES" value={minutes} onChange={setMinutes} testID="cardio-minutes" />
        )}
        {fields.distance ? (
          <Field label="DISTANCE" keypadLabel="DISTANCE · KM" value={distance} onChange={setDistance} testID="cardio-distance" />
        ) : null}
      </View>
      {fields.incline || fields.speed || fields.calories ? (
        <View className="mb-s2 flex-row gap-s2">
          {fields.incline ? (
            <Field label="INCLINE %" keypadLabel="INCLINE · %" value={incline} onChange={setIncline} testID="cardio-incline" />
          ) : null}
          {fields.speed ? (
            <Field
              label="SPEED"
              keypadLabel={`SPEED · ${speedUnit === 'mph' ? 'MPH' : 'KM/H'}`}
              value={speed}
              onChange={setSpeed}
              testID="cardio-speed"
              accessory={<SpeedUnitToggle unit={speedUnit} onToggle={toggleSpeedUnit} />}
            />
          ) : null}
          {fields.calories ? (
            <Field
              label="CALORIES"
              value={calories}
              onChange={setCalories}
              integer
              testID="cardio-calories"
              accessory={
                // §4.1: fill the field from MET math when the machine has no
                // readout. Editable after; disabled honestly when it can't
                // compute (no minutes yet, or no real bodyweight anywhere).
                <Pressable
                  onPress={() => {
                    if (estimated !== null) setCalories(String(estimated));
                  }}
                  disabled={estimated === null}
                  accessibilityRole="button"
                  accessibilityLabel={
                    estimated === null
                      ? realBw === null
                        ? 'estimate unavailable — log a bodyweight first'
                        : 'estimate unavailable — enter minutes first'
                      : `estimate ${estimated} calories`
                  }
                  testID="cardio-estimate"
                  hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  className="rounded-pill border px-s2"
                  style={{
                    minHeight: 20,
                    justifyContent: 'center',
                    borderColor: `${colors.epic}59`,
                    backgroundColor: 'rgba(168,85,247,0.06)',
                    opacity: estimated === null ? 0.4 : 1,
                  }}
                >
                  <Text className="text-2xs font-bold text-epic" style={{ letterSpacing: 0.5 }}>
                    EST.
                  </Text>
                </Pressable>
              }
            />
          ) : null}
        </View>
      ) : null}

      {/* Intensity — optional, rides in notes (no schema column). */}
      <View className="mb-s3">
        <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          INTENSITY
        </Text>
        <View className="flex-row" style={{ gap: 6 }}>
          {INTENSITIES.map((i) => (
            <Chip
              key={i}
              label={i}
              active={intensity === i}
              onPress={() => setIntensity((cur) => (cur === i ? null : i))}
              testID={`cardio-intensity-${i.toLowerCase()}`}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            />
          ))}
        </View>
      </View>

      {/* Notes — optional, kept mounted (the save contract lists cardio-notes). */}
      <View className="mb-s3">
        <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          NOTES <Text className="text-text-mute" style={{ letterSpacing: 0 }}>· optional</Text>
        </Text>
        <TextField
          label="NOTES"
          placeholder={boxing ? 'Sparring vs bag, combos…' : 'Example: 12% incline, 4.6km/h, post-pull'}
          value={notes}
          onChange={setNotes}
          testID="cardio-notes"
        />
      </View>

      <View className="mb-s3">
        <CardioRewardPreview xp={xpPreview} minutes={mins} />
      </View>

      {budgetAsk === null ? (
        <NeonButton
          title={mins > 0 ? `LOG SESSION · +${xpPreview} XP` : 'LOG SESSION'}
          onPress={onLogPress}
          disabled={mins <= 0}
          busy={log.isPending}
          size="hero"
          rightIcon={
            <Text style={{ color: colors['accent-ink'], fontSize: 16, ...pixelFont() }}>›</Text>
          }
          testID="cardio-save"
        />
      ) : (
        // §4.2: the budget question. Either answer LOGS the session; only
        // the Fuel fold-in differs.
        <View
          className="rounded-xl border p-s3"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
          testID="cardio-budget-ask"
        >
          <Text className="mb-s2 text-sm text-text">
            Add ~{budgetAsk} kcal back to today&apos;s fuel budget?
          </Text>
          <Text className="mb-s3 text-2xs text-text-mute">
            YES raises today&apos;s target in Fuel by what you burned. NO logs the session with its
            calories recorded, but Fuel stays untouched.
          </Text>
          <View className="flex-row" style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <NeonButton title="YES · EAT THEM BACK" onPress={() => submit(true)} busy={log.isPending} testID="cardio-budget-yes" />
            </View>
            <View style={{ flex: 1 }}>
              <NeonButton title="NO · JUST LOG" variant="ghost" onPress={() => submit(false)} busy={log.isPending} testID="cardio-budget-no" />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** KM/H ⇄ MPH pill beside the SPEED field — one tap flips unit + converts. */
function SpeedUnitToggle({ unit, onToggle }: { unit: 'kmh' | 'mph'; onToggle: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`speed unit: ${unit === 'mph' ? 'miles per hour' : 'kilometres per hour'}, tap to switch`}
      testID="cardio-speed-unit"
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      className="rounded-pill border px-s2"
      style={{ minHeight: 20, justifyContent: 'center', borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
    >
      <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 0.5 }}>
        {unit === 'mph' ? 'MPH' : 'KM/H'}
      </Text>
    </Pressable>
  );
}
