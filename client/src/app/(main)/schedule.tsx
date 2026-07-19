import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWorkoutSchedule, useSaveSchedule } from '@/data/schedule';
import { useSavePlanSourcePref } from '@/data/plan-source-pref';
import { BUILT_IN_DAYS, SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { daysForSource, type SourceIndex } from '@/domain/plan-sources';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * WEEKLY SCHEDULE (Tyson, 2026-07-20). ONE plan for the whole week, chosen at the
 * top — MY PLAN / AI PLAN / EVOFORGE PLAN — then a REST or a SPLIT for each day.
 *
 * This replaces the per-day source dropdown (migration 066): a source picker on
 * every card was fiddly and off-model — a week follows one plan. The chosen
 * source is written back TWO ways so every surface agrees: `active_plan_source`
 * (035 — what Train opens on) AND a UNIFORM `sources` map on the schedule row
 * (every trained day → the chosen source), so Train's per-date reader (which
 * already honours an explicit per-day source) renders each day from that plan
 * with no positional remap. The `plan` map ('0'..'6' → day name | 'Rest') is
 * unchanged — the streak SQL still reads it untouched.
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

/** The whole-week plan picker: three source buttons, one active. A source with
 *  no plan behind it (empty MY PLAN / AI PLAN) is shown but disabled. */
