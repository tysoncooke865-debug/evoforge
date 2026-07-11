import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { getBranchStage, raritySlug } from '@/domain/avatar-stats';
import { avatarStageRowsV2, branchDisplayNameV2, branchPathsV2, evolutionNameV2, nextEvolutionV2, shredderName, shredderRows, shredderStage, type BranchPathV2, type BranchV2 } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import tokens from '@/theme/tokens';
import { avatarArtV2 } from '@/ui/avatar-art';
import { avatarImage } from '@/ui/avatar-images';
import { Silhouette } from '@/ui/silhouette';
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
  const { summary, stats, bfMid, branchV2, sex, earliestBf, nutritionPhase } = useAvatarData();
  const isShred = branchV2 === 'shredder';

  const rows = avatarStageRowsV2(branchV2, summary.level);
  const shredRows = isShred ? shredderRows(bfMid) : [];
  const evo = nextEvolutionV2(branchV2, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });
  const readiness = evolutionReadiness(evo.requirements);

  const paths = branchPathsV2(branchV2, {
    strength: stats.strengthScore,
    size: stats.sizeScore,
    leanness: stats.leannessScore,
    conditioning: stats.conditioningScore,
    aesthetic: stats.aestheticScore,
  }, { nutritionPhase, earliestBf });

  const stage = isShred ? shredderStage(bfMid) : getBranchStage(stats.branch, summary.level);
  const art = avatarArtV2(branchV2, stage, sex);
  const slug = raritySlug(summary.level);
  const auraColour = (tokens.colors as Record<string, string>)[slug] ?? tokens.colors.common;

  // Only the NEXT stage shows its name; deeper futures stay "???".
  const nextUnlockLevel = rows.find((r) => !r.unlocked)?.level ?? null;

  return (
    <ScreenShell>
      <View className="items-center">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
          {branchDisplayNameV2(branchV2).toUpperCase()}
        </Text>
        <Text
          className="text-3xl font-bold text-text"
          style={{ textShadowColor: `${auraColour}80`, textShadowRadius: 18 }}
        >
          {isShred ? shredderName(bfMid) : evolutionNameV2(branchV2, summary.level)}
        </Text>
      </View>

      <HeroStage
        branch={stats.branch}
        stage={stage}
        auraColour={auraColour}
        size={230}
        source={art.source}
        silhouette={!art.hasArt}
      />
      {!art.hasArt ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : null}
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
          {isShred
            ? shredRows.map((row) => (
                <View
                  key={row.stage}
                  className="mb-s2 flex-row items-center rounded-xl p-s3"
                  style={{
                    borderWidth: 1,
                    borderColor: row.current ? `${auraColour}66` : row.unlocked ? tokens.colors.border : 'rgba(120,170,220,0.10)',
                    backgroundColor: row.current ? `${auraColour}12` : 'rgba(13,21,36,0.5)',
                  }}
                >
                  {row.unlocked && avatarArtV2('shredder', row.stage, sex).hasArt ? (
                    <View style={{ width: 52, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                      <Image source={avatarArtV2('shredder', row.stage, sex).source} style={{ width: 48, height: 52 }} contentFit="contain" />
                    </View>
                  ) : (
                    <Silhouette branch="aesthetic" stage={Math.min(row.stage, 4)} rim={tokens.colors.success} />
                  )}
                  <View className="ml-s3 flex-1">
                    <Text className={`text-base font-bold ${row.unlocked ? 'text-text' : 'text-text-mute'}`}>
                      {row.unlocked || row.stage === shredRows.find((r) => !r.unlocked)?.stage ? row.name : '???'}
                    </Text>
                    <Text className="text-2xs text-text-mute">
                      {row.bfTarget === null
                        ? 'The starting form'
                        : row.unlocked
                          ? `Unlocked · under ${row.bfTarget}% body fat`
                          : `Requires under ${row.bfTarget}% body fat`}
                    </Text>
                  </View>
                  {row.current ? (
                    <Text className="text-xs font-bold" style={{ color: auraColour, letterSpacing: 1 }}>
                      CURRENT
                    </Text>
                  ) : !row.unlocked ? (
                    <Text className="text-xs text-text-mute">🔒</Text>
                  ) : null}
                </View>
              ))
            : null}
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
                {row.unlocked && avatarArtV2(branchV2, row.stage, sex).hasArt ? (
                  <View style={{ width: 52, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                    <Image source={avatarArtV2(branchV2, row.stage, sex).source} style={{ width: 48, height: 52 }} contentFit="contain" />
                  </View>
                ) : (
                  <Silhouette branch={stats.branch} stage={row.stage} />
                )}
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

      {/* Branch paths: what it takes to become the other builds. */}
      <View>
        <EdgeLabel>BRANCH PATHS</EdgeLabel>
        <Text className="mb-s3 mt-s1 text-2xs text-text-mute">
          Your branch follows your stat mix — hit these gates and the character changes build.
        </Text>
        {paths.map((path) => (
          <BranchPathCard key={path.branch} path={path} level={summary.level} />
        ))}
      </View>
    </ScreenShell>
  );
}

function BranchPathCard({
  path,
  level,
}: {
  path: BranchPathV2;
  level: number;
}) {
  const readiness = evolutionReadiness(path.requirements);
  const tints: Record<BranchV2, string> = {
    shredder: tokens.colors.success,
    titan: tokens.colors.legendary,
    mass: tokens.colors.danger,
    cardio: tokens.colors.rare,
    hybrid: tokens.colors.accent,
    aesthetic: tokens.colors.mythic,
  };
  const tint = tints[path.branch];
  const donor = path.branch === 'titan' ? 'mass' : path.branch === 'cardio' ? 'hybrid' : path.branch === 'shredder' ? 'aesthetic' : path.branch;
  const stage = getBranchStage(donor, level);
  return (
    <View
      className="mb-s3 rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: `${tint}40`, backgroundColor: 'rgba(13,21,36,0.5)' }}
    >
      <View className="mb-s3 flex-row items-center gap-s3">
        <Silhouette branch={donor} stage={stage} rim={tint} />
        <View className="flex-1">
          <Text className="text-base font-bold text-text">{branchDisplayNameV2(path.branch)}</Text>
          <Text className="text-2xs text-text-mute">
            Become {evolutionNameV2(path.branch, level)}
          </Text>
        </View>
        <View className="items-center">
          <Text className="text-xl font-bold" style={{ color: tint }}>
            {readiness.percent}%
          </Text>
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
            READY
          </Text>
        </View>
      </View>
      {path.requirements.map((req) => (
        <RequirementRow key={req.label} req={req} />
      ))}
      {path.note ? <Text className="text-2xs text-text-mute">{path.note}</Text> : null}
    </View>
  );
}
