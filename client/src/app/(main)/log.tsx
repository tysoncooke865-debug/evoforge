import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useLogBodyweight, useLogCardio } from '@/data/mutations';
import { CARDIO_TYPES, cardioEventAmount } from '@/domain/cardio';
import { pyFloat } from '@/domain/py';

/**
 * Log: cardio sessions and bodyweight readings. Cardio previews the XP the
 * session will actually grant -- floor(minutes * 2), the migration literal --
 * so what the button promises is what the ledger receives.
 */
export default function LogScreen() {
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="items-center p-s6">
      <View className="w-full max-w-[560px] gap-s4">
        <CardioCard />
        <BodyweightCard />
      </View>
    </ScrollView>
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
      <Text className="mb-s1 text-2xs text-text-mute">{label}</Text>
      <TextInput
        className="rounded-md border border-border bg-surface-2 p-s2 text-text"
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

function CardioCard() {
  const [type, setType] = useState<string>(CARDIO_TYPES[0]);
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const [incline, setIncline] = useState('');
  const [speed, setSpeed] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const log = useLogCardio();

  const mins = pyFloat(minutes) ?? 0;
  const xpPreview = cardioEventAmount(mins);

  const submit = () => {
    if (mins <= 0) return;
    log.mutate(
      {
        type,
        minutes: mins,
        distanceKm: pyFloat(distance) ?? 0,
        incline: pyFloat(incline) ?? 0,
        speed: pyFloat(speed) ?? 0,
        calories: pyFloat(calories) ?? 0,
        notes,
      },
      {
        onSuccess: () => {
          setMinutes('');
          setDistance('');
          setIncline('');
          setSpeed('');
          setCalories('');
          setNotes('');
        },
      }
    );
  };

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <Text className="mb-s3 text-xs text-text-mute">CARDIO SESSION</Text>

      <View className="mb-s3 flex-row flex-wrap gap-s2">
        {CARDIO_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setType(t)}
            className={`rounded-pill border px-s3 py-s1 ${
              t === type ? 'border-border-strong bg-surface-3' : 'border-border bg-surface-2'
            }`}
          >
            <Text className={`text-xs font-bold ${t === type ? 'text-accent' : 'text-text-dim'}`}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      <View className="mb-s2 flex-row gap-s2">
        <Field label="MINUTES" value={minutes} onChange={setMinutes} testID="cardio-minutes" />
        <Field label="DISTANCE KM" value={distance} onChange={setDistance} testID="cardio-distance" />
      </View>
      <View className="mb-s2 flex-row gap-s2">
        <Field label="INCLINE %" value={incline} onChange={setIncline} />
        <Field label="SPEED KM/H" value={speed} onChange={setSpeed} />
        <Field label="CALORIES" value={calories} onChange={setCalories} />
      </View>
      <View className="mb-s3">
        <Text className="mb-s1 text-2xs text-text-mute">NOTES</Text>
        <TextInput
          className="rounded-md border border-border bg-surface-2 p-s2 text-text"
          placeholder="Example: 12% incline, 4.6km/h, post-pull"
          placeholderTextColor="#64758f"
          value={notes}
          onChangeText={setNotes}
        />
      </View>

      <Pressable
        className={`items-center rounded-md p-s3 ${mins > 0 ? 'bg-accent' : 'bg-surface-2'}`}
        onPress={submit}
        disabled={log.isPending || mins <= 0}
        testID="cardio-save"
      >
        {log.isPending ? (
          <ActivityIndicator color="#04121a" />
        ) : (
          <Text className={`font-bold ${mins > 0 ? 'text-accent-ink' : 'text-text-mute'}`}>
            {mins > 0 ? `LOG SESSION · +${xpPreview} XP` : 'LOG SESSION'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function BodyweightCard() {
  const [weight, setWeight] = useState('');
  const log = useLogBodyweight();
  const kg = pyFloat(weight) ?? 0;

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <Text className="mb-s3 text-xs text-text-mute">BODYWEIGHT</Text>
      <View className="flex-row items-end gap-s2">
        <Field label="KG" value={weight} onChange={setWeight} testID="bw-kg" />
        <Pressable
          className={`rounded-md px-s4 py-s2 ${kg > 0 ? 'bg-accent' : 'bg-surface-2'}`}
          onPress={() => kg > 0 && log.mutate(kg, { onSuccess: () => setWeight('') })}
          disabled={log.isPending || kg <= 0}
          testID="bw-save"
        >
          {log.isPending ? (
            <ActivityIndicator color="#04121a" />
          ) : (
            <Text className={`font-bold ${kg > 0 ? 'text-accent-ink' : 'text-text-mute'}`}>LOG</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
