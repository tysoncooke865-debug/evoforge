import { describe, expect, it } from 'vitest';

import { chooseAiMove, isMoveUsable } from '../ai';
import { computeDamage } from '../damage';
import { buildCombatant, createBattle, decideOrder, moveById, resolveTurn } from '../engine';
import { ALL_MOVES, RECOVER_MOVE, movesForChampion } from '../moves';
import { gymReward, rewardsFor } from '../rewards';
import { GYMS } from '../gyms';
import { CHAMPIONS } from '../champions';
import { createBattleStats } from '../stat-scaler';
import { applyStatus, tickStatuses } from '../status';
import type { BattleStats, ChampionId, Combatant } from '../types';

/** Deterministic RNG (mulberry32) so every test is exact. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const half = () => 0.5;

function statBlock(over: Partial<BattleStats> = {}): BattleStats {
  return {
    maxHealth: 110, currentHealth: 110, maxStamina: 100, currentStamina: 100,
    power: 20, defence: 14, speed: 16, precision: 18, evasion: 0.1,
    critChance: 0.15, critMultiplier: 1.7, staminaRegen: 14, ...over,
  };
}
function combatant(id: ChampionId, over: Partial<BattleStats> = {}): Combatant {
  return buildCombatant({ championId: id, name: id, stats: statBlock(over), spriteBranch: 'aesthetic', spriteStage: 3 });
}

describe('damage formula', () => {
  it('damage is never negative and never below 1 for a real attack', () => {
    const atk = combatant('aesthetic', { power: 1 });
    const def = combatant('titan', { defence: 999 });
    const r = computeDamage(moveById('precision_strike'), atk, def, seeded(1));
    expect(r.damage).toBeGreaterThanOrEqual(1);
  });

  it('higher defence reduces damage', () => {
    const atk = combatant('aesthetic');
    const soft = computeDamage(moveById('precision_strike'), atk, combatant('titan', { defence: 5 }), half);
    const hard = computeDamage(moveById('precision_strike'), atk, combatant('titan', { defence: 60 }), half);
    expect(hard.damage).toBeLessThan(soft.damage);
  });

  it('critical hits increase damage', () => {
    const atk = combatant('aesthetic');
    const def = combatant('titan');
    const normal = computeDamage(moveById('precision_strike'), atk, def, half, { forceCrit: false });
    const crit = computeDamage(moveById('precision_strike'), atk, def, half, { forceCrit: true });
    expect(crit.crit).toBe(true);
    expect(crit.damage).toBeGreaterThan(normal.damage);
  });
});

describe('turn system', () => {
  it('an unaffordable move is blocked (isMoveUsable + resolver no-op)', () => {
    const c = combatant('titan', { currentStamina: 2 });
    expect(isMoveUsable(moveById('titan_breaker'), c)).toBe(false);
    const state = createBattle('b', 'training', combatant('titan', { currentStamina: 2 }), combatant('aesthetic'));
    const after = resolveTurn(state, moveById('titan_breaker'), RECOVER_MOVE, seeded(3));
    expect(after.lastTurnEvents.some((e) => e.kind === 'no_stamina')).toBe(true);
    expect(after.turnNumber).toBe(1); // no turn advanced
  });

  it('move order respects priority over speed', () => {
    const slowHiPri = moveById('counter_pose'); // priority 2
    const fastLoPri = moveById('rapid_strike'); // priority 1
    const slowPlayer = combatant('aesthetic', { speed: 5 });
    const fastFoe = combatant('apex', { speed: 40 });
    // Player uses higher-priority move → acts first despite lower speed.
    expect(decideOrder(slowHiPri, fastLoPri, slowPlayer, fastFoe, half)).toBe(true);
  });

  it('move order respects speed at equal priority', () => {
    const a = moveById('precision_strike');
    const b = moveById('twin_slash'); // both priority 0
    expect(decideOrder(a, b, combatant('apex', { speed: 40 }), combatant('titan', { speed: 5 }), half)).toBe(true);
    expect(decideOrder(a, b, combatant('titan', { speed: 5 }), combatant('apex', { speed: 40 }), half)).toBe(false);
  });

  it('Recover is always usable, even at 0 stamina', () => {
    expect(isMoveUsable(RECOVER_MOVE, combatant('titan', { currentStamina: 0 }))).toBe(true);
  });

  it('stamina regenerates each end-of-turn but never past max', () => {
    const state = createBattle('b', 'training', combatant('apex', { currentStamina: 10, maxStamina: 100, staminaRegen: 20 }), combatant('titan'));
    const after = resolveTurn(state, RECOVER_MOVE, RECOVER_MOVE, seeded(7));
    // Recover(+35) then regen(+20) but clamped to max.
    expect(after.player.stats.currentStamina).toBeLessThanOrEqual(after.player.stats.maxStamina);
    expect(after.player.stats.currentStamina).toBeGreaterThan(10);
  });
});

describe('status effects', () => {
  it('bleed damages at end of turn', () => {
    const player = combatant('shredded');
    const opp = combatant('titan');
    applyStatus(opp, 'bleed', 3, 8);
    const state = createBattle('b', 'training', player, opp);
    const before = opp.stats.currentHealth;
    const after = resolveTurn(state, RECOVER_MOVE, RECOVER_MOVE, seeded(2));
    expect(after.opponent.stats.currentHealth).toBeLessThan(before);
    expect(after.opponent.statuses.find((s) => s.kind === 'bleed')?.turnsLeft).toBe(2);
  });

  it('statuses expire and never go negative', () => {
    const c = combatant('apex');
    applyStatus(c, 'overclocked', 1, 0.3);
    expect(tickStatuses(c)).toContain('overclocked');
    expect(c.statuses).toHaveLength(0);
    // Ticking an empty set is safe.
    expect(tickStatuses(c)).toEqual([]);
  });
});

describe('victory + defeat', () => {
  it('a defeated champion cannot act and victory triggers', () => {
    const player = combatant('titan', { power: 40 });
    const opp = combatant('aesthetic', { maxHealth: 8, currentHealth: 8, defence: 1, speed: 1 });
    const state = createBattle('b', 'gym', player, opp);
    const after = resolveTurn(state, moveById('forge_smash'), moveById('precision_strike'), seeded(9));
    expect(after.winner).toBe('player');
    expect(after.phase).toBe('victory');
    // The defeated opponent should not have landed its attack after dying.
    const oppDamage = after.stats.opponentDamage;
    expect(oppDamage).toBe(0);
  });

  it('the battle cannot continue after a winner is set', () => {
    const player = combatant('titan', { power: 60 });
    const opp = combatant('aesthetic', { maxHealth: 6, currentHealth: 6, defence: 1 });
    const state = createBattle('b', 'gym', player, opp);
    const won = resolveTurn(state, moveById('forge_smash'), RECOVER_MOVE, seeded(4));
    expect(won.winner).toBe('player');
    const again = resolveTurn(won, moveById('forge_smash'), RECOVER_MOVE, seeded(4));
    expect(again).toBe(won); // no-op, same reference
  });
});

describe('AI', () => {
  it('always returns a legal action (affordable + off cooldown)', () => {
    const rng = seeded(11);
    for (let i = 0; i < 200; i++) {
      const self = combatant((['aesthetic', 'titan', 'apex', 'shredded'] as const)[i % 4], { currentStamina: Math.floor(rng() * 100) });
      const foe = combatant('aesthetic', { currentHealth: Math.floor(rng() * 110) + 1 });
      const move = chooseAiMove(self, foe, (['balanced', 'aggressive', 'defensive'] as const)[i % 3], rng);
      const legal = move.id === 'recover' || (isMoveUsable(move, self) && movesForChampion(self.championId).includes(move));
      expect(legal).toBe(true);
    }
  });
});

describe('rewards anti-farm', () => {
  it('gym first-clear reward cannot be claimed twice', () => {
    const gym = GYMS[0];
    const first = gymReward(gym, true, false);
    expect(first.firstClear).toBe(true);
    expect(first.badgeId).toBe(gym.badgeId);
    expect(first.coins).toBe(gym.reward.coins);
    const repeat = gymReward(gym, true, true);
    expect(repeat.firstClear).toBeFalsy();
    expect(repeat.badgeId).toBeUndefined();
    expect(repeat.coins).toBeLessThan(first.coins);
  });
});

describe('stat scaler', () => {
  it('a real-stat champion never leaves the controlled contribution band', () => {
    const maxed = createBattleStats('aesthetic', { size: 100, aes: 100, str: 100, cnd: 100 }, 'training');
    const zero = createBattleStats('aesthetic', { size: 0, aes: 0, str: 0, cnd: 0 }, 'training');
    // At most ~20% above the zero-contribution block.
    expect(maxed.power).toBeLessThanOrEqual(zero.power * 1.21);
    expect(maxed.maxHealth).toBeLessThanOrEqual(zero.maxHealth * 1.21);
  });

  it('opponents normalise toward a target power, never walling out', () => {
    // Targets inside the scaler's clamp band (titan raw power ≈ 228).
    const weak = createBattleStats('titan', null, 'gym', { targetPower: 160 });
    const strong = createBattleStats('titan', null, 'gym', { targetPower: 260 });
    expect(strong.power).toBeGreaterThan(weak.power);
    // Clamped so identity survives — never absurdly beyond base.
    expect(strong.power).toBeLessThan(CHAMPION_POWER_CEIL);
    // Even an enormous target can't wall the player out (ratio clamps ≤ 1.4×).
    const huge = createBattleStats('titan', null, 'gym', { targetPower: 9000 });
    expect(huge.power).toBeLessThan(CHAMPION_POWER_CEIL);
  });
});

const CHAMPION_POWER_CEIL = 200; // sanity ceiling; scaler clamps ratio to 1.4×

describe('catalog integrity', () => {
  it('every champion has exactly four moves and every move id resolves', () => {
    for (const id of ['aesthetic', 'titan', 'apex', 'shredded'] as const) {
      expect(movesForChampion(id)).toHaveLength(4);
      for (const m of movesForChampion(id)) expect(ALL_MOVES[m.id]).toBe(m);
    }
  });
});

describe('versus + champion mapping (Tyson beta)', () => {
  it('versus battles pay nothing (bragging rights only)', () => {
    expect(rewardsFor('versus', true, {})).toEqual({ coins: 0, forgeXp: 0 });
    expect(rewardsFor('versus', false, {})).toEqual({ coins: 0, forgeXp: 0 });
  });
  it('each battle champion maps to a real sprite branch', () => {
    const branches = (['aesthetic', 'titan', 'apex', 'shredded'] as const).map((id) => CHAMPIONS[id].spriteBranch);
    expect(branches).toEqual(['aesthetic', 'titan', 'cardio', 'shredder']);
  });
});
