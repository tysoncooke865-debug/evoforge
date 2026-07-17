import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { usePathDualWrite } from '@/data/path-sync';
import { OriginPanel } from '@/ui/character/origin-panel';
import { ReforgeCard } from '@/ui/origin/reforge-card';
import { useAvatarData } from '@/data/use-avatar-data';
import { useDisplayIdentity } from '@/data/use-display-identity';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { SkillTreeView } from '@/ui/character/skill-tree';
import { raritySlug } from '@/domain/avatar-stats';
import { avatarStageRowsV2, branchDisplayNameV2, nextEvolutionV2, shredderRows } from '@/domain/branches-v2';
import { evolutionReadiness } from '@/domain/evolution-readiness';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarArtV2 } from '@/ui/character/avatar-art';
import { formArt } from '@/ui/customise/art';
import { Silhouette } from '@/ui/character/silhouette';
import { HeroStage } from '@/ui/character/hero-stage';
import { DividerGlow, EdgeLabel } from '@/ui/core/hud';
import { RarityBadge } from '@/ui/character/rarity-badge';
import { RequirementRow } from '@/ui/character/requirement-row';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * THE FORGE (TRANSFORM P6 — the tab is Forge; this screen now says so):
 * two subviews behind a segmented submenu. EVOLUTION is the progression
 * screen; PATHS breaks the same stats into the five attribute paths that
 * feed the branch gates (the skill tree, renamed to what it shows). The
 * choice rides ?view= so it survives refresh — 'paths' is the name, and
 * the old 'skill-tree' value still resolves so existing links and tours
 * keep working. testIDs (avatar-tab-0/1) are unchanged for the same reason.
 */
export default function AvatarScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const router = useRouter();
  const view: 0 | 1 = params.view === 'paths' || params.view === 'skill-tree' ? 1 : 0;
  const setView = (i: 0 | 1) => router.setParams({ view: i === 1 ? 'paths' : 'evolution' });

  return (
    <ScreenShell>
      <ScreenHeader kicker="THE FORGE" title={view === 1 ? 'PATHS' : 'EVOLUTION'} />
      <SegmentedTabs
        left="◈ EVOLUTION"
        right="⬢ PATHS"
        active={view}
        onChange={setView}
        testIDPrefix="avatar-tab"
        pixelLabels
      />
      {view === 0 ? <EvolutionView /> : <SkillTreeView onViewEvolution={() => setView(0)} />}
    </ScreenShell>
  );
}

/**
 * The progression screen: current form on the stage, the evolution line with
 * true silhouettes for the unknown, and the next evolution as visual
 * requirement rows with readiness, the quick win and the wall called out.
 */
