import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById } from '../content';
import { addShield, damageUnit } from '../game-engine/combat/combat';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import {
  applyCommand,
  BattleCommand,
  ScheduledCommand,
  validateDeployPosition,
} from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import { createBattle, effectiveStats } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';

const config = { seed: 1234, player: { playerId: 'p1' }, opponent: { playerId: 'p2' } };

function deploy(
  tick: number,
  team: 'player' | 'opponent',
  cardId: string,
  lane: 0 | 1,
  x: number
): ScheduledCommand {
  return { tick, command: { type: 'deploy-card', team, cardId, lane, x } };
}

/**
 * A busy, symmetric-ish battle used by several tests. Deploy ticks are chosen
 * so every command is affordable under the current energy balance — the
 * determinism test asserts rejected === [] to keep this honest.
 */
function busyCommands(): ScheduledCommand[] {
  const L = BALANCE.arena.laneLength;
  return [
    deploy(10, 'player', 'forge-recruit', 0, 10),
    deploy(10, 'opponent', 'forge-recruit', 0, L - 10),
    deploy(80, 'player', 'titan-guard', 1, 5),
    deploy(100, 'opponent', 'drone-archer', 1, L - 8),
    deploy(260, 'player', 'cardio-runner', 0, 20),
    deploy(280, 'opponent', 'neon-boxer', 0, L - 20),
    deploy(500, 'player', 'cyber-medic', 1, 10),
    deploy(560, 'opponent', 'heavy-tank', 1, L - 5),
    deploy(750, 'player', 'shadow-striker', 0, 15),
    deploy(900, 'opponent', 'blade-runner', 0, L - 12),
  ];
}

