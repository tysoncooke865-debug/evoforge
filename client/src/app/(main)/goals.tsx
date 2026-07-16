import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { useBodyweightLog, useLatestBodyfatMid, useTargets } from '@/data/hooks';
import { useSaveTarget } from '@/data/mutations';
import { useAvatarData } from '@/data/use-avatar-data';
import { pyFloat } from '@/domain/py';
import { journeyPercent } from '@/domain/targets';
import { pixelFont } from '@/theme/fonts';
import { XpBar } from '@/ui/character/xp-bar';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * Goals: body-fat %, bodyweight and bench-1RM targets, each with a JOURNEY
 * bar -- distance travelled over distance to travel, so a cut and a bulk both
 * read honestly (journeyPercent, golden-fixtured). Baseline is the last
 * reading on or before the target was set, else the first reading after it;
 * no baseline, no bar.
 */
export default function GoalsScreen() {
  const targets = useTargets();
  const bodyweights = useBodyweightLog();
  const bfMid = useLatestBodyfatMid();
  const { summary, stats } = useAvatarData();

  const rows = targets.data ?? [];
  const find = (type: string, name: string) =>
    rows.filter((r) => r.target_type === type && r.name === name).at(-1);

  const bfTarget = find('Body Fat', 'Body Fat %');
  const bwTarget = find('Bodyweight', 'Bodyweight kg');
  const benchTarget = find('1RM', 'Barbell Bench Press (Strength)');

  const bwReadings = useMemo(
    () =>
      (bodyweights.data ?? [])
        .map((r) => ({ t: String(r.timestamp ?? ''), v: pyFloat(r.bodyweight) ?? 0 }))
        .filter((r) => r.v > 0),
    [bodyweights.data]
  );

  const baselineFor = (createdAt: string | null): number | null => {
    if (!createdAt || bwReadings.length === 0) return bwReadings[0]?.v ?? null;
    const before = bwReadings.filter((r) => r.t <= createdAt);
    return before.length > 0 ? before[before.length - 1].v : bwReadings[0].v;
  };

  const latestBw = bwReadings.length > 0 ? bwReadings[bwReadings.length - 1].v : null;

  return (
    <ScreenShell><ScreenHeader kicker="THE ROAD AHEAD" title="GOALS" />
        <GoalCard
          title="BODY FAT %"
          unit="%"
          current={bfMid.data ?? null}
          target={bfTarget?.target_value ?? null}
          journey={
            bfTarget && bfMid.data !== null
              ? journeyPercent(bfTarget.target_value + 5, bfMid.data, bfTarget.target_value)
              : null
          }
          onSave={(v) => ({ targetType: 'Body Fat', name: 'Body Fat %', value: v, unit: '%' })}
          initial={bfTarget ? String(bfTarget.target_value) : '10'}
        />

        <GoalCard
          title="BODYWEIGHT (KG)"
          unit="kg"
          current={latestBw}
          target={bwTarget?.target_value ?? null}
          journey={
            bwTarget && latestBw !== null
              ? journeyPercent(baselineFor(bwTarget.created_at), latestBw, bwTarget.target_value)
              : null
          }
          onSave={(v) => ({ targetType: 'Bodyweight', name: 'Bodyweight kg', value: v, unit: 'kg' })}
          initial={bwTarget ? String(bwTarget.target_value) : latestBw ? latestBw.toFixed(1) : '80'}
        />

        <GoalCard
          title="BENCH 1RM (KG)"
          unit="kg"
          current={stats.benchE1rm > 0 ? stats.benchE1rm : null}
          target={benchTarget?.target_value ?? null}
          journey={
            benchTarget && stats.benchE1rm > 0
              ? journeyPercent(
                  Math.min(stats.benchE1rm, benchTarget.target_value * 0.6),
                  stats.benchE1rm,
                  benchTarget.target_value
                )
              : null
          }
          onSave={(v) => ({
            targetType: '1RM',
            name: 'Barbell Bench Press (Strength)',
            value: v,
            unit: 'kg',
          })}
          initial={benchTarget ? String(benchTarget.target_value) : '100'}
        />

        <GlowCard>
          <Text
            className="mb-s2 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            LEVEL JOURNEY
          </Text>
          <XpBar xpIntoLevel={summary.xpIntoLevel} xpNeeded={summary.xpNeeded} />
          <Text className="mt-s1 text-2xs text-text-mute">
            Level {summary.level} → {Math.min(summary.level + 1, 100)}
          </Text>
        </GlowCard>
    </ScreenShell>
  );
}

function GoalCard({
  title,
  unit,
  current,
  target,
  journey,
  onSave,
  initial,
}: {
  title: string;
  unit: string;
  current: number | null;
  target: number | null;
  journey: number | null;
  onSave: (value: number) => { targetType: string; name: string; value: number; unit: string };
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  const save = useSaveTarget();
  const v = pyFloat(value) ?? 0;

  return (
    <GlowCard>
      <View className="mb-s2 flex-row items-center justify-between">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          {title}
        </Text>
        <Text className="text-xs text-text-dim">
          {current !== null ? `now ${current.toFixed(1)}${unit}` : 'no data yet'}
          {target !== null ? `  ·  target ${target.toFixed(1)}${unit}` : ''}
        </Text>
      </View>

      {journey !== null ? (
        <View className="mb-s3 h-s2 overflow-hidden rounded-pill border border-border-soft bg-surface-2">
          <View className="h-full rounded-pill bg-success" style={{ width: `${journey}%` }} />
        </View>
      ) : target !== null ? (
        <Text className="mb-s3 text-2xs text-text-mute">Log data to see your journey.</Text>
      ) : null}

      <View className="flex-row items-center gap-s2">
        <TextInput
          className="flex-1 rounded-md border border-border bg-surface-2 p-s2 text-text"
          inputMode="decimal"
          value={value}
          onChangeText={setValue}
        />
        <Pressable
          className={`rounded-md px-s4 py-s2 ${v > 0 ? 'bg-accent' : 'bg-surface-2'}`}
          onPress={() => v > 0 && save.mutate(onSave(v))}
          disabled={save.isPending || v <= 0}
        >
          {save.isPending ? (
            <ActivityIndicator color="#04121a" size="small" />
          ) : (
            <Text
              className={v > 0 ? 'text-accent-ink' : 'text-text-mute'}
              allowFontScaling={false}
              style={{ fontSize: 12, letterSpacing: 0.5, ...pixelFont() }}
            >
              SET TARGET
            </Text>
          )}
        </Pressable>
      </View>
    </GlowCard>
  );
}
