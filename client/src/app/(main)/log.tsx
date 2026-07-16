import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { useLogBodyweight, useLogMeasurements } from '@/data/mutations';
import { pyFloat } from '@/domain/py';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { Field } from '@/ui/core/field';
import { EdgeLabel } from '@/ui/core/hud';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * STATS (P2 C3, owner-decided): bodyweight + tape measurements only.
 * Cardio moved to Today — one screen for training, one for the body.
 * The route file stays `log` so links and history never break.
 */
export default function LogScreen() {
  return (
    <ScreenShell>
      <ScreenHeader kicker="TRACK THE BODY" title="STATS" right={<CompanionMenuButton anim="idle" height={56} />} />
      <BodyweightCard />
      <MeasurementsCard />
    </ScreenShell>
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
            <Text
              className={kg > 0 ? 'text-accent-ink' : 'text-text-mute'}
              allowFontScaling={false}
              style={{ fontSize: 13, letterSpacing: 0.5, ...pixelFont() }}
            >
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
            <Text
              className="text-accent"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
            >
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
                className={`mb-s1 ${filled ? 'text-accent' : 'text-text-mute'}`}
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
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