function SourcePicker({
  active,
  enabled,
  onPick,
}: {
  active: SourceIndex;
  enabled: (s: SourceIndex) => boolean;
  onPick: (s: SourceIndex) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row gap-s2">
      {SOURCES.map((s) => {
        const on = s === active;
        const usable = enabled(s);
        return (
          <Pressable
            key={s}
            onPress={() => usable && onPick(s)}
            disabled={!usable}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !usable }}
            testID={`week-source-${s}`}
            className="flex-1 items-center justify-center rounded-md border px-s2"
            style={{
              minHeight: 46,
              opacity: usable ? 1 : 0.4,
              borderColor: on ? colors.accent : colors.border,
              backgroundColor: on ? 'rgba(34,211,238,0.12)' : 'rgba(13,21,36,0.6)',
            }}
          >
            <Text
              className={on ? 'text-accent' : 'text-text-dim'}
              numberOfLines={1}
              allowFontScaling={false}
              style={{ fontSize: 11, letterSpacing: 0.3, ...pixelFont() }}
            >
              {SOURCE_LABEL[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ScheduleScreen() {
  const colors = useThemeColors();
  const schedule = useWorkoutSchedule();
  const save = useSaveSchedule();
  const savePref = useSavePlanSourcePref();
  const { sources: planSources, preferredSource } = useDayPlan();

  const daysOf = (s: SourceIndex): readonly string[] => daysForSource(s, planSources, BUILT_IN_DAYS);
  const sourceHasDays = (s: SourceIndex): boolean => daysOf(s).length > 0;

  // Default: Mon–Sat the six built-in days in order, Sunday rest.
  const [plan, setPlan] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = { '0': 'Rest' };
    for (let i = 1; i <= 6; i++) seed[String(i)] = BUILT_IN_DAYS[i - 1] ?? 'Rest';
    return seed;
  });
  // The whole-week source. null until seeded — falls back to preferredSource for
  // display so the picker is never blank while plans load.
  const [weekSource, setWeekSource] = useState<SourceIndex | null>(null);
  // Which split dropdown is open (e.g. "1-split"), or null.
  const [openKey, setOpenKey] = useState<string | null>(null);

  const source: SourceIndex = weekSource ?? preferredSource;
  const dayList = daysOf(source);

  // Seed from the latest saved schedule once it loads. 065 (interim): a slot
  // may be [primary, ...extras] — seed the primary; the extras editor lands
  // in the next change.
  const rows = schedule.data;
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const last = rows[rows.length - 1];
    const t = setTimeout(() => {
      const primaries = Object.fromEntries(
        Object.entries(last.plan).map(([dow, v]) => [dow, Array.isArray(v) ? (v[0] ?? 'Rest') : v])
      );
      setPlan(primaries);
      // Seed the week source from the saved row's uniform source (the most-used
      // value in its per-day map), else leave null → falls back to preferredSource.
      const vals = Object.values(last.sources ?? {}).filter((v) => v === 0 || v === 1 || v === 2) as SourceIndex[];
      if (vals.length > 0) {
        const tally = new Map<SourceIndex, number>();
        for (const v of vals) tally.set(v, (tally.get(v) ?? 0) + 1);
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
        setWeekSource(top);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [rows]);

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));

  /** Pick the whole-week source. Any trained day whose split isn't in the new
   *  plan is remapped to that plan's first day (never left pointing at a split
   *  the chosen plan doesn't have). */
  const chooseSource = (s: SourceIndex) => {
    setOpenKey(null);
    if (!sourceHasDays(s)) return;
    setWeekSource(s);
    const list = daysOf(s);
    setPlan((p) => {
      const next: Record<string, string> = { ...p };
      for (const dow of Object.keys(next)) {
        const cur = next[dow];
        if (!cur || cur === 'Rest') continue;
        if (!list.includes(cur)) next[dow] = list[0];
      }
      return next;
    });
  };

  /** Toggle a day between REST and TRAIN. Turning training on keeps the current
   *  split if the chosen plan has it, else takes the plan's first day. */
  const toggleDay = (dow: string, isRest: boolean) => {
    setOpenKey(null);
    if (!isRest) {
      setPlan((p) => ({ ...p, [dow]: 'Rest' }));
      return;
    }
    if (dayList.length === 0) return;
    setPlan((p) => {
      const cur = p[dow];
      return { ...p, [dow]: cur && cur !== 'Rest' && dayList.includes(cur) ? cur : dayList[0] };
    });
  };

  const onSave = () => {
    // UNIFORM sources: every trained day follows the one chosen plan. Train's
    // per-date reader then renders each day from that source with no remap.
    const uniform: Record<string, number> = {};
    for (const dow of Object.keys(plan)) {
      if (plan[dow] && plan[dow] !== 'Rest') uniform[dow] = source;
    }
    save.mutate({ plan, sources: uniform });
    // Keep the app-wide "which plan am I following" (035) in step with the week.
    savePref.mutate(source);
  };

  const noPlans = !sourceHasDays(0) && !sourceHasDays(1);

  return (
    <ScreenShell>
      <ScreenHeader kicker="TRAIN ON SCHEDULE" title="EDIT SCHEDULE" titleLines={1} />
      <Text className="text-2xs text-text-mute">
        Pick ONE plan for your whole week, then set a rest day or a split for each day. The streak
        judges each day against the schedule in force THEN, so changes apply from today onward, never
        backwards. Rest days bridge a streak; missed training days reset it.
      </Text>

      {/* Whole-week plan picker. */}
      <GlowCard>
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, letterSpacing: 1.5, ...pixelFont(false) }}>
          PLAN FOR THE WEEK
        </Text>
        <View className="mt-s2">
          <SourcePicker active={source} enabled={sourceHasDays} onPick={chooseSource} />
        </View>
        {noPlans ? (
          <Text className="mt-s2 text-2xs text-text-mute">
            Build a plan on Train to unlock MY PLAN / AI PLAN — EVOFORGE PLAN always works.
          </Text>
        ) : null}
      </GlowCard>

      {WEEKDAY_NAMES.map((name, dow) => {
        const key = String(dow);
        const isRest = !plan[key] || plan[key] === 'Rest';
        const splitOpts: Opt[] = dayList.map((d) => ({ value: d, label: d.split(' - ')[0] }));
        return (
          <GlowCard key={name}>
            <View className="flex-row items-center justify-between">
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
                onPress={() => toggleDay(key, isRest)}
              />
            </View>

            {!isRest && dayList.length > 0 ? (
              <View className="mt-s2">
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
        onPress={onSave}
        busy={save.isPending}
        testID="save-schedule"
      />
    </ScreenShell>
  );
}