describe('deterministic battle engine', () => {
  it('an empty battle resolves to a draw through sudden death', () => {
    const result = runBattle(config, [], BALANCE);
    expect(result.outcome.winner).toBe('draw');
    expect(result.stalled).toBe(false);
    expect(result.invariantViolations).toEqual([]);
    expect(result.outcome.endTick).toBe(
      BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks
    );
  });

  it('same seed and commands produce identical results and digests', () => {
    const a = runBattle(config, busyCommands(), BALANCE);
    const b = runBattle(config, busyCommands(), BALANCE);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantViolations).toEqual([]);
    // The fixture must actually play out as authored — a balance change that
    // starves any scripted deploy should fail loudly, not hollow out the test.
    expect(a.rejected).toEqual([]);
  });

  it('different commands produce a different battle', () => {
    const a = runBattle(config, busyCommands(), BALANCE);
    const b = runBattle(config, busyCommands().slice(0, 4), BALANCE);
    expect(a.digest).not.toBe(b.digest);
  });

  it('one-sided pressure destroys the enemy core', () => {
    const commands: ScheduledCommand[] = [];
    for (let i = 0; i < 8; i++) {
      commands.push(deploy(100 + i * 300, 'player', 'cardio-runner', 0, 30));
      commands.push(deploy(150 + i * 300, 'player', 'heavy-tank', 0, 30));
    }
    const result = runBattle(config, commands, BALANCE);
    expect(result.outcome.winner).toBe('player');
    expect(result.outcome.reason).toBe('core-destroyed');
    expect(result.outcome.opponentCoreHealth).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('timeout with unequal core health picks the healthier side (both directions)', () => {
    // Pre-damage one core and let an otherwise-empty battle run to the timer.
    for (const [damaged, expectedWinner] of [
      ['opponent', 'player'],
      ['player', 'opponent'],
    ] as const) {
      const state = createBattle(config, BALANCE);
      state.cores[damaged].health -= 500;
      while (state.phase !== 'finished') advanceTick(state, BALANCE);
      expect(state.outcome!.reason).toBe('timeout-core-health');
      expect(state.outcome!.winner).toBe(expectedWinner);
      expect(state.outcome!.endTick).toBe(BALANCE.battle.durationTicks);
    }
  });

  it('sudden death: first core damage decides, and deploys during SD are legal', () => {
    const result = runBattle(
      config,
      [deploy(BALANCE.battle.durationTicks + 20, 'player', 'cardio-runner', 0, 30)],
      BALANCE
    );
    expect(result.rejected).toEqual([]);
    expect(result.outcome.winner).toBe('player');
    expect(result.outcome.reason).toBe('sudden-death');
    expect(result.outcome.endTick).toBeGreaterThan(BALANCE.battle.durationTicks);
    expect(result.outcome.endTick).toBeLessThan(
      BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks
    );
    expect(result.invariantViolations).toEqual([]);
  });

  it('units fight and the survivor pushes on — no dead targeting', () => {
    const L = BALANCE.arena.laneLength;
    const result = runBattle(
      config,
      [
        deploy(10, 'player', 'neon-boxer', 0, 30),
        deploy(10, 'opponent', 'forge-recruit', 0, L - 30),
      ],
      BALANCE
    );
    // Invariants (checked every tick) include "never target dead entities".
    expect(result.invariantViolations).toEqual([]);
    const deaths = result.state.log.filter((l) => l.type === 'death');
    expect(deaths.length).toBeGreaterThan(0);
  });

  it('battles always produce exactly one valid outcome', () => {
    for (const seed of [1, 7, 42, 999, 31337]) {
      const result = runBattle({ ...config, seed }, busyCommands(), BALANCE);
      expect(result.outcome).not.toBeNull();
      expect(['player', 'opponent', 'draw']).toContain(result.outcome.winner);
      expect(result.stalled).toBe(false);
    }
  });
});

describe('command validation', () => {
  function freshState() {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    return state;
  }

  it('rejects unknown cards', () => {
    const result = applyCommand(freshState(), BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'nope',
      lane: 0,
      x: 10,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects deployment outside the deploy zone', () => {
    const state = freshState();
    const tooDeep = BALANCE.arena.deployZoneDepth + 1;
    const result = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'forge-recruit',
      lane: 0,
      x: tooDeep,
    });
    expect(result.ok).toBe(false);
    expect(state.units.length).toBe(0);
  });

  it('rejects deployment without enough energy', () => {
    const state = freshState();
    state.teams.player.energy = 1;
    const result = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'heavy-tank',
      lane: 0,
      x: 10,
    });
    expect(result.ok).toBe(false);
    expect(state.teams.player.energy).toBe(1);
  });

  it('deploy costs energy and spawns the right unit count', () => {
    const state = freshState();
    const before = state.teams.player.energy;
    const result = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'forge-recruit',
      lane: 1,
      x: 10,
    });
    expect(result.ok).toBe(true);
    expect(state.units.length).toBe(2); // deployCount 2
    expect(state.teams.player.energy).toBeCloseTo(before - 2);
    expect(new Set(state.units.map((u) => u.id)).size).toBe(2);
  });

  it('rejected commands are recorded, not silently dropped', () => {
    const result = runBattle(
      config,
      [deploy(5, 'player', 'heavy-tank', 0, 10), deploy(6, 'player', 'heavy-tank', 0, 10)],
      BALANCE
    );
    // Starting energy (~5.2 by tick 5) cannot afford even one heavy tank (6).
    expect(result.rejected.length).toBe(2);
  });

  it('accept-then-reject at the energy boundary (spend happens before the next check)', () => {
    const state = freshState();
    state.teams.player.energy = 6;
    const cmd: BattleCommand = {
      type: 'deploy-card',
      team: 'player',
      cardId: 'heavy-tank',
      lane: 0,
      x: 10,
    };
    expect(applyCommand(state, BALANCE, cmd).ok).toBe(true);
    expect(state.teams.player.energy).toBeCloseTo(0);
    const second = applyCommand(state, BALANCE, cmd);
    expect(second.ok).toBe(false);
    expect(state.units.length).toBe(1);
  });

  it('opponent-side deploy zone is mirrored and enforced', () => {
    const L = BALANCE.arena.laneLength;
    const D = BALANCE.arena.deployZoneDepth;
    const state = freshState();
    const attempt = (x: number) =>
      applyCommand(state, BALANCE, {
        type: 'deploy-card',
        team: 'opponent',
        cardId: 'forge-recruit',
        lane: 0,
        x,
      });
    expect(attempt(10).ok).toBe(false); // player half — illegal
    expect(attempt(L - D - 1).ok).toBe(false); // just outside the zone
    expect(state.units.length).toBe(0);
    expect(attempt(L - 10).ok).toBe(true);
    expect(state.units.length).toBeGreaterThan(0);
  });

  it('validateDeployPosition boundaries for both teams', () => {
    const L = BALANCE.arena.laneLength;
    const D = BALANCE.arena.deployZoneDepth;
    expect(validateDeployPosition(BALANCE, 'player', 0).ok).toBe(true);
    expect(validateDeployPosition(BALANCE, 'player', D).ok).toBe(true);
    expect(validateDeployPosition(BALANCE, 'player', D + 0.1).ok).toBe(false);
    expect(validateDeployPosition(BALANCE, 'opponent', L).ok).toBe(true);
    expect(validateDeployPosition(BALANCE, 'opponent', L - D).ok).toBe(true);
    expect(validateDeployPosition(BALANCE, 'opponent', L - D - 0.1).ok).toBe(false);
    expect(validateDeployPosition(BALANCE, 'player', NaN).ok).toBe(false);
  });

  it('core exclusion radius triggers when the deploy zone reaches the enemy core', () => {
    // Unreachable with shipped balance (zone ends 60 from the enemy core);
    // verify the safety net with a deep deploy zone.
    const deepZone = {
      ...BALANCE,
      arena: { ...BALANCE.arena, deployZoneDepth: 95 },
    };
    expect(validateDeployPosition(deepZone, 'player', 92).ok).toBe(false);
    expect(validateDeployPosition(deepZone, 'player', 88).ok).toBe(true);
    expect(validateDeployPosition(deepZone, 'opponent', 8).ok).toBe(false);
    expect(validateDeployPosition(deepZone, 'opponent', 12).ok).toBe(true);
  });

  it('unknown command types are rejected, never thrown (replay safety)', () => {
    const result = runBattle(
      config,
      [{ tick: 10, command: { type: 'mystery', team: 'player' } as unknown as BattleCommand }],
      BALANCE
    );
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain('unknown command type');
  });

  it('malformed team ids are rejected, never thrown (replay safety)', () => {
    const result = runBattle(
      config,
      [
        {
          tick: 10,
          command: {
            type: 'deploy-card',
            team: 'hacker',
            cardId: 'forge-recruit',
            lane: 0,
            x: 70,
          } as unknown as BattleCommand,
        },
      ],
      BALANCE
    );
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain('invalid team');
    expect(result.state.units.length).toBe(0);
  });

  it('malformed schedule ticks are rejected up front, never silently dropped', () => {
    const cmd = (tick: number): ScheduledCommand => ({
      tick,
      command: { type: 'noop', team: 'player' },
    });
    const result = runBattle(config, [cmd(0), cmd(-5), cmd(1.5), cmd(NaN)], BALANCE);
    expect(result.rejected.length).toBe(4);
    for (const r of result.rejected) {
      expect(r.reason).toContain('invalid scheduled tick');
    }
    expect(result.stalled).toBe(false);
  });

  it('schedule entries with a valid tick but null/missing command are rejected, never thrown (P4)', () => {
    // {tick:5} and {tick:5, command:null} used to pass prepareCommandSchedule
    // and TypeError inside applyCommand at command.team — a contract breach
    // (commands are rejected, never thrown).
    const poisoned = [
      { tick: 5 },
      { tick: 6, command: null },
      { tick: 7, command: 'noop' },
    ] as unknown as ScheduledCommand[];
    const result = runBattle(config, poisoned, BALANCE);
    expect(result.stalled).toBe(false);
    expect(result.rejected.length).toBe(3);
    for (const r of result.rejected) {
      expect(r.reason).toContain('malformed command');
      expect(r.command).toBeNull();
    }
    // applyCommand itself guards consumers that reach advanceTick without
    // prepareCommandSchedule (the live path).
    expect(applyCommand(freshState(), BALANCE, null as unknown as BattleCommand)).toEqual({
      ok: false,
      reason: 'malformed command (not an object)',
    });
    expect(applyCommand(freshState(), BALANCE, undefined as unknown as BattleCommand)).toEqual({
      ok: false,
      reason: 'malformed command (not an object)',
    });
  });
});

