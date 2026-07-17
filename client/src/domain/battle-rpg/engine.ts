import { isMoveUsable } from './ai';
import { computeDamage, rollHit } from './damage';
import { ALL_MOVES } from './moves';
import {
  applyStatus,
  effectiveRegen,
  effectiveSpeed,
  hasStatus,
  tickStatuses,
} from './status';
import type {
  BattleEvent,
  BattleMode,
  BattleMove,
  BattleState,
  ChampionId,
  Combatant,
  Rng,
} from './types';

/**
 * THE BATTLE ENGINE — a pure, deterministic turn resolver. It never touches
 * React, storage or Math.random directly; the RNG is threaded so tests are
 * exact and the UI just plays back `lastTurnEvents`.
 *
 * Turn order (per the brief): validate → order by priority then speed →
 * resolve first → check defeat → resolve second if able → end-of-turn
 * (bleed, regen, cooldowns, status ticks, clear guards) → check victory.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface BuildCombatantInput {
  championId: ChampionId;
  name: string;
  stats: Combatant['stats'];
  spriteBranch: Combatant['spriteBranch'];
  spriteStage: number;
}

export function buildCombatant(i: BuildCombatantInput): Combatant {
  return {
    championId: i.championId,
    name: i.name,
    spriteBranch: i.spriteBranch,
    spriteStage: i.spriteStage,
    stats: { ...i.stats },
    statuses: [],
    cooldowns: {},
    tookDamage: false,
    comboArmed: false,
    guard: null,
  };
}

export function createBattle(
  battleId: string,
  mode: BattleMode,
  player: Combatant,
  opponent: Combatant
): BattleState {
  return {
    battleId,
    mode,
    turnNumber: 1,
    phase: 'awaiting_player',
    player,
    opponent,
    log: [{ kind: 'info', side: 'player', message: `Battle start — ${player.name} vs ${opponent.name}!` }],
    lastTurnEvents: [],
    winner: null,
    stats: { playerDamage: 0, opponentDamage: 0, crits: 0 },
    rewards: null,
    isResolvingTurn: false,
  };
}

export function moveById(id: string): BattleMove {
  return ALL_MOVES[id];
}

function isAlive(c: Combatant): boolean {
  return c.stats.currentHealth > 0;
}

/** Execute one combatant's move against the other, mutating both in place and
 *  pushing events. Returns nothing; caller checks defeat afterwards. */
