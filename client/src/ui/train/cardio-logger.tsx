import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useCardioLog } from '@/data/hooks';
import { useLogCardio } from '@/data/mutations';
import { CARDIO_TYPES, cardioEventAmount } from '@/domain/cardio';
import { pyFloat } from '@/domain/py';
import { useThemeColors } from '@/theme/use-theme';
import { Field } from '@/ui/core/field';
import { EdgeLabel } from '@/ui/core/hud';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { GlowCard } from '@/ui/core/shell';
import { TextField } from '@/ui/core/text-field';

/**
 * The cardio session logger — moved VERBATIM from log.tsx to Today
 * (P2 C3, owner-decided: cardio lives only on Today; Log became Stats).
 * Every testID is byte-identical (cardio-minutes, cardio-save, …); the
 * XP preview stays floor(minutes × 2), the migration literal.
 */

/** Which inputs each activity actually uses — irrelevant fields never render. */
const CARDIO_FIELDS: Record<string, { minutes?: boolean; distance?: boolean; incline?: boolean; speed?: boolean; calories?: boolean; rounds?: boolean }> = {
  'Treadmill incline walk': { minutes: true, incline: true, speed: true, distance: true, calories: true },
  'Outdoor walk': { minutes: true, distance: true, calories: true },
  Run: { minutes: true, distance: true, calories: true },
  Bike: { minutes: true, distance: true, calories: true },
  Stairmaster: { minutes: true, incline: true, calories: true },
  Boxing: { rounds: true, calories: true },
  Other: { minutes: true, distance: true, calories: true },
};

/** Speed is stored in the cardio_log as km/h (no unit column); MPH input is
 *  converted on save so history stays comparable. 1 mph = 1.609344 km/h. */
const KMH_PER_MPH = 1.609344;

const CARDIO_ICONS: Record<string, string> = {
  'Treadmill incline walk': '⛰',
  'Outdoor walk': '🚶',
  Run: '🏃',
  Bike: '🚴',
  Stairmaster: '🪜',
  Boxing: '🥊',
  Other: '✚',
};

/** Which companion animation a cardio type earns: rounds-based types punch. */
export function cardioAnim(type: string): 'punch' | 'run' {
  return (CARDIO_FIELDS[type] ?? CARDIO_FIELDS.Other).rounds ? 'punch' : 'run';
}

