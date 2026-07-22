'use no memo'; // React Compiler opt-out: these components render a mutable simulation read from refs on a version counter (see battle-store docs).

/**
 * The shared arena screen composition — used by /battle (standard battles at
 * the saved AI difficulty) and /tutorial (guided battle vs the training AI).
 * Renders a snapshot of the shared battle store on every simulation frame;
 * all gameplay decisions (deploy validation, outcome, timing) live in the
 * engine/controller/store — this screen only reads state and forwards taps.
 *
 * M6 additions:
 *  - active synergy chips per team beside each core bar (aura layer display)
 *  - non-blocking augment picker when the player's offer opens
 *  - floating damage/heal numbers + death fades, derived from the battle
 *    log delta since the last processed entry (no per-unit React state; the
 *    floater list lives in a ref and is pruned/capped each frame)
 *  - tapping an unaffordable card surfaces the energy toast
 *  - tutorial overlay step sequencer (tutorial mode only)
 *
 * M8: ghost battles — when `ghostRecordId` is set, the screen loads that
 * stored battle record and starts a ghost battle against the record's player
 * side instead of an AI battle. An unusable record (missing, stale balance
 * version, corrupt) shows a clear error state and NEVER falls back to a
 * standard battle.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NeonButton } from '../../../components/ui';
import { colors, spacing, typography } from '../../../constants/theme';
import { BALANCE, CHAMPIONS, getChampionById } from '../../../content';
import { liveDigest, LiveBattle, LiveBattleOptions } from '../battle-controller';
import { battleStore, randomSeed } from '../battle-store';
import { useBattle } from '../use-battle';
import {
  ChampionFitnessScaling,
  computeFitnessScaling,
  NEUTRAL_SCALING,
} from '../../../game-engine/balance/fitness-scaling';
import { validateDeck } from '../../../game-engine/cards/deck';
import type { BattleRecord } from '../../../game-engine/simulation/replay';
import type { LaneId } from '../../../game-engine/types';
import { buildEnemyGymSquad } from '../../gyms/gym-war';
import { buildPlayerSquad } from '../../gyms/squad';
import { appStorage, playerProvider } from '../../../services/app-services';
import {
  battleRecordKey,
  loadBattleRecords,
} from '../../../services/persistence/battle-records';
import { DEFAULT_DECK_CARD_IDS } from '../../../services/persistence/save';
import { usePlayer } from '../../../services/player-data/use-player';
import { AugmentPicker } from './augment-picker';
import { CardRow } from './card-row';
import { ChampionHud } from './champion-hud';
import { CoreBar } from './core-bar';
import { FLOATER_TTL_MS, LaneFloater, LaneStrip } from './lane-strip';
import { ResultOverlay } from './result-overlay';
import { SynergyChips } from './synergy-chips';
import { TutorialOverlay } from './tutorial-overlay';

/** How long a rejected-deploy toast stays visible. */
const REJECTION_TOAST_MS = 1500;
/** Cap on concurrently displayed combat floaters (mobile-safe). */
const FLOATER_CAP = 12;

const { laneLength } = BALANCE.arena;

interface FxState {
  live: LiveBattle | null;
  logIndex: number;
  nextKey: number;
  floaters: LaneFloater[];
}

/**
 * Consumes new structured 'fx' log entries (kind|lane|x|amount|team, written
 * by the engine's combat/heal paths) into short-lived floaters. Runs inside
 * render on the existing per-frame re-render — mutating only the ref.
 */
