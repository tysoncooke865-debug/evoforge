import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { chooseAiMove } from '@/domain/battle-rpg/ai';
import { CHAMPIONS } from '@/domain/battle-rpg/champions';
import { buildCombatant, createBattle, moveById, resolveTurn } from '@/domain/battle-rpg/engine';
import { RECOVER_MOVE, movesForChampion } from '@/domain/battle-rpg/moves';
import { combatPower, createBattleStats, type PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import type {
  AiPersonality,
  BattleEvent,
  BattleMode,
  BattleMove,
  BattleState,
  ChampionId,
} from '@/domain/battle-rpg/types';
import { rewardsFor } from '@/domain/battle-rpg/rewards';
import { useBattleRpgStore } from '@/state/battle-rpg-store';

/**
 * useBattle — owns the live BattleState and plays back each resolved turn's
 * events on a timer so the UI can animate + narrate one action at a time.
 * Input is locked (`isBusy`) during playback so moves can't be spammed.
 */

export interface BattleSetup {
  mode: BattleMode;
  playerChampion: ChampionId;
  opponentChampion: ChampionId;
  opponentName: string;
  ai: AiPersonality;
  player: PlayerCombatInput;
  /** gym id when mode === 'gym'. */
  gymId?: string;
  /** difficulty multiplier for the opponent (gym/rival). */
  difficulty?: number;
  playerSprite: { branch: BattleState['player']['spriteBranch']; stage: number };
}

const EVENT_MS = 780;

export function makeBattle(setup: BattleSetup): BattleState {
  const playerStats = createBattleStats(setup.playerChampion, setup.player, setup.mode);
  const targetPower = combatPower(playerStats);
  const oppStats = createBattleStats(setup.opponentChampion, null, setup.mode, {
    targetPower,
    difficulty: setup.difficulty,
  });
  const player = buildCombatant({
    championId: setup.playerChampion,
    name: CHAMPIONS[setup.playerChampion].name,
    stats: playerStats,
    spriteBranch: setup.playerSprite.branch,
    spriteStage: setup.playerSprite.stage,
  });
  const opponent = buildCombatant({
    championId: setup.opponentChampion,
    name: setup.opponentName,
    stats: oppStats,
    spriteBranch: CHAMPIONS[setup.opponentChampion].spriteBranch,
    spriteStage: 4,
  });
  return createBattle(`b_${setup.mode}_${Math.floor(Math.random() * 1e6)}`, setup.mode, player, opponent);
}

export interface UseBattle {
  state: BattleState;
  /** The event currently being animated (drives sprites + damage numbers). */
  activeEvent: BattleEvent | null;
  message: string;
  isBusy: boolean;
  playerMoves: BattleMove[];
  selectMove: (moveId: string) => void;
  rematch: () => void;
  /** Debug hooks (dev only). */
  debug: {
    setHealth: (side: 'player' | 'opponent', hp: number) => void;
    restoreStamina: () => void;
    forceCrit: boolean;
    toggleForceCrit: () => void;
    skipTo: (winner: 'player' | 'opponent') => void;
  };
}

export function useBattle(setup: BattleSetup, onEnd?: (won: boolean, s: BattleState) => void): UseBattle {
  const [state, setState] = useState<BattleState>(() => makeBattle(setup));
  const [activeEvent, setActiveEvent] = useState<BattleEvent | null>(null);
  const [message, setMessage] = useState<string>('');
  const [forceCrit, setForceCrit] = useState(false);
  const queueRef = useRef<BattleEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef(false);

  const playerMoves = useMemo(() => movesForChampion(setup.playerChampion), [setup.playerChampion]);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => () => clearTimer(), []);

  // Play the queued events one at a time, then unlock input.
  const drain = useCallback(
    (finalState: BattleState) => {
      const step = () => {
        const next = queueRef.current.shift();
        if (!next) {
          setActiveEvent(null);
          setState((s) => ({ ...s, isResolvingTurn: false }));
          // End-of-battle callback once, after the last event shows.
          if (finalState.winner && !endedRef.current) {
            endedRef.current = true;
            onEnd?.(finalState.winner === 'player', finalState);
          }
          return;
        }
        setActiveEvent(next);
        setMessage(next.message);
        timerRef.current = setTimeout(step, EVENT_MS);
      };
      step();
    },
    [onEnd]
  );

  const selectMove = useCallback(
    (moveId: string) => {
      if (state.isResolvingTurn || state.winner) return;
      const move = moveId === 'recover' ? RECOVER_MOVE : moveById(moveId);
      // Guard: never resolve an unaffordable move (UI also disables it).
      if (move.staminaCost > state.player.stats.currentStamina && move.id !== 'recover') {
        setMessage('Not enough stamina.');
        return;
      }
      const rng = Math.random;
      const aiMove = chooseAiMove(state.opponent, state.player, setup.ai, rng);
      const resolved = resolveTurn({ ...state, isResolvingTurn: true }, move, aiMove, rng, {
        forcePlayerCrit: forceCrit,
      });
      setState(resolved);
      queueRef.current = [...resolved.lastTurnEvents];
      clearTimer();
      drain(resolved);
    },
    [state, setup.ai, forceCrit, drain]
  );

  const rematch = useCallback(() => {
    clearTimer();
    endedRef.current = false;
    queueRef.current = [];
    setActiveEvent(null);
    setMessage('');
    setState(makeBattle(setup));
  }, [setup]);

  // Dev debug helpers.
  const debug = useMemo(
    () => ({
      setHealth: (side: 'player' | 'opponent', hp: number) =>
        setState((s) => ({
          ...s,
          [side]: { ...s[side], stats: { ...s[side].stats, currentHealth: Math.max(0, Math.min(s[side].stats.maxHealth, hp)) } },
        })),
      restoreStamina: () =>
        setState((s) => ({ ...s, player: { ...s.player, stats: { ...s.player.stats, currentStamina: s.player.stats.maxStamina } } })),
      forceCrit,
      toggleForceCrit: () => setForceCrit((v) => !v),
      skipTo: (winner: 'player' | 'opponent') =>
        setState((s) => {
          const dead = winner === 'player' ? 'opponent' : 'player';
          const next: BattleState = {
            ...s,
            [dead]: { ...s[dead], stats: { ...s[dead].stats, currentHealth: 0 } },
            winner,
            phase: winner === 'player' ? 'victory' : 'defeat',
          };
          if (!endedRef.current) { endedRef.current = true; onEnd?.(winner === 'player', next); }
          return next;
        }),
    }),
    [forceCrit, onEnd]
  );

  return { state, activeEvent, message, isBusy: state.isResolvingTurn, playerMoves, selectMove, rematch, debug };
}

