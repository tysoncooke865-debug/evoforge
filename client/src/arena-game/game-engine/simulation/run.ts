/**
 * Headless battle runner + state digest. Runs a full battle from
 * (config, commands) to a guaranteed outcome without any UI.
 */
import type { BalanceConfig } from '../../content/balance';
import { checkInvariants } from './invariants';
import type { RejectedCommand, ScheduledCommand } from './events';
import { BattleOutcome, BattleState, createBattle, type BattleConfig } from './state';
import { advanceTick } from './tick';

export interface RunResult {
  outcome: BattleOutcome;
  state: BattleState;
  rejected: RejectedCommand[];
  /** FNV-1a digest of the final state — replay verification handle. */
  digest: number;
  /** True if the safety cap was hit (should never happen — engine bug). */
  stalled: boolean;
  invariantViolations: string[];
}

export interface RunOptions {
  /** Check invariants after every tick (default true; disable for bulk perf runs). */
  checkInvariantsEveryTick?: boolean;
}

/**
 * Prepares a command schedule exactly the way runBattle applies it: rejects
 * malformed schedule ticks up front (a NaN tick would also make the sort
 * comparator inconsistent — ticks in the past are execution-impossible;
 * ticks after an early finish are legitimately moot and NOT rejected), then
 * sorts by (tick, arrival index) explicitly so replay ordering never depends
 * on Array.prototype.sort stability on any JS engine. Same-tick order is
 * outcome-relevant (entity ids follow application order).
 *
 * Exported for incremental replay players (M8), which must step the exact
 * schedule runBattle would apply in one shot.
 */
export function prepareCommandSchedule(
  commands: readonly ScheduledCommand[],
  rejected: RejectedCommand[]
): ScheduledCommand[] {
  const valid: { c: ScheduledCommand; index: number }[] = [];
  let index = 0;
  for (const c of commands) {
    // Untrusted record data can contain null/non-object entries — skip them
    // rather than throw (the never-throw contract of every replay consumer).
    if (!c || typeof c !== 'object') continue;
    if (!Number.isInteger(c.tick) || c.tick < 1) {
      rejected.push({
        tick: c.tick,
        command: c.command ?? null,
        reason: `invalid scheduled tick ${c.tick}`,
      });
    } else if (!c.command || typeof c.command !== 'object') {
      // A valid tick with a null/missing command must reject up front too —
      // applyCommand also guards this, but rejecting here keeps the schedule
      // clean and the rejection visible (P4 fix).
      rejected.push({ tick: c.tick, command: null, reason: 'malformed command (not an object)' });
    } else {
      valid.push({ c, index: index++ });
    }
  }
  return valid.sort((a, b) => a.c.tick - b.c.tick || a.index - b.index).map((v) => v.c);
}

export function runBattle(
  config: BattleConfig,
  commands: readonly ScheduledCommand[],
  balance: BalanceConfig,
  options: RunOptions = {}
): RunResult {
  const check = options.checkInvariantsEveryTick ?? true;
  const state = createBattle(config, balance);
  const rejected: RejectedCommand[] = [];
  const violations: string[] = [];

  const sorted = prepareCommandSchedule(commands, rejected);

  // Timeout + sudden death guarantee termination; cap is a hard backstop.
  const maxTicks = balance.battle.durationTicks + balance.battle.suddenDeathTicks + 10;
  let stalled = false;

  while (state.phase !== 'finished') {
    advanceTick(state, balance, sorted, rejected);
    if (check) {
      const v = checkInvariants(state, balance);
      if (v.length > 0) violations.push(...v.map((x) => `tick ${state.tick}: ${x}`));
    }
    if (state.tick > maxTicks) {
      stalled = true;
      state.phase = 'finished';
      state.outcome = {
        winner: 'draw',
        reason: 'draw',
        endTick: state.tick,
        playerCoreHealth: state.cores.player.health,
        opponentCoreHealth: state.cores.opponent.health,
      };
      break;
    }
  }

  return {
    outcome: state.outcome!,
    state,
    rejected,
    digest: computeDigest(state),
    stalled,
    invariantViolations: violations,
  };
}

/**
 * Order-stable FNV-1a digest over everything gameplay-relevant. Two battles
 * with the same digest went through identical final states.
 */
export function computeDigest(state: BattleState): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    // Fold a float deterministically: fixed precision, then 32-bit FNV mix.
    const v = Math.round(n * 1000);
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  };

  const mixString = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };

  mix(state.tick);
  mix(state.teams.player.energy);
  mix(state.teams.opponent.energy);
  for (const team of ['player', 'opponent'] as const) {
    const cards = state.teams[team].cards;
    if (cards) {
      for (const id of cards.hand) mixString(id);
      for (const id of cards.queue) mixString(id);
    }
    // Augment offer/choice IS state (not derivable) — digest it. The derived
    // aura layer is deliberately NOT digested (recomputable).
    const augment = state.teams[team].augment;
    if (augment.offeredIds) {
      for (const id of augment.offeredIds) mixString(id);
    } else {
      mixString('(no-offer)');
    }
    mixString(augment.chosenId ?? '(no-choice)');
    mix(augment.chosenAtTick ?? -1);
  }
  mix(state.cores.player.health);
  mix(state.cores.opponent.health);
  mix(state.rng.getState());
  for (const u of state.units) {
    mix(u.id);
    mix(u.team === 'player' ? 1 : 2);
    mix(u.kind === 'champion' ? 1 : 0);
    mix(u.x);
    mix(u.health);
    mix(u.shield);
    mix(u.attackCooldownTicks);
    mix(u.alive ? 1 : 0);
    mix(u.lane);
    mix(u.stunUntilTick);
    for (const m of u.modifiers) {
      mix(m.expiresAtTick);
      mix(m.attackDamageMult ?? 1);
      mix(m.moveSpeedMult ?? 1);
      mix(m.attackIntervalMult ?? 1);
      mix(m.bonusMaxHealth ?? 0);
      mix(m.damageTakenMult ?? 1);
    }
    if (u.champion) {
      mixString(u.champion.definitionId);
      mix(u.champion.commandable ? 1 : 0);
      mix(u.champion.abilityCooldownTicks);
      mix(u.champion.ultimateCharge);
      mix(u.champion.respawnAtTick ?? -1);
      mix(u.champion.stanceShifts);
    }
  }
  if (state.outcome) {
    mix(state.outcome.endTick);
    mix(state.outcome.winner === 'player' ? 1 : state.outcome.winner === 'opponent' ? 2 : 3);
  }
  return h >>> 0;
}
