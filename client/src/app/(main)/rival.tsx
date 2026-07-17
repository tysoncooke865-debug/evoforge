/**
 * PROGRESSION_OVERHAUL P7 — the Rival Rank page (spec §33): standing,
 * division, rating + confidence, placements, season peak, recent rated
 * matches. States its boundary: competitive results only.
 */

import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { progressionFeatures } from '@/data/progression/features';
import { useReconcileSettles, useRivalMatches, useRivalRating } from '@/data/progression/use-rival-rank';
import { rankStandingFor } from '@/domain/progression/rank-tiers';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

export default function RivalRankScreen() {
  const colors = useThemeColors();
  const { session } = useAuth();
  const rating = useRivalRating();
  const matches = useRivalMatches();
  const reconcile = useReconcileSettles();
  const reconciledRef = useRef(false);

  // Reconcile once per visit: any completed-but-unrated battles settle now.
  useEffect(() => {
    if (reconciledRef.current || !progressionFeatures.rivalRankEnabled || !session) return;
    reconciledRef.current = true;
    reconcile.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!progressionFeatures.rivalRankEnabled) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="COMPETITIVE" title="RIVAL RANK" onBack={() => router.back()} />
        <Text className="text-sm text-text-dim">Rival Rank is not enabled yet.</Text>
      </ScreenShell>
    );
  }

  const row = rating.data ?? null;
  const standing = rankStandingFor({
    rating: Number(row?.rating ?? 1500),
    rd: Number(row?.rating_deviation ?? 350),
    placementsCompleted: Number(row?.placement_matches_completed ?? 0),
  });
  const myId = session?.user?.id ?? '';

  return (
    <ScreenShell>
      <ScreenHeader kicker="COMPETITIVE" title="RIVAL RANK" onBack={() => router.back()} />

      <GlowCard glow={colors.accent} padding={16}>
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          SEASON 1 · OVERALL
        </Text>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 30, lineHeight: 38, letterSpacing: 0, color: standing.provisional ? colors['text-dim'] : colors.accent, textShadowColor: 'rgba(34,211,238,0.4)', textShadowRadius: 12, ...pixelFont() }}
        >
          {standing.label}
        </Text>
        {row ? (
          <View className="mt-s2 flex-row" style={{ gap: 16 }}>
            <View>
              <Text className="text-base text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
                {Math.round(Number(row.rating))}
              </Text>
              <Text className="text-2xs text-text-mute">RIVAL RATING</Text>
            </View>
            <View>
              <Text className="text-base text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
                {Math.round(Number(row.season_peak_rating))}
              </Text>
              <Text className="text-2xs text-text-mute">SEASON PEAK</Text>
            </View>
            <View>
              <Text className="text-base text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
                {standing.confidence.toUpperCase()}
              </Text>
              <Text className="text-2xs text-text-mute">CONFIDENCE</Text>
            </View>
          </View>
        ) : (
          <Text className="mt-s2 text-xs text-text-dim">
            Complete Arena battles to enter placements — five rated matches set your first rank.
          </Text>
        )}
        <Text className="mt-s2 text-2xs text-text-mute">
          Rival Rank measures competitive results. Evo Rating, Forge Level, coins and cosmetics never move it.
        </Text>
      </GlowCard>

      <View>
        <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          RATED MATCHES
        </Text>
        {(matches.data ?? []).length === 0 ? (
          <Text className="text-xs text-text-mute">No rated matches yet — win battles in the Arena.</Text>
        ) : (
          (matches.data ?? []).map((m) => {
            const isA = String(m.player_a) === myId;
            const delta = Number(isA ? m.rating_change_a : m.rating_change_b);
            const won = (m.outcome === 'a' && isA) || (m.outcome === 'b' && !isA);
            return (
              <View key={String(m.id)} className="mb-s1 flex-row items-center justify-between rounded-md border px-s3 py-s2" style={{ borderColor: colors.border, backgroundColor: colors['surface-2'] }}>
                <Text className="text-xs" style={{ color: m.outcome === 'draw' ? colors['text-dim'] : won ? colors.success : colors.danger }}>
                  {m.outcome === 'draw' ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'} · {String(m.created_at).slice(0, 10)}
                </Text>
                <Text className="text-sm" allowFontScaling={false} style={{ color: delta >= 0 ? colors.success : colors.danger, ...pixelFont() }}>
                  {delta >= 0 ? '+' : ''}
                  {Math.round(delta)}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </ScreenShell>
  );
}
