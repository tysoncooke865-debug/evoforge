import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { useCardioLog } from '@/data/hooks';
import { useLogBodyweight, useLogCardio, useLogMeasurements } from '@/data/mutations';
import { CARDIO_TYPES, cardioEventAmount } from '@/domain/cardio';
import { pyFloat } from '@/domain/py';
import tokens from '@/theme/tokens';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/screen-header';
import { SegmentedTabs } from '@/ui/segmented-tabs';
import { SpriteCompanion } from '@/ui/sprite-avatar';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * Log: cardio sessions and bodyweight readings. Cardio previews the XP the
 * session will actually grant -- floor(minutes * 2), the migration literal --
 * so what the button promises is what the ledger receives.
 */
export default function LogScreen() {
  // CARDIO | STATS segments (IMPROVEMENT_PLAN #3). Both stay MOUNTED and
  // toggle via display style -- conditional rendering would drop half-typed
  // form state on a tab switch.
  const [tab, setTab] = useState<0 | 1>(0);
  // Cardio type lives HERE (not in CardioCard) so the header companion can
  // train what's being logged — gloves up for Boxing, full sprint otherwise —
  // from the screen's top-right, matching the AI and Arena placements.
  const [cardioType, setCardioType] = useState<string>(CARDIO_TYPES[0]);
  const boxing = Boolean((CARDIO_FIELDS[cardioType] ?? CARDIO_FIELDS.Other).rounds);
  return (
    <ScreenShell><ScreenHeader kicker="LOG IT ALL" title="TRAINING LOG" right={<SpriteCompanion anim={boxing ? 'punch' : 'run'} height={56} />} />
        <SegmentedTabs left="CARDIO" right="STATS" active={tab} onChange={setTab} testIDPrefix="log-tab" />
        <View style={{ display: tab === 0 ? 'flex' : 'none', gap: 16 }}>
          <CardioCard type={cardioType} setType={setCardioType} />
        </View>
        <View style={{ display: tab === 1 ? 'flex' : 'none', gap: 16 }}>
          <BodyweightCard />
          <MeasurementsCard />
        </View>
    </ScreenShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View className="flex-1">
      <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
        {label}
      </Text>
      <TextInput
        className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
        inputMode="decimal"
        placeholder={placeholder}
        placeholderTextColor="#64758f"
        value={value}
        onChangeText={onChange}
        testID={testID}
      />
    </View>
  );
}

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

function CardioCard({ type, setType }: { type: string; setType: (t: string) => void }) {
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

function BodyweightCard() {
  const [weight, setWeight] = useState('');
  const log = useLogBodyweight();
  const kg = pyFloat(weight) ?? 0;

  return (
    <GlowCard>
      <SectionLabel>BODYWEIGHT</SectionLabel>
      <View className="flex-row items-end gap-s2">
        <Field label="KG" value={weight} onChange={setWeight} testID="bw-kg" />
        <Pressable
          className={`min-h-[44px] items-center justify-center rounded-md px-s4 ${kg > 0 ? 'bg-accent' : 'border border-border bg-surface-2'}`}
          style={
            kg > 0
              ? { shadowColor: tokens.colors.accent, shadowOpacity: 0.45, shadowRadius: 10, elevation: 5 }
              : undefined
          }
          onPress={() => kg > 0 && log.mutate(kg, { onSuccess: () => setWeight('') })}
          disabled={log.isPending || kg <= 0}
          accessibilityRole="button"
          testID="bw-save"
        >
          {log.isPending ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className={`text-xs font-bold ${kg > 0 ? 'text-accent-ink' : 'text-text-mute'}`} style={{ letterSpacing: 1 }}>
              LOG
            </Text>
          )}
        </Pressable>
      </View>
    </GlowCard>
  );
}

// 'bodyweight' deliberately absent: it wrote measurements.bodyweight, which
// NOTHING reads back — bodyweight lives in bodyweight_log (the card above).
// The column stays for old rows (IMPROVEMENT_PLAN #1).
const MEASUREMENT_FIELDS = [
  ['neck_cm', 'NECK'],
  ['shoulders_cm', 'SHOULDERS'],
  ['chest_cm', 'CHEST'],
  ['bicep_cm', 'BICEP'],
  ['forearm_cm', 'FOREARM'],
  ['wrist_cm', 'WRIST'],
  ['waist_cm', 'WAIST'],
  ['hips_cm', 'HIPS'],
  ['thigh_cm', 'THIGH'],
  ['calf_cm', 'CALF'],
] as const;

function MeasurementsCard() {
  const [values, setValues] = useState<Record<string, string>>({});
  const log = useLogMeasurements();

  const entries = MEASUREMENT_FIELDS.map(([key]) => [key, pyFloat(values[key] ?? '')] as const).filter(
    ([, v]) => v !== null && (v as number) > 0
  );

  const submit = () => {
    if (entries.length === 0) return;
    log.mutate(Object.fromEntries(entries) as Record<string, number>, {
      onSuccess: () => setValues({}),
    });
  };

  return (
    <GlowCard>
      <EdgeLabel
        right={
          entries.length > 0 ? (
            <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
              {entries.length} READY
            </Text>
          ) : undefined
        }
      >
        TAPE MEASUREMENTS (CM)
      </EdgeLabel>
      <Text className="mb-s3 mt-s1 text-2xs text-text-mute">Fill what you measured; blanks are skipped.</Text>
      <View className="mb-s4 flex-row flex-wrap gap-s2">
        {MEASUREMENT_FIELDS.map(([key, label]) => {
          const filled = (pyFloat(values[key] ?? '') ?? 0) > 0;
          return (
            <View key={key} className="w-[30%]">
              <Text
                className={`mb-s1 text-2xs font-bold ${filled ? 'text-accent' : 'text-text-mute'}`}
                style={{ letterSpacing: 1 }}
              >
                {label}
              </Text>
              <TextInput
                className={`min-h-[44px] rounded-md border bg-surface-2 p-s2 text-center text-text ${filled ? 'border-border-strong' : 'border-border'}`}
                inputMode="decimal"
                value={values[key] ?? ''}
                onChangeText={(t) => setValues((prev) => ({ ...prev, [key]: t }))}
              />
            </View>
          );
        })}
      </View>
      <NeonButton
        title={entries.length > 0 ? `LOG ${entries.length} READING${entries.length > 1 ? 'S' : ''}` : 'LOG MEASUREMENTS'}
        onPress={submit}
        disabled={entries.length === 0}
        busy={log.isPending}
      />
    </GlowCard>
  );
}
