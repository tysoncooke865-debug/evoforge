import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useAvatarData } from '@/data/use-avatar-data';
import {
  buildRoster,
  currentStageFor,
  equipState,
  loadoutFromSelection,
  resolveDisplay,
  selectionFromLoadout,
  stageOptions,
  unlockContext,
  type DerivedIdentity,
  type Selection,
} from '@/domain/customise';
import { raritySlug } from '@/domain/avatar-stats';
import { useLoadoutStore } from '@/state/loadout-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { CosmeticTabs } from '@/ui/customise/cosmetic-tabs';
import { EdgeLabel } from '@/ui/core/hud';
import { NeonButton } from '@/ui/core/neon-button';
import { PreviewPanel } from '@/ui/customise/preview-panel';
import { RosterSection } from '@/ui/customise/roster';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import { SpriteCompanion } from '@/ui/character/sprite-avatar';
import { StageCarousel } from '@/ui/customise/stage-carousel';

/**
 * CUSTOMISE (Tyson, 2026-07-16) — the full-screen champion select, pushed
 * over Home like the workout page (tab bar stays; Home keeps its scroll).
 * Roster locks are the LIVE branch gates, stage locks the live ladders,
 * cosmetic gates the real Forge Level; skins are the palette-swap packs.
 *
 * PREVIEW ≠ EQUIPPED: everything on this screen edits a local Selection.
 * Only EQUIP writes the persisted loadout — and display resolution
 * re-validates that loadout against live state on every read.
 */
export default function CustomiseScreen() {
  const { ready, branchV2, sex, summary, stats, bfMid, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const loadout = useLoadoutStore((s) => s.loadout);
  const equip = useLoadoutStore((s) => s.equip);
  const hydrated = useLoadoutStore((s) => s._hydrated);
  const pushToast = useToastStore((s) => s.push);

  const derived: DerivedIdentity = {
    branch: branchV2,
    level: summary.level,
    bfMid,
    scores: {
      strength: stats.strengthScore,
      size: stats.sizeScore,
      leanness: stats.leannessScore,
      conditioning: stats.conditioningScore,
      aesthetic: stats.aestheticScore,
    },
    ctx: { nutritionPhase, earliestBf },
    forgeLevel: forgeProgressFromRow(forge.data ?? null).level,
  };

  // The screen-local SELECTION, seeded from the equipped loadout once both
  // the data and the persisted store have arrived.
  const [selection, setSelection] = useState<Selection | null>(null);
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !ready || !hydrated) return;
    seededRef.current = true;
    setSelection(selectionFromLoadout(branchV2, loadout));
  }, [ready, hydrated, branchV2, loadout]);

  if (!ready || selection === null) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="SELECT YOUR CHAMPION" title="CUSTOMISE" onBack={() => router.back()} />
        <View className="items-center p-s6" style={{ minHeight: 240, justifyContent: 'center' }}>
          <ActivityIndicator color={tokens.colors.accent} />
        </View>
      </ScreenShell>
    );
  }

  const roster = buildRoster(derived.branch, derived.scores, derived.ctx);
  const entry = roster.find((e) => e.id === selection.branch) ?? roster[0];
  const options = stageOptions(entry.id, derived.level, derived.bfMid);
  const selectedOption =
    selection.branch === entry.id && selection.stageKey !== null
      ? (options.find((o) => o.key === selection.stageKey) ?? null)
      : null;
  const currentStage = currentStageFor(entry.id, derived.level, derived.bfMid);
  const previewStage = selectedOption?.stage ?? currentStage;
  const stageCount = Math.max(options.length, 4);
  const rarityColourKey = raritySlug(derived.level);
  const rarityColour = (tokens.colors as Record<string, string>)[rarityColourKey] ?? tokens.colors.common;

  // The equipped loadout resolves to a branch for the roster's ◈ marker.
  const equippedDisplay = resolveDisplay(derived, loadout);

  const state = equipState(derived, selection, loadout);
  const buttonTitle =
    state.kind === 'equip'
      ? 'EQUIP'
      : state.kind === 'equipped'
        ? 'EQUIPPED ✓'
        : state.kind === 'locked-character'
          ? 'LOCKED — GATES UNMET'
          : `UNLOCK: ${state.requirement}`;

  const select = (next: Partial<Selection>) => setSelection({ ...selection, ...next });

  const onEquip = () => {
    if (state.kind !== 'equip') return;
    equip(loadoutFromSelection(derived.branch, selection));
    pushToast({ kind: 'info', title: 'LOADOUT EQUIPPED', subtitle: 'Your champion awaits on the home stage' });
  };

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="SELECT YOUR CHAMPION"
        title="CUSTOMISE"
        onBack={() => router.back()}
        right={<ForgeLevelModule />}
      />

      <RosterSection
        entries={roster}
        selectedId={selection.branch}
        equippedId={equippedDisplay.branch}
        level={derived.level}
        bfMid={derived.bfMid}
        sex={sex}
        skin={selection.skinId}
        onSelect={(id) =>
          select({
            branch: id,
            // A different champion's ladder — any explicit stage pick made
            // for the old one no longer applies.
            stageKey: null,
          })
        }
      />

      <PreviewPanel
        entry={entry}
        selection={selection}
        stageOption={selectedOption}
        currentStage={currentStage}
        stageCount={stageCount}
        level={derived.level}
        bfMid={derived.bfMid}
        sex={sex}
        scores={derived.scores}
        rarityColour={rarityColour}
      />

      <StageCarousel
        branch={entry.id}
        options={options}
        selectedKey={selection.stageKey}
        sex={sex}
        skin={selection.skinId}
        onSelect={(key) => select({ stageKey: key })}
      />

      <View>
        <EdgeLabel>CUSTOMISATION</EdgeLabel>
        <View className="mt-s2">
          <CosmeticTabs
            selection={selection}
            branch={entry.id}
            stage={previewStage}
            sex={sex}
            unlockCtx={unlockContext(derived)}
            onChange={select}
          />
        </View>
      </View>

      <NeonButton
        title={buttonTitle}
        onPress={onEquip}
        disabled={state.kind !== 'equip'}
        pixel
        size="hero"
        testID="equip-loadout"
      />
    </ScreenShell>
  );
}

/** Compact header module: Forge Level + XP progress + the companion. */
function ForgeLevelModule() {
  const forge = useForgeProgression();
  const progress = forgeProgressFromRow(forge.data ?? null);
  const pct = progress.xpForNextLevel > 0 ? Math.min(1, progress.xpIntoLevel / progress.xpForNextLevel) : 0;
  return (
    <View className="flex-row items-center" style={{ gap: 8 }}>
      <View style={{ alignItems: 'flex-end' }}>
        <Text allowFontScaling={false} style={{ fontSize: 12, color: tokens.colors.accent, ...pixelFont() }}>
          LV.{progress.level}
        </Text>
        <View
          style={{ marginTop: 3, width: 56, height: 4, borderRadius: 2, backgroundColor: 'rgba(120,170,220,0.15)' }}
          accessibilityLabel={`${progress.xpIntoLevel} of ${progress.xpForNextLevel} XP to the next level`}
        >
          <View
            style={{
              width: `${Math.round(pct * 100)}%`,
              height: 4,
              borderRadius: 2,
              backgroundColor: tokens.colors.accent,
              shadowColor: tokens.colors.accent,
              shadowOpacity: 0.6,
              shadowRadius: 6,
            }}
          />
        </View>
      </View>
      <SpriteCompanion anim="idle" height={30} />
    </View>
  );
}
