/**
 * Stress driver — dev-only density harness for the render-stress lab
 * (premium program P3). Starts a REAL battle in mode 'dev-stress' (never
 * recorded, never persisted, zero provider writes — see battle-store) and
 * holds a target combatant density by force-spawning units directly through
 * the engine's spawn seam, bypassing the energy economy. Driver spawns are
 * NOT commands, which is exactly why 'dev-stress' battles must never
 * persist a BattleRecord (the digest could never replay).
 *
 * Everything here runs between store frames on the JS thread — the sim only
 * advances inside the store's own frame(), so direct state mutation between
 * fires is safe. Balance tables are read, never written.
 */
import { BALANCE, getCardById } from '../../../content';
import { spawnUnitsForCard } from '../../../game-engine/entities/spawn';
import type { LaneId, TeamId } from '../../../game-engine/types';
import { DEFAULT_DECK_CARD_IDS } from '../../../services/persistence/save';
import { CHAMPIONS } from '../../../content/champions';
import { battleStore, randomSeed } from '../battle-store';
import { stepLiveBattle } from '../battle-controller';

export interface StressConfig {
  /** Combatant target per team, excluding champions. */
  targetPerTeam: number;
  /** Share of spawns that are ranged (drone-archer); rest are melee (neon-boxer). */
  rangedFraction: number;
  /** 1 = real time; 2/4 add extra sim steps per interval (driver-side). */
  simSpeed: 1 | 2 | 4;
  /** Hold density via deficit top-up; off = single initial wave only. */
  topUp: boolean;
  /** Queue the player champion's ability/ultimate every ~2s (telegraph FX pressure). */
  autoCastChampion: boolean;
  /** Restart (fresh seed, same config) ~1s after a finish — memory-trend loops. */
  autoRestart: boolean;
  /** Arena 2.0 (P3): run the formation anti-overlap sim. Default off (1.0 lab). */
  formation?: boolean;
}

export const DEFAULT_STRESS_CONFIG: StressConfig = {
  targetPerTeam: 15,
  rangedFraction: 0.3,
  simSpeed: 1,
  topUp: true,
  autoCastChampion: true,
  autoRestart: false,
};

const TOP_UP_INTERVAL_MS = 250;
const TOP_UP_BURST_CAP = 6;
const SPEED_INTERVAL_MS = 50;
const AUTOCAST_INTERVAL_MS = 2000;
const RESTART_DELAY_MS = 1000;

const MELEE_CARD_ID = 'neon-boxer';
const RANGED_CARD_ID = 'drone-archer';

let config: StressConfig = { ...DEFAULT_STRESS_CONFIG };
let topUpId: ReturnType<typeof setInterval> | null = null;
let speedId: ReturnType<typeof setInterval> | null = null;
let castId: ReturnType<typeof setInterval> | null = null;
let restartId: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let spawnCounter = 0;
let driverActive = false;

function stressBattleRunning(): boolean {
  const s = battleStore.getState();
  return s.mode === 'dev-stress' && s.status === 'running' && s.live !== null;
}

/** Deficit-fill one team up to the target, burst-capped. */
function topUpTeam(team: TeamId, deficitCap: number): number {
  const live = battleStore.getState().live;
  if (!live) return 0;
  const alive = live.state.units.filter((u) => u.alive && u.kind === 'unit' && u.team === team);
  let deficit = Math.min(deficitCap, config.targetPerTeam - alive.length);
  let spawned = 0;
  const laneLength = BALANCE.arena.laneLength;
  while (deficit > 0) {
    const ranged = (spawnCounter % 100) / 100 < config.rangedFraction;
    const card = getCardById(ranged ? RANGED_CARD_ID : MELEE_CARD_ID);
    if (!card || !card.unit) return spawned; // content missing — refuse quietly
    const lane: LaneId = (spawnCounter % 2) as LaneId;
    // Own-half spawn bands, mirrored, converging mid-lane.
    const frac = 0.25 + ((spawnCounter * 7) % 5) * 0.05; // 0.25..0.45
    const x = team === 'player' ? laneLength * frac : laneLength * (1 - frac);
    const units = spawnUnitsForCard(live.state, BALANCE, card, team, lane, x);
    spawned += units.length;
    deficit -= units.length;
    spawnCounter++;
  }
  return spawned;
}

function topUpTick(): void {
  if (!stressBattleRunning()) return;
  const spawned = topUpTeam('player', TOP_UP_BURST_CAP) + topUpTeam('opponent', TOP_UP_BURST_CAP);
  if (spawned > 0) {
    // Paint the injected units immediately (the store only bumps on sim ticks).
    battleStore.setState((s) => ({ version: s.version + 1 }));
  }
}

function speedTick(): void {
  if (config.simSpeed <= 1) return;
  if (!stressBattleRunning()) return;
  const live = battleStore.getState().live;
  if (!live) return;
  // The store's own loop supplies the base 1x; add the difference here.
  stepLiveBattle(live, config.simSpeed - 1);
  battleStore.setState((s) => ({ version: s.version + 1 }));
}

function castTick(): void {
  if (!config.autoCastChampion) return;
  if (!stressBattleRunning()) return;
  const store = battleStore.getState();
  // Alternate ability/ultimate; rejections (not charged / on cooldown) are fine.
  if (spawnCounter % 2 === 0) store.championAbility();
  else store.championUltimate();
  store.clearRejection();
}

function watchForFinish(): void {
  unsubscribe?.();
  unsubscribe = battleStore.subscribe((state, prev) => {
    if (!driverActive || !config.autoRestart) return;
    if (state.status === 'finished' && prev.status !== 'finished' && state.mode === 'dev-stress') {
      if (restartId !== null) clearTimeout(restartId);
      restartId = setTimeout(() => {
        restartId = null;
        if (driverActive) restartStressBattle();
      }, RESTART_DELAY_MS);
    }
  });
}

function clearTimers(): void {
  if (topUpId !== null) clearInterval(topUpId);
  if (speedId !== null) clearInterval(speedId);
  if (castId !== null) clearInterval(castId);
  if (restartId !== null) clearTimeout(restartId);
  topUpId = speedId = castId = null;
  restartId = null;
}

export function startStressBattle(cfg: Partial<StressConfig> = {}): void {
  config = { ...DEFAULT_STRESS_CONFIG, ...cfg };
  driverActive = true;
  spawnCounter = 0;
  battleStore
    .getState()
    .start(
      randomSeed(),
      'local-player',
      {
        playerChampionId: CHAMPIONS[0].id,
        playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
        opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
        aiDifficulty: 'standard',
        formation: config.formation ?? false,
      },
      'dev-stress'
    );
  clearTimers();
  topUpId = setInterval(topUpTick, TOP_UP_INTERVAL_MS);
  speedId = setInterval(speedTick, SPEED_INTERVAL_MS);
  castId = setInterval(castTick, AUTOCAST_INTERVAL_MS);
  watchForFinish();
  // Immediate first wave so measurement can begin without waiting 250ms.
  topUpTick();
}

export function restartStressBattle(): void {
  if (!driverActive) return;
  startStressBattle(config);
}

export function updateStressConfig(partial: Partial<StressConfig>): void {
  config = { ...config, ...partial };
}

export function getStressConfig(): StressConfig {
  return { ...config };
}

export function isStressDriverActive(): boolean {
  return driverActive;
}

export function stopStressDriver(): void {
  driverActive = false;
  clearTimers();
  unsubscribe?.();
  unsubscribe = null;
}
