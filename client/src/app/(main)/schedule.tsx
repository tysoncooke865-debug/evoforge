import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
 * weekday to REST, or to a SOURCE (my plan / AI plan / EvoForge) picked from a
 * DROPDOWN and a SPLIT from that source. Effective today onward; past days keep
 * the plan that governed them.
 *
 * The store stays two parallel maps: `plan` ('0'..'6' → day name | 'Rest', the
 * streak SQL still reads this untouched) and `sources` ('0'..'6' → SourceIndex).
 * A day resolves its exercises from ITS source, so a week can mix e.g. AI push,
 * my-plan legs, built-in pull — each split coming from wherever it was built.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SOURCES: readonly SourceIndex[] = [0, 1, 2];

interface Opt {
  value: string;
  label: string;
}

/** A compact dropdown box: a labelled Pressable that expands an inline option
 *  list. Only one dropdown on the screen is open at a time (openKey). */
function Dropdown({
  boxLabel,
  value,
  options,
  isOpen,
  onToggle,
  onPick,
  testID,
}: {
  boxLabel: string;
  value: string;
  options: readonly Opt[];
  isOpen: boolean;
  onToggle: () => void;
  onPick: (value: string) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1 }}>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {boxLabel}
      </Text>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        testID={testID}
        className="flex-row items-center justify-between rounded-md border px-s3"
        style={{
          minHeight: 44,
          borderColor: isOpen ? `${colors.accent}99` : colors.border,
          backgroundColor: 'rgba(13,21,36,0.6)',
        }}
      >
        <Text className="text-text" numberOfLines={1} allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>
          {value}
        </Text>
        <Text className="text-accent" style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
          ⌄
        </Text>
      </Pressable>
      {isOpen ? (
        <View
          className="mt-s1 overflow-hidden rounded-md border"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface }}
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => onPick(o.value)}
                accessibilityRole="button"
                testID={testID ? `${testID}-opt-${o.value}` : undefined}
                className="px-s3"
                style={{
                  minHeight: 42,
                  justifyContent: 'center',
                  backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'transparent',
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text
                  className={active ? 'text-accent' : 'text-text-dim'}
                  numberOfLines={1}
                  allowFontScaling={false}
                  style={{ fontSize: 12, ...pixelFont() }}
                >
                  {active ? '✓ ' : ''}
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export default function ScheduleScreen() {
  const colors = useThemeColors();
  const schedule = useWorkoutSchedule();
  const save = useSaveSchedule();
  const { sources: planSources, preferredSource } = useDayPlan();

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
  // Which single dropdown is open (e.g. "1-source", "1-split"), or null.
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));

  const pickSource = (dow: string, s: SourceIndex) => {
    setOpenKey(null);
    if (!sourceHasDays(s)) return;
    setDaySources((m) => ({ ...m, [dow]: s }));
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
        const sourceOpts: Opt[] = SOURCES.filter(sourceHasDays).map((s) => ({
          value: String(s),
          label: SOURCE_LABEL[s],
        }));
        const splitOpts: Opt[] = dayList.map((d) => ({ value: d, label: d.split(' - ')[0] }));
        return (
          <GlowCard key={name}>
            <View className="mb-s2 flex-row items-center justify-between">
              <Text
                className="text-text"
                allowFontScaling={false}
                style={{ fontSize: 14, letterSpacing: 0.5, ...pixelFont() }}
              >
                {name.toUpperCase()}
              </Text>
              <Chip
                label={isRest ? 'REST' : 'TRAIN'}
                active={isRest}
                onPress={() => {
                  setOpenKey(null);
                  if (isRest) pickSource(key, sourceHasDays(activeSource) ? activeSource : 2);
                  else setPlan((p) => ({ ...p, [key]: 'Rest' }));
                }}
              />
            </View>

            {!isRest ? (
              <View className="flex-row gap-s3">
                <Dropdown
                  boxLabel="SOURCE"
                  value={SOURCE_LABEL[activeSource]}
                  options={sourceOpts}
                  isOpen={openKey === `${key}-source`}
                  onToggle={() => toggle(`${key}-source`)}
                  onPick={(v) => pickSource(key, Number(v) as SourceIndex)}
                  testID={`sched-src-${dow}`}
                />
                <Dropdown
                  boxLabel="SPLIT"
                  value={plan[key] ? plan[key].split(' - ')[0] : '—'}
                  options={splitOpts}
                  isOpen={openKey === `${key}-split`}
                  onToggle={() => toggle(`${key}-split`)}
                  onPick={(v) => {
                    setOpenKey(null);
                    setPlan((p) => ({ ...p, [key]: v }));
                  }}
                  testID={`sched-split-${dow}`}
                />
              </View>
            ) : null}
            {!isRest && dayList.length === 0 ? (
              <Text className="mt-s2 text-2xs text-warn">
                No splits in this plan yet — build it on Train first.
              </Text>
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
