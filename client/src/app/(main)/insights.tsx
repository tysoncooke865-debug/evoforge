import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

import {
  useAnalyticsDaily,
  useAnalyticsOverview,
  useAnalyticsTopPages,
  useIsAdmin,
  type AnalyticsDay,
} from '@/data/analytics-admin';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

type Metric = 'active_users' | 'signups' | 'sets_logged';
const METRICS: { key: Metric; label: string; colour: (c: ReturnType<typeof useThemeColors>) => string }[] = [
  { key: 'active_users', label: 'ACTIVE', colour: (c) => c.accent },
  { key: 'signups', label: 'SIGNUPS', colour: (c) => c.success },
  { key: 'sets_logged', label: 'SETS', colour: (c) => c.epic },
];

/**
 * INSIGHTS (migration 080) — the product-metrics dashboard: engagement,
 * retention, signups and content volume. Admin-only; every rollup RPC re-checks
 * is_app_admin server-side, so this screen is defence-in-depth, not the gate.
 */
export default function InsightsScreen() {
  const colors = useThemeColors();
  const admin = useIsAdmin();
  const isAdmin = admin.data === true;
  const [days, setDays] = useState(14);
  const [metric, setMetric] = useState<Metric>('active_users');

  const overview = useAnalyticsOverview(isAdmin);
  const daily = useAnalyticsDaily(days, isAdmin);
  const topPages = useAnalyticsTopPages(days, isAdmin);
  const o = overview.data;

  if (admin.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ADMIN" title="INSIGHTS" onBack={() => router.back()} />
        <Text className="py-s5 text-center text-2xs text-text-mute">Checking access…</Text>
      </ScreenShell>
    );
  }

  if (!isAdmin) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ADMIN" title="INSIGHTS" onBack={() => router.back()} />
        <GlowCard>
          <Text className="py-s3 text-center text-sm text-text-dim">
            🔒 This dashboard is for app admins only.
          </Text>
        </GlowCard>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader kicker="ADMIN" title="INSIGHTS" onBack={() => router.back()} />

      {/* Live pulse. */}
      <GlowCard glow={colors.accent}>
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>ACTIVE NOW</Text>
            <Text allowFontScaling={false} style={{ fontSize: 28, color: colors.accent, ...pixelFont() }}>{o?.active_now ?? '—'}</Text>
          </View>
          <View className="items-end">
            <Text className="text-2xs text-text-mute">last 5 min</Text>
            {o ? <Text className="text-2xs text-text-mute">updated {String(o.generated_at).slice(11, 16)} UTC</Text> : null}
          </View>
        </View>
      </GlowCard>

      {/* Engagement + retention KPIs. */}
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        <Kpi label="DAILY ACTIVE" value={o?.dau} tint={colors.accent} sub="unique · 24h" />
        <Kpi label="WEEKLY ACTIVE" value={o?.wau} tint={colors.accent} sub="unique · 7d" />
        <Kpi label="MONTHLY ACTIVE" value={o?.mau} tint={colors.accent} sub="unique · 30d" />
        <Kpi label="TOTAL USERS" value={o?.total_users} tint={colors.text} sub="all time" />
        <Kpi label="SIGNUPS TODAY" value={o?.signups_today} tint={colors.success} />
        <Kpi label="SIGNUPS · 7D" value={o?.signups_7d} tint={colors.success} />
        <Kpi label="SIGNUPS · 30D" value={o?.signups_30d} tint={colors.success} />
        <Kpi label="ONE & DONE" value={o?.never_returned} tint={colors.danger} sub="never returned" />
      </View>

      {/* Content volume + time. */}
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        <Kpi label="SETS · 7D" value={o?.sets_logged_7d} tint={colors.epic} />
        <Kpi label="WORKOUTS · 7D" value={o?.workouts_logged_7d} tint={colors.epic} />
        <Kpi label="AVG SESSION" value={o?.avg_session_min} unit="min" tint={colors.legendary} />
        <Kpi label="TIME ON APP" value={o?.avg_time_on_app_min} unit="min" tint={colors.legendary} sub="avg / user" />
      </View>

      {/* Range selector. */}
      <View className="flex-row" style={{ gap: 6 }}>
        {[7, 14, 30].map((n) => {
          const on = days === n;
          return (
            <Pressable
              key={n}
              onPress={() => setDays(n)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              testID={`insights-range-${n}`}
              className="rounded-pill border px-s3"
              style={{ minHeight: 32, justifyContent: 'center', borderColor: on ? `${colors.accent}8c` : colors.border, backgroundColor: on ? `${colors.accent}1f` : colors['surface-2'] }}
            >
              <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 0.5, color: on ? colors.accent : colors['text-dim'], ...pixelFont(false) }}>{n}D</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Daily trend — one metric at a time (no dual axis). */}
      <GlowCard>
        <View className="mb-s2 flex-row items-center justify-between">
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>DAILY TREND</Text>
          <View className="flex-row" style={{ gap: 4 }}>
            {METRICS.map((m) => {
              const on = metric === m.key;
              const c = m.colour(colors);
              return (
                <Pressable key={m.key} onPress={() => setMetric(m.key)} accessibilityRole="button" testID={`insights-metric-${m.key}`} className="rounded-pill border px-s2" style={{ minHeight: 28, justifyContent: 'center', borderColor: on ? `${c}8c` : colors.border, backgroundColor: on ? `${c}1f` : 'transparent' }}>
                  <Text allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, color: on ? c : colors['text-mute'], ...pixelFont(false) }}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {daily.isPending ? (
          <Text className="py-s4 text-center text-2xs text-text-mute">Loading…</Text>
        ) : (
          <DailyChart data={daily.data ?? []} metric={metric} colour={METRICS.find((m) => m.key === metric)!.colour(colors)} />
        )}
      </GlowCard>

      {/* Top pages by dwell. */}
      <GlowCard>
        <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>TOP PAGES · {days}D</Text>
        {topPages.isPending ? (
          <Text className="py-s4 text-center text-2xs text-text-mute">Loading…</Text>
        ) : (topPages.data ?? []).length === 0 ? (
          <Text className="py-s3 text-center text-2xs text-text-mute">No page views recorded yet.</Text>
        ) : (
          <View className="mt-s2" style={{ gap: 8 }}>
            {(topPages.data ?? []).slice(0, 12).map((p) => {
              const max = Math.max(1, ...(topPages.data ?? []).map((x) => x.views));
              return (
                <View key={p.page} testID={`insights-page-${p.page}`}>
                  <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                    <Text className="flex-1 text-2xs text-text-dim" numberOfLines={1}>{p.page === '/' ? '/ (home)' : p.page}</Text>
                    <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.accent, ...pixelFont(false) }}>
                      {p.views} · {p.unique_users}u{p.avg_seconds != null ? ` · ${p.avg_seconds}s` : ''}
                    </Text>
                  </View>
                  <View className="mt-s1 overflow-hidden rounded-pill" style={{ height: 4, backgroundColor: colors['surface-3'] }}>
                    <View style={{ height: '100%', width: `${Math.max(0.03, p.views / max) * 100}%`, borderRadius: 999, backgroundColor: colors.accent }} />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </GlowCard>

      <Text className="mt-s1 mb-s4 text-2xs text-text-mute">
        Metrics are server-computed rollups (migration 080). Page paths are normalised — id
        segments stripped — so no personal data is recorded in a route.
      </Text>
    </ScreenShell>
  );
}

function Kpi({ label, value, unit, sub, tint }: { label: string; value: number | null | undefined; unit?: string; sub?: string; tint: string }) {
  const colors = useThemeColors();
  const shown = value === null || value === undefined ? '—' : `${value}${unit ? '' : ''}`;
  return (
    <View className="rounded-lg border p-s3" style={{ flexGrow: 1, flexBasis: '46%', borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.5)' }}>
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 1, ...pixelFont(false) }}>{label}</Text>
      <Text allowFontScaling={false} style={{ fontSize: 22, color: tint, ...pixelFont() }}>
        {shown}{unit && value != null ? <Text className="text-2xs text-text-mute"> {unit}</Text> : null}
      </Text>
      {sub ? <Text className="text-2xs text-text-mute">{sub}</Text> : null}
    </View>
  );
}

/** A simple daily bar chart — one metric, scaled to its own max, newest at the
 *  right. Labels only the endpoints to stay legible on a phone. */
function DailyChart({ data, metric, colour }: { data: AnalyticsDay[]; metric: Metric; colour: string }) {
  if (data.length === 0) {
    return <Text className="py-s4 text-center text-2xs text-text-mute">No data in range.</Text>;
  }
  const vals = data.map((d) => Number(d[metric] ?? 0));
  const max = Math.max(1, ...vals);
  const peak = Math.max(...vals);
  return (
    <View>
      <View className="flex-row items-end" style={{ height: 96, gap: 2 }}>
        {data.map((d, i) => {
          const v = vals[i];
          return (
            <View key={d.day} className="flex-1 items-center justify-end" style={{ height: '100%' }}>
              <View
                style={{
                  width: '100%',
                  height: `${Math.max(2, (v / max) * 100)}%`,
                  borderRadius: 3,
                  backgroundColor: v === peak && peak > 0 ? colour : `${colour}88`,
                  minHeight: 2,
                }}
              />
            </View>
          );
        })}
      </View>
      <View className="mt-s1 flex-row justify-between">
        <Text className="text-2xs text-text-mute">{fmtDay(data[0].day)}</Text>
        <Text allowFontScaling={false} style={{ fontSize: 9, color: colour, ...pixelFont(false) }}>peak {peak}</Text>
        <Text className="text-2xs text-text-mute">{fmtDay(data[data.length - 1].day)}</Text>
      </View>
    </View>
  );
}

function fmtDay(day: string): string {
  // day is 'YYYY-MM-DD' → 'MM-DD'
  return String(day).slice(5, 10);
}
