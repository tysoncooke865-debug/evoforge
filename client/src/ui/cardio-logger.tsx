import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useCardioLog } from '@/data/hooks';
import { useLogCardio } from '@/data/mutations';
import { CARDIO_TYPES, cardioEventAmount } from '@/domain/cardio';
import { pyFloat } from '@/domain/py';
import tokens from '@/theme/tokens';
import { Field } from '@/ui/field';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { GlowCard } from '@/ui/shell';

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
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [incline, setIncline] = useState('');
  const [speed, setSpeed] = useState('');
  const [calories, setCalories] = useState('');
  const [rounds, setRounds] = useState('');
  const [roundLen, setRoundLen] = useState('3');
  const [notes, setNotes] = useState('');
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
    log.mutate(
      {
        type,
        minutes: mins,
        distanceKm: pyFloat(distance) ?? 0,
        incline: pyFloat(incline) ?? 0,
        speed: pyFloat(speed) ?? 0,
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
    <GlowCard glow={mins > 0 ? tokens.colors.rare : undefined}>
      <View className="mb-s3">
        <EdgeLabel
          right={
            mins > 0 ? (
              <Text className="text-2xs font-bold" style={{ color: tokens.colors.rare, letterSpacing: 1.5 }}>
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
          style={{ borderColor: `${tokens.colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.06)' }}
        >
          <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
            ↺ REPEAT LAST · {Math.trunc(pyFloat(lastOfType.minutes) ?? 0)} MIN
          </Text>
        </Pressable>
      ) : null}

      <View className="mb-s2 flex-row gap-s2">
        {boxing ? (
          <>
            <Field label="ROUNDS" value={rounds} onChange={setRounds} testID="cardio-rounds" />
            <Field label="ROUND MIN" value={roundLen} onChange={setRoundLen} />
          </>
        ) : (
          <Field label="MINUTES" value={minutes} onChange={setMinutes} testID="cardio-minutes" />
        )}
        {fields.distance ? (
          <Field label="DISTANCE KM" value={distance} onChange={setDistance} testID="cardio-distance" />
        ) : null}
      </View>
      {fields.incline || fields.speed || fields.calories ? (
        <View className="mb-s2 flex-row gap-s2">
          {fields.incline ? <Field label="INCLINE %" value={incline} onChange={setIncline} /> : null}
          {fields.speed ? <Field label="SPEED KM/H" value={speed} onChange={setSpeed} /> : null}
          {fields.calories ? <Field label="CALORIES" value={calories} onChange={setCalories} /> : null}
        </View>
      ) : null}
      <View className="mb-s4">
        <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          NOTES
        </Text>
        <TextInput
          className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
          placeholder={boxing ? 'Intensity, sparring vs bag…' : 'Example: 12% incline, 4.6km/h, post-pull'}
          placeholderTextColor="#64758f"
          value={notes}
          onChangeText={setNotes}
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