describe('energy regeneration', () => {
  it('caps at max and never goes invalid', () => {
    const state = createBattle(config, BALANCE);
    for (let i = 0; i < 2000; i++) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
      if (state.phase === 'finished') break;
    }
    expect(state.teams.player.energy).toBeLessThanOrEqual(BALANCE.energy.max);
    expect(state.teams.player.energy).toBeGreaterThan(0);
  });
});

describe('unit behaviours', () => {
  const L = BALANCE.arena.laneLength;

  it('core-only units walk past enemies and hit the core', () => {
    const result = runBattle(
      config,
      [
        deploy(10, 'player', 'cardio-runner', 0, 30),
        // Enemy tank sits mid-lane in the same lane; runner must ignore it.
        deploy(10, 'opponent', 'titan-guard', 0, L - 35),
      ],
      BALANCE
    );
    // The runner must have chipped the core (it got past the tank)...
    expect(result.outcome.opponentCoreHealth).toBeLessThan(BALANCE.core.maxHealth);
    // ...and must never have attacked a unit on the way.
    const runnerKills = result.state.log.filter(
      (l) => l.type === 'death' && l.detail.includes('killed by cardio-runner')
    );
    expect(runnerKills).toEqual([]);
  });

  it('healers heal wounded allies', () => {
    const result = runBattle(
      config,
      [
        deploy(10, 'player', 'titan-guard', 0, 30),
        // Deployed after energy has regenerated past the medic's cost.
        deploy(300, 'player', 'cyber-medic', 0, 25),
        deploy(10, 'opponent', 'neon-boxer', 0, L - 30),
      ],
      BALANCE
    );
    const heals = result.state.log.filter((l) => l.type === 'heal');
    expect(heals.length).toBeGreaterThan(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('digest reflects state exactly (computeDigest is stable)', () => {
    const a = runBattle(config, busyCommands(), BALANCE);
    expect(computeDigest(a.state)).toBe(a.digest);
  });
});

describe('movement', () => {
  function spawnOne(state: ReturnType<typeof createBattle>, team: 'player' | 'opponent', lane: 0 | 1, x: number) {
    const card = getCardById('titan-guard')!;
    return spawnUnitsForCard(state, BALANCE, card, team, lane, x)[0];
  }

  it('units march toward the enemy core at exactly moveSpeedPerTick', () => {
    const state = createBattle(config, BALANCE);
    // Different lanes so no aggro interaction.
    const p = spawnOne(state, 'player', 0, 20);
    const o = spawnOne(state, 'opponent', 1, 80);
    const speed = p.base.moveSpeedPerTick;
    const px = p.x;
    const ox = o.x;
    const N = 50;
    for (let i = 0; i < N; i++) advanceTick(state, BALANCE);
    expect(p.x).toBeCloseTo(px + N * speed, 8);
    expect(o.x).toBeCloseTo(ox - N * speed, 8);
  });

  it('moveToward lands exactly on the target, never overshooting', () => {
    const state = createBattle(config, BALANCE);
    const p = spawnOne(state, 'player', 0, 10);
    const o = spawnOne(state, 'opponent', 0, 30);
    p.base.moveSpeedPerTick = 50; // absurd speed to force the overshoot case
    advanceTick(state, BALANCE);
    expect(p.x).toBe(30); // stepped exactly onto the target, not past it
  });

  it('positions stay clamped inside the lane through a long battle', () => {
    const result = runBattle(config, busyCommands(), BALANCE);
    // Invariants (checked every tick) include position bounds.
    expect(result.invariantViolations).toEqual([]);
    for (const u of result.state.units) {
      expect(u.x).toBeGreaterThanOrEqual(0);
      expect(u.x).toBeLessThanOrEqual(BALANCE.arena.laneLength);
    }
  });

  it('multi-unit fan-out never stacks units, even at deploy-zone edges', () => {
    const state = createBattle(config, BALANCE);
    const card = getCardById('forge-recruit')!; // deployCount 2
    const atEdge = spawnUnitsForCard(state, BALANCE, card, 'player', 0, 0);
    expect(atEdge[0].x).not.toBe(atEdge[1].x);
    const oppEdge = spawnUnitsForCard(
      state,
      BALANCE,
      card,
      'opponent',
      1,
      BALANCE.arena.laneLength
    );
    expect(oppEdge[0].x).not.toBe(oppEdge[1].x);
  });
});

describe('attack cadence', () => {
  it('first hit lands on contact, then exactly every attackIntervalTicks', () => {
    const state = createBattle(config, BALANCE);
    const card = getCardById('titan-guard')!;
    const unit = spawnUnitsForCard(state, BALANCE, card, 'player', 0, 30)[0];
    unit.x = BALANCE.arena.laneLength - 1; // adjacent to the opponent core
    const interval = card.unit!.stats.attackIntervalTicks;
    const hits: number[] = [];
    let lastHealth = state.cores.opponent.health;
    for (let i = 0; i < interval * 5 + 2; i++) {
      advanceTick(state, BALANCE);
      if (state.cores.opponent.health < lastHealth) {
        hits.push(state.tick);
        lastHealth = state.cores.opponent.health;
      }
    }
    expect(hits.length).toBe(6); // immediate first hit + 5 interval hits
    expect(hits[0]).toBe(1);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i] - hits[i - 1]).toBe(interval);
    }
  });
});

