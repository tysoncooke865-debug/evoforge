import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';

import {
  useExecAction,
  useExecActions,
  useExecAgents,
  useExecAlerts,
  useExecOverview,
  useIsAdmin,
  type ExecAlert,
} from '@/data/exec';
import { execDimensions, execHealthScore, healthBand } from '@/domain/exec-health';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * EXEC — the founder's dashboard (Tyson, 2026-07-25: extend the app rather than
 * found a separate Next.js project, so this reuses the admin gate, the rollup
 * RPCs, the design tokens and the existing deploy).
 *
 * QUICK ACTIONS ARE HERE BY DECISION, and every one is (a) admin-gated
 * server-side, (b) written to `exec_action_log` with who pressed it, and (c)
 * reversible or read-only. A founder pressing a button IS the constitution's
 * approval — the rule exists to stop an AGENT acting unilaterally. Actions that
 * would reach outside the database (deploy, merge a PR, dispatch CI) need a
 * GitHub token this project does not have, so they are ABSENT rather than
 * present and broken.
 */

/**
 * Relative time anchored to the SERVER's clock (`generated_at`), never
 * `Date.now()`: calling that during render is impure — the React Compiler
 * rejects it outright — and a device clock that disagrees with Postgres would
 * quietly mis-age every row on the page. The overview refetches every 30s, so
 * the anchor stays fresh on its own.
 */
const AGO = (iso: string | null | undefined, nowMs: number): string => {
  if (!iso || !nowMs) return 'never';
  const mins = Math.floor((nowMs - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return '—';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

function Stat({ label, value, tint, sub }: { label: string; value: string; tint?: string; sub?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flex: 1, minWidth: 96 }}>
      <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.4, ...pixelFont(false) }}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={{ fontSize: 24, color: tint ?? colors.text, ...pixelFont() }}>
        {value}
      </Text>
      {sub ? <Text className="text-2xs text-text-mute">{sub}</Text> : null}
    </View>
  );
}