function collectFloaters(fx: FxState, live: LiveBattle, nowMs: number): LaneFloater[] {
  if (fx.live !== live) {
    // New battle (start/rematch): drop stale floaters, skip the old log.
    fx.live = live;
    fx.logIndex = 0;
    fx.floaters = [];
  }
  const log = live.state.log;
  for (; fx.logIndex < log.length; fx.logIndex++) {
    const entry = log[fx.logIndex];
    if (entry.type !== 'fx') continue;
    const [kind, laneStr, xStr, amountStr, team] = entry.detail.split('|');
    const lane = laneStr === '1' ? 1 : 0;
    const x = Number(xStr);
    const amount = Number(amountStr);
    if (!Number.isFinite(x)) continue;
    let text: string;
    let color: string;
    if (kind === 'hit') {
      text = `-${amount}`;
      color = team === 'player' ? colors.danger : colors.warning;
    } else if (kind === 'heal') {
      text = `+${amount}`;
      color = colors.success;
    } else if (kind === 'death') {
      text = '✕';
      color = team === 'player' ? colors.player : colors.opponent;
    } else {
      continue;
    }
    fx.floaters.push({
      key: fx.nextKey++,
      lane,
      topPct: (1 - x / laneLength) * 100,
      text,
      color,
      bornAtMs: nowMs,
    });
  }
  // Prune aged floaters; cap the rest (newest win — they carry the news).
  fx.floaters = fx.floaters.filter((f) => nowMs - f.bornAtMs < FLOATER_TTL_MS);
  if (fx.floaters.length > FLOATER_CAP) {
    fx.floaters = fx.floaters.slice(fx.floaters.length - FLOATER_CAP);
  }
  return fx.floaters;
}