describe('stun', () => {
  it('a stunned unit neither moves nor attacks, then resumes on the wake tick', () => {
    const state = createBattle(config, BALANCE);
    const card = getCardById('titan-guard')!;
    const unit = spawnUnitsForCard(state, BALANCE, card, 'player', 0, 30)[0];
    unit.x = BALANCE.arena.laneLength - 1;
    advanceTick(state, BALANCE); // attacks immediately
    const healthAfterFirstHit = state.cores.opponent.health;
    expect(healthAfterFirstHit).toBeLessThan(BALANCE.core.maxHealth);

    const stunTicks = 40; // longer than the 32-tick attack interval
    unit.stunUntilTick = state.tick + stunTicks;
    const frozenX = unit.x;
    // Stunned while tick < stunUntilTick: that is stunTicks - 1 further ticks
    // from here (the current tick already happened).
    for (let i = 0; i < stunTicks - 1; i++) {
      advanceTick(state, BALANCE);
      expect(unit.x).toBe(frozenX);
    }
    // No attacks landed during the stun.
    expect(state.cores.opponent.health).toBe(healthAfterFirstHit);
    // Pinned semantics: cooldown recovers during stun, so the unit attacks on
    // the first tick it wakes.
    advanceTick(state, BALANCE);
    expect(state.cores.opponent.health).toBeLessThan(healthAfterFirstHit);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });
});

