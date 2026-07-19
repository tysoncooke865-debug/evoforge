import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useWorkoutSchedule, useSaveSchedule } from '@/data/schedule';
import { BUILT_IN_DAYS, SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { daysForSource, type SourceIndex } from '@/domain/plan-sources';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * IMPROVEMENT_PLAN #11 + PER-DAY SOURCE (2026-07-19, migration 066): map each
 * weekday to REST, or to a SOURCE (my plan / AI plan / EvoForge) and a SPLIT
 * from that source. Effective today onward; past days keep the plan that
 * governed them.
 *
 * The store stays two parallel maps: `plan` ('0'..'6' → day name | 'Rest', the
 * streak SQL still reads this untouched) and `sources` ('0'..'6' → SourceIndex).
 * A day resolves its exercises from ITS source, so a week can mix e.g. AI push,
 * my-plan legs, built-in pull — each split coming from wherever it was built.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SOURCES: readonly SourceIndex[] = [0, 1, 2];

export default function ScheduleScreen() {
  const colors = useThemeColors();
  const schedule = useWorkoutSchedule();
  const save = useSaveSchedule();
  const { sources: planSources, preferredSource } = useDayPlan();

  // Which sources actually have days to offer (built-in always does).
  const daysOf = (s: SourceIndex): readonly string[] => daysForSource(s, planSources, BUILT_IN_DAYS);
  const sourceHasDays = (s: SourceIndex): boolean => daysOf(s).length > 0;
  /** The source a stored name belongs to — my plan wins, then AI, then built-in. */
  const sourceOfName = (name: string): SourceIndex => {
    if (daysOf(0).includes(name)) return 0;
    if (daysOf(1).includes(name)) return 1;
    return 2;
  };

  // Default: Mon–Sat the six built-in days in order, Sunday rest.
  const [plan, setPlan] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = { '0': 'Rest' };
    for (let i = 1; i <= 6; i++) seed[String(i)] = BUILT_IN_DAYS[i - 1] ?? 'Rest';
    return seed;
  });
  const [daySources, setDaySources] = useState<Record<string, number>>({});

  // Seed from the latest saved schedule once it loads. A legacy row has no
  // sources map → derive each non-rest day's source from the name it stored.
  const rows = schedule.data;
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const last = rows[rows.length - 1];
    const t = setTimeout(() => {
      setPlan(last.plan);
      const seededSources: Record<string, number> = {};
      for (const dow of Object.keys(last.plan)) {
        const name = last.plan[dow];
        if (!name || name === 'Rest') continue;
        seededSources[dow] = last.sources?.[dow] ?? sourceOfName(name);
      }
      setDaySources(seededSources);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const setRest = (dow: string) => setPlan((p) => ({ ...p, [dow]: 'Rest' }));

  const pickSource = (dow: string, s: SourceIndex) => {
    if (!sourceHasDays(s)) return;
    setDaySources((m) => ({ ...m, [dow]: s }));
    // Keep the current day if it belongs to the new source; otherwise adopt the
    // source's first day (leaving 'Rest' as a real choice the user re-picks).
    setPlan((p) => {
      const cur = p[dow];
      if (cur && cur !== 'Rest' && daysOf(s).includes(cur)) return p;
      return { ...p, [dow]: daysOf(s)[0] };
    });
  };

  return (
    <ScreenShell>
      <ScreenHeader kicker="TRAIN ON SCHEDULE" title="EDIT SCHEDULE" titleLines={1} />
      <Text className="text-2xs text-text-mute">
        Pick a source and a split for each day — the streak judges each day against the schedule in
        force THEN, so changes apply from today onward, never backwards. Rest days bridge a streak;
        missed training days reset it.
      </Text>
      {WEEKDAY_NAMES.map((name, dow) => {
        const key = String(dow);
        const isRest = !plan[key] || plan[key] === 'Rest';
        const activeSource: SourceIndex = (daySources[key] as SourceIndex) ?? preferredSource;
        const dayList = daysOf(activeSource);
        return (
          <GlowCard key={name}>
            <Text
              className="mb-s2 text-text"
              allowFontScaling={false}
              style={{ fontSize: 14, letterSpacing: 0.5, ...pixelFont() }}
            >
              {name.toUpperCase()}
            </Text>

            {/* Rest, or which source this day trains from. */}
            <View className="flex-row flex-wrap gap-s2">
              <Chip label="REST" active={isRest} onPress={() => setRest(key)} />
              {SOURCES.filter(sourceHasDays).map((s) => (
                <Chip
                  key={s}
                  label={SOURCE_LABEL[s]}
                  active={!isRest && activeSource === s}
                  onPress={() => pickSource(key, s)}
                  testID={`sched-src-${dow}-${s}`}
                />
              ))}
            </View>

            {/* The split, from the chosen source's day list. */}
            {!isRest ? (
              <>
                <Text
                  className="mb-s1 mt-s3 text-text-mute"
                  allowFontScaling={false}
                  style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
                >
                  {`SPLIT · ${SOURCE_LABEL[activeSource]}`}
                </Text>
                {dayList.length === 0 ? (
                  <Text className="text-2xs text-warn">
                    No splits in this plan yet — build it on Train first.
                  </Text>
                ) : (
                  <View className="flex-row flex-wrap gap-s2">
                    {dayList.map((d) => (
                      <Chip
                        key={d}
                        label={d.split(' - ')[0].toUpperCase()}
                        active={plan[key] === d}
                        onPress={() => setPlan((p) => ({ ...p, [key]: d }))}
                      />
                    ))}
                  </View>
                )}
                {plan[key] && plan[key] !== 'Rest' ? (
                  <Text className="mt-s1 text-2xs" style={{ color: colors.accent }}>
                    {plan[key]}
                  </Text>
                ) : null}
              </>
            ) : null}
          </GlowCard>
        );
      })}
      <NeonButton
        title="SAVE SCHEDULE · EFFECTIVE TODAY"
        onPress={() => save.mutate({ plan, sources: daySources })}
        busy={save.isPending}
        testID="save-schedule"
      />
    </ScreenShell>
  );
}