export function ArenaScreen({
  tutorial = false,
  ghostRecordId,
  gymWarGymId,
}: {
  tutorial?: boolean;
  /** Battle-record key to fight as a ghost battle (M8). */
  ghostRecordId?: string;
  /** Rival gym id to attack as a Gym War battle (M9). */
  gymWarGymId?: string;
}) {
  const router = useRouter();
  const status = useBattle((s) => s.status);
  const version = useBattle((s) => s.version);
  const mode = useBattle((s) => s.mode);
  const selectedCardId = useBattle((s) => s.selectedCardId);
  const lastRejection = useBattle((s) => s.lastRejection);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Augment picker visibility (dismiss/reopen until chosen). */
  const [pickerDismissed, setPickerDismissed] = useState(false);
  /** Tutorial overlay visibility (skippable at any time). */
  const [tutorialClosed, setTutorialClosed] = useState(false);
  /** Ghost/gym-war start failure — shown instead of the arena (fail safe). */
  const [setupError, setSetupError] = useState<string | null>(null);
  /** Source record of the current ghost battle, kept for Rematch. */
  const ghostRecordRef = useRef<BattleRecord | null>(null);
  /** Gym War battle options (squads + enemy identity), kept for Rematch. */
  const gymWarOptionsRef = useRef<LiveBattleOptions | null>(null);
  const fxRef = useRef<FxState>({ live: null, logIndex: 0, nextKey: 1, floaters: [] });

  const save = usePlayer((s) => s.save);
  // The player's active deck; falls back to the starter deck if the saved
  // deck is somehow invalid so a battle can always start.
  const activeDeck = save.decks.all.find((d) => d.id === save.decks.activeDeckId);
  const deckCardIds =
    activeDeck && validateDeck(activeDeck.cardIds, BALANCE).length === 0
      ? activeDeck.cardIds
      : DEFAULT_DECK_CARD_IDS;
  const deckRef = useRef(deckCardIds);
  deckRef.current = deckCardIds;

  // The player's saved champion; falls back to the roster's first champion if
  // the saved id is somehow invalid so a battle can always start.
  const championId = getChampionById(save.player.championId)?.id ?? CHAMPIONS[0].id;
  const championRef = useRef(championId);
  championRef.current = championId;

  // Tutorial battles always face the training AI; lobby battles use the
  // difficulty persisted in save settings.
  const difficulty = tutorial ? 'training' : save.settings.aiDifficulty;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  // Fitness-derived champion scaling (M7): read through the provider
  // boundary (never from save/UI state directly), computed with the same
  // capped function the dev editor previews. Held in a ref for rematches.
  const scalingRef = useRef<ChampionFitnessScaling>(NEUTRAL_SCALING);

  const battleOptions = () => ({
    playerDeckCardIds: deckRef.current,
    // The AI opponent fights with the starter deck.
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    playerChampionId: championRef.current,
    playerChampionScaling: scalingRef.current,
    aiDifficulty: difficultyRef.current,
  });

  // Start a fresh battle on mount — after fetching the fitness profile via
  // the EvoForgePlayerProvider. Leaving the screen abandons the battle
  // (reset to idle) so re-entering never shows a stale result.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const player = await playerProvider.getCurrentPlayer();
        const fitness = await playerProvider.getFitnessProfile(player.playerId);
        scalingRef.current = computeFitnessScaling(
          {
            strength: fitness.strengthRating,
            cardio: fitness.cardioRating,
            muscularity: fitness.muscularityRating,
            leanness: fitness.leannessRating,
            aesthetics: fitness.aestheticsRating,
          },
          BALANCE
        );
      } catch (e) {
        // Graceful fallback: a broken profile never blocks battling.
        console.warn('[battle] fitness profile unavailable, using neutral scaling', e);
        scalingRef.current = NEUTRAL_SCALING;
      }
      if (cancelled) return;

      if (ghostRecordId) {
        // Ghost battle: load the stored record and fight its player side.
        // Failures show an error state — never a silent standard battle.
        try {
          const records = await loadBattleRecords(appStorage);
          const record = records.find((r) => battleRecordKey(r) === ghostRecordId);
          if (cancelled) return;
          if (!record) {
            setSetupError('Recording not found — it may have rotated out of the battle log.');
            return;
          }
          ghostRecordRef.current = record;
          const result = battleStore
            .getState()
            .startGhost(record, randomSeed(), save.player.playerId, battleOptions());
          if (!result.ok) setSetupError(result.reason);
        } catch (e) {
          if (!cancelled) setSetupError(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      if (gymWarGymId) {
        // Gym War (M9): player squad (captain + selected borrowed members)
        // vs the enemy gym's auto-squad. All gym data flows through the
        // provider boundary; failures show an error state — never a silent
        // standard battle.
        try {
          const gymProfile = await playerProvider.getGymProfile(save.player.playerId);
          if (!gymProfile) {
            if (!cancelled) setSetupError('You are not a member of a gym.');
            return;
          }
          const ownMembers = await playerProvider.getGymMembers(gymProfile.gymId);
          const rivals = await playerProvider.listRivalGyms();
          const enemyGym = rivals.find((g) => g.gymId === gymWarGymId);
          if (!enemyGym) {
            if (!cancelled) setSetupError(`Unknown rival gym '${gymWarGymId}'.`);
            return;
          }
          const enemyMembers = await playerProvider.getGymMembers(gymWarGymId);
          if (cancelled) return;
          // Selected borrowed members, in selection order; stale ids skipped.
          const selected = save.gym.selectedSquad
            .map((id) => ownMembers.find((m) => m.playerId === id))
            .filter((m): m is NonNullable<typeof m> => m !== undefined)
            .slice(0, BALANCE.gym.maxBorrowed);
          const options: LiveBattleOptions = {
            ...battleOptions(),
            playerSquad: buildPlayerSquad(
              championRef.current,
              scalingRef.current,
              selected,
              BALANCE
            ),
            opponentSquad: buildEnemyGymSquad(enemyMembers, BALANCE),
            opponentPlayerId: `gym-${gymWarGymId}`,
            opponentDisplayName: enemyGym.name,
          };
          gymWarOptionsRef.current = options;
          battleStore.getState().start(randomSeed(), save.player.playerId, options, 'gym-war');
        } catch (e) {
          if (!cancelled) setSetupError(e instanceof Error ? e.message : String(e));
        }
        return;
      }

      if (battleStore.getState().status === 'idle') {
        battleStore
          .getState()
          .start(
            Date.now() >>> 0,
            save.player.playerId,
            battleOptions(),
            tutorial ? 'tutorial' : 'standard'
          );
      }
    })();
    return () => {
      cancelled = true;
      battleStore.getState().reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toast-style rejection feedback: show the latest reason, auto-clear it.
  useEffect(() => {
    if (!lastRejection) return;
    setToast(lastRejection);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      battleStore.getState().clearRejection();
    }, REJECTION_TOAST_MS);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [lastRejection]);

  if (setupError) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, styles.ghostErrorWrap]}>
        <Text style={styles.ghostErrorTitle}>
          {gymWarGymId ? 'GYM WAR UNAVAILABLE' : 'GHOST UNAVAILABLE'}
        </Text>
        <Text style={styles.ghostErrorText}>{setupError}</Text>
        <NeonButton label="Back" variant="secondary" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  // `version` is subscribed above purely to force this re-render each frame;
  // read the mutable live battle fresh so the numbers shown are current.
  const live = battleStore.getState().live;

  if (!live) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.cyan} size="large" />
      </SafeAreaView>
    );
  }

  const { state } = live;
  const remainingSeconds = Math.max(
    0,
    (BALANCE.battle.durationTicks - state.tick) / BALANCE.ticksPerSecond
  );
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  const timerLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  const energy = state.teams.player.energy;
  const energyPct = Math.max(0, Math.min(1, energy / BALANCE.energy.max));
  const lane0Units = state.units.filter((u) => u.alive && u.lane === 0);
  const lane1Units = state.units.filter((u) => u.alive && u.lane === 1);
  // The HUD drives the CAPTAIN only (M9): borrowed champions are not
  // commandable — they auto-cast engine-side.
  const playerChampion =
    state.units.find(
      (u) => u.kind === 'champion' && u.team === 'player' && u.champion?.commandable
    ) ?? null;

  const floaters = collectFloaters(fxRef.current, live, Date.now());
  const lane0Floaters = floaters.filter((f) => f.lane === 0);
  const lane1Floaters = floaters.filter((f) => f.lane === 1);

  const playerAugment = state.teams.player.augment;
  const pickerAvailable =
    status === 'running' && playerAugment.offeredIds !== null && playerAugment.chosenId === null;

  const handleDeployTap = (lane: LaneId, x: number) => {
    battleStore.getState().deploy(lane, x);
  };

  const handleSelectCard = (id: string) => {
    battleStore.getState().selectCard(id === selectedCardId ? null : id);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hudTop}>
        <Text style={styles.timer}>{timerLabel}</Text>
        {state.phase === 'sudden-death' && <Text style={styles.phaseLabel}>SUDDEN DEATH</Text>}
        {tutorial && <Text style={styles.tutorialLabel}>TUTORIAL</Text>}
        {mode === 'ghost' && <Text style={styles.ghostLabel}>GHOST BATTLE</Text>}
        {mode === 'gym-war' && <Text style={styles.gymWarLabel}>GYM WAR</Text>}
      </View>

      <CoreBar
        core={state.cores.opponent}
        label={
          mode === 'ghost'
            ? 'GHOST CORE'
            : mode === 'gym-war'
              ? `${(live.opponentDisplayName ?? 'ENEMY GYM').toUpperCase()} CORE`
              : 'OPPONENT CORE'
        }
      />
      <SynergyChips
        team="opponent"
        synergyIds={state.auras.opponent.activeSynergyIds}
        augmentId={state.teams.opponent.augment.chosenId}
      />

      <View style={styles.arena}>
        <LaneStrip lane={0} units={lane0Units} floaters={lane0Floaters} onDeployTap={handleDeployTap} />
        <LaneStrip lane={1} units={lane1Units} floaters={lane1Floaters} onDeployTap={handleDeployTap} />
      </View>

      <SynergyChips
        team="player"
        synergyIds={state.auras.player.activeSynergyIds}
        augmentId={playerAugment.chosenId}
      />
      <CoreBar core={state.cores.player} label="YOUR CORE" />

      <View style={styles.hudBottom}>
        <View style={styles.energyRow}>
          <Text style={styles.energyLabel}>
            ENERGY {energy.toFixed(1)} / {BALANCE.energy.max}
          </Text>
          <View style={styles.energyTrack}>
            <View style={[styles.energyFill, { width: `${energyPct * 100}%` }]} />
          </View>
        </View>

        <ChampionHud
          champion={playerChampion}
          tick={state.tick}
          onAbility={() => battleStore.getState().championAbility()}
          onUltimate={() => battleStore.getState().championUltimate()}
        />

        <Text style={styles.toast}>{toast ?? ' '}</Text>

        <CardRow
          cardIds={state.teams.player.cards?.hand ?? []}
          energy={energy}
          selectedCardId={selectedCardId}
          onSelect={handleSelectCard}
          onUnaffordable={() => battleStore.getState().flagRejection('Not enough Forge Energy')}
        />
      </View>

      {pickerAvailable && (
        <AugmentPicker
          offeredIds={playerAugment.offeredIds ?? []}
          open={!pickerDismissed}
          onChoose={(id) => battleStore.getState().chooseAugment(id)}
          onDismiss={() => setPickerDismissed(true)}
          onReopen={() => setPickerDismissed(false)}
        />
      )}

      {tutorial && !tutorialClosed && status !== 'finished' && (
        <TutorialOverlay commandLog={live.commandLog} onClose={() => setTutorialClosed(true)} />
      )}

      {status === 'finished' && state.outcome && (
        <ResultOverlay
          outcome={state.outcome}
          contributions={
            mode === 'gym-war'
              ? (live.config.player.squad?.borrowed ?? []).map((b, i) => ({
                  key: b.sourcePlayerId ?? `${b.championId}-${i}`,
                  label: b.displayName ?? b.championId,
                  detail: `+${
                    BALANCE.gym.contributionPerWar +
                    (state.outcome?.winner === 'player' ? BALANCE.gym.contributionWinBonus : 0)
                  } pts`,
                }))
              : undefined
          }
          contributionsTitle="SQUAD CONTRIBUTION"
          onRematch={() => {
            if (mode === 'ghost' && ghostRecordRef.current) {
              // Ghost rematch: same recording, fresh seed.
              battleStore
                .getState()
                .startGhost(
                  ghostRecordRef.current,
                  randomSeed(),
                  save.player.playerId,
                  battleOptions()
                );
              return;
            }
            if (mode === 'gym-war' && gymWarOptionsRef.current) {
              // Gym War rematch: same squads and enemy gym, fresh seed.
              battleStore
                .getState()
                .restart(randomSeed(), save.player.playerId, gymWarOptionsRef.current, 'gym-war');
              return;
            }
            battleStore
              .getState()
              .restart(
                randomSeed(),
                save.player.playerId,
                battleOptions(),
                tutorial ? 'tutorial' : 'standard'
              );
          }}
          onBackToLobby={() => router.replace('/forge-arena/lobby')}
        />
      )}

      {__DEV__ && (
        <View style={styles.devOverlay} pointerEvents="none">
          <Text style={styles.devText}>
            seed {state.seed} · tick {state.tick} · v{version} ·{' '}
            {live.opponentKind === 'ghost' ? 'ghost' : live.aiDifficulty} · rej{' '}
            {live.rejected.length} · digest {liveDigest(live)}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.sm, gap: spacing.sm },
  center: { alignItems: 'center', justifyContent: 'center' },
  hudTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  timer: { ...typography.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  phaseLabel: {
    ...typography.label,
    color: colors.danger,
    letterSpacing: 1.5,
  },
  tutorialLabel: {
    ...typography.label,
    color: colors.cyan,
    letterSpacing: 1.5,
  },
  ghostLabel: {
    ...typography.label,
    color: colors.opponent,
    letterSpacing: 1.5,
  },
  gymWarLabel: {
    ...typography.label,
    color: colors.warning,
    letterSpacing: 1.5,
  },
  ghostErrorWrap: { gap: spacing.md, padding: spacing.lg },
  ghostErrorTitle: { ...typography.heading, color: colors.danger, letterSpacing: 1.5 },
  ghostErrorText: { ...typography.body, color: colors.textDim, textAlign: 'center' },
  arena: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  hudBottom: { gap: spacing.xs },
  energyRow: { gap: spacing.xs },
  energyLabel: { ...typography.mono, color: colors.cyan },
  energyTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  energyFill: { height: '100%', backgroundColor: colors.cyan },
  toast: {
    ...typography.label,
    color: colors.warning,
    textAlign: 'center',
    minHeight: 16,
  },
  devOverlay: { position: 'absolute', left: 4, bottom: 4 },
  devText: { ...typography.mono, fontSize: 9, color: colors.textFaint },
});
