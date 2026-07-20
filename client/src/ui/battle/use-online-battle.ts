import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CHAMPIONS } from '@/domain/battle-rpg/champions';
import { buildCombatant, createBattle, moveById, resolveTurn } from '@/domain/battle-rpg/engine';
import { RECOVER_MOVE, movesForChampion } from '@/domain/battle-rpg/moves';
import { createBattleStats } from '@/domain/battle-rpg/stat-scaler';
import { turnRng } from '@/domain/battle-rpg/prng';
import type { BattleEvent, BattleMove, BattleState } from '@/domain/battle-rpg/types';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { fetchPvpMoves, pvpForfeit, pvpSubmitMove, type PvpMatch } from '@/data/matchmaking';
import { supabase } from '@/data/supabase';

/**
 * useOnlineBattle — drives a REAL-TIME PvP champion match (migration 074) from
 * the same interface BattleRunner already renders, so the battle UI is reused.
 *
 * DETERMINISM (the whole trick): both clients build the SAME canonical battle —
 * seat 1 is always "player", seat 2 "opponent" — and resolve each turn with
 * turnRng(seed, turn). decideOrder breaks speed ties on rng()<0.5 favouring the
 * "player" label, so resolving from the LOCAL perspective would desync on ties;
 * resolving canonically and swapping only the VIEW for seat 2 keeps both devices
 * byte-identical (proven in prng.test.ts). Moves are exchanged over Realtime
 * (pvp_moves); when both seats' moves for turn N are in, each client resolves N
 * locally and plays its own animation — no lockstep, because the result is
 * identical. Nothing farmable rides on a match, so client resolution is safe.
 */

const EVENT_MS = 780;

/** The canonical battle, identical on both devices (seat1 = player). */
function buildCanonical(match: PvpMatch): BattleState {
  const s1 = createBattleStats(match.champion1, match.input1, 'training');
  const s2 = createBattleStats(match.champion2, match.input2, 'training');
  const p1 = buildCombatant({
    championId: match.champion1, name: CHAMPIONS[match.champion1].name, stats: s1,
    spriteBranch: CHAMPIONS[match.champion1].spriteBranch, spriteStage: 4,
  });
  const p2 = buildCombatant({
    championId: match.champion2, name: CHAMPIONS[match.champion2].name, stats: s2,
    spriteBranch: CHAMPIONS[match.champion2].spriteBranch, spriteStage: 4,
  });
  return createBattle(`pvp_${match.id}`, 'versus', p1, p2, null);
}

/** Present the canonical state from the LOCAL seat: seat 2 sees itself as player. */
function viewFor(s: BattleState, mySeat: 1 | 2): BattleState {
  if (mySeat === 1) return s;
  return {
    ...s,
    player: s.opponent,
    opponent: s.player,
    winner: s.winner === 'player' ? 'opponent' : s.winner === 'opponent' ? 'player' : s.winner,
  };
}
function flipEvent(e: BattleEvent | null, mySeat: 1 | 2): BattleEvent | null {
  if (!e || mySeat === 1) return e;
  return { ...e, side: e.side === 'player' ? 'opponent' : 'player' };
}

export interface UseOnlineBattle {
  state: BattleState;
  activeEvent: BattleEvent | null;
  message: string;
  isBusy: boolean;
  waitingForOpponent: boolean;
  opponentLeft: boolean;
  playerMoves: BattleMove[];
  selectMove: (moveId: string) => void;
  advance: () => void;
  forfeit: () => void;
}

