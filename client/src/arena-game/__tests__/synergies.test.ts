/**
 * Milestone 6 tests — the synergy aura layer. Pure TS (engine only).
 *
 * Covers: tag counting incl. champion tags and copies, mixed-paths distinct
 * counting, death-deactivation and reactivation on redeploy, logged
 * on/off transitions, armorFlat with the min-1 rule and the melee-only
 * frontline rule, healingMult math (direct + card + healer), move/damage
 * aura folding into effectiveStats and the tick pipeline, derived-not-
 * digested, and invariants staying clean throughout.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById } from '../content';
import { damageUnit, healUnit } from '../game-engine/combat/combat';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { applyCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest } from '../game-engine/simulation/run';
import { BattleState, createBattle, effectiveStats, UnitState } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { computeTeamAuras } from '../game-engine/synergies/synergies';

const config = { seed: 606, player: { playerId: 'p1' }, opponent: { playerId: 'p2' } };

function battle(playerChampionId?: string): BattleState {
  const state = createBattle(
    {
      seed: 606,
      player: { playerId: 'p1', championId: playerChampionId },
      opponent: { playerId: 'p2' },
    },
    BALANCE
  );
  state.teams.player.energy = 10;
  state.teams.opponent.energy = 10;
  return state;
}

function spawn(state: BattleState, cardId: string, lane: 0 | 1, x: number, team: 'player' | 'opponent' = 'player'): UnitState {
  return spawnUnitsForCard(state, BALANCE, getCardById(cardId)!, team, lane, x)[0];
}

describe('synergy counting', () => {
  it('starts neutral: no synergy from a lone champion, auras neutral in a fresh battle', () => {
    const state = battle('champion-titan');
    expect(state.auras.player.activeSynergyIds).toEqual([]);
    expect(state.auras.player.armorFlat).toBe(0);
    expect(state.auras.player.attackDamageMult).toBe(1);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('champion tags count toward thresholds: titan champion + 2 titan units = Titan Bulwark', () => {
    const state = battle('champion-titan');
    spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 0, 14);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('titan-bulwark');
    expect(state.auras.player.armorFlat).toBe(8);
    // The opponent team is unaffected.
    expect(state.auras.opponent.activeSynergyIds).toEqual([]);
    expect(state.log.some((l) => l.type === 'synergy-on' && l.detail === 'player titan-bulwark')).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('copies count as distinct combatants (2 titans stay below the threshold of 3)', () => {
    const state = battle();
    spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 1, 10);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).not.toContain('titan-bulwark');
  });

  it('support-network activates at 2 supports and boosts healing by 1.25', () => {
    const state = battle();
    spawn(state, 'cyber-medic', 0, 10);
    spawn(state, 'support-drone', 0, 14);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('support-network');
    expect(state.auras.player.healingMult).toBeCloseTo(1.25);
  });

  it('mass-presence activates at 2 mass combatants (heavy tanks carry the tag)', () => {
    const state = battle();
    spawn(state, 'heavy-tank', 0, 10);
    spawn(state, 'heavy-tank', 1, 14);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('mass-presence');
    expect(state.auras.player.activeSynergyIds).not.toContain('titan-bulwark'); // only 2 titans
    expect(state.auras.player.armorFlat).toBe(4);
    // The Mass Monster champion counts toward the threshold like any tag.
    const withChampion = battle('champion-mass');
    spawn(withChampion, 'heavy-tank', 0, 30);
    advanceTick(withChampion, BALANCE);
    expect(withChampion.auras.player.activeSynergyIds).toContain('mass-presence');
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('mixed-paths counts DISTINCT avatar paths, champion path included', () => {
    const state = battle('champion-titan');
    // Champion (titan) + cardio + shredder = 3 distinct paths.
    spawn(state, 'neon-boxer', 0, 10);
    spawn(state, 'shadow-striker', 1, 10);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('balanced-forge');
    expect(state.auras.player.attackDamageMult).toBeCloseTo(1.05);
  });

  it('mixed-paths needs distinct paths, not path-tagged bodies', () => {
    const state = battle();
    // Three cardio bodies: 1 distinct path — momentum on, balanced-forge off.
    spawn(state, 'neon-boxer', 0, 10);
    spawn(state, 'cardio-runner', 0, 14);
    spawn(state, 'blade-runner', 1, 10);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('cardio-momentum');
    expect(state.auras.player.activeSynergyIds).not.toContain('balanced-forge');
    expect(state.auras.player.moveSpeedMult).toBeCloseTo(1.15);
  });
});

describe('synergy death-deactivation and redeploy-reactivation', () => {
  it('deactivates when a member dies, reactivates on redeploy, transitions logged', () => {
    const state = battle('champion-titan');
    const guard = spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 0, 14);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('titan-bulwark');

    damageUnit(state, guard, 999999, 'test');
    expect(guard.alive).toBe(false);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).not.toContain('titan-bulwark');
    expect(state.auras.player.armorFlat).toBe(0);
    expect(state.log.some((l) => l.type === 'synergy-off' && l.detail === 'player titan-bulwark')).toBe(true);

    spawn(state, 'titan-guard', 1, 10);
    advanceTick(state, BALANCE);
    expect(state.auras.player.activeSynergyIds).toContain('titan-bulwark');
    const activations = state.log.filter(
      (l) => l.type === 'synergy-on' && l.detail === 'player titan-bulwark'
    );
    expect(activations.length).toBe(2);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });
});

describe('armorFlat', () => {
  function bulwarkBattle() {
    const state = battle('champion-titan');
    const guard = spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 0, 14);
    const archer = spawn(state, 'drone-archer', 1, 10);
    advanceTick(state, BALANCE);
    expect(state.auras.player.armorFlat).toBe(8);
    return { state, guard, archer };
  }

  it('reduces each hit flat for melee frontline, minimum 1 damage dealt', () => {
    const { state, guard } = bulwarkBattle();
    const before = guard.health;
    const big = damageUnit(state, guard, 50, 'test');
    expect(big.dealtToHealth).toBe(42); // 50 - 8
    const tiny = damageUnit(state, guard, 5, 'test');
    expect(tiny.dealtToHealth).toBe(1); // floored at 1, never 0 or negative
    expect(guard.health).toBe(before - 43);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('does not protect ranged (non-frontline) combatants', () => {
    const { state, archer } = bulwarkBattle();
    const result = damageUnit(state, archer, 50, 'test');
    expect(result.dealtToHealth).toBe(50);
  });

  it('applies before shields: the shield absorbs the post-armour amount', () => {
    const { state, guard } = bulwarkBattle();
    guard.shield = 30;
    const result = damageUnit(state, guard, 50, 'test');
    expect(result.dealtToShield).toBe(30);
    expect(result.dealtToHealth).toBe(12); // 50 - 8 - 30
  });
});

describe('healingMult', () => {
  it('healUnit scales by the multiplier and still clamps at base max health', () => {
    const state = battle();
    const unit = spawn(state, 'titan-guard', 0, 10);
    unit.health -= 200;
    expect(healUnit(unit, 100, 1.25)).toBe(125);
    unit.health = unit.baseMaxHealth - 10;
    expect(healUnit(unit, 100, 1.25)).toBe(10); // clamped
  });

  it('card heals scale with the receiving team aura (recovery-pulse 180 → 225)', () => {
    const state = battle();
    spawn(state, 'cyber-medic', 0, 10);
    spawn(state, 'support-drone', 0, 14);
    const wounded = spawn(state, 'titan-guard', 1, 10);
    wounded.health -= 400;
    advanceTick(state, BALANCE);
    state.teams.player.energy = 10;
    const before = wounded.health;
    const result = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'recovery-pulse',
      target: { kind: 'unit', unitId: wounded.id },
    });
    expect(result.ok).toBe(true);
    expect(wounded.health).toBe(before + 225);
  });

  it('healer units scale too: the medic beam heals attackDamage x aura', () => {
    const state = battle();
    const medic = spawn(state, 'cyber-medic', 0, 10);
    spawn(state, 'support-drone', 0, 30); // second support, out of medic range
    const wounded = spawn(state, 'titan-guard', 0, 12);
    wounded.health -= 500;
    // Tick 1: the medic heals once at the NEUTRAL rate (auras recompute at
    // end of tick) and starts its 24-tick heal cooldown.
    advanceTick(state, BALANCE);
    expect(state.auras.player.healingMult).toBeCloseTo(1.25);
    const before = wounded.health;
    // The next heal lands exactly when the cooldown elapses — under the aura.
    for (let i = 0; i < 25; i++) advanceTick(state, BALANCE);
    const healEntries = state.log.filter((l) => l.type === 'heal');
    expect(healEntries.length).toBe(2);
    expect(wounded.health - before).toBeCloseTo(medic.base.attackDamage * 1.25);
  });
});

describe('aura folding into stats and the tick pipeline', () => {
  it('effectiveStats folds aura damage and speed; omitting the aura keeps base', () => {
    const state = battle('champion-titan');
    const boxer = spawn(state, 'neon-boxer', 0, 10);
    spawn(state, 'shadow-striker', 1, 10);
    advanceTick(state, BALANCE); // balanced-forge on (3 paths)
    const withAura = effectiveStats(boxer, state.tick, state.auras.player);
    expect(withAura.attackDamage).toBeCloseTo(boxer.base.attackDamage * 1.05);
    const withoutAura = effectiveStats(boxer, state.tick);
    expect(withoutAura.attackDamage).toBeCloseTo(boxer.base.attackDamage);
  });

  it('active momentum makes units actually march 15% faster', () => {
    const state = battle();
    const boxer = spawn(state, 'neon-boxer', 0, 10);
    spawn(state, 'cardio-runner', 1, 10);
    spawn(state, 'blade-runner', 1, 14);
    advanceTick(state, BALANCE); // momentum activates at end of this tick
    const before = boxer.x;
    advanceTick(state, BALANCE);
    expect(boxer.x - before).toBeCloseTo(boxer.base.moveSpeedPerTick * 1.15, 8);
  });

  it('auras are derived state: mutating them does not change the digest', () => {
    const state = battle('champion-titan');
    spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 0, 14);
    advanceTick(state, BALANCE);
    const digest = computeDigest(state);
    state.auras.player.armorFlat += 100;
    state.auras.player.activeSynergyIds.push('cardio-momentum');
    expect(computeDigest(state)).toBe(digest);
  });

  it('computeTeamAuras is pure and matches the pipeline snapshot after a tick', () => {
    const state = battle('champion-titan');
    spawn(state, 'titan-guard', 0, 10);
    spawn(state, 'heavy-tank', 0, 14);
    advanceTick(state, BALANCE);
    expect(computeTeamAuras(state, 'player')).toEqual(state.auras.player);
    expect(computeTeamAuras(state, 'opponent')).toEqual(state.auras.opponent);
  });
});

describe('synergy battles stay deterministic and invariant-clean', () => {
  it('a synergy-heavy scripted battle runs clean with matching digests', () => {
    const run = () => {
      const state = createBattle(config, BALANCE);
      state.teams.player.energy = 10;
      state.teams.opponent.energy = 10;
      spawn(state, 'titan-guard', 0, 10);
      spawn(state, 'heavy-tank', 0, 14);
      spawn(state, 'neon-boxer', 0, 18);
      spawn(state, 'titan-guard', 0, 60, 'opponent');
      spawn(state, 'forge-recruit', 0, 70, 'opponent');
      for (let i = 0; i < 600 && state.phase !== 'finished'; i++) {
        advanceTick(state, BALANCE);
        const violations = checkInvariants(state, BALANCE);
        if (violations.length > 0) return { digest: -1, violations };
      }
      return { digest: computeDigest(state), violations: [] as string[] };
    };
    const a = run();
    const b = run();
    expect(a.violations).toEqual([]);
    expect(a.digest).toBe(b.digest);
  });
});