function executeMove(
  actor: Combatant,
  target: Combatant,
  move: BattleMove,
  side: 'player' | 'opponent',
  rng: Rng,
  tally: BattleState['stats'],
  events: BattleEvent[],
  forceCrit: boolean
): void {
  // Pay stamina + arm cooldown (validated by the caller).
  actor.stats.currentStamina = clamp(actor.stats.currentStamina - move.staminaCost, 0, actor.stats.maxStamina);
  if (move.cooldown > 0) actor.cooldowns[move.id] = move.cooldown + 1; // +1: decremented same end-of-turn

  events.push({ kind: 'move', side, message: `${actor.name} used ${move.name}!`, animationType: move.animationType, moveId: move.id });

  // Defensive stances (one-turn guard).
  if (move.id === 'counter_pose') actor.guard = { mult: 0.5, counter: 0.3 };
  else if (move.id === 'iron_guard') actor.guard = { mult: 0.45, counter: 0 };

  // Damage.
  if (move.basePower > 0) {
    const foeSide: 'player' | 'opponent' = side === 'player' ? 'opponent' : 'player';
    const hits = move.multiHit ? 1 + (rng() < move.multiHit.chance ? move.multiHit.times - 1 : 0) : 1;
    let landedAny = false;
    for (let h = 0; h < hits; h++) {
      if (!isAlive(target)) break;
      const hit = rollHit(move, target, rng);
      if (!hit) {
        events.push({ kind: 'miss', side, message: `${target.name} dodged!` });
        continue;
      }
      landedAny = true;
      const res = computeDamage(move, actor, target, rng, { forceCrit });
      let dmg = res.damage;
      if (target.guard) dmg = Math.max(1, Math.round(dmg * target.guard.mult));
      target.stats.currentHealth = clamp(target.stats.currentHealth - dmg, 0, target.stats.maxHealth);
      target.tookDamage = true;
      if (side === 'player') tally.playerDamage += dmg;
      else tally.opponentDamage += dmg;
      if (res.crit) tally.crits += 1;
      events.push({
        kind: res.crit ? 'crit' : 'damage',
        side: foeSide,
        message: res.crit ? `Critical hit! ${dmg} damage.` : `${dmg} damage.`,
        amount: dmg,
        animationType: move.animationType,
      });
      // Counter (returns melee damage to the attacker).
      if (target.guard && target.guard.counter > 0 && isAlive(target)) {
        const back = Math.max(1, Math.round(dmg * target.guard.counter));
        actor.stats.currentHealth = clamp(actor.stats.currentHealth - back, 0, actor.stats.maxHealth);
        actor.tookDamage = true;
        events.push({ kind: 'damage', side, message: `${target.name} countered for ${back}!`, amount: back });
      }
    }
    // Combo flag is consumed by any offensive move.
    if (landedAny) actor.comboArmed = false;
  }

  // Shadow Step arms the next attack.
  if (move.id === 'shadow_step') actor.comboArmed = true;

  // Effects (statuses, restores) — only if the move connected for offensive
  // ones; self-effects always apply.
  const targetAlive = isAlive(target);
  for (const eff of move.effects) {
    if (eff.chance != null && rng() >= eff.chance) continue;
    const onSelf = eff.target === 'self';
    const recv = onSelf ? actor : target;
    if (!onSelf && !targetAlive) continue;
    const recvSide: 'player' | 'opponent' = onSelf ? side : side === 'player' ? 'opponent' : 'player';
    switch (eff.kind) {
      case 'apply_status':
      case 'buff_self':
        if (eff.status) {
          applyStatus(recv, eff.status, eff.duration ?? 1, eff.amount ?? 0);
          events.push({ kind: 'status_apply', side: recvSide, message: `${recv.name} — ${eff.status.replace('_', ' ')}.`, status: eff.status });
        }
        break;
      case 'restore_stamina': {
        const before = recv.stats.currentStamina;
        recv.stats.currentStamina = clamp(recv.stats.currentStamina + (eff.amount ?? 0), 0, recv.stats.maxStamina);
        const gained = Math.round(recv.stats.currentStamina - before);
        if (gained > 0) events.push({ kind: 'stamina', side: recvSide, message: `${recv.name} recovered ${gained} stamina.`, amount: gained });
        break;
      }
      case 'restore_health':
      case 'heal_self': {
        const before = recv.stats.currentHealth;
        recv.stats.currentHealth = clamp(recv.stats.currentHealth + (eff.amount ?? 0), 0, recv.stats.maxHealth);
        const gained = Math.round(recv.stats.currentHealth - before);
        if (gained > 0) events.push({ kind: 'heal', side: recvSide, message: `${recv.name} healed ${gained}.`, amount: gained });
        break;
      }
      case 'lower_defence':
        applyStatus(recv, 'guard_break', eff.duration ?? 2, eff.amount ?? 0.25);
        events.push({ kind: 'status_apply', side: recvSide, message: `${recv.name} — guard break.`, status: 'guard_break' });
        break;
    }
  }
}

function endOfTurn(c: Combatant, side: 'player' | 'opponent', events: BattleEvent[], tally: BattleState['stats']): void {
  // Bleed damage.
  const bleed = c.statuses.find((s) => s.kind === 'bleed');
  if (bleed && isAlive(c)) {
    const dmg = Math.max(1, Math.round(bleed.magnitude));
    c.stats.currentHealth = clamp(c.stats.currentHealth - dmg, 0, c.stats.maxHealth);
    if (side === 'player') tally.opponentDamage += dmg;
    else tally.playerDamage += dmg;
    events.push({ kind: 'status_tick', side, message: `${c.name} bleeds for ${dmg}.`, amount: dmg, status: 'bleed' });
  }
  // Stamina regen (never past max).
  if (isAlive(c)) {
    c.stats.currentStamina = clamp(c.stats.currentStamina + effectiveRegen(c), 0, c.stats.maxStamina);
  }
  // Cooldowns down.
  for (const id of Object.keys(c.cooldowns)) {
    c.cooldowns[id] = Math.max(0, c.cooldowns[id] - 1);
    if (c.cooldowns[id] === 0) delete c.cooldowns[id];
  }
  // Status durations.
  const expired = tickStatuses(c);
  for (const kind of expired) events.push({ kind: 'status_expire', side, message: `${c.name} — ${kind.replace('_', ' ')} wore off.`, status: kind });
  // Guard is a ONE-turn stance.
  c.guard = null;
}

