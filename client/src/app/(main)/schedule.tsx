import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useRoutines } from '@/data/routines';
import { useWorkoutSchedule, useSaveSchedule } from '@/data/schedule';
import { useSavePlanSourcePref } from '@/data/plan-source-pref';
import { BUILT_IN_DAYS, SOURCE_LABEL, useDayPlan } from '@/data/use-day-plan';
import { daysForSource, type SourceIndex } from '@/domain/plan-sources';
import { dayWorkouts, type PlanDayValue } from '@/domain/scheduled-streak';
import { todayIso } from '@/domain/today';
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
 * with no positional remap.
 *
 * 065: a `plan` value may carry EXTRA workouts beyond its primary —
 * [primary, ...extras], where extras are built-in day names or saved routines
 * (LITERAL names — never source-remapped). Extras get their own bar under the
 * day's on Train, and a day whose primary is Rest but holds an extra still
 * counts as a scheduled training day for the streak. The week-source picker,
 * REST/TRAIN toggle and SPLIT dropdown all operate on the PRIMARY slot only,
 * always preserving the extras beneath. The streak SQL is 065's array-aware
 * body.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SOURCES: readonly SourceIndex[] = [0, 1, 2];

const primaryOf = (v: PlanDayValue | undefined): string => (Array.isArray(v) ? (v[0] ?? 'Rest') : (v ?? 'Rest'));
const extrasOf = (v: PlanDayValue | undefined): string[] => (Array.isArray(v) ? v.slice(1) : []);
/** A day value from its parts: extra-less days stay plain strings (the 065
 *  wire rule — serializePlan enforces it again on save). */