describe('modifiers', () => {
  it('effectiveStats stacks live modifiers and ignores expired ones', () => {
    const state = createBattle(config, BALANCE);
    const unit = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    unit.modifiers.push(
      { sourceId: 'a', expiresAtTick: 100, attackDamageMult: 2 },
      { sourceId: 'b', expiresAtTick: 100, attackDamageMult: 1.5, moveSpeedMult: 2 },
      { sourceId: 'expired', expiresAtTick: 0, attackDamageMult: 10 }
    );
    const stats = effectiveStats(unit, 1);
    expect(stats.attackDamage).toBeCloseTo(unit.base.attackDamage * 3);
    expect(stats.moveSpeedPerTick).toBeCloseTo(unit.base.moveSpeedPerTick * 2);
  });

  it('attack interval floors at 1 tick under extreme haste', () => {
    const state = createBattle(config, BALANCE);
    const unit = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    unit.modifiers.push({ sourceId: 'haste', expiresAtTick: 100, attackIntervalMult: 0.001 });
    expect(effectiveStats(unit, 1).attackIntervalTicks).toBe(1);
  });

  it('bonus max health expiry clamps health back down without invariant violations', () => {
    const state = createBattle(config, BALANCE);
    const unit = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    const expiry = state.tick + 10;
    unit.modifiers.push({ sourceId: 'armour', expiresAtTick: expiry, bonusMaxHealth: 300 });
    unit.health = unit.baseMaxHealth + 200; // boosted above base max
    for (let i = 0; i < 15; i++) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
    }
    expect(unit.health).toBe(unit.baseMaxHealth);
    expect(unit.modifiers.length).toBe(0); // expired modifiers are pruned
  });

  it('battles with injected modifiers stay deterministic', () => {
    const run = () => {
      const state = createBattle(config, BALANCE);
      const u = spawnUnitsForCard(state, BALANCE, getCardById('neon-boxer')!, 'player', 0, 30)[0];
      u.modifiers.push({ sourceId: 'belt', expiresAtTick: 500, attackDamageMult: 1.35 });
      spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'opponent', 0, 70);
      for (let i = 0; i < 1000 && state.phase !== 'finished'; i++) advanceTick(state, BALANCE);
      return computeDigest(state);
    };
    expect(run()).toBe(run());
  });
});

