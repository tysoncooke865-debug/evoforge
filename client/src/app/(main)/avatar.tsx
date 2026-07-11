import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { branchDisplayName, evolutionName, getBranchStage, raritySlug } from '@/domain/avatar-stats';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { avatarStageRows } from '@/domain/xp-leveling';
import tokens from '@/theme/tokens';
import { avatarImage } from '@/ui/avatar-images';
import { HeroStage } from '@/ui/hero-stage';
import { DividerGlow, EdgeLabel } from '@/ui/hud';
import { RarityBadge } from '@/ui/rarity-badge';
import { RequirementRow } from '@/ui/requirement-row';
import { ScreenShell } from '@/ui/shell';

/**
 * The progression screen: current form on the stage, the evolution line with
 * true silhouettes for the unknown, and the next evolution as visual
 * requirement rows with readiness, the quick win and the wall called out.
 */
export default function AvatarScreen() {
  const { summary, stats, bfMid } = useAvatarData();

  const rows = avatarStageRows(stats.branch, summary.level);
  const evo = nextEvolutionInfo(stats.branch, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });
  const readiness = evolutionReadiness(evo.requirements);

  const stage = getBranchStage(stats.branch, summary.level);
  const slug = raritySlug(summary.level);
  const auraColour = (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;

  // Only the NEXT stage shows its name; deeper futures stay "???".
  const nextUnlockLevel = rows.find((r) => !r.unlocked)?.level ?? null;

  return (
    <ScreenShell>
      <View className="items-center">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
          {branchDisplayName(stats.branch).toUpperCase()}
        </Text>
        <Text
          className="text-3xl font-bold text-text"
          style={{ textShadowColor: `${auraColour}80`, textShadowRadius: 18 }}
        >
          {evolutionName(stats.branch, summary.level)}
        </Text>
      </View>

      <HeroStage branch={stats.branch} stage={stage} auraColour={auraColour} size={230} />
      <View className="-mt-s4 items-center">
        <RarityBadge level={summary.level} />
      </View>

      <DividerGlow />

      {/* Next evolution — the signature panel. */}
      <View
        className="rounded-xl p-s5"
        style={{ borderWidth: 1, borderColor: `${tokens.colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
      >
        <View className="mb-s4 flex-row items-center justify-between">
          <View>
            <EdgeLabel>NEXT EVOLUTION</EdgeLabel>
            <Text className="text-xl font-bold text-text">{evo.targetName}</Text>
          </View>
          <View className="items-center">
            <Text
              className="text-3xl font-bold"
              style={{ color: tokens.colors.epic, textShadowColor: 'rgba(168,85,247,0.6)', textShadowRadius: 14 }}
            >
              {readiness.percent}%
            </Text>
            <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
              READY
            </Text>
          </View>
        </View>

        {evo.requirements.map((req) => (
          <RequirementRow
            key={req.label}
            req={req}
            priority={
              readiness.nearest?.label === req.label
                ? 'nearest'
                : readiness.hardest?.label === req.label && readiness.hardest !== readiness.nearest
                  ? 'hardest'
                  : undefined
            }
          />
        ))}
      </View>

      {/* The evolution line. */}
      <View>
        <EdgeLabel>EVOLUTION LINE</EdgeLabel>
        <View className="mt-s3">
          {rows.map((row) => {
            const isNext = row.level === nextUnlockLevel;
            const showName = row.unlocked || isNext;
            return (
              <View
                key={row.level}
                className="mb-s2 flex-row items-center rounded-xl p-s3"
                style={{
                  borderWidth: 1,
                  borderColor: row.current
                    ? `${auraColour}66`
                    : row.unlocked
                      ? tokens.colors.border
                      : 'rgba(120,170,220,0.10)',
                  backgroundColor: row.current ? `${auraColour}12` : 'rgba(13,21,36,0.5)',
                  shadowColor: row.current ? auraColour : '#000',
                  shadowOpacity: row.current ? 0.35 : 0,
                  shadowRadius: 14,
                }}
              >
                {/* Locked = silhouette: shape and rim light only. */}
                <View
                  style={{
                    width: 52,
                    height: 56,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 10,
                    backgroundColor: row.unlocked ? 'transparent' : 'rgba(4,7,14,0.75)',
                    shadowColor: row.unlocked ? 'transparent' : tokens.colors.epic,
                    shadowOpacity: row.unlocked ? 0 : 0.4,
                    shadowRadius: 8,
                  }}
                >
                  <Image
                    source={avatarImage(stats.branch, row.stage)}
                    style={
                      row.unlocked
                        ? { width: 48, height: 52 }
                        : { width: 44, height: 48, tintColor: '#0a1020', opacity: 0.95 }
                    }
                    contentFit="contain"
                  />
                </View>
                <View className="ml-s3 flex-1">
                  <Text className={`text-base font-bold ${row.unlocked ? 'text-text' : 'text-text-mute'}`}>
                    {showName ? row.name : '???'}
                  </Text>
                  <Text className="text-2xs text-text-mute">
                    {row.unlocked ? `Unlocked · Level ${row.level}` : `Requires Level ${row.level}`}
                  </Text>
                </View>
                {row.current ? (
                  <Text className="text-xs font-bold" style={{ color: auraColour, letterSpacing: 1 }}>
                    CURRENT
                  </Text>
                ) : isNext ? (
                  <Text className="text-xs font-bold text-epic" style={{ letterSpacing: 1 }}>
                    NEXT
                  </Text>
                ) : !row.unlocked ? (
                  <Text className="text-xs text-text-mute">🔒</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </ScreenShell>
  );
}
