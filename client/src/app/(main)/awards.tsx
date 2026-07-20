import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAchievements } from '@/data/hooks';
import { useAchievementInputs } from '@/data/use-achievement-progress';
import {
  achievementProgress,
  categoryOf,
  CATEGORY_ORDER,
  type AchCategory,
  type AchProgress,
} from '@/domain/achievement-progress';
import { ACHIEVEMENTS } from '@/domain/catalogs';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/** A distinct hue per category — the eye groups by colour before it reads. */
const CATEGORY_COLOR: Record<AchCategory, string> = {
  Milestones: '#22d3ee',
  Consistency: '#34d399',
  Strength: '#fb7185',
  Physique: '#a855f7',
  Volume: '#38bdf8',
  Cardio: '#fb923c',
  Rank: '#fbbf24',
};

type Filter = 'ALL' | AchCategory;

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

/** A thin static fill bar (no reveal animation — this is a scrollable list). */
function Bar({ frac, colour }: { frac: number; colour: string }) {
  const colors = useThemeColors();
  return (
    <View className="overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
      <View
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(1, frac)) * 100}%`,
          borderRadius: 999,
          backgroundColor: colour,
          shadowColor: colour,
          shadowOpacity: 0.5,
          shadowRadius: 6,
        }}
      />
    </View>
  );
}

function AchievementRow({
  id,
  title,
  description,
  unlockedOn,
  progress,
  showProgress,
}: {
  id: string;
  title: string;
  description: string;
  unlockedOn: string | null | undefined;
  progress: AchProgress | undefined;
  showProgress: boolean;
}) {
  const colors = useThemeColors();
  const unlocked = unlockedOn !== undefined;
  const colour = CATEGORY_COLOR[categoryOf(id)];
  const determinate = progress && !progress.indeterminate;

  return (
    <View
      className={`mb-s2 rounded-md border p-s3 ${unlocked ? 'border-border-strong bg-surface-2' : 'border-border-soft'}`}
      testID={`award-${id}`}
    >
      <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
        <Text
          className={`flex-1 ${unlocked ? 'text-text' : 'text-text-mute'}`}
          allowFontScaling={false}
          style={{ fontSize: 15, ...pixelFont() }}
        >
          {title}
        </Text>
        {unlocked ? (
          <Text className="text-success" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}>
            {unlockedOn || 'UNLOCKED'}
          </Text>
        ) : showProgress && determinate ? (
          <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, color: colour, ...pixelFont(false) }}>
            {fmtNum(progress!.current)} / {fmtNum(progress!.target)}{progress!.unit ? ` ${progress!.unit}` : ''}
          </Text>
        ) : (
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}>
            LOCKED
          </Text>
        )}
      </View>
      <Text className={`mt-s1 text-xs ${unlocked ? 'text-text-dim' : 'text-text-mute'}`}>{description}</Text>
      {!unlocked && showProgress ? (
        determinate ? (
          <View className="mt-s2">
            <Bar frac={progress!.fraction} colour={colour} />
          </View>
        ) : progress?.hint ? (
          <Text className="mt-s1 text-2xs" style={{ color: colors['text-mute'] }}>→ {progress.hint}</Text>
        ) : null
      ) : null}
    </View>
  );
}

/** All 64 achievements — grouped, filterable, with real progress toward the
 *  locked ones and a "next up" shortlist of the closest few. The catalog is the
 *  generated one the parity suite pins; progress mirrors the sweep's thresholds
 *  (achievement-progress.ts, drift-guarded). */
export default function AwardsScreen() {
  const colors = useThemeColors();
  const achievements = useAchievements();
  const { inputs, ready } = useAchievementInputs();
  const [filter, setFilter] = useState<Filter>('ALL');

  const held = useMemo(
    () =>
      new Map(
        (achievements.data ?? []).map((r) => [String(r.achievement_id), (r.date_unlocked as string | null) ?? null])
      ),
    [achievements.data]
  );
  const progress = useMemo(() => achievementProgress(inputs), [inputs]);

  const entries = Object.entries(ACHIEVEMENTS);
  const earned = entries.filter(([id]) => held.has(id)).length;
  const total = entries.length;

  // Per-category earned/total, for the chip counters.
  const catCounts = useMemo(() => {
    const m = new Map<AchCategory, { earned: number; total: number }>();
    for (const c of CATEGORY_ORDER) m.set(c, { earned: 0, total: 0 });
    for (const [id] of entries) {
      const slot = m.get(categoryOf(id))!;
      slot.total += 1;
      if (held.has(id)) slot.earned += 1;
    }
    return m;
  }, [entries, held]);

  // "Next up" — the closest locked, determinate achievements (real progress).
  const nextUp = useMemo(() => {
    if (!ready) return [];
    return entries
      .filter(([id]) => !held.has(id))
      .map(([id]) => ({ id, p: progress[id] }))
      .filter((x) => x.p && !x.p.indeterminate && x.p.fraction > 0 && x.p.fraction < 1)
      .sort((a, b) => b.p!.fraction - a.p!.fraction)
      .slice(0, 3);
  }, [entries, held, progress, ready]);

  const inProgress = useMemo(
    () =>
      ready
        ? entries.filter(([id]) => !held.has(id) && progress[id] && !progress[id].indeterminate && progress[id].fraction > 0).length
        : 0,
    [entries, held, progress, ready]
  );

  const visible = entries.filter(([id]) => filter === 'ALL' || categoryOf(id) === filter);
  // Within a group: earned last, then by how close (closest first).
  const orderRow = ([id]: [string, unknown]): number => {
    if (held.has(id)) return -1; // pushed to the end via sort below
    const p = progress[id];
    return p && !p.indeterminate ? p.fraction : 0;
  };
  const groups: { cat: AchCategory; rows: [string, readonly [string, string]][] }[] =
    filter === 'ALL'
      ? CATEGORY_ORDER.map((cat) => ({
          cat,
          rows: visible.filter(([id]) => categoryOf(id) === cat) as [string, readonly [string, string]][],
        }))
      : [{ cat: filter, rows: visible as [string, readonly [string, string]][] }];

  const sortRows = (rows: [string, readonly [string, string]][]) =>
    [...rows].sort((a, b) => {
      const ea = held.has(a[0]) ? 1 : 0;
      const eb = held.has(b[0]) ? 1 : 0;
      if (ea !== eb) return ea - eb; // locked first, earned sink to the bottom
      return orderRow(b) - orderRow(a); // closest-to-earning first
    });

  return (
    <ScreenShell>
      <ScreenHeader kicker="TROPHY HALL" title="ACHIEVEMENTS" />

      {/* Summary */}
      <GlowCard>
        <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}>
          UNLOCKED
        </Text>
        <View className="mt-s1 flex-row items-end justify-between">
          <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 26, ...pixelFont() }}>
            {earned} <Text className="text-lg text-text-mute">/ {total}</Text>
          </Text>
          <Text className="text-2xs text-text-mute">{Math.round((earned / total) * 100)}% complete</Text>
        </View>
        <View className="mt-s2">
          <Bar frac={earned / total} colour={colors.accent} />
        </View>
        {inProgress > 0 ? (
          <Text className="mt-s2 text-2xs text-text-dim">{inProgress} more in progress</Text>
        ) : null}
      </GlowCard>

      {/* Next up */}
      {nextUp.length > 0 ? (
        <GlowCard>
          <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1.5, color: colors.legendary, ...pixelFont(false) }}>
            NEXT UP
          </Text>
          <Text className="mt-s1 mb-s2 text-2xs text-text-mute">You’re closest to these — go get them.</Text>
          {nextUp.map(({ id, p }) => {
            const colour = CATEGORY_COLOR[p!.category];
            return (
              <View key={id} className="mb-s3" testID={`nextup-${id}`}>
                <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                  <Text className="flex-1 text-text" allowFontScaling={false} style={{ fontSize: 13, ...pixelFont() }}>
                    {ACHIEVEMENTS[id][0]}
                  </Text>
                  <Text allowFontScaling={false} style={{ fontSize: 9, color: colour, ...pixelFont(false) }}>
                    {fmtNum(p!.current)} / {fmtNum(p!.target)}{p!.unit ? ` ${p!.unit}` : ''}
                  </Text>
                </View>
                <View className="mt-s1">
                  <Bar frac={p!.fraction} colour={colour} />
                </View>
              </View>
            );
          })}
        </GlowCard>
      ) : null}

      {/* Category filter */}
      <View className="mb-s2 flex-row flex-wrap" style={{ gap: 6 }}>
        {(['ALL', ...CATEGORY_ORDER] as Filter[]).map((f) => {
          const on = filter === f;
          const c = f === 'ALL' ? colors.accent : CATEGORY_COLOR[f];
          const counts = f === 'ALL' ? { earned, total } : catCounts.get(f)!;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`award-filter-${f}`}
              className="rounded-pill border px-s3"
              style={{
                minHeight: 34,
                justifyContent: 'center',
                borderColor: on ? `${c}8c` : colors.border,
                backgroundColor: on ? `${c}1f` : colors['surface-2'],
              }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, color: on ? c : colors['text-dim'], ...pixelFont(false) }}>
                {f === 'ALL' ? 'ALL' : f.toUpperCase()} {counts.earned}/{counts.total}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* List */}
      {groups.map(({ cat, rows }) => {
        if (rows.length === 0) return null;
        const c = CATEGORY_COLOR[cat];
        const cc = catCounts.get(cat)!;
        return (
          <View key={cat} className="mb-s2">
            {filter === 'ALL' ? (
              <View className="mb-s2 mt-s2 flex-row items-center" style={{ gap: 8 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 1, color: c, ...pixelFont(false) }}>
                  {cat.toUpperCase()}
                </Text>
                <Text className="text-2xs text-text-mute">{cc.earned}/{cc.total}</Text>
              </View>
            ) : null}
            {sortRows(rows).map(([id, [title, description]]) => (
              <AchievementRow
                key={id}
                id={id}
                title={title}
                description={description}
                unlockedOn={held.has(id) ? held.get(id) : undefined}
                progress={progress[id]}
                showProgress={ready}
              />
            ))}
          </View>
        );
      })}
    </ScreenShell>
  );
}