const dayValue = (primary: string, extras: string[]): PlanDayValue =>
  extras.length > 0 ? [primary, ...extras] : primary;

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
  const routines = useRoutines();
  const { sources: planSources, preferredSource } = useDayPlan();

  const daysOf = (s: SourceIndex): readonly string[] => daysForSource(s, planSources, BUILT_IN_DAYS);
  const sourceHasDays = (s: SourceIndex): boolean => daysOf(s).length > 0;

  // Saved routines are assignable as a day's PRIMARY as well as extras: the
  // stored name is LITERAL (never source-remapped — the uniform `sources`
  // write plus Train's explicit-source short-circuit guarantee that), and the
  // resolver's routine-by-name fallback opens it.
  const routineNames = (routines.data ?? []).map((r) => r.name);
  const routineNameSet = new Set(routineNames.map((n) => n.toLowerCase()));
  const isRoutineName = (name: string): boolean => routineNameSet.has(name.toLowerCase());

  // Default: Mon–Sat the six built-in days in order, Sunday rest.
  const [plan, setPlan] = useState<Record<string, PlanDayValue>>(() => {
    const seed: Record<string, PlanDayValue> = { '0': 'Rest' };
    for (let i = 1; i <= 6; i++) seed[String(i)] = BUILT_IN_DAYS[i - 1] ?? 'Rest';
    return seed;
  });
  // The whole-week source. null until seeded — falls back to preferredSource for
  // display so the picker is never blank while plans load.
  const [weekSource, setWeekSource] = useState<SourceIndex | null>(null);
  // Which split dropdown is open (e.g. "1-split"), or null.
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Which day the ADD WORKOUT picker is open for; null = closed. */
  const [pickerDow, setPickerDow] = useState<number | null>(null);
  /** The day the ?add= routine landed on — its card glows until saved. */
  const [addedDow, setAddedDow] = useState<number | null>(null);
  const addApplied = useRef(false);
  const params = useLocalSearchParams<{ add?: string }>();

  const todayDow = String(new Date(`${todayIso()}T00:00:00Z`).getUTCDay());

  const source: SourceIndex = weekSource ?? preferredSource;
  const dayList = daysOf(source);

  // Seed from the latest saved schedule once it loads — full 065 values
  // (extras ride along with their day). ?add= (the quick-workout save flow)
  // applies in the SAME pass: a separate add effect raced the deferred seed,
  // which overwrote the appended extra. The append lands on TODAY's weekday,
  // still unsaved (the athlete presses SAVE; nothing writes silently).
  const rows = schedule.data;
  useEffect(() => {
    if (!rows) return;
    const t = setTimeout(() => {
      const last = rows.length > 0 ? rows[rows.length - 1] : null;
      const next: Record<string, PlanDayValue> = last ? { ...last.plan } : { ...plan };
      const name = typeof params.add === 'string' ? params.add.trim() : '';
      if (name && !addApplied.current) {
        addApplied.current = true;
        const v = next[todayDow];
        const have = dayWorkouts(v).map((w) => w.toLowerCase());
        if (!have.includes(name.toLowerCase())) {
          next[todayDow] = [primaryOf(v), ...extrasOf(v), name];
          setAddedDow(Number(todayDow));
        }
      }
      setPlan(next);
      if (last) {
        // Seed the week source from the saved row's uniform source (the
        // most-used value in its per-day map), else leave null → falls back
        // to preferredSource.
        const vals = Object.values(last.sources ?? {}).filter((v) => v === 0 || v === 1 || v === 2) as SourceIndex[];
        if (vals.length > 0) {
          const tally = new Map<SourceIndex, number>();
          for (const v of vals) tally.set(v, (tally.get(v) ?? 0) + 1);
          const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
          setWeekSource(top);
        }
      }
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, params.add, todayDow]);

  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));

  /** Pick the whole-week source. Any trained day whose PRIMARY split isn't in
   *  the new plan is remapped to that plan's first day (never left pointing at
   *  a split the chosen plan doesn't have). Extras are literal picks and are
   *  never remapped — and so is a saved-routine PRIMARY: it belongs to no
   *  plan source, so switching plans must not clobber it. */
  const chooseSource = (s: SourceIndex) => {
    setOpenKey(null);
    if (!sourceHasDays(s)) return;
    setWeekSource(s);
    const list = daysOf(s);
    setPlan((p) => {
      const next: Record<string, PlanDayValue> = { ...p };
      for (const dow of Object.keys(next)) {
        const cur = primaryOf(next[dow]);
        if (cur === 'Rest' || isRoutineName(cur)) continue;
        if (!list.includes(cur)) next[dow] = dayValue(list[0], extrasOf(next[dow]));
      }
      return next;
    });
  };

  /** Toggle a day between REST and TRAIN — the PRIMARY slot only; extras stay.
   *  Turning training on keeps the current split if the chosen plan has it,
   *  else takes the plan's first day. */
  const toggleDay = (dow: string, isRest: boolean) => {
    setOpenKey(null);
    if (!isRest) {
      setPlan((p) => ({ ...p, [dow]: dayValue('Rest', extrasOf(p[dow])) }));
      return;
    }
    if (dayList.length === 0) return;
    setPlan((p) => {
      const cur = primaryOf(p[dow]);
      const next = cur !== 'Rest' && dayList.includes(cur) ? cur : dayList[0];
      return { ...p, [dow]: dayValue(next, extrasOf(p[dow])) };
    });
  };

  const addExtra = (dow: number, name: string) =>
    setPlan((p) => {
      const v = p[String(dow)];
      return { ...p, [String(dow)]: [primaryOf(v), ...extrasOf(v), name] };
    });

  const removeExtra = (dow: number, index: number) =>
    setPlan((p) => {
      const v = p[String(dow)];
      return { ...p, [String(dow)]: dayValue(primaryOf(v), extrasOf(v).filter((_, i) => i !== index)) };
    });

  /** An extra that is neither a plan day nor a saved routine any more —
   *  a deleted routine the schedule still references. Removable, flagged. */
  const known = new Set(
    [...daysOf(0), ...daysOf(1), ...BUILT_IN_DAYS, ...routineNames].map((n) => n.toLowerCase())
  );

  const pickerChoices = (dow: number): { section: string; names: string[] }[] => {
    const v = plan[String(dow)];
    const taken = new Set([primaryOf(v), ...extrasOf(v)].map((w) => w.toLowerCase()));
    return [
      { section: 'BUILT-IN DAYS', names: BUILT_IN_DAYS.filter((d) => !taken.has(d.toLowerCase())) },
      { section: 'MY ROUTINES', names: routineNames.filter((n) => !taken.has(n.toLowerCase())) },
    ];
  };

  const onSave = () => {
    setAddedDow(null); // the ?add= glow has served its purpose
    // UNIFORM sources: every trained day follows the one chosen plan. Train's
    // per-date reader then renders each day from that source with no remap.
    const uniform: Record<string, number> = {};
    for (const dow of Object.keys(plan)) {
      if (primaryOf(plan[dow]) !== 'Rest') uniform[dow] = source;
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
        backwards. Rest days bridge a streak; missed training days reset it. A day with an extra
        workout counts as a training day even when its main slot is Rest.
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
        const primary = primaryOf(plan[key]);
        const extras = extrasOf(plan[key]);
        const isRest = primary === 'Rest';
        // Plan splits first, then saved routines (★) — a routine can be the
        // day's MAIN workout, not just an extra.
        const splitOpts: Opt[] = [
          ...dayList.map((d) => ({ value: d, label: d.split(' - ')[0] })),
          ...routineNames
            .filter((n) => !dayList.some((d) => d.toLowerCase() === n.toLowerCase()))
            .map((n) => ({ value: n, label: `★ ${n}` })),
        ];
        return (
          <GlowCard key={name} glow={addedDow === dow ? colors.accent : undefined}>
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
                  value={primary !== 'Rest' ? primary.split(' - ')[0] : '—'}
                  options={splitOpts}
                  isOpen={openKey === `${key}-split`}
                  onToggle={() => toggle(`${key}-split`)}
                  onPick={(v) => {
                    setOpenKey(null);
                    setPlan((p) => ({ ...p, [key]: dayValue(v, extrasOf(p[key])) }));
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
            {/* A PRIMARY pointing at a routine that was deleted since. */}
            {!isRest && primary !== 'Rest' && !known.has(primary.toLowerCase()) ? (
              <Text className="mt-s1 text-2xs" style={{ color: colors.danger }}>
                ⚠ DELETED ROUTINE — pick another split
              </Text>
            ) : null}

            {/* 065: the day's extra workouts — literal names, own bar on Train. */}
            {extras.map((w, i) => (
              <View
                key={`${w}:${i}`}
                className="mt-s2 flex-row items-center justify-between rounded-lg border px-s3 py-s2"
                style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
              >
                <View className="flex-1 flex-row items-center gap-s2">
                  <Text className="text-2xs" style={{ color: colors.accent }}>
                    + EXTRA
                  </Text>
                  <Text className="flex-1 text-xs text-text" numberOfLines={1}>
                    {w}
                  </Text>
                  {!known.has(w.toLowerCase()) ? (
                    <Text className="text-2xs" style={{ color: colors.danger }}>
                      ⚠ DELETED ROUTINE
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => removeExtra(dow, i)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${w} from ${name}`}
                  testID={`remove-extra-${dow}-${i}`}
                >
                  <Text className="text-sm text-text-mute">✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => {
                setOpenKey(null);
                setPickerDow(dow);
              }}
              className="mt-s2 items-center rounded-lg border border-dashed py-s2"
              style={{ borderColor: `${colors.accent}59` }}
              accessibilityRole="button"
              testID={`add-workout-${dow}`}
            >
              <Text className="text-2xs" style={{ color: colors.accent }}>
                + ADD WORKOUT
              </Text>
            </Pressable>
          </GlowCard>
        );
      })}
      <NeonButton
        title="SAVE SCHEDULE · EFFECTIVE TODAY"
        onPress={onSave}
        busy={save.isPending}
        testID="save-schedule"
      />

      <Modal
        transparent
        visible={pickerDow !== null}
        animationType="fade"
        onRequestClose={() => setPickerDow(null)}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
          onPress={() => setPickerDow(null)}
        >
          <Pressable
            onPress={() => undefined}
            className="rounded-t-xl border-t p-s4"
            style={{ borderColor: colors.border, backgroundColor: colors.surface, maxHeight: '70%' }}
          >
            <Text
              className="mb-s3 text-text"
              allowFontScaling={false}
              style={{ fontSize: 14, letterSpacing: 0.5, ...pixelFont() }}
            >
              ADD WORKOUT · {pickerDow !== null ? WEEKDAY_NAMES[pickerDow].toUpperCase() : ''}
            </Text>
            <ScrollView>
              {pickerDow !== null
                ? pickerChoices(pickerDow).map(({ section, names }) => (
                    <View key={section} className="mb-s3">
                      <Text className="mb-s2 text-2xs text-text-mute">{section}</Text>
                      {names.length === 0 ? (
                        <Text className="text-2xs text-text-mute">
                          {section === 'MY ROUTINES'
                            ? 'No saved routines yet — finish a workout and save it.'
                            : 'All built-in days are already on this day.'}
                        </Text>
                      ) : (
                        names.map((n) => (
                          <Pressable
                            key={n}
                            onPress={() => {
                              addExtra(pickerDow, n);
                              setPickerDow(null);
                            }}
                            className="mb-s2 rounded-lg border px-s3 py-s3"
                            style={{ borderColor: colors.border }}
                            accessibilityRole="button"
                            testID={`pick-extra-${n}`}
                          >
                            <Text className="text-xs text-text">{n}</Text>
                          </Pressable>
                        ))
                      )}
                    </View>
                  ))
                : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenShell>
  );
}
