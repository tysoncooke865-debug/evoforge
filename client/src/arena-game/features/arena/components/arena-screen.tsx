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
 *
 * P6 — combat feel: hit-flash, death dissolve, ability/ultimate telegraphs,
 * spawn/summon poofs and core hit shake/flash are ALL derived the same way
 * as the M6 floaters above — a pure scan of the battle log delta (plus,
 * for telegraphs, current unit positions; for core hits, the previous
 * frame's core health) in combat-fx.ts, timestamped/aged/capped here in the
 * fx ref, exactly like collectFloaters always did. No Animated values, no
 * per-unit React state, no engine edits — see PROGRESS.md "P6 — combat feel".
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
import { ratingDeltaForOutcome } from '../../../services/progression/rank';
import { DEFAULT_DECK_CARD_IDS } from '../../../services/persistence/save';
import { usePlayer } from '../../../services/player-data/use-player';
import { AugmentPicker } from './augment-picker';
import { BattleIntro, INTRO_TOTAL_MS } from './battle-intro';
import { CardRow } from './card-row';
import { ChampionHud } from './champion-hud';
import { buildUnitLookup, deriveCombatSignals, deriveCoreHitIntensity } from './combat-fx';
import {
  detectFiredAttacks,
  deriveProjectiles,
  type ImpactTier,
  PROJECTILE_TTL_MS,
  shakeOffset,
  STRIKE_MS,
  TIER_FX,
  tierForDamage,
} from './impact';
import { CoreBar, CoreHitFlash, CORE_HIT_TTL_MS } from './core-bar';
import {
  FLOATER_TTL_MS,
  HIT_FLASH_TTL_MS,
  LaneFloater,
  LaneHitPing,
  LaneProjectile,
  LaneSpawnPoof,
  LaneStrip,
  LaneTelegraph,
  SPAWN_POOF_TTL_MS,
  TELEGRAPH_TTL_MS,
} from './lane-strip';
import { computeFloaterStagger, computeLaneMomentum } from './readability';
import { ResultOverlay } from './result-overlay';
import { SynergyChips } from './synergy-chips';
import { TutorialOverlay } from './tutorial-overlay';
import { useReducedMotionPref } from './use-reduced-motion';

/** How long a rejected-deploy toast stays visible. */
const REJECTION_TOAST_MS = 1500;
/** Cap on concurrently displayed combat floaters (mobile-safe). */
const FLOATER_CAP = 12;
/** Caps for the newer P6 effect categories — same "mobile-safe, newest win"
 *  rule as FLOATER_CAP. Telegraphs/spawns are rare (ability cooldowns are
 *  10s+; deploys are player-paced) so these caps are generous headroom, not
 *  a normal-play limit. */
const HIT_PING_CAP = 12;
const TELEGRAPH_CAP = 4;
const SPAWN_POOF_CAP = 8;
/** P4 caps/timings for the combat-feel additions. */
const PROJECTILE_CAP = 10;
/** How long the core-destruction climax holds before the result overlay
 *  lands (Phase 4/9): long enough to register the moment, short enough to
 *  never feel like a hang. */
const CLIMAX_MS = 1100;
/** Ultimate cast: full-screen tint fade + slow-motion emphasis. */
const ULTIMATE_FLASH_MS = 420;
const ULTIMATE_SLOWMO_SCALE = 0.35;
const ULTIMATE_SLOWMO_MS = 380;
/** Escalation rank so a weaker shake never replaces an active stronger one. */
const SHAKE_RANK: Record<ImpactTier, number> = { light: 0, medium: 1, heavy: 2, ultimate: 3, core: 4 };

/** Ceiling on any single pre-battle provider fetch — a hung request on a
 *  flaky connection must degrade (neutral scaling / setup error), never
 *  hold the battle loading spinner forever. */
const NETWORK_TIMEOUT_MS = 6000;

function withNetworkTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} request timed out — check your connection`)),
      NETWORK_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const { laneLength } = BALANCE.arena;
// P7: one divider per whole energy point on the energy bar (e.g. 9 dividers
// for a max of 10) — a cheap "pip" affordance so a player can eyeball how
// many more whole-energy card costs the current fill covers, without doing
// the (energy / max) division in their head. Pure layout, no new state.
const ENERGY_PIP_COUNT = Math.max(0, Math.floor(BALANCE.energy.max) - 1);
const ENERGY_PIPS = Array.from({ length: ENERGY_PIP_COUNT }, (_, i) => i + 1);

interface FxState {
  live: LiveBattle | null;
  logIndex: number;
  nextKey: number;
  floaters: LaneFloater[];
  hitPings: LaneHitPing[];
  telegraphs: LaneTelegraph[];
  spawnPoofs: LaneSpawnPoof[];
  /** Previous frame's core health, for deriveCoreHitIntensity's before/after
   *  comparison — core objects mutate in place and carry no history. */
  prevCoreHealth: { player: number; opponent: number } | null;
  /** Most recent core-hit event per team, aged into CoreHitFlash below. */
  coreHitBornAt: { player: number | null; opponent: number | null; playerSevere: boolean; opponentSevere: boolean };
  // --- P4 combat feel ---
  /** Ranged shots in flight. */
  projectiles: LaneProjectile[];
  /** unit id → attack cooldown last frame, for fired-attack detection. */
  prevAttackCooldowns: Map<number, number>;
  /** unit id → strike start (ms), driving the attack lunge. */
  strikes: Map<number, number>;
  /** Active screen shake (strongest recent impact wins). */
  screenShake: { bornAtMs: number; tier: ImpactTier } | null;
  /** Full-screen tint from an ultimate cast, in the caster's path color. */
  ultimateFlash: { bornAtMs: number; color: string } | null;
}

function topPctOf(x: number): number {
  return (1 - x / laneLength) * 100;
}

/**
 * Consumes the battle log delta since the last frame (via combat-fx.ts's
 * pure deriveCombatSignals) into every P6 combat-feel effect: floaters (as
 * before), hit pings, ability/ultimate telegraphs and spawn/summon poofs.
 * Runs inside render on the existing per-frame re-render — mutating only
 * the ref, same as the M6-era collectFloaters this replaces.
 */
function collectCombatFx(
  fx: FxState,
  live: LiveBattle,
  nowMs: number
): {
  floaters: LaneFloater[];
  hitPings: LaneHitPing[];
  telegraphs: LaneTelegraph[];
  spawnPoofs: LaneSpawnPoof[];
} {
  if (fx.live !== live) {
    // New battle (start/rematch): drop stale effects, skip the old log.
    fx.live = live;
    fx.logIndex = 0;
    fx.floaters = [];
    fx.hitPings = [];
    fx.telegraphs = [];
    fx.spawnPoofs = [];
    fx.prevCoreHealth = null;
    fx.coreHitBornAt = { player: null, opponent: null, playerSevere: false, opponentSevere: false };
    fx.projectiles = [];
    fx.prevAttackCooldowns = new Map();
    fx.strikes = new Map();
    fx.screenShake = null;
    fx.ultimateFlash = null;
  }

  /** Strongest-wins screen shake: a light rumble never cuts a big one short. */
  const requestShake = (tier: ImpactTier) => {
    const active =
      fx.screenShake && nowMs - fx.screenShake.bornAtMs < TIER_FX[fx.screenShake.tier].shakeMs
        ? fx.screenShake
        : null;
    if (active && SHAKE_RANK[active.tier] > SHAKE_RANK[tier]) return;
    fx.screenShake = { bornAtMs: nowMs, tier };
  };

  const units = buildUnitLookup(live.state.units);
  const { floaters, hits, telegraphs, spawns, nextIndex } = deriveCombatSignals(
    live.state.log,
    fx.logIndex,
    units
  );
  fx.logIndex = nextIndex;

  for (const sig of floaters) {
    const topPct = topPctOf(sig.x);
    // P7: stagger against floaters already active in the SAME lane (age is
    // irrelevant here — every entry in fx.floaters that survived to this
    // point is still within FLOATER_TTL_MS, including ones pushed earlier
    // in this very loop, so simultaneous multi-hit ticks fan out too).
    const staggerPx = computeFloaterStagger(
      fx.floaters.filter((f) => f.lane === sig.lane).map((f) => f.topPct),
      topPct
    );
    // P4 impact tiers: damage numbers scale with the hit's weight; heals sit
    // at the light size, deaths keep their own glyph treatment.
    const tierFx = sig.kind === 'hit' ? TIER_FX[tierForDamage(sig.amount)] : TIER_FX.light;
    fx.floaters.push({
      key: fx.nextKey++,
      lane: sig.lane,
      topPct,
      kind: sig.kind,
      text: sig.text,
      color: sig.color,
      bornAtMs: nowMs,
      staggerPx,
      fontSize: tierFx.floaterFontSize,
      fontWeight: tierFx.floaterWeight,
    });
  }
  fx.floaters = fx.floaters.filter((f) => nowMs - f.bornAtMs < FLOATER_TTL_MS);
  if (fx.floaters.length > FLOATER_CAP) {
    fx.floaters = fx.floaters.slice(fx.floaters.length - FLOATER_CAP);
  }

  for (const hit of hits) {
    fx.hitPings.push({
      lane: hit.lane,
      x: hit.x,
      team: hit.team,
      bornAtMs: nowMs,
      targetId: hit.targetId,
      amount: hit.amount,
      shielded: hit.shielded,
    });
    // Heavy hits are the first rung of the escalation ladder that reaches
    // beyond the struck unit: a screen bump + a blink of hit-stop.
    if (tierForDamage(hit.amount) === 'heavy') {
      requestShake('heavy');
      battleStore.getState().applyTimeDilation(0, TIER_FX.heavy.hitStopMs);
    }
  }
  fx.hitPings = fx.hitPings.filter((h) => nowMs - h.bornAtMs < HIT_FLASH_TTL_MS);
  if (fx.hitPings.length > HIT_PING_CAP) {
    fx.hitPings = fx.hitPings.slice(fx.hitPings.length - HIT_PING_CAP);
  }

  for (const sig of telegraphs) {
    fx.telegraphs.push({
      key: fx.nextKey++,
      lane: sig.lane,
      topPct: topPctOf(sig.x),
      tier: sig.tier,
      label: sig.label,
      color: sig.color,
      bornAtMs: nowMs,
      path: sig.path,
    });
    // Ultimates get the full presentation beat: path-colored screen tint,
    // the strongest pre-core shake, and a short slow-motion emphasis.
    if (sig.tier === 'ultimate') {
      fx.ultimateFlash = { bornAtMs: nowMs, color: sig.color };
      requestShake('ultimate');
      battleStore.getState().applyTimeDilation(ULTIMATE_SLOWMO_SCALE, ULTIMATE_SLOWMO_MS);
    } else if (sig.path === 'titan') {
      // P5: Titan is the ground-shaker — even its signature ability bumps
      // the camera (Quake Stomp). No other path shakes on a mere ability;
      // Mass Monster stays deliberately shake-free (oppressive, not
      // explosive).
      requestShake('heavy');
    }
  }
  fx.telegraphs = fx.telegraphs.filter((t) => nowMs - t.bornAtMs < TELEGRAPH_TTL_MS[t.tier]);
  if (fx.telegraphs.length > TELEGRAPH_CAP) {
    fx.telegraphs = fx.telegraphs.slice(fx.telegraphs.length - TELEGRAPH_CAP);
  }

  for (const sig of spawns) {
    fx.spawnPoofs.push({
      key: fx.nextKey++,
      lane: sig.lane,
      topPct: topPctOf(sig.x),
      team: sig.team,
      bornAtMs: nowMs,
    });
  }
  fx.spawnPoofs = fx.spawnPoofs.filter((p) => nowMs - p.bornAtMs < SPAWN_POOF_TTL_MS);
  if (fx.spawnPoofs.length > SPAWN_POOF_CAP) {
    fx.spawnPoofs = fx.spawnPoofs.slice(fx.spawnPoofs.length - SPAWN_POOF_CAP);
  }

  // Core hit flash/shake: compare this frame's core health against the last
  // frame's (cores mutate in place — see combat.ts's damageCore — so there
  // is no log entry to scan; a before/after snapshot is the only signal).
  const playerHealth = live.state.cores.player.health;
  const opponentHealth = live.state.cores.opponent.health;
  const prev = fx.prevCoreHealth ?? { player: playerHealth, opponent: opponentHealth };
  const playerIntensity = deriveCoreHitIntensity(
    prev.player,
    playerHealth,
    live.state.cores.player.maxHealth
  );
  const opponentIntensity = deriveCoreHitIntensity(
    prev.opponent,
    opponentHealth,
    live.state.cores.opponent.maxHealth
  );
  if (playerIntensity !== 'none') {
    fx.coreHitBornAt.player = nowMs;
    fx.coreHitBornAt.playerSevere = playerIntensity === 'severe';
  }
  if (opponentIntensity !== 'none') {
    fx.coreHitBornAt.opponent = nowMs;
    fx.coreHitBornAt.opponentSevere = opponentIntensity === 'severe';
  }
  // Core hits reach the whole screen: a bump normally, the top-rung shake +
  // hit-stop when a core on the brink takes another hit.
  if (playerIntensity === 'severe' || opponentIntensity === 'severe') {
    requestShake('core');
    battleStore.getState().applyTimeDilation(0, TIER_FX.core.hitStopMs);
  } else if (playerIntensity !== 'none' || opponentIntensity !== 'none') {
    requestShake('heavy');
  }
  fx.prevCoreHealth = { player: playerHealth, opponent: opponentHealth };

  // --- P4: fired-attack detection → strike lunges + ranged projectiles ---
  const fired = detectFiredAttacks(live.state.units, fx.prevAttackCooldowns);
  const unitById = new Map(live.state.units.map((u) => [u.id, u]));
  for (const id of fired) fx.strikes.set(id, nowMs);
  for (const [id, born] of fx.strikes) {
    if (nowMs - born >= STRIKE_MS || !unitById.has(id)) fx.strikes.delete(id);
  }
  for (const shot of deriveProjectiles(fired, unitById)) {
    fx.projectiles.push({
      key: fx.nextKey++,
      lane: shot.lane,
      fromTopPct: topPctOf(shot.fromX),
      toTopPct: topPctOf(shot.toX),
      team: shot.team,
      bornAtMs: nowMs,
    });
  }
  fx.projectiles = fx.projectiles.filter((p) => nowMs - p.bornAtMs < PROJECTILE_TTL_MS);
  if (fx.projectiles.length > PROJECTILE_CAP) {
    fx.projectiles = fx.projectiles.slice(fx.projectiles.length - PROJECTILE_CAP);
  }
  fx.prevAttackCooldowns = new Map(
    live.state.units.filter((u) => u.alive).map((u) => [u.id, u.attackCooldownTicks])
  );

  return { floaters: fx.floaters, hitPings: fx.hitPings, telegraphs: fx.telegraphs, spawnPoofs: fx.spawnPoofs };
}

/** Turns a recorded core-hit timestamp into the age-fraction CoreBar renders
 *  from (see core-bar.tsx's CoreHitFlash) — undefined once fully faded, so
 *  CoreBar does no work for a core that was never hit this battle. */
function coreHitFlashFor(bornAtMs: number | null, severe: boolean, nowMs: number): CoreHitFlash | undefined {
  if (bornAtMs === null) return undefined;
  const ageFrac = (nowMs - bornAtMs) / CORE_HIT_TTL_MS;
  if (ageFrac >= 1) return undefined;
  return { ageFrac: Math.max(0, ageFrac), severe };
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
  /** Suppresses the units' walk-bob (Phase 3) — see use-reduced-motion.ts. */
  const reduceMotion = useReducedMotionPref();

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
  const fxRef = useRef<FxState>({
    live: null,
    logIndex: 0,
    nextKey: 1,
    floaters: [],
    hitPings: [],
    telegraphs: [],
    spawnPoofs: [],
    prevCoreHealth: null,
    coreHitBornAt: { player: null, opponent: null, playerSevere: false, opponentSevere: false },
    projectiles: [],
    prevAttackCooldowns: new Map(),
    strikes: new Map(),
    screenShake: null,
    ultimateFlash: null,
  });
  // P9 — battle intro: every non-tutorial battle opens with the champions
  // facing off over a 3-2-1-FIGHT countdown while the sim is frozen via the
  // store's intro hold. The frozen sim produces no version bumps, so a
  // bounded local interval drives the intro frames (same pattern as the
  // climax below). Keyed on the live object so a Rematch replays it.
  const liveForIntro = useBattle((s) => s.live);
  const introRef = useRef<{ startedAt: number; active: boolean }>({ startedAt: 0, active: false });
  const [, setIntroFrame] = useState(0);
  useEffect(() => {
    if (!liveForIntro || tutorial) return;
    introRef.current = { startedAt: Date.now(), active: true };
    battleStore.getState().holdForIntro(INTRO_TOTAL_MS);
    const interval = setInterval(() => {
      if (Date.now() - introRef.current.startedAt >= INTRO_TOTAL_MS) {
        introRef.current.active = false;
        clearInterval(interval);
      }
      setIntroFrame((f) => f + 1); // the final bump un-renders the overlay
    }, 50);
    return () => clearInterval(interval);
  }, [liveForIntro, tutorial]);

  // P4/P9 — core-destruction climax: when the battle finishes, hold the
  // result overlay back for CLIMAX_MS while a final shake + flash lands. The
  // battle loop stops on finish (no more version bumps), so a short local
  // interval drives the climax frames, then reveals the overlay and stops.
  const [resultRevealed, setResultRevealed] = useState(false);
  const [, setClimaxFrame] = useState(0);
  useEffect(() => {
    if (status !== 'finished') {
      setResultRevealed(false);
      return;
    }
    // Seed the climax presentation: top-rung shake + a screen tint in the
    // winner's color (cyan victory wash / red defeat wash).
    const winner = battleStore.getState().live?.state.outcome?.winner;
    fxRef.current.screenShake = { bornAtMs: Date.now(), tier: 'core' };
    fxRef.current.ultimateFlash = {
      bornAtMs: Date.now(),
      color: winner === 'player' ? colors.player : winner === 'opponent' ? colors.opponent : colors.warning,
    };
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= CLIMAX_MS) {
        clearInterval(interval);
        setResultRevealed(true);
      } else {
        setClimaxFrame((f) => f + 1);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [status]);

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
        // A hung network request must NEVER hold the battle spinner (the
        // one in-arena path that could present as "stuck on a loading
        // screen" on a flaky mobile connection — supabase fetches carry no
        // timeout of their own). Timing out falls into the neutral-scaling
        // catch below and the battle starts anyway.
        const player = await withNetworkTimeout(
          playerProvider.getCurrentPlayer(),
          'current player'
        );
        const fitness = await withNetworkTimeout(
          playerProvider.getFitnessProfile(player.playerId),
          'fitness profile'
        );
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
          // Same hung-request protection as the profile fetch: gym reads
          // time out into the visible setup-error state, never a forever
          // spinner.
          const gymProfile = await withNetworkTimeout(
            playerProvider.getGymProfile(save.player.playerId),
            'gym profile'
          );
          if (!gymProfile) {
            if (!cancelled) setSetupError('You are not a member of a gym.');
            return;
          }
          const ownMembers = await withNetworkTimeout(
            playerProvider.getGymMembers(gymProfile.gymId),
            'gym members'
          );
          const rivals = await withNetworkTimeout(playerProvider.listRivalGyms(), 'rival gyms');
          const enemyGym = rivals.find((g) => g.gymId === gymWarGymId);
          if (!enemyGym) {
            if (!cancelled) setSetupError(`Unknown rival gym '${gymWarGymId}'.`);
            return;
          }
          const enemyMembers = await withNetworkTimeout(
            playerProvider.getGymMembers(gymWarGymId),
            'rival gym members'
          );
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
  // P7: which team currently has more living presence pushing each lane, and
  // toward which core — see readability.ts's computeLaneMomentum.
  const lane0Momentum = computeLaneMomentum(lane0Units);
  const lane1Momentum = computeLaneMomentum(lane1Units);
  // The HUD drives the CAPTAIN only (M9): borrowed champions are not
  // commandable — they auto-cast engine-side.
  const playerChampion =
    state.units.find(
      (u) => u.kind === 'champion' && u.team === 'player' && u.champion?.commandable
    ) ?? null;

  const nowMs = Date.now();
  const { floaters, hitPings, telegraphs, spawnPoofs } = collectCombatFx(fxRef.current, live, nowMs);
  const lane0Floaters = floaters.filter((f) => f.lane === 0);
  const lane1Floaters = floaters.filter((f) => f.lane === 1);
  const lane0HitPings = hitPings.filter((h) => h.lane === 0);
  const lane1HitPings = hitPings.filter((h) => h.lane === 1);
  const lane0Telegraphs = telegraphs.filter((t) => t.lane === 0);
  const lane1Telegraphs = telegraphs.filter((t) => t.lane === 1);
  const lane0SpawnPoofs = spawnPoofs.filter((p) => p.lane === 0);
  const lane1SpawnPoofs = spawnPoofs.filter((p) => p.lane === 1);
  const lane0Projectiles = fxRef.current.projectiles.filter((p) => p.lane === 0);
  const lane1Projectiles = fxRef.current.projectiles.filter((p) => p.lane === 1);
  // P4: screen shake (strongest recent impact; suppressed under reduced
  // motion) and the ultimate/climax full-screen tint, both aged per frame.
  const shake =
    fxRef.current.screenShake && !reduceMotion
      ? shakeOffset(nowMs - fxRef.current.screenShake.bornAtMs, fxRef.current.screenShake.tier)
      : { dx: 0, dy: 0 };
  const flashAge = fxRef.current.ultimateFlash ? nowMs - fxRef.current.ultimateFlash.bornAtMs : Infinity;
  const flashWindowMs = status === 'finished' ? CLIMAX_MS : ULTIMATE_FLASH_MS;
  const ultimateFlashOpacity =
    flashAge < flashWindowMs ? (1 - flashAge / flashWindowMs) * 0.16 : 0;
  // Phase 6: a steady crimson edge marks a core on the brink (≤25%, the
  // severe threshold) on that core's side of the arena — static by design
  // (no ambient pulse), the hit shake supplies the motion.
  const playerCoreDanger =
    state.cores.player.health > 0 &&
    state.cores.player.health / state.cores.player.maxHealth <= 0.25;
  const opponentCoreDanger =
    state.cores.opponent.health > 0 &&
    state.cores.opponent.health / state.cores.opponent.maxHealth <= 0.25;
  const playerCoreHit = coreHitFlashFor(
    fxRef.current.coreHitBornAt.player,
    fxRef.current.coreHitBornAt.playerSevere,
    nowMs
  );
  const opponentCoreHit = coreHitFlashFor(
    fxRef.current.coreHitBornAt.opponent,
    fxRef.current.coreHitBornAt.opponentSevere,
    nowMs
  );

  const playerAugment = state.teams.player.augment;
  const pickerAvailable =
    status === 'running' && playerAugment.offeredIds !== null && playerAugment.chosenId === null;

  const handleDeployTap = (lane: LaneId, x: number) => {
    battleStore.getState().deploy(lane, x);
  };

  const handleSelectCard = (id: string) => {
    battleStore.getState().selectCard(id === selectedCardId ? null : id);
  };

  // P9 intro overlay state (elapsed drives the countdown component).
  const introElapsed = introRef.current.active ? nowMs - introRef.current.startedAt : Infinity;
  const introVisible = !tutorial && introElapsed < INTRO_TOTAL_MS;
  const opponentIntroLabel =
    mode === 'ghost'
      ? `Ghost battle — ${live.opponentDisplayName ?? 'your past self'}`
      : mode === 'gym-war'
        ? `Gym War — ${live.opponentDisplayName ?? 'enemy gym'}`
        : `${live.opponentDisplayName ?? `${live.aiDifficulty} AI`}`;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hudTop}>
        <Text
          style={[
            styles.timer,
            // P9 tension: the clock itself escalates — amber inside the
            // final 30 seconds, danger red in sudden death.
            remainingSeconds <= 30 && state.phase !== 'sudden-death' && styles.timerLow,
            state.phase === 'sudden-death' && styles.timerSudden,
          ]}
        >
          {timerLabel}
        </Text>
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
        hit={opponentCoreHit}
      />
      <SynergyChips
        team="opponent"
        synergyIds={state.auras.opponent.activeSynergyIds}
        augmentId={state.teams.opponent.augment.chosenId}
      />

      <View
        style={[
          styles.arena,
          shake.dx !== 0 || shake.dy !== 0
            ? { transform: [{ translateX: shake.dx }, { translateY: shake.dy }] }
            : null,
        ]}
      >
        <LaneStrip
          lane={0}
          units={lane0Units}
          floaters={lane0Floaters}
          hitPings={lane0HitPings}
          telegraphs={lane0Telegraphs}
          spawnPoofs={lane0SpawnPoofs}
          projectiles={lane0Projectiles}
          strikes={fxRef.current.strikes}
          tick={state.tick}
          momentum={lane0Momentum}
          deployHighlight={selectedCardId !== null}
          reduceMotion={reduceMotion}
          onDeployTap={handleDeployTap}
        />
        <LaneStrip
          lane={1}
          units={lane1Units}
          floaters={lane1Floaters}
          hitPings={lane1HitPings}
          telegraphs={lane1Telegraphs}
          spawnPoofs={lane1SpawnPoofs}
          projectiles={lane1Projectiles}
          strikes={fxRef.current.strikes}
          tick={state.tick}
          momentum={lane1Momentum}
          deployHighlight={selectedCardId !== null}
          reduceMotion={reduceMotion}
          onDeployTap={handleDeployTap}
        />
        {ultimateFlashOpacity > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.screenFlash,
              { backgroundColor: fxRef.current.ultimateFlash!.color, opacity: ultimateFlashOpacity },
            ]}
          />
        )}
        {opponentCoreDanger && (
          <View pointerEvents="none" style={[styles.coreDangerEdge, styles.coreDangerTop]} />
        )}
        {playerCoreDanger && (
          <View pointerEvents="none" style={[styles.coreDangerEdge, styles.coreDangerBottom]} />
        )}

      </View>

      <SynergyChips
        team="player"
        synergyIds={state.auras.player.activeSynergyIds}
        augmentId={playerAugment.chosenId}
      />
      <CoreBar core={state.cores.player} label="YOUR CORE" hit={playerCoreHit} />

      <View style={styles.hudBottom}>
        <View style={styles.energyRow}>
          <Text style={styles.energyLabel}>
            ENERGY {energy.toFixed(1)} / {BALANCE.energy.max}
          </Text>
          <View style={styles.energyTrack}>
            <View style={[styles.energyFill, { width: `${energyPct * 100}%` }]} />
            {ENERGY_PIPS.map((n) => (
              <View
                key={n}
                pointerEvents="none"
                style={[styles.energyPip, { left: `${(n / BALANCE.energy.max) * 100}%` }]}
              />
            ))}
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

      {introVisible && (
        <BattleIntro
          elapsedMs={introElapsed}
          playerChampionId={
            live.config.player.squad?.captain.championId ?? live.config.player.championId ?? null
          }
          opponentChampionId={
            live.config.opponent.squad?.captain.championId ??
            live.config.opponent.championId ??
            null
          }
          opponentLabel={opponentIntroLabel}
          squad={
            mode === 'gym-war'
              ? (live.config.player.squad?.borrowed ?? []).map((b) => ({
                  championId: b.championId,
                  ownerName: b.displayName ?? 'Gym mate',
                }))
              : undefined
          }
          reduceMotion={reduceMotion}
        />
      )}

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

      {status === 'finished' && state.outcome && resultRevealed && (
        <ResultOverlay
          outcome={state.outcome}
          mode={mode}
          // Same source the store records through — the number shown IS the
          // number applied (0 for tutorial/ghost).
          ratingDelta={ratingDeltaForOutcome(mode, state.outcome.winner, BALANCE)}
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
  // P7: the timer is the battle's heartbeat — pixel display face, larger.
  timer: {
    ...typography.pixelBold,
    fontSize: 26,
    letterSpacing: 1,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  timerLow: { color: colors.warning },
  timerSudden: { color: colors.danger },
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
  // P4 — full-screen tint for ultimates (caster's path color) and the
  // battle-end climax (winner's color); opacity is aged per frame.
  screenFlash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Phase 6 — steady danger edge on the side of a core at ≤25% health.
  coreDangerEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: `${colors.danger}1C`,
  },
  coreDangerTop: { top: 0, borderTopWidth: 2, borderTopColor: colors.danger },
  coreDangerBottom: { bottom: 0, borderBottomWidth: 2, borderBottomColor: colors.danger },
  hudBottom: { gap: spacing.xs },
  energyRow: { gap: spacing.xs },
  energyLabel: { ...typography.pixel, fontSize: 15, letterSpacing: 0.5, color: colors.cyan },
  energyTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  energyFill: { height: '100%', backgroundColor: colors.cyan },
  // P7: whole-energy-point divider on the energy bar (see ENERGY_PIPS).
  energyPip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(7, 11, 18, 0.45)',
  },
  toast: {
    ...typography.label,
    color: colors.warning,
    textAlign: 'center',
    minHeight: 16,
  },
  devOverlay: { position: 'absolute', left: 4, bottom: 4 },
  devText: { ...typography.mono, fontSize: 9, color: colors.textFaint },
});
