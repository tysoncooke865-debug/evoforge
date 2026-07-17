import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { BranchV2, ScoresV2 } from '@/domain/branches-v2';
import { evolutionNameV2, shredderName } from '@/domain/branches-v2';
import type { RosterEntry, Selection, StageOption } from '@/domain/customise';
import { AURAS, displayDonor } from '@/domain/customise';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import type { Sex } from '@/ui/character/avatar-art';
import { HeroStage } from '@/ui/character/hero-stage';
import { RarityBadge } from '@/ui/character/rarity-badge';
import { RequirementRow } from '@/ui/character/requirement-row';
import { StatBar } from '@/ui/character/stat-bar';
import { EdgeLabel } from '@/ui/core/hud';

import { formArt } from './art';
import { StageRail } from './stage-rail';

/**
 * CUSTOMISE §preview — the selected champion on the same podium stage the
 * Home hero uses (HeroStage), with the SELECTION's skin and aura applied
 * live. Locked characters still preview (dimmed via silhouette rules or
 * shown with their real gates below) — seeing what you're training toward
 * is the point.
 */
export function PreviewPanel({
  entry,
  selection,
  stageOption,
  stageOptions,
  onSelectStage,
  currentStage,
  stageCount,
  level,
  bfMid,
  sex,
  scores,
  rarityColour,
}: {
  entry: RosterEntry;
  selection: Selection;
  /** The selected stage option (null = current form). */
  stageOption: StageOption | null;
  /** The full ladder — rendered as the right-edge stage rail (≤1 hides it). */
  stageOptions: StageOption[];
  onSelectStage: (key: string | null) => void;
  currentStage: number;
  stageCount: number;
  level: number;
  bfMid: number | null;
  sex: Sex;
  scores: ScoresV2;
  rarityColour: string;
}) {
  const colors = useThemeColors();
  const stage = stageOption?.stage ?? currentStage;
  const art = formArt(entry.id, stage, sex, selection.skinId);
  const aura = AURAS.find((a) => a.id === selection.auraId);
  const auraColour = aura?.colour ?? rarityColour;
  const formName = formNameFor(entry.id, stageOption, level, bfMid);
  const previewingLocked = stageOption !== null && !stageOption.unlocked;

  return (
    <View
      className="rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: `${colors.accent}33`, backgroundColor: 'rgba(10,16,30,0.55)' }}
    >
      <View className="flex-row items-start justify-between">
        <View style={{ flexShrink: 1 }}>
          <Text
            className="text-xl font-bold"
            numberOfLines={1}
            style={{ color: colors.accent, textShadowColor: `${colors.accent}66`, textShadowRadius: 14, ...pixelFont() }}
          >
            {formName.toUpperCase()}
          </Text>
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
            {entry.icon} {entry.name.toUpperCase()} · STAGE {stage} / {stageCount}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/evo' as never)}
          accessibilityRole="button"
          accessibilityLabel="view full stats"
          testID="preview-view-stats"
          className="rounded-md border px-s2 py-s1"
          style={{ minHeight: 32, justifyContent: 'center', borderColor: `${colors.accent}45` }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.accent, ...pixelFont() }}>
            VIEW STATS
          </Text>
        </Pressable>
      </View>

      {/* The podium takes the width; the evolution stages ride a slim rail
          hugging the box's right edge (inside the padding — no bleed).
          resolveDisplay-style rule: ≤1 stage renders no rail at all. */}
      <View className="flex-row items-center">
        <View className="flex-1" style={{ opacity: entry.unlocked && !previewingLocked ? 1 : 0.6 }}>
          <HeroStage
            branch={displayDonor(entry.id)}
            stage={stage}
            auraColour={auraColour}
            size={190}
            source={art.painted}
            animatedSource={art.animated}
            stillSource={art.still}
            silhouette={!art.hasArt}
          />
        </View>
        <View style={{ marginLeft: 8 }}>
          <StageRail
            maxHeight={300}
            items={stageOptions.map((option, i) => {
              const optionArt = formArt(entry.id, option.stage, sex, selection.skinId);
              const selected = selection.stageKey === option.key || (selection.stageKey === null && option.current);
              return {
                key: option.key,
                stageNo: i + 1,
                sprite: optionArt.still ?? optionArt.painted,
                pixelated: optionArt.still !== undefined,
                selected,
                locked: !option.unlocked,
                accessibilityLabel: `stage ${i + 1}, ${option.name}, ${option.unlocked ? 'owned' : `locked, ${option.requirement.toLowerCase()}`}${selected ? ', selected' : ''}`,
                testID: `stage-card-${option.key}`,
                // Re-selecting the current form clears the explicit pick so
                // the loadout keeps following future evolutions.
                onPress: () => onSelectStage(option.current ? null : option.key),
              };
            })}
          />
        </View>
      </View>
      {!entry.unlocked ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          🔒 GATES BELOW — TRAIN TO UNLOCK
        </Text>
      ) : previewingLocked ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          🔒 PREVIEWING A FUTURE FORM
        </Text>
      ) : !art.hasArt ? (
        <Text className="-mt-s2 text-center text-2xs text-text-mute" style={{ letterSpacing: 2 }}>
          FORM NOT YET FORGED — ART INCOMING
        </Text>
      ) : null}

      <View className="mt-s1 items-center">
        <RarityBadge level={level} />
      </View>

      {/* The live gates for a locked champion — the same requirement rows
          the Forge uses, fed by the same engine. */}
      {!entry.unlocked && entry.requirements.length > 0 ? (
        <View className="mt-s3">
          <EdgeLabel>UNLOCK GATES</EdgeLabel>
          <View className="mt-s2">
            {entry.requirements.map((req) => (
              <RequirementRow key={req.label} req={req} />
            ))}
          </View>
          {entry.note ? (
            <Text className="mt-s1 text-2xs text-text-mute">{entry.note}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Compact stats — the four the mock calls out, from the REAL scores. */}
      <View className="mt-s3">
        <StatBar abbr="SIZE" value={scores.size} colour={colors.epic} />
        <StatBar abbr="AES" value={scores.aesthetic} colour={colors.accent} />
        <StatBar abbr="STR" value={scores.strength} colour="#f59e0b" />
        <StatBar abbr="CND" value={scores.conditioning} colour="#34d399" />
      </View>
    </View>
  );
}

function formNameFor(
  branch: BranchV2,
  stageOption: StageOption | null,
  level: number,
  bfMid: number | null
): string {
  if (stageOption) return stageOption.name;
  if (branch === 'shredder') return shredderName(bfMid);
  return evolutionNameV2(branch, level);
}
