import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useWorkoutSchedule, useSaveSchedule } from '@/data/schedule';
import { PPPPLA_DAYS } from '@/domain/custom-plan';
import tokens from '@/theme/tokens';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';

/**
 * IMPROVEMENT_PLAN #11: map weekdays → training days (or Rest),
 * effective today onward. Past days keep the plan that governed them.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const OPTIONS = ['Rest', ...PPPPLA_DAYS];

/** Mon–Sat = the six training days in order, Sunday rest. */
const SUGGESTED: Record<string, string> = {
  '0': 'Rest',
  '1': PPPPLA_DAYS[0],
  '2': PPPPLA_DAYS[1],
  '3': PPPPLA_DAYS[2],
  '4': PPPPLA_DAYS[3],
  '5': PPPPLA_DAYS[4],
  '6': PPPPLA_DAYS[5],
};

export default function ScheduleScreen() {
  const schedule = useWorkoutSchedule();
  const save = useSaveSchedule();
  const [plan, setPlan] = useState<Record<string, string>>(SUGGESTED);

  // Seed from the latest saved schedule once it loads.
  const rows = schedule.data;
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const t = setTimeout(() => setPlan(rows[rows.length - 1].plan), 0);
    return () => clearTimeout(t);
  }, [rows]);

  return (
    <ScreenShell>
      <ScreenHeader kicker="TRAIN ON SCHEDULE" title="WEEKLY SCHEDULE" />
      <Text className="text-2xs text-text-mute">
        The streak judges each day against the schedule in force THEN — changes apply from today
        onward, never backwards. Rest days bridge a streak; missed training days reset it.
      </Text>
      {WEEKDAY_NAMES.map((name, dow) => (
        <GlowCard key={name}>
          <Text className="mb-s2 text-xs font-bold text-text" style={{ letterSpacing: 1.5 }}>
            {name.toUpperCase()}
          </Text>
          <View className="flex-row flex-wrap gap-s2">
            {OPTIONS.map((o) => (
              <Chip
                key={o}
                label={o === 'Rest' ? 'REST' : o.split(' - ')[0].toUpperCase()}
                active={plan[String(dow)] === o}
                onPress={() => setPlan((prev) => ({ ...prev, [String(dow)]: o }))}
              />
            ))}
          </View>
          {plan[String(dow)] && plan[String(dow)] !== 'Rest' ? (
            <Text className="mt-s1 text-2xs" style={{ color: tokens.colors.accent }}>
              {plan[String(dow)]}
            </Text>
          ) : null}
        </GlowCard>
      ))}
      <NeonButton
        title="SAVE SCHEDULE · EFFECTIVE TODAY"
        onPress={() => save.mutate(plan)}
        busy={save.isPending}
        testID="save-schedule"
      />
    </ScreenShell>
  );
}