describe('shields', () => {
  function unitOnBattle() {
    const state = createBattle(config, BALANCE);
    const unit = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    return { state, unit };
  }

  it('partial absorption: shield soaks first, overflow hits health', () => {
    const { state, unit } = unitOnBattle();
    addShield(unit, 100);
    const startHealth = unit.health;
    const result = damageUnit(state, unit, 120, 'test');
    expect(result.dealtToShield).toBe(100);
    expect(result.dealtToHealth).toBe(20);
    expect(unit.shield).toBe(0);
    expect(unit.health).toBe(startHealth - 20);
    expect(result.killed).toBe(false);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('full absorption leaves health untouched', () => {
    const { state, unit } = unitOnBattle();
    addShield(unit, 200);
    const startHealth = unit.health;
    const result = damageUnit(state, unit, 150, 'test');
    expect(unit.health).toBe(startHealth);
    expect(unit.shield).toBe(50);
    expect(result.killed).toBe(false);
  });

  it('kill-through-shield resolves death correctly', () => {
    const { state, unit } = unitOnBattle();
    unit.health = 5;
    addShield(unit, 10);
    const result = damageUnit(state, unit, 1000, 'test');
    expect(result.killed).toBe(true);
    expect(unit.alive).toBe(false);
    expect(unit.health).toBe(0);
    expect(unit.targetId).toBeNull();
    expect(state.log.some((l) => l.type === 'death')).toBe(true);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('addShield ignores dead units and non-positive amounts', () => {
    const { unit } = unitOnBattle();
    addShield(unit, -50);
    expect(unit.shield).toBe(0);
    unit.alive = false;
    unit.health = 0;
    addShield(unit, 100);
    expect(unit.shield).toBe(0);
  });
});

describe('energy rates', () => {
  it('regenerates at exactly regenPerTick before the final minute', () => {
    const state = createBattle(config, BALANCE);
    state.teams.player.energy = 0;
    const N = 28;
    for (let i = 0; i < N; i++) advanceTick(state, BALANCE);
    expect(state.teams.player.energy).toBeCloseTo(N * BALANCE.energy.regenPerTick, 9);
  });

  it('final-minute regen multiplier kicks in at finalMinuteStartTick', () => {
    const state = createBattle(config, BALANCE);
    state.tick = BALANCE.energy.finalMinuteStartTick;
    state.teams.player.energy = 0;
    const N = 28;
    for (let i = 0; i < N; i++) advanceTick(state, BALANCE);
    expect(state.teams.player.energy).toBeCloseTo(
      N * BALANCE.energy.regenPerTick * BALANCE.energy.finalMinuteRegenMult,
      9
    );
  });

  it('float drift at exact affordability boundaries never rejects a fair spend', () => {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    // Simulate iterative accumulation to exactly the card's cost in rational
    // math — the float sum may land a hair under.
    state.teams.player.energy = 0;
    const steps = Math.round(2 / BALANCE.energy.regenPerTick);
    for (let i = 0; i < steps; i++) state.teams.player.energy += BALANCE.energy.regenPerTick;
    const result = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'forge-recruit', // cost 2
      lane: 0,
      x: 10,
    });
    expect(result.ok).toBe(true);
    expect(state.teams.player.energy).toBeGreaterThanOrEqual(0);
  });
});
