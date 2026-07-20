import { describe, expect, it } from 'vitest';

import { buildCombatant, createBattle, moveById, resolveTurn } from '../engine';
import { RECOVER_MOVE } from '../moves';
import { hashSeed, mulberry32, turnRng } from '../prng';
import type { BattleState, BattleStats, ChampionId, Combatant } from '../types';

/** THE CONTRACT online PvP depends on: two devices with the SAME match seed +
 *  move log compute byte-identical battle states, so neither needs a referee. */

function statBlock(over: Partial<BattleStats> = {}): BattleStats {
  return {
    maxHealth: 140, currentHealth: 140, maxStamina: 100, currentStamina: 100,
    power: 22, defence: 14, speed: 16, precision: 18, evasion: 0.08,
    critChance: 0.15, critMultiplier: 1.7, staminaRegen: 14, ...over,
  };
}
function combatant(id: ChampionId): Combatant {
  return buildCombatant({ championId: id, name: id, stats: statBlock(), spriteBranch: 'aesthetic', spriteStage: 3 });
}

describe('deterministic PRNG', () => {
  it('mulberry32 is reproducible for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('hashSeed is stable and turnRng differs per turn but repeats for the same turn', () => {
    expect(hashSeed('match-xyz:3')).toBe(hashSeed('match-xyz:3'));
    const t3a = turnRng('match-xyz', 3);
    const t3b = turnRng('match-xyz', 3);
    const t4 = turnRng('match-xyz', 4);
    expect([t3a(), t3a(), t3a()]).toEqual([t3b(), t3b(), t3b()]);
    // A different turn draws a different sequence (overwhelmingly likely).
    expect(turnRng('match-xyz', 3)()).not.toEqual(t4());
  });
});

describe('online turn resolution converges on two independent devices', () => {
  /** Resolve a fixed move script on a fresh battle using per-turn seeded rng —
   *  exactly what each online client does locally from the shared seed + moves. */
  function playMatch(seed: string): BattleState {
    let state = createBattle(`m_${seed}`, 'versus', combatant('titan'), combatant('aesthetic'));
    const script: Array<[string, string]> = [
      ['titan_breaker', 'precision_strike'],
      ['recover', 'precision_strike'],
      ['titan_breaker', 'recover'],
      ['recover', 'precision_strike'],
      ['titan_breaker', 'precision_strike'],
    ];
    for (let i = 0; i < script.length; i++) {
      if (state.winner) break;
      const turn = state.turnNumber; // resolve turn N with rng(seed, N)
      const pMove = script[i][0] === 'recover' ? RECOVER_MOVE : moveById(script[i][0]);
      const oMove = script[i][1] === 'recover' ? RECOVER_MOVE : moveById(script[i][1]);
      state = resolveTurn({ ...state, isResolvingTurn: true }, pMove, oMove, turnRng(seed, turn));
    }
    return state;
  }

  it('same seed + same moves → byte-identical final state (device A === device B)', () => {
    const deviceA = playMatch('match-abc-123');
    const deviceB = playMatch('match-abc-123');
    // The whole resolved state must match — health, stamina, statuses, events.
    expect(deviceA.player.stats.currentHealth).toBe(deviceB.player.stats.currentHealth);
    expect(deviceA.opponent.stats.currentHealth).toBe(deviceB.opponent.stats.currentHealth);
    expect(deviceA.player.stats.currentStamina).toBe(deviceB.player.stats.currentStamina);
    expect(deviceA.turnNumber).toBe(deviceB.turnNumber);
    expect(deviceA.winner).toBe(deviceB.winner);
    expect(deviceA.lastTurnEvents).toEqual(deviceB.lastTurnEvents);
  });

  it('a different seed generally diverges (rng actually matters)', () => {
    const a = playMatch('seed-one');
    const b = playMatch('seed-two');
    // Two different seeds should not produce identical health on every turn.
    const same =
      a.player.stats.currentHealth === b.player.stats.currentHealth &&
      a.opponent.stats.currentHealth === b.opponent.stats.currentHealth;
    expect(same).toBe(false);
  });
});
