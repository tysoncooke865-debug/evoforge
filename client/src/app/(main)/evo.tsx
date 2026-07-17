/**
 * PROGRESSION_OVERHAUL P5 — the Evo Rating detail page (spec §31):
 * current/starting/peak, Evolution Progress, the four pillars with their
 * confidences, the review history, the forecast, pending evidence.
 * Clear hierarchy, not a wall of identical glowing cards.
 */

import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import {
  useEvoRatingCurrent,
  useEvoSnapshots,
  usePendingEvoEvidence,
  usePlayerStats,
  useRunEvoReview,
} from '@/data/progression/use-evo-rating';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { StatBar } from '@/ui/character/stat-bar';

function PlayerStatsPanel() {
  const colors = useThemeColors();
  const ps = usePlayerStats();
  const stats = ps.data?.stats ?? null;
  if (!stats) return null;
  const rows: readonly (readonly [string, number])[] = [
    ['POWER', Number(stats.power)],
    ['VITALITY', Number(stats.vitality)],
    ['STAMINA', Number(stats.stamina)],
    ['BALANCE', Number(stats.balance)],
    ['TECHNIQUE', Number(stats.technique)],
  ];
  return (
    <View className="rounded-xl border p-s4" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          PLAYER STATS
        </Text>
        {stats.evo_class ? (
          <Text allowFontScaling={false} style={{ fontSize: 11, letterSpacing: 0, color: colors.epic, ...pixelFont() }}>
            {String(stats.evo_class).toUpperCase()}
          </Text>
        ) : null}
      </View>
      <View className="mt-s2 flex-row flex-wrap" style={{ gap: 12 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ minWidth: 64 }}>
            <Text className="text-lg text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
              {value}
            </Text>
            <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}>
              {label}
            </Text>
          </View>
        ))}
      </View>
      {(ps.data?.traits ?? []).length > 0 ? (
        <View className="mt-s2 flex-row flex-wrap" style={{ gap: 6 }}>
          {ps.data!.traits.map((t) => (
            <View key={String(t.trait_key)} className="rounded-pill border px-s2 py-s1" style={{ borderColor: `${colors.legendary}59`, backgroundColor: 'rgba(245,184,59,0.06)' }}>
              <Text className="text-2xs" style={{ color: colors.legendary }}>
                {String(t.trait_key).replace(/_/g, ' ').toUpperCase()}
                {Number(t.trait_tier) > 1 ? ` ${'I'.repeat(Number(t.trait_tier))}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// Colour as a TOKEN KEY, resolved through the theme at render (accent
// follows the equipped palette; the rarity keys stay standard by design).
const PILLARS: readonly (readonly [
  scoreKey: string,
  confKey: string,
  abbr: string,
  name: string,
  colour: 'epic' | 'mythic' | 'accent' | 'rare',
])[] = [
  ['size_score', 'size_confidence', 'SIZE', 'Size', 'epic'],
  ['aesthetics_score', 'aesthetics_confidence', 'AES', 'Aesthetics', 'mythic'],
  ['strength_score', 'strength_confidence', 'STR', 'Strength', 'accent'],
  ['cardio_score', 'cardio_confidence', 'CARDIO', 'Cardio', 'rare'],
];

export default function EvoRatingScreen() {
  const colors = useThemeColors();
  const current = useEvoRatingCurrent();
  const snapshots = useEvoSnapshots(12);
  const pending = usePendingEvoEvidence();
  const review = useRunEvoReview();

  const row = (current.data ?? null) as Record<string, unknown> | null;

  if (!progressionFeatures.newProgressionEnabled) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="PROGRESSION" title="EVO RATING" onBack={() => router.back()} />
        <Text className="text-sm text-text-dim">The new progression system is not enabled yet.</Text>
      </ScreenShell>
    );
  }

  const n = (k: string): number => Math.floor(Number(row?.[k] ?? 0));
  const recommendations: string[] = Array.isArray(
    (snapshots.data?.[0] as Record<string, unknown> | undefined)?.recommendations
  )
    ? ((snapshots.data![0] as Record<string, unknown>).recommendations as string[])
    : [];

  return (
    <ScreenShell>
      <ScreenHeader kicker="PROGRESSION" title="EVO RATING" onBack={() => router.back()} />

      {!row ? (
        <GlowCard glow={colors.epic}>
          <Text className="text-base font-bold text-text">No Evo Rating yet</Text>
          <Text className="mt-s1 text-xs text-text-dim">
            Run your first official review to anchor your starting rating.
          </Text>
          <View className="mt-s3">
            <NeonButton title="RUN FIRST EVO REVIEW" pixel busy={review.isPending} onPress={() => review.mutate({ force: true })} testID="evo-first-review" />
          </View>
        </GlowCard>
      ) : (
        <>
          {/* The core numbers. */}
          <GlowCard glow={colors.epic} padding={16}>
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                  CURRENT{String(row.status) === 'provisional' ? ' · PROVISIONAL' : ''}
                </Text>
                <Text allowFontScaling={false} style={{ fontSize: 52, lineHeight: 58, letterSpacing: 0, color: colors.epic, textShadowColor: 'rgba(168,85,247,0.5)', textShadowRadius: 16, ...pixelFont() }}>
                  {n('displayed_rating')}
                </Text>
                <Text className="text-sm text-text" allowFontScaling={false} style={{ letterSpacing: 0, ...pixelFont() }}>
                  {String(row.descriptor ?? '').toUpperCase()}
                </Text>
              </View>
              <View className="items-end" style={{ gap: 2 }}>
                <Text className="text-2xs text-text-mute">STARTING {n('starting_displayed')}</Text>
                <Text className="text-2xs" style={{ color: colors.legendary }}>
                  PEAK {n('peak_displayed')}
                </Text>
                <Text className="text-2xs" style={{ color: n('lifetime_evolution') >= 0 ? colors.success : colors.danger }}>
                  LIFETIME {n('lifetime_evolution') >= 0 ? '+' : ''}
                  {n('lifetime_evolution')}
                </Text>
                <Text className="text-2xs text-text-mute">
                  CONFIDENCE {String(row.confidence_label ?? 'provisional').toUpperCase()}
                </Text>
              </View>
            </View>
            <View className="mt-s3 overflow-hidden rounded-pill" style={{ height: 6, backgroundColor: colors['surface-3'] }}>
              <View style={{ width: `${n('evolution_progress')}%`, height: '100%', borderRadius: 999, backgroundColor: colors.epic }} />
            </View>
            <Text className="mt-s1 text-2xs text-text-dim">
              {n('evolution_progress')}/100 toward Evo Rating {Math.min(n('displayed_rating') + 1, 100)}
            </Text>
            {n('peak_displayed') > n('displayed_rating') ? (
              <Text className="mt-s1 text-2xs" style={{ color: colors.legendary }}>
                RECLAIM YOUR PEAK — {n('peak_displayed')} awaits
              </Text>
            ) : null}
          </GlowCard>

          {/* Pillars with confidence. */}
          <View>
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              PILLARS
            </Text>
            {PILLARS.map(([scoreKey, confKey, abbr, name, colour]) => (
              <View key={scoreKey}>
                <StatBar abbr={abbr} name={name} value={Number(row[scoreKey] ?? 1)} colour={colors[colour]} />
                <Text className="-mt-s2 mb-s2 text-2xs text-text-mute">
                  confidence {n(confKey)} · {String(row.limiting_pillar) === scoreKey.replace('_score', '') ? 'LIMITING' : ' '}
                </Text>
              </View>
            ))}
          </View>

          {/* Player Stats + class + traits (P8). */}
          <PlayerStatsPanel />

          {/* Forecast from the latest review. */}
          {recommendations.length > 0 ? (
            <GlowCard padding={16}>
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                FASTEST PATH FORWARD
              </Text>
              {recommendations.map((r, i) => (
                <Text key={i} className="mt-s2 text-sm text-text-dim">
                  {i + 1}. {r}
                </Text>
              ))}
            </GlowCard>
          ) : null}

          {/* Pending evidence. */}
          {(pending.data?.length ?? 0) > 0 ? (
            <View className="rounded-xl border p-s4" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}>
              <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
                PENDING EVO EVIDENCE
              </Text>
              {pending.data!.map((p) => (
                <Text key={String(p.id)} className="mt-s2 text-xs text-text-dim">
                  {String(p.reason ?? p.source_type)} · +{String(p.projected_impact_low)}–{String(p.projected_impact_high)} projected
                </Text>
              ))}
            </View>
          ) : null}

          {/* Review history. */}
          <View>
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              REVIEW HISTORY
            </Text>
            {(snapshots.data ?? []).map((s) => (
              <View key={String(s.id)} className="mb-s2 flex-row items-center justify-between rounded-md border px-s3 py-s2" style={{ borderColor: colors.border, backgroundColor: colors['surface-2'] }}>
                <Text className="text-xs text-text-dim">
                  {String(s.calculated_at).slice(0, 10)} · {String(s.trigger_type).replace('_', ' ')}
                </Text>
                <Text className="text-sm" allowFontScaling={false} style={{ color: colors.epic, ...pixelFont() }}>
                  {String(s.displayed_rating)} · {String(s.evolution_progress)}/100
                </Text>
              </View>
            ))}
          </View>

          {progressionFeatures.monthlyScansEnabled ? (
            <NeonButton
              title="GUIDED EVO SCAN"
              pixel
              onPress={() => router.push('/evo-scan' as never)}
              testID="evo-open-scan"
            />
          ) : null}
          <NeonButton
            title="RUN EVO REVIEW NOW"
            variant="ghost"
            pixel
            busy={review.isPending}
            onPress={() => review.mutate({ force: true })}
            testID="evo-run-review"
          />
        </>
      )}
    </ScreenShell>
  );
}