export interface ResolveOptions {
  /** Force the player's next hit to crit (debug). */
  forcePlayerCrit?: boolean;
}

/**
 * Resolve one full turn. `aiMove` is chosen by the caller (ai.ts) so the
 * engine stays free of AI policy. Returns a NEW state (inputs are cloned).
 */
export function resolveTurn(
  prev: BattleState,
  playerMove: BattleMove,
  aiMove: BattleMove,
  rng: Rng,
  opts: ResolveOptions = {}
): BattleState {
  if (prev.winner !== null) return prev; // battle is over — no-op (guard)

  const state: BattleState = structuredClone(prev);
  const events: BattleEvent[] = [];
  const { player, opponent } = state;

  // Validate the player's move (defensive — the UI also blocks this).
  if (!isMoveUsable(playerMove, player) && playerMove.id !== 'recover') {
    return { ...prev, lastTurnEvents: [{ kind: 'no_stamina', side: 'player', message: 'Not enough stamina.' }] };
  }

  // Determine order: priority desc, then effective speed desc, then rng.
  const pFirst = decideOrder(playerMove, aiMove, player, opponent, rng);

  const acts: { c: Combatant; foe: Combatant; move: BattleMove; side: 'player' | 'opponent'; crit: boolean }[] = pFirst
    ? [
        { c: player, foe: opponent, move: playerMove, side: 'player', crit: !!opts.forcePlayerCrit },
        { c: opponent, foe: player, move: aiMove, side: 'opponent', crit: false },
      ]
    : [
        { c: opponent, foe: player, move: aiMove, side: 'opponent', crit: false },
        { c: player, foe: opponent, move: playerMove, side: 'player', crit: !!opts.forcePlayerCrit },
      ];

  for (const a of acts) {
    if (!isAlive(a.c)) continue; // a defeated champion cannot act
    // Stagger: small chance to lose the action entirely (kept mild).
    if (hasStatus(a.c, 'stagger') && rng() < 0.15) {
      events.push({ kind: 'info', side: a.side, message: `${a.c.name} is staggered and falters!` });
      continue;
    }
    executeMove(a.c, a.foe, a.move, a.side, rng, state.stats, events, a.crit);
    if (!isAlive(a.foe)) {
      events.push({ kind: 'defeated', side: a.side === 'player' ? 'opponent' : 'player', message: `${a.foe.name} was defeated!` });
      break; // second action does not resolve
    }
  }

  // End-of-turn (only if both still standing; if someone died, skip their tick
  // but still allow the survivor's bleed? Both may die from end-turn — handled
  // by running end-of-turn only when no winner yet).
  const someoneDead = !isAlive(player) || !isAlive(opponent);
  if (!someoneDead) {
    endOfTurn(player, 'player', events, state.stats);
    if (isAlive(opponent)) endOfTurn(opponent, 'opponent', events, state.stats);
    // Both could hit 0 from bleed — resolve as a draw toward the player-loses
    // side is unfair; treat simultaneous KO as the player winning ties.
  }

  // Victory check.
  const playerDead = !isAlive(player);
  const oppDead = !isAlive(opponent);
  let winner: BattleState['winner'] = null;
  let phase: BattleState['phase'] = 'awaiting_player';
  if (oppDead && !playerDead) { winner = 'player'; phase = 'victory'; }
  else if (playerDead && !oppDead) { winner = 'opponent'; phase = 'defeat'; }
  else if (playerDead && oppDead) { winner = 'player'; phase = 'victory'; } // tie → player

  state.log = [...state.log, ...events];
  state.lastTurnEvents = events;
  state.winner = winner;
  state.phase = phase;
  state.turnNumber = prev.turnNumber + (winner ? 0 : 1);
  state.isResolvingTurn = false;
  return state;
}

/** True if the player's move goes first. Priority beats speed; speed breaks
 *  priority ties; rng breaks exact speed ties. */
export function decideOrder(
  playerMove: BattleMove,
  aiMove: BattleMove,
  player: Combatant,
  opponent: Combatant,
  rng: Rng
): boolean {
  if (playerMove.priority !== aiMove.priority) return playerMove.priority > aiMove.priority;
  const ps = effectiveSpeed(player);
  const os = effectiveSpeed(opponent);
  if (ps !== os) return ps > os;
  return rng() < 0.5;
}
