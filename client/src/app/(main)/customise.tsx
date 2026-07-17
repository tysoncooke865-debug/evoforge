import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useCharacterUnlocks, usePurchaseCharacter } from '@/data/characters';
import { useCoinTotal } from '@/data/coins';
import { usePaletteUnlocks, usePurchasePalette } from '@/data/palettes';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useSkinUnlocks, usePurchaseSkin } from '@/data/skins';
import { useAvatarData } from '@/data/use-avatar-data';
import {
  GYMERICA,
  PREMIUM_CHARACTERS,
  buildRoster,
  currentStageFor,
  equipState,
  loadoutFromSelection,
  resolveDisplay,
  selectionFromLoadout,
  skinKey,
  stageOptions,
  unlockContext,
  type DerivedIdentity,
  type Selection,
} from '@/domain/customise';
import { raritySlug } from '@/domain/avatar-stats';
import { useLoadoutStore } from '@/state/loadout-store';
import { useThemeStore } from '@/state/theme-store';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { CosmeticTabs } from '@/ui/customise/cosmetic-tabs';
import { EdgeLabel } from '@/ui/core/hud';
import { NeonButton } from '@/ui/core/neon-button';
import { gymericaStill } from '@/ui/character/gymerica-art';
import { GymericaPanel } from '@/ui/customise/gymerica-panel';
import { PreviewPanel } from '@/ui/customise/preview-panel';
import { RosterSection } from '@/ui/customise/roster';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import { SpriteCompanion } from '@/ui/character/sprite-avatar';

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
  const colors = useThemeColors();
  const { ready, branchV2, sex, summary, stats, bfMid, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const loadout = useLoadoutStore((s) => s.loadout);
  const equip = useLoadoutStore((s) => s.equip);
  const hydrated = useLoadoutStore((s) => s._hydrated);
  const pushToast = useToastStore((s) => s.push);
  const coins = useCoinTotal();
  const unlocks = useSkinUnlocks();
  const purchase = usePurchaseSkin();
  const charUnlocks = useCharacterUnlocks();
  const purchaseCharacter = usePurchaseCharacter();
  const paletteUnlocks = usePaletteUnlocks();
  const purchasePalette = usePurchasePalette();
  const ownedSkins = new Set((unlocks.data ?? []).map((u) => skinKey(u.line, u.skin)));
  const ownedCharacters = new Set((charUnlocks.data ?? []).map((u) => u.character));
  const ownedPalettes = new Set((paletteUnlocks.data ?? []).map((u) => u.palette));

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

  // LIVE PREVIEW (the palette shop): while this screen is FOCUSED, the whole
  // app wears the SELECTED palette — cycling theme cards recolours the page
  // itself, ownership not required. This screen stays mounted after its
  // first visit (href:null tab), so blur must restore the equipped
  // resolution, and unmount must too. ThemeRoot re-validates ownership on
  // every read either way.
  const focused = useIsFocused();
  const setPreview = useThemeStore((s) => s.setPreview);
  const selectedPalette = selection?.paletteId ?? null;
  useEffect(() => {
    setPreview(focused ? selectedPalette : null);
    return () => setPreview(null);
  }, [focused, selectedPalette, setPreview]);

  if (!ready || selection === null) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="SELECT YOUR CHAMPION" title="CUSTOMISE" onBack={() => router.back()} />
        <View className="items-center p-s6" style={{ minHeight: 240, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </ScreenShell>
    );
  }

  const roster = buildRoster(derived.branch, derived.scores, derived.ctx);
  const entry = roster.find((e) => e.id === selection.branch) ?? roster[0];
  const options = stageOptions(entry.id, derived.level, derived.bfMid, entry.unlocked);
  const selectedOption =
    selection.branch === entry.id && selection.stageKey !== null
      ? (options.find((o) => o.key === selection.stageKey) ?? null)
      : null;
  const currentStage = currentStageFor(entry.id, derived.level, derived.bfMid);
  const previewStage = selectedOption?.stage ?? currentStage;
  const stageCount = Math.max(options.length, 4);
  const rarityColourKey = raritySlug(derived.level);
  const rarityColour = (colors as Record<string, string>)[rarityColourKey] ?? colors.common;

  // GYMERICA MODE: a premium character is selected — his own panel replaces
  // the branch preview/stage/outfit blocks.
  const gymericaMode = selection.character != null;

  // The equipped loadout resolves to a branch (or premium char) for the
  // roster's ◈ marker.
  const equippedDisplay = resolveDisplay(derived, loadout, ownedSkins, ownedCharacters);
  const equippedRosterId = equippedDisplay.character?.id ?? equippedDisplay.branch;

  const state = equipState(derived, selection, loadout, ownedSkins, ownedCharacters, ownedPalettes);
  const balance = coins.data ?? 0;
  const isBuy = state.kind === 'buy-skin' || state.kind === 'buy-character' || state.kind === 'buy-palette';
  const buyPrice = isBuy ? state.price : 0;
  const canAfford = isBuy && balance >= buyPrice;
  const buttonTitle =
    state.kind === 'equip'
      ? 'EQUIP'
      : state.kind === 'equipped'
        ? 'EQUIPPED ✓'
        : state.kind === 'locked-character'
          ? 'LOCKED — GATES UNMET'
          : isBuy
            ? canAfford
              ? `BUY · ${buyPrice} COINS`
              : `NEED ${buyPrice} COINS`
            : `UNLOCK: ${state.requirement}`;
  const buyPending = purchase.isPending || purchaseCharacter.isPending || purchasePalette.isPending;
  const buttonBusy = isBuy && buyPending;
  const buttonEnabled = state.kind === 'equip' || (isBuy && canAfford);

  const select = (next: Partial<Selection>) => setSelection({ ...selection, ...next });

  const onPrimary = () => {
    if (state.kind === 'equip') {
      equip(loadoutFromSelection(derived.branch, selection));
      pushToast({ kind: 'info', title: 'LOADOUT EQUIPPED', subtitle: 'Your champion awaits on the home stage' });
      return;
    }
    if (buyPending || !canAfford) return;
    // Buy, then the invalidated ownership flips the button to EQUIP; the
    // selection is untouched so the preview stays on what was bought.
    if (state.kind === 'buy-skin') purchase.mutate({ line: state.line, skin: state.skin });
    else if (state.kind === 'buy-character') purchaseCharacter.mutate({ character: state.character });
    else if (state.kind === 'buy-palette') purchasePalette.mutate({ palette: state.palette });
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
        premium={PREMIUM_CHARACTERS.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          owned: ownedCharacters.has(c.id),
          price: c.price,
          still: gymericaStill(1, 'standard'),
        }))}
        selectedId={gymericaMode ? (selection.character as string) : selection.branch}
        equippedId={equippedRosterId}
        level={derived.level}
        bfMid={derived.bfMid}
        sex={sex}
        skin={selection.skinId}
        onSelect={(id) =>
          select({
            branch: id,
            character: null,
            // A different champion's ladder — any explicit stage pick made
            // for the old one no longer applies.
            stageKey: null,
          })
        }
        onSelectPremium={(id) => select({ character: id as typeof selection.character })}
      />

      {gymericaMode ? (
        <GymericaPanel
          character={GYMERICA}
          selection={selection}
          owned={ownedCharacters.has(GYMERICA.id)}
          auraColour={rarityColour}
          onChange={select}
        />
      ) : (
        <>
          <PreviewPanel
            entry={entry}
            selection={selection}
            stageOption={selectedOption}
            stageOptions={options}
            onSelectStage={(key) => select({ stageKey: key })}
            currentStage={currentStage}
            stageCount={stageCount}
            level={derived.level}
            bfMid={derived.bfMid}
            sex={sex}
            scores={derived.scores}
            rarityColour={rarityColour}
          />

          <View>
            <EdgeLabel>CUSTOMISATION</EdgeLabel>
            <View className="mt-s2">
              <CosmeticTabs
                selection={selection}
                branch={entry.id}
                stage={previewStage}
                sex={sex}
                unlockCtx={unlockContext(derived, ownedSkins, ownedPalettes)}
                onChange={select}
              />
            </View>
          </View>
        </>
      )}

      <NeonButton
        title={buttonTitle}
        onPress={onPrimary}
        disabled={!buttonEnabled}
        busy={buttonBusy}
        pixel
        size="hero"
        testID="equip-loadout"
      />
    </ScreenShell>
  );
}

/** Compact header module: coin wallet + Forge Level + the companion. */
function ForgeLevelModule() {
  const colors = useThemeColors();
  const forge = useForgeProgression();
  const coins = useCoinTotal();
  const progress = forgeProgressFromRow(forge.data ?? null);
  const pct = progress.xpForNextLevel > 0 ? Math.min(1, progress.xpIntoLevel / progress.xpForNextLevel) : 0;
  return (
    <View className="flex-row items-center" style={{ gap: 8 }}>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        {/* The wallet — the shop's currency, read straight from coin_total. */}
        <View className="flex-row items-center" style={{ gap: 3 }} testID="customise-coins">
          <CoinIcon size={12} />
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.legendary, ...pixelFont() }}>
            {coins.data ?? '—'}
          </Text>
        </View>
        <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.accent, ...pixelFont() }}>
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
              backgroundColor: colors.accent,
              shadowColor: colors.accent,
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