export function CardioCard({ type, setType }: { type: string; setType: (t: string) => void }) {
  const colors = useThemeColors();
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [incline, setIncline] = useState('');
  const [speed, setSpeed] = useState('');
  const [calories, setCalories] = useState('');
  const [speedUnit, setSpeedUnit] = useState<'kmh' | 'mph'>('kmh');
  const [rounds, setRounds] = useState('');
  const [roundLen, setRoundLen] = useState('3');
  const [notes, setNotes] = useState('');

  // Toggle the speed unit, converting the current entry so it stays the SAME
  // physical speed (5 km/h ⇄ 3.1 mph), not the same number.
  const toggleSpeedUnit = () => {
    const v = pyFloat(speed);
    if (v != null && v > 0) {
      const conv = speedUnit === 'kmh' ? v / KMH_PER_MPH : v * KMH_PER_MPH;
      setSpeed(String(Math.round(conv * 10) / 10));
    }
    setSpeedUnit((u) => (u === 'kmh' ? 'mph' : 'kmh'));
  };
  const log = useLogCardio();
  const history = useCardioLog();

  const fields = CARDIO_FIELDS[type] ?? CARDIO_FIELDS.Other;

  // Boxing has no schema column for rounds: minutes derive as rounds x length,
  // and the round detail rides in notes. No schema change, honest storage.
  const boxing = Boolean(fields.rounds);
  const mins = boxing
    ? (pyFloat(rounds) ?? 0) * (pyFloat(roundLen) ?? 0)
    : (pyFloat(minutes) ?? 0);
  const xpPreview = cardioEventAmount(mins);

  // One-tap reuse: the latest session of this type prefills the form.
  const lastOfType = [...(history.data ?? [])].reverse().find((r) => String(r.type) === type);
  const repeatLast = () => {
    if (!lastOfType) return;
    const m = pyFloat(lastOfType.minutes) ?? 0;
    if (boxing) {
      const len = pyFloat(roundLen) ?? 3;
      setRounds(len > 0 ? String(Math.round(m / len)) : '');
    } else {
      setMinutes(m > 0 ? String(m) : '');
    }
    const d = pyFloat((lastOfType as Record<string, unknown>).distance_km) ?? 0;
    setDistance(d > 0 ? String(d) : '');
  };

  const submit = () => {
    if (mins <= 0) return;
    const noteText = boxing
      ? [`${rounds || 0} rounds x ${roundLen || 0} min`, notes].filter(Boolean).join(' — ')
      : notes;
    const speedInput = pyFloat(speed) ?? 0;
    log.mutate(
      {
        type,
        minutes: mins,
        distanceKm: pyFloat(distance) ?? 0,
        incline: pyFloat(incline) ?? 0,
        speed: speedUnit === 'mph' ? speedInput * KMH_PER_MPH : speedInput,
        calories: pyFloat(calories) ?? 0,
        notes: noteText,
      },
      {
        onSuccess: () => {
          setMinutes('');
          setDistance('');
          setIncline('');
          setSpeed('');
          setCalories('');
          setRounds('');
          setNotes('');
        },
      }
    );
  };

  return (
    <GlowCard glow={mins > 0 ? colors.rare : undefined}>
      <View className="mb-s3">
        <EdgeLabel
          right={
            mins > 0 ? (
              <Text className="text-2xs font-bold" style={{ color: colors.rare, letterSpacing: 1.5 }}>
                {Math.trunc(mins)} MIN LOCKED IN
              </Text>
            ) : undefined
          }
        >
          CARDIO SESSION
        </EdgeLabel>
      </View>

      <View className="mb-s3 flex-row flex-wrap gap-s2">
        {CARDIO_TYPES.map((t) => (
          <Chip
            key={t}
            label={`${CARDIO_ICONS[t] ?? ''} ${t}`.trim()}
            active={t === type}
            onPress={() => setType(t)}
          />
        ))}
      </View>

      {lastOfType ? (
        <Pressable
          onPress={repeatLast}
          accessibilityRole="button"
          className="mb-s3 self-start rounded-pill border px-s3 py-s1"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
        >
          <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
            ↺ REPEAT LAST · {Math.trunc(pyFloat(lastOfType.minutes) ?? 0)} MIN
          </Text>
        </Pressable>
      ) : null}

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
            <Field label="CALORIES" value={calories} onChange={setCalories} integer testID="cardio-calories" />
          ) : null}
        </View>
      ) : null}
      <View className="mb-s4">
        <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          NOTES
        </Text>
        <TextField
          label="NOTES"
          placeholder={boxing ? 'Intensity, sparring vs bag…' : 'Example: 12% incline, 4.6km/h, post-pull'}
          value={notes}
          onChange={setNotes}
          testID="cardio-notes"
        />
      </View>

      <NeonButton
        title={mins > 0 ? `LOG SESSION · +${xpPreview} XP` : 'LOG SESSION'}
        onPress={submit}
        disabled={mins <= 0}
        busy={log.isPending}
        testID="cardio-save"
      />
    </GlowCard>
  );
}

/** KM/H ⇄ MPH pill toggle shown beside the SPEED field's label. One tap flips
 *  the unit and converts the current value to the same physical speed. */
function SpeedUnitToggle({ unit, onToggle }: { unit: 'kmh' | 'mph'; onToggle: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`speed unit: ${unit === 'mph' ? 'miles per hour' : 'kilometres per hour'}, tap to switch`}
      testID="cardio-speed-unit"
      className="rounded-pill border px-s2"
      style={{ minHeight: 20, justifyContent: 'center', borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
    >
      <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 0.5 }}>
        {unit === 'mph' ? 'MPH' : 'KM/H'}
      </Text>
    </Pressable>
  );
}