/** Compute the reward + persist it. Called from the battle screen onEnd. */
export function settleBattle(
  setup: BattleSetup,
  won: boolean,
  turns: number,
  opponentChampion: ChampionId,
  opponentName: string
) {
  const store = useBattleRpgStore.getState();
  const gymAlreadyCleared = setup.gymId ? store.gymProgress[setup.gymId]?.firstClearClaimed ?? false : false;
  const rewards = rewardsFor(setup.mode, won, { gymId: setup.gymId, gymAlreadyCleared });

  store.recordResult({
    id: `r_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    at: Date.now(),
    mode: setup.mode,
    playerChampion: setup.playerChampion,
    opponentChampion,
    opponentName,
    result: won ? 'win' : 'loss',
    turns,
    rewards,
  });

  if (setup.mode === 'gym' && setup.gymId && won) {
    store.markGymClear(setup.gymId, turns, !!rewards.firstClear);
  }
  if (setup.mode === 'rival') store.recordRival(won, Date.now());
  return rewards;
}

/** A tactical tip for the defeat screen, based on how the battle went. */
export function tacticalTip(state: BattleState, gymId?: string): string {
  const p = state.player;
  if (p.stats.currentStamina < p.stats.maxStamina * 0.25) {
    return 'Recover stamina before committing to a heavy move.';
  }
  if (gymId === 'iron_foundry') return 'Brax guards hard — bait Iron Guard, then strike, and use defence before his Titan Breaker.';
  if (state.opponent.stats.speed > p.stats.speed) return 'Speed-based attacks can act before slow heavies — lead with a fast or high-priority move.';
  return 'Open with a buff or a status, then punish while it holds.';
}

export function opponentPowerLabel(setup: BattleSetup): number {
  const oppStats = createBattleStats(setup.opponentChampion, null, setup.mode, { difficulty: setup.difficulty, targetPower: combatPower(createBattleStats(setup.playerChampion, setup.player, setup.mode)) });
  return Math.round(combatPower(oppStats));
}