export default function ExecScreen() {
  const colors = useThemeColors();
  const admin = useIsAdmin();
  const isAdmin = admin.data === true;

  const overview = useExecOverview(isAdmin);
  const alerts = useExecAlerts(isAdmin);
  const agents = useExecAgents(isAdmin);
  const actions = useExecActions(isAdmin);
  const act = useExecAction();
  const [confirming, setConfirming] = useState<string | null>(null);

  if (admin.isPending) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ADMIN" title="EXEC" onBack={() => router.back()} />
        <Text className="py-s5 text-center text-2xs text-text-mute">Checking access…</Text>
      </ScreenShell>
    );
  }
  if (!isAdmin) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ADMIN" title="EXEC" onBack={() => router.back()} />
        <GlowCard>
          <Text className="py-s3 text-center text-sm text-text-dim">🔒 App admins only.</Text>
        </GlowCard>
      </ScreenShell>
    );
  }

  const o = overview.data;
  const nowMs = o ? Date.parse(o.generated_at) : 0;
  // The watchdog counts as healthy only if it has actually RUN recently — a
  // scheduled job that stopped firing is exactly the failure this page exists
  // to surface, so "configured" is not the same as "working". Both timestamps
  // come from the server, so this comparison never touches the device clock.
  const scanAgeMin =
    o?.last_watchdog_scan && nowMs ? (nowMs - Date.parse(o.last_watchdog_scan)) / 60000 : Infinity;
  const watchdogHealthy = scanAgeMin < 20;

  const score = o
    ? execHealthScore({
        post: o.post_origin_cohort,
        lifetime: o.lifetime,
        watchdogHealthy,
        testsGreen: true,
        pushSubscribers: o.push_subscribers,
      })
    : 0;
  const band = healthBand(score);
  const bandColor =
    band === 'good' ? colors.success : band === 'fair' ? colors.warn : band === 'poor' ? colors.warn : colors.danger;
  const dims = o
    ? execDimensions({
        post: o.post_origin_cohort,
        lifetime: o.lifetime,
        watchdogHealthy,
        testsGreen: true,
        pushSubscribers: o.push_subscribers,
      })
    : [];

  const alertList = alerts.data ?? [];
  const agentList = agents.data ?? [];
  const actionList = actions.data ?? [];

  const sevColor = (s: ExecAlert['severity']) =>
    s === 'critical' ? colors.danger : s === 'warning' ? colors.warn : colors['text-mute'];

  return (
    <ScreenShell>
      <ScreenHeader kicker="ADMIN" title="EXEC" onBack={() => router.back()} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 12 }}>

        {/* HEALTH */}
        <GlowCard glow={bandColor}>
          <View className="flex-row items-end justify-between">
            <View>
              <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
                PRODUCT HEALTH
              </Text>
              <Text allowFontScaling={false} style={{ fontSize: 44, color: bandColor, ...pixelFont() }}>
                {overview.isPending ? '—' : score}
              </Text>
              <Text className="text-2xs text-text-mute">{band.toUpperCase()} · out of 100</Text>
            </View>
            <View className="items-end" style={{ gap: 2 }}>
              <Text className="text-2xs text-text-mute">watchdog {watchdogHealthy ? 'live' : 'STALE'}</Text>
              <Text className="text-2xs text-text-mute">scan {AGO(o?.last_watchdog_scan, nowMs)}</Text>
              {o ? <Text className="text-2xs text-text-mute">as at {String(o.generated_at).slice(11, 16)} UTC</Text> : null}
            </View>
          </View>

          <View className="mt-s3" style={{ gap: 6 }}>
            {dims.map((d) => (
              <View key={d.key} className="flex-row items-center" style={{ gap: 8 }}>
                <Text className="text-2xs text-text-dim" style={{ flex: 1 }} numberOfLines={1}>
                  {d.label}
                </Text>
                <Text className="text-2xs text-text" style={{ width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {d.actual}
                </Text>
                <View style={{ width: 60, height: 6, borderRadius: 3, backgroundColor: `${colors.text}14`, overflow: 'hidden' }}>
                  <View
                    style={{
                      width: `${d.score}%`,
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: d.score >= 80 ? colors.success : d.score >= 50 ? colors.warn : colors.danger,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        </GlowCard>

        {/* FUNNEL — cohort split, always. */}
        <GlowCard>
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
            ACTIVATION · POST-ORIGIN COHORT
          </Text>
          <View className="mt-s2 flex-row" style={{ gap: 8 }}>
            <Stat label="SIGNED UP" value={String(o?.post_origin_cohort.signed_up ?? '—')} />
            <Stat label="PROFILE" value={String(o?.post_origin_cohort.profiled ?? '—')} />
            <Stat label="ORIGIN" value={String(o?.post_origin_cohort.origins ?? '—')} />
            <Stat
              label="LOGGED"
              value={String(o?.post_origin_cohort.activated ?? '—')}
              tint={colors.danger}
              sub="the cliff"
            />
          </View>
          <Text className="mt-s2 text-2xs text-text-mute">
            Split at 2026-07-17: athletes before the Origin flow never had one to complete, so a
            mixed funnel reads as abandonment that never happened.
          </Text>
          <View className="mt-s3 flex-row" style={{ gap: 8 }}>
            <Stat label="SETS 7D" value={String(o?.sets_7d ?? '—')} />
            <Stat label="ON PUSH" value={String(o?.push_subscribers ?? '—')} sub="activated athletes" />
            <Stat label="TRAINED 4D" value={String(o?.lifetime.trained_4d ?? '—')} sub="lifetime" />
          </View>
        </GlowCard>

        {/* ALERTS */}
        <GlowCard glow={alertList.length > 0 ? colors.warn : undefined}>
          <View className="flex-row items-center justify-between">
            <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
              OPEN ALERTS
            </Text>
            <Text className="text-2xs text-text-mute">{alertList.length} open</Text>
          </View>
          {alertList.length === 0 ? (
            <Text className="py-s3 text-center text-2xs text-text-mute">
              Nothing open. The watchdog scans every 5 minutes.
            </Text>
          ) : (
            alertList.map((a) => (
              <View key={a.id} className="mt-s2 rounded-lg border p-s3" style={{ borderColor: `${sevColor(a.severity)}55` }}>
                <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                  <Text allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.2, color: sevColor(a.severity), ...pixelFont(false) }}>
                    {a.severity.toUpperCase()} · {a.kind}
                  </Text>
                  <Text className="text-2xs text-text-mute">{AGO(a.opened_at, nowMs)}</Text>
                </View>
                <Text className="mt-s1 text-2xs text-text">{a.title}</Text>
                <Pressable
                  accessibilityRole="button"
                  testID={`exec-resolve-${a.id}`}
                  onPress={() => act.resolveAlert.mutate(a.id)}
                  className="mt-s2 items-center justify-center rounded-lg border"
                  style={{ minHeight: 34, borderColor: `${colors.text}22` }}
                >
                  <Text className="text-2xs text-text-dim">RESOLVE</Text>
                </Pressable>
              </View>
            ))
          )}
        </GlowCard>

        {/* QUICK ACTIONS */}
        <GlowCard>
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
            QUICK ACTIONS
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            Every action is admin-only and recorded below with who pressed it.
          </Text>
          <View className="mt-s3" style={{ gap: 8 }}>
            <NeonButton
              title={act.runWatchdog.isPending ? 'SCANNING…' : 'RUN WATCHDOG NOW'}
              variant="primary"
              onPress={() => act.runWatchdog.mutate()}
              disabled={act.runWatchdog.isPending}
              testID="exec-run-watchdog"
            />
            <NeonButton
              title={act.snapshot.isPending ? 'SNAPSHOTTING…' : 'SNAPSHOT METRICS'}
              variant="ghost"
              onPress={() => act.snapshot.mutate()}
              disabled={act.snapshot.isPending}
              testID="exec-snapshot"
            />
            {/* Pausing alerting is the one action here that can HIDE a problem,
                so it confirms. Everything else is additive or reversible. */}
            {confirming === 'pause' ? (
              <View className="rounded-lg border p-s3" style={{ borderColor: `${colors.danger}66` }}>
                <Text className="text-2xs text-text">
                  Pause the watchdog? Production stops being watched until you resume it.
                </Text>
                <View className="mt-s2 flex-row" style={{ gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      title="PAUSE IT"
                      variant="ghost"
                      onPress={() => {
                        act.setWatchdog.mutate(false);
                        setConfirming(null);
                      }}
                      testID="exec-pause-confirm"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <NeonButton title="CANCEL" variant="ghost" onPress={() => setConfirming(null)} />
                  </View>
                </View>
              </View>
            ) : (
              <View className="flex-row" style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <NeonButton title="PAUSE ALERTS" variant="ghost" onPress={() => setConfirming('pause')} testID="exec-pause" />
                </View>
                <View style={{ flex: 1 }}>
                  <NeonButton
                    title="RESUME"
                    variant="ghost"
                    onPress={() => act.setWatchdog.mutate(true)}
                    testID="exec-resume"
                  />
                </View>
              </View>
            )}
          </View>
          <Text className="mt-s3 text-2xs text-text-mute">
            Deploy, merge a PR and run CI are deliberately absent: they need a GitHub token this
            project does not have yet. A button that cannot work is worse than no button.
          </Text>
        </GlowCard>

        {/* AI WORKFORCE — real rows or an honest silence. */}
        <GlowCard>
          <View className="flex-row items-center justify-between">
            <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
              AI WORKFORCE
            </Text>
            <Text className="text-2xs text-text-mute">last {AGO(o?.last_agent_at, nowMs)}</Text>
          </View>
          {agentList.length === 0 ? (
            <Text className="py-s3 text-center text-2xs text-text-mute">
              No agent session has reported yet. This shows what actually ran — it is never
              simulated.
            </Text>
          ) : (
            agentList.map((a) => (
              <View key={a.id} className="mt-s2 flex-row items-center" style={{ gap: 8 }}>
                <Text
                  allowFontScaling={false}
                  style={{
                    fontSize: 9,
                    letterSpacing: 1,
                    width: 74,
                    color: a.status === 'failed' ? colors.danger : a.status === 'running' ? colors.accent : colors.success,
                    ...pixelFont(false),
                  }}
                >
                  {a.department.toUpperCase()}
                </Text>
                <Text className="text-2xs text-text-dim" style={{ flex: 1 }} numberOfLines={1}>
                  {a.task}
                </Text>
                <Text className="text-2xs text-text-mute">{AGO(a.started_at, nowMs)}</Text>
              </View>
            ))
          )}
        </GlowCard>

        {/* AUDIT */}
        <GlowCard>
          <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
            ACTION LOG
          </Text>
          {actionList.length === 0 ? (
            <Text className="py-s3 text-center text-2xs text-text-mute">No actions yet.</Text>
          ) : (
            actionList.map((a) => (
              <View key={a.id} className="mt-s2 flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="text-2xs text-text-dim" numberOfLines={1} style={{ flex: 1 }}>
                  {a.action}
                </Text>
                <Text className="text-2xs text-text-mute">{AGO(a.at, nowMs)}</Text>
              </View>
            ))
          )}
        </GlowCard>
      </ScrollView>
    </ScreenShell>
  );
}