function EvolutionView() {
  const colors = useThemeColors();
  const { summary, stats, bfMid, sex, ready, branchV2 } = useAvatarData();
  // ORIGIN PATH Release 2: mirror the derived path+stage into user_paths
  // (dual-write; legacy stays the read path — ORIGIN_PATH_PLAN.md).
  usePathDualWrite(ready, branchV2, summary.level, bfMid);
  // CUSTOMISE (Tyson, 2026-07-16: "customising doesn't change the forge
  // avatar screen"): the Forge shows the DISPLAY identity — the equipped
  // character/stage/skin/aura, gate-validated on every read — exactly
  // like Home. The evolution line follows the displayed champion.
  const identity = useDisplayIdentity();
  const displayBranch = identity.display.branch;
  const skinId = identity.display.skinId;
  const isShred = displayBranch === 'shredder';

  const rows = avatarStageRowsV2(displayBranch, summary.level);
  const shredRows = isShred ? shredderRows(bfMid) : [];
  const evo = nextEvolutionV2(displayBranch, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });
  const readiness = evolutionReadiness(evo.requirements);

  const stage = identity.display.stage;
  const slug = raritySlug(summary.level);
  const rarityColour = (colors as Record<string, string>)[slug] ?? colors.common;
  const auraColour = identity.display.auraColour ?? rarityColour;

  // Only the NEXT stage shows its name; deeper futures stay "???".
  const nextUnlockLevel = rows.find((r) => !r.unlocked)?.level ?? null;

  return (
    <>
      {/* ORIGIN PATH (Releases 4+5): reveal / discover banner / path roster. */}
      <OriginPanel />
      {/* FREE REFORGE (047): one free re-choice after 3 valid workouts. */}
      <ReforgeCard />
      <View className="items-center">
        <Text
          className="text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
        >
          {branchDisplayNameV2(displayBranch).toUpperCase()}
        </Text>
        <Text
          className="text-text"
          allowFontScaling={false}
          style={{
            fontSize: 30,
            lineHeight: 36,
            textShadowColor: `${auraColour}80`,
            textShadowRadius: 18,
            ...pixelFont(),
          }}
        >
          {identity.display.formName}
        </Text>
      </View>

      <HeroStage
        branch={identity.display.donor}
        stage={stage}
        auraColour={auraColour}
        size={230}
        source={identity.paintedSource}
        animatedSource={identity.animatedSource}
        stillSource={identity.stillSource}
        silhouette={!identity.hasArt}
      />
      {!identity.hasArt ? (
        <Text
          className="-mt-s2 text-center text-text-mute"
          allowFontScaling={false}
          style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
        >
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
        style={{ borderWidth: 1, borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
      >
        <View className="mb-s4 flex-row items-center justify-between">
          <View>
            <EdgeLabel>NEXT EVOLUTION</EdgeLabel>
            <Text className="text-text" allowFontScaling={false} style={{ fontSize: 20, ...pixelFont() }}>
              {evo.targetName}
            </Text>
          </View>
          <View className="items-center">
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 30,
                lineHeight: 34,
                color: colors.epic,
                textShadowColor: 'rgba(168,85,247,0.6)',
                textShadowRadius: 14,
                ...pixelFont(),
              }}
            >
              {readiness.percent}%
            </Text>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 8, letterSpacing: 1.5, ...pixelFont(false) }}
            >
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
                    borderColor: row.current ? `${auraColour}66` : row.unlocked ? colors.border : 'rgba(120,170,220,0.10)',
                    backgroundColor: row.current ? `${auraColour}12` : 'rgba(13,21,36,0.5)',
                  }}
                >
                  {row.unlocked && (formArt('shredder', row.stage, sex, skinId).animated || avatarArtV2('shredder', row.stage, sex).hasArt) ? (
                    <View style={{ width: 52, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                      <Image
                        source={formArt('shredder', row.stage, sex, skinId).animated ?? formArt('shredder', row.stage, sex, skinId).painted}
                        style={{
                          width: 48,
                          height: 52,
                          ...(formArt('shredder', row.stage, sex, skinId).animated ? ({ imageRendering: 'pixelated' } as object) : {}),
                        }}
                        contentFit="contain"
                      />
                    </View>
                  ) : (
                    <Silhouette branch="aesthetic" stage={Math.min(row.stage, 4)} rim={colors.success} />
                  )}
                  <View className="ml-s3 flex-1">
                    <Text
                      className={row.unlocked ? 'text-text' : 'text-text-mute'}
                      allowFontScaling={false}
                      style={{ fontSize: 16, ...pixelFont() }}
                    >
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
                    <Text
                      allowFontScaling={false}
                      style={{ fontSize: 11, color: auraColour, letterSpacing: 0.5, ...pixelFont() }}
                    >
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
                      ? colors.border
                      : 'rgba(120,170,220,0.10)',
                  backgroundColor: row.current ? `${auraColour}12` : 'rgba(13,21,36,0.5)',
                  shadowColor: row.current ? auraColour : '#000',
                  shadowOpacity: row.current ? 0.35 : 0,
                  shadowRadius: 14,
                }}
              >
                {row.unlocked && (formArt(displayBranch, row.stage, sex, skinId).animated || avatarArtV2(displayBranch, row.stage, sex).hasArt) ? (
                  <View style={{ width: 52, height: 56, alignItems: 'center', justifyContent: 'center' }}>
                    {/* Unlocked stages show their ROTATING sprite where one
                        exists (Tyson, 2026-07-16) — the same per-stage set
                        the hero uses, in the EQUIPPED SKIN; painted art is
                        the fallback. */}
                    <Image
                      source={formArt(displayBranch, row.stage, sex, skinId).animated ?? formArt(displayBranch, row.stage, sex, skinId).painted}
                      style={{
                        width: 48,
                        height: 52,
                        ...(formArt(displayBranch, row.stage, sex, skinId).animated ? ({ imageRendering: 'pixelated' } as object) : {}),
                      }}
                      contentFit="contain"
                    />
                  </View>
                ) : (
                  <Silhouette branch={identity.display.donor} stage={row.stage} />
                )}
                <View className="ml-s3 flex-1">
                  <Text
                    className={row.unlocked ? 'text-text' : 'text-text-mute'}
                    allowFontScaling={false}
                    style={{ fontSize: 16, ...pixelFont() }}
                  >
                    {showName ? row.name : '???'}
                  </Text>
                  <Text className="text-2xs text-text-mute">
                    {row.unlocked ? `Unlocked · Level ${row.level}` : `Requires Level ${row.level}`}
                  </Text>
                </View>
                {row.current ? (
                  <Text
                    allowFontScaling={false}
                    style={{ fontSize: 11, color: auraColour, letterSpacing: 0.5, ...pixelFont() }}
                  >
                    CURRENT
                  </Text>
                ) : isNext ? (
                  <Text
                    className="text-epic"
                    allowFontScaling={false}
                    style={{ fontSize: 11, letterSpacing: 0.5, ...pixelFont() }}
                  >
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

    </>
  );
}
