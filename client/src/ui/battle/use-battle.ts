import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { chooseAiMove } from '@/domain/battle-rpg/ai';
import { CHAMPIONS } from '@/domain/battle-rpg/champions';
import { buildCombatant, createBattle, moveById, resolveTurn } from '@/domain/battle-rpg/engine';
import { ITEM_MOVES, RECOVER_MOVE, movesForChampion } from '@/domain/battle-rpg/moves';
import { combatPower, createBattleStats, type PlayerCombatInput } from '@/domain/battle-rpg/stat-scaler';
import type {
  AiPersonality,
  BattleEvent,
  BattleMode,
  BattleMove,
  BattleState,
  ChampionId,
  ScalingContext,
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
  /** VERSUS (pass-and-play): the opponent is a second HUMAN on this device,
   *  not the AI. Each turn collects P1's move then P2's move, then resolves. */
  versus?: boolean;
  /** CHALLENGE (join-by-code): build the opponent from the CHALLENGER's real
   *  stats (their champion as they made it), not normalised to the joiner. */
  opponentInput?: PlayerCombatInput;
  /** The challenge code, for posting the result back. */
  challengeCode?: string;
  /** GHOST (migration 037): the workout_ghosts id, for posting the result. */
  ghostId?: string;
}

const EVENT_MS = 780;

/** Versus uses balanced (training) scaling — both are human. */
const scalingFor = (m: BattleMode): ScalingContext =>
  m === 'versus' || m === 'challenge' || m === 'ghost' ? 'training' : m;

/** Clamp a stat block so its combat power does not exceed `ceil` — keeps a
 *  challenger's champion tough but never impossible. */
function capStats(s: import('@/domain/battle-rpg/types').BattleStats, ceil: number) {
  const power = combatPower(s);
  if (power <= ceil) return s;
  const k = ceil / power;
  return {
    ...s,
    maxHealth: Math.round(s.maxHealth * k), currentHealth: Math.round(s.maxHealth * k),
    power: Math.round(s.power * k * 10) / 10, defence: Math.round(s.defence * k * 10) / 10,
  };
}

export function makeBattle(setup: BattleSetup): BattleState {
  const playerStats = createBattleStats(setup.playerChampion, setup.player, scalingFor(setup.mode));
  const targetPower = combatPower(playerStats);
  const oppStats = setup.opponentInput
    ? // The challenger's REAL champion (their build), lightly capped so it is
      // never an impossible wall (opponent power clamped near 1.35× the joiner).
      capStats(createBattleStats(setup.opponentChampion, setup.opponentInput, 'training'), targetPower * 1.35)
    : createBattleStats(setup.opponentChampion, null, scalingFor(setup.mode), {
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
  // Gym battles fight under their arena's ambient condition (conditions.ts).
  const conditionId = setup.mode === 'gym' ? setup.gymId ?? null : null;
  return createBattle(`b_${setup.mode}_${Math.floor(Math.random() * 1e6)}`, setup.mode, player, opponent, conditionId);
}

export interface UseBattle {
  state: BattleState;
  /** The event currently being animated (drives sprites + damage numbers). */
  activeEvent: BattleEvent | null;
  message: string;
  isBusy: boolean;
  playerMoves: BattleMove[];
  selectMove: (moveId: string) => void;
  advance: () => void;
  rematch: () => void;
  /** VERSUS: whose input the move grid should collect right now. */
  awaitingSide: 'player' | 'opponent';
  /** VERSUS: the moves for the side currently choosing. */
  activeMoves: BattleMove[];
  /** VERSUS: the combatant whose turn it is to pick. */
  activeChooser: BattleState['player'];
  /** VERSUS: true once P1 has locked in and we're waiting on P2. */
  pendingPlayerLocked: boolean;
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
  const [pendingPlayer, setPendingPlayer] = useState<BattleMove | null>(null);
  const queueRef = useRef<BattleEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<(() => void) | null>(null);
  const endedRef = useRef(false);

  const playerMoves = useMemo(() => movesForChampion(setup.playerChampion), [setup.playerChampion]);
  const opponentMoves = useMemo(() => movesForChampion(setup.opponentChampion), [setup.opponentChampion]);
  const awaitingSide: 'player' | 'opponent' = setup.versus && pendingPlayer ? 'opponent' : 'player';

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
        // Battle speed (Phase D): 2× halves every beat; read at schedule time
        // so flipping the toggle mid-playback applies from the next beat.
        timerRef.current = setTimeout(step, EVENT_MS / useBattleRpgStore.getState().battleSpeed);
      };
      stepRef.current = step;
      step();
    },
    [onEnd]
  );

  /** Tap-to-advance: skip the current event's dwell and show the next now. */
  const advance = useCallback(() => {
    if (!timerRef.current || !stepRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    stepRef.current();
  }, []);

  const resolveWith = useCallback(
    (playerMove: BattleMove, opponentMove: BattleMove) => {
      const resolved = resolveTurn({ ...state, isResolvingTurn: true }, playerMove, opponentMove, Math.random, {
        forcePlayerCrit: forceCrit,
      });
      setState(resolved);
      queueRef.current = [...resolved.lastTurnEvents];
      clearTimer();
      drain(resolved);
    },
    [state, forceCrit, drain]
  );

  const selectMove = useCallback(
    (moveId: string) => {
      if (state.isResolvingTurn || state.winner) return;
      const move = moveId === 'recover' ? RECOVER_MOVE : moveById(moveId);

      // VERSUS (pass-and-play): collect P1's move, then P2's, then resolve.
      if (setup.versus) {
        const chooser = pendingPlayer ? state.opponent : state.player;
        if (move.staminaCost > chooser.stats.currentStamina && move.id !== 'recover') {
          setMessage('Not enough stamina.');
          return;
        }
        if (!pendingPlayer) {
          setPendingPlayer(move); // P1 locked in — wait for P2
        } else {
          resolveWith(pendingPlayer, move);
          setPendingPlayer(null);
        }
        return;
      }

      // Single-player: resolve the player's move against the AI's.
      if (move.staminaCost > state.player.stats.currentStamina && move.id !== 'recover') {
        setMessage('Not enough stamina.');
        return;
      }
      // Gym leaders carry battle items too (Phase C — fair fight).
      const aiMove = chooseAiMove(state.opponent, state.player, setup.ai, Math.random, setup.mode === 'gym' ? ITEM_MOVES : []);
      resolveWith(move, aiMove);
    },
    [state, setup.ai, setup.versus, setup.mode, pendingPlayer, resolveWith]
  );

  const rematch = useCallback(() => {
    clearTimer();
    endedRef.current = false;
    queueRef.current = [];
    setActiveEvent(null);
    setMessage('');
    setPendingPlayer(null);
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

  return {
    state,
    activeEvent,
    message,
    isBusy: state.isResolvingTurn,
    playerMoves,
    selectMove,
    advance,
    rematch,
    debug,
    awaitingSide,
    activeMoves: awaitingSide === 'opponent' ? opponentMoves : playerMoves,
    activeChooser: awaitingSide === 'opponent' ? state.opponent : state.player,
    pendingPlayerLocked: !!pendingPlayer,
  };
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
  const resultKey = `r_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;

  store.recordResult({
    id: resultKey,
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
  // resultKey is the idempotency key the server grant uses.
  return { rewards, resultKey };
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
  const oppStats = createBattleStats(setup.opponentChampion, null, scalingFor(setup.mode), { difficulty: setup.difficulty, targetPower: combatPower(createBattleStats(setup.playerChampion, setup.player, scalingFor(setup.mode))) });
  return Math.round(combatPower(oppStats));
}