export function useOnlineBattle(
  match: PvpMatch,
  mySeat: 1 | 2,
  onEnd?: (iWon: boolean, canonical: BattleState) => void
): UseOnlineBattle {
  const seed = match.seed;
  const [canonical, setCanonicalState] = useState<BattleState>(() => buildCanonical(match));
  const canonicalRef = useRef(canonical);
  const setCanonical = useCallback((s: BattleState) => {
    canonicalRef.current = s;
    setCanonicalState(s);
  }, []);

  const [activeEvent, setActiveEvent] = useState<BattleEvent | null>(null);
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false); // I locked a move this turn
  const [isResolving, setIsResolving] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);

  // turn -> { 1?: moveId, 2?: moveId }
  const movesRef = useRef<Record<number, Record<number, string>>>({});
  const resolvedRef = useRef(-1);
  const queueRef = useRef<BattleEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef<(() => void) | null>(null);
  const endedRef = useRef(false);
  const isResolvingRef = useRef(false);
  const maybeResolveRef = useRef<(() => void) | null>(null);

  const myChampion = mySeat === 1 ? match.champion1 : match.champion2;
  const playerMoves = useMemo(() => movesForChampion(myChampion), [myChampion]);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => () => clearTimer(), []);

  const drain = useCallback(
    (finalState: BattleState) => {
      const step = () => {
        const next = queueRef.current.shift();
        if (!next) {
          setActiveEvent(null);
          setIsResolving(false);
          if (finalState.winner && !endedRef.current) {
            endedRef.current = true;
            const iWon = (finalState.winner === 'player') === (mySeat === 1);
            onEnd?.(iWon, finalState);
          } else {
            // Next turn may already have both moves queued (opponent moved while
            // we were animating) — resolve it now.
            maybeResolveRef.current?.();
          }
          return;
        }
        setActiveEvent(next);
        setMessage(next.message);
        timerRef.current = setTimeout(step, EVENT_MS / useBattleRpgStore.getState().battleSpeed);
      };
      stepRef.current = step;
      step();
    },
    [mySeat, onEnd]
  );

  const maybeResolve = useCallback(() => {
    const cur = canonicalRef.current;
    if (cur.winner || isResolvingRef.current) return;
    const turn = cur.turnNumber;
    const m = movesRef.current[turn];
    if (!m || m[1] === undefined || m[2] === undefined) return;
    if (resolvedRef.current >= turn) return;
    resolvedRef.current = turn;
    setSubmitted(false);
    isResolvingRef.current = true;
    setIsResolving(true);
    const move1 = m[1] === 'recover' ? RECOVER_MOVE : moveById(m[1]);
    const move2 = m[2] === 'recover' ? RECOVER_MOVE : moveById(m[2]);
    const resolved = resolveTurn({ ...cur, isResolvingTurn: true }, move1, move2, turnRng(seed, turn));
    setCanonical(resolved);
    queueRef.current = [...resolved.lastTurnEvents];
    clearTimer();
    drain(resolved);
  }, [seed, drain, setCanonical]);
  // Keep the ref pointing at the latest maybeResolve (callbacks call it via the
  // ref to avoid stale closures). Effect, not render-time, per react-hooks/refs.
  useEffect(() => { maybeResolveRef.current = maybeResolve; }, [maybeResolve]);
  // Mirror isResolving into its ref so callbacks read it synchronously.
  useEffect(() => { isResolvingRef.current = isResolving; }, [isResolving]);

  const recordMove = useCallback((turn: number, seat: number, moveId: string) => {
    const t = movesRef.current[turn] ?? {};
    if (t[seat] !== undefined) return; // first write wins (idempotent)
    movesRef.current[turn] = { ...t, [seat]: moveId };
    maybeResolveRef.current?.();
  }, []);

  // Realtime: opponent moves + match status (their forfeit ends the game).
  useEffect(() => {
    let live = true;
    // Catch up on any moves already submitted before this channel connected.
    void fetchPvpMoves(match.id).then((rows) => {
      if (!live) return;
      for (const r of rows) recordMove(r.turn, r.seat, r.move_id);
    });
    const channel = supabase
      .channel(`pvp:${match.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pvp_moves', filter: `match_id=eq.${match.id}` }, (payload) => {
        const r = payload.new as { turn: number; seat: number; move_id: string };
        recordMove(r.turn, r.seat, r.move_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pvp_matches', filter: `id=eq.${match.id}` }, (payload) => {
        const m = payload.new as { status: string; winner_seat: number | null };
        if ((m.status === 'abandoned' || m.status === 'finished') && !endedRef.current && !canonicalRef.current.winner) {
          // Opponent forfeited / the match closed server-side before our local
          // resolution — honour the server's winner.
          endedRef.current = true;
          setOpponentLeft(m.status === 'abandoned');
          onEnd?.(m.winner_seat === mySeat, canonicalRef.current);
        }
      })
      .subscribe();
    return () => {
      live = false;
      void supabase.removeChannel(channel);
    };
  }, [match.id, mySeat, recordMove, onEnd]);

  const advance = useCallback(() => {
    if (!timerRef.current || !stepRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    stepRef.current();
  }, []);

  const selectMove = useCallback(
    (moveId: string) => {
      const cur = canonicalRef.current;
      if (cur.winner || isResolvingRef.current || submitted) return;
      const me = mySeat === 1 ? cur.player : cur.opponent;
      const move = moveId === 'recover' ? RECOVER_MOVE : moveById(moveId);
      if (move.staminaCost > me.stats.currentStamina && move.id !== 'recover') {
        setMessage('Not enough stamina.');
        return;
      }
      const turn = cur.turnNumber;
      setSubmitted(true);
      recordMove(turn, mySeat, moveId); // optimistic local
      void pvpSubmitMove(match.id, turn, moveId);
    },
    [mySeat, submitted, recordMove, match.id]
  );

  const forfeit = useCallback(() => {
    if (endedRef.current) return;
    void pvpForfeit(match.id);
  }, [match.id]);

  const waitingForOpponent = submitted && !isResolving && !canonical.winner;

  return {
    state: viewFor(canonical, mySeat),
    activeEvent: flipEvent(activeEvent, mySeat),
    message,
    isBusy: isResolving || submitted || canonical.winner !== null,
    waitingForOpponent,
    opponentLeft,
    playerMoves,
    selectMove,
    advance,
    forfeit,
  };
}
