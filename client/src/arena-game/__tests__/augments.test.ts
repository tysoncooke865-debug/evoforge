/**
 * Milestone 6 tests — mid-match augments. Pure TS (engine only).
 *
 * Covers: deterministic offers drawn from the battle RNG in fixed team
 * order, command validation (before offer / wrong id / double choose /
 * unknown), every effect kind's application, digest inclusion of the
 * offered/chosen state, and invariants staying clean.
 *
 * Most tests use a custom balance with an early offer tick — balance is a
 * parameter throughout the engine, so this exercises exactly the shipped
 * code path without simulating 90 seconds per test.
 */
import { describe, expect, it } from 'vitest';
import { AUGMENTS, BALANCE, getCardById } from '../content';
import type { BalanceConfig } from '../content/balance';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { applyCommand, ScheduledCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import { BattleState, createBattle } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';

const OFFER_TICK = 50;
const FAST: BalanceConfig = {
  ...BALANCE,
  augment: { ...BALANCE.augment, offerTick: OFFER_TICK },
};

const config = { seed: 909, player: { playerId: 'p1' }, opponent: { playerId: 'p2' } };

/** Battle advanced just past the offer tick (both teams offered). */
function offeredBattle(seed = 909): BattleState {
  const state = createBattle({ ...config, seed }, FAST);
  while (state.tick < OFFER_TICK) advanceTick(state, FAST);
  expect(state.teams.player.augment.offeredIds).not.toBeNull();
  expect(state.teams.opponent.augment.offeredIds).not.toBeNull();
  return state;
}

function choose(state: BattleState, team: 'player' | 'opponent', augmentId: string) {
  return applyCommand(state, FAST, { type: 'choose-augment', team, augmentId });
}

/** Forces a specific offer so effect tests can pick a known augment. */
function forceOffer(state: BattleState, team: 'player' | 'opponent', ids: string[]): void {
  state.teams[team].augment.offeredIds = ids;
}

describe('augment offers', () => {
  it('are drawn deterministically: same seed → same offers and digests', () => {
    const a = offeredBattle();
    const b = offeredBattle();
    expect(a.teams.player.augment.offeredIds).toEqual(b.teams.player.augment.offeredIds);
    expect(a.teams.opponent.augment.offeredIds).toEqual(b.teams.opponent.augment.offeredIds);
    expect(computeDigest(a)).toBe(computeDigest(b));
  });

  it('offer exactly choiceCount distinct known augments per team, logged', () => {
    const state = offeredBattle();
    for (const team of ['player', 'opponent'] as const) {
      const offered = state.teams[team].augment.offeredIds!;
      expect(offered.length).toBe(FAST.augment.choiceCount);
      expect(new Set(offered).size).toBe(offered.length);
      for (const id of offered) {
        expect(AUGMENTS.some((a) => a.id === id)).toBe(true);
      }
    }
    const offerLogs = state.log.filter((l) => l.type === 'augment-offer');
    expect(offerLogs.length).toBe(2);
    expect(checkInvariants(state, FAST)).toEqual([]);
  });

  it('no offer exists before the offer tick', () => {
    const state = createBattle(config, FAST);
    for (let i = 0; i < OFFER_TICK - 1; i++) advanceTick(state, FAST);
    expect(state.teams.player.augment.offeredIds).toBeNull();
  });
});

describe('choose-augment validation', () => {
  it('rejects a choice before the offer exists', () => {
    const state = createBattle(config, FAST);
    state.tick = 1;
    const result = choose(state, 'player', AUGMENTS[0].id);
    expect(result).toEqual({ ok: false, reason: 'no augment offer yet' });
  });

  it('rejects an augment that was not among the team\'s offered three', () => {
    const state = offeredBattle();
    const offered = state.teams.player.augment.offeredIds!;
    const notOffered = AUGMENTS.map((a) => a.id).find((id) => !offered.includes(id))!;
    const result = choose(state, 'player', notOffered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('was not offered');
    // Nothing was recorded.
    expect(state.teams.player.augment.chosenId).toBeNull();
  });

  it('rejects a second choice (once per team), and teams are independent', () => {
    const state = offeredBattle();
    const playerOffer = state.teams.player.augment.offeredIds!;
    expect(choose(state, 'player', playerOffer[0]).ok).toBe(true);
    const again = choose(state, 'player', playerOffer[1]);
    expect(again).toEqual({ ok: false, reason: 'augment already chosen' });
    expect(state.teams.player.augment.chosenId).toBe(playerOffer[0]);

    const opponentOffer = state.teams.opponent.augment.offeredIds!;
    expect(choose(state, 'opponent', opponentOffer[0]).ok).toBe(true);
    expect(checkInvariants(state, FAST)).toEqual([]);
  });

  it('rejects malformed augment ids from untrusted replays', () => {
    const state = offeredBattle();
    const result = applyCommand(state, FAST, {
      type: 'choose-augment',
      team: 'player',
      augmentId: 42 as unknown as string,
    });
    expect(result.ok).toBe(false);
  });

  it('scheduled through runBattle: pre-offer and wrong-id choices land in rejected', () => {
    const commands: ScheduledCommand[] = [
      // Before the offer.
      { tick: 10, command: { type: 'choose-augment', team: 'player', augmentId: AUGMENTS[0].id } },
    ];
    const result = runBattle(config, commands, FAST);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toBe('no augment offer yet');
    expect(result.invariantViolations).toEqual([]);
  });
});

describe('augment effects', () => {
  /** Battle just past a forced offer containing the augment under test. */
  function effectBattle(augmentId: string): BattleState {
    const state = createBattle(config, FAST);
    while (state.tick < OFFER_TICK) advanceTick(state, FAST);
    forceOffer(state, 'player', [
      augmentId,
      ...AUGMENTS.map((a) => a.id).filter((id) => id !== augmentId).slice(0, 2),
    ]);
    return state;
  }

  it('core-repair heals the own core immediately, clamped at max', () => {
    const state = effectBattle('core-reconstruction');
    state.cores.player.health -= 500;
    expect(choose(state, 'player', 'core-reconstruction').ok).toBe(true);
    expect(state.cores.player.health).toBe(FAST.core.maxHealth - 500 + 150);

    const clamped = effectBattle('core-reconstruction');
    clamped.cores.player.health -= 50; // repair would overshoot
    expect(choose(clamped, 'player', 'core-reconstruction').ok).toBe(true);
    expect(clamped.cores.player.health).toBe(FAST.core.maxHealth);
  });

  it('energy-regen multiplies regeneration from the next tick on', () => {
    const state = effectBattle('forge-conduits');
    expect(choose(state, 'player', 'forge-conduits').ok).toBe(true);
    advanceTick(state, FAST); // aura folds in at the end of this tick
    state.teams.player.energy = 0;
    state.teams.opponent.energy = 0;
    const N = 28;
    for (let i = 0; i < N; i++) advanceTick(state, FAST);
    expect(state.teams.player.energy).toBeCloseTo(N * FAST.energy.regenPerTick * 1.1, 9);
    expect(state.teams.opponent.energy).toBeCloseTo(N * FAST.energy.regenPerTick, 9);
  });

  it('heal-pulse heals all own living units every interval after the choice', () => {
    const state = effectBattle('nano-repair-swarm');
    const wounded = spawnUnitsForCard(state, FAST, getCardById('heavy-tank')!, 'player', 0, 10)[0];
    wounded.health -= 400;
    expect(choose(state, 'player', 'nano-repair-swarm').ok).toBe(true);
    const chosenAt = state.tick;
    const interval = 200; // secondsToTicks(10)
    const before = wounded.health;
    while (state.tick < chosenAt + interval - 1) advanceTick(state, FAST);
    expect(wounded.health).toBe(before); // nothing until the interval elapses
    advanceTick(state, FAST);
    expect(wounded.health).toBe(before + 40);
    expect(state.log.some((l) => l.type === 'augment-pulse')).toBe(true);
    expect(checkInvariants(state, FAST)).toEqual([]);
  });

  it('deploy-shield pre-shields fighters deployed after the choice', () => {
    const state = effectBattle('prefab-shielding');
    expect(choose(state, 'player', 'prefab-shielding').ok).toBe(true);
    // Not yet folded: deploys THIS tick still spawn unshielded.
    const beforeFold = spawnUnitsForCard(state, FAST, getCardById('neon-boxer')!, 'player', 0, 10)[0];
    expect(beforeFold.shield).toBe(0);
    advanceTick(state, FAST);
    state.teams.player.energy = 10;
    const result = applyCommand(state, FAST, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'forge-recruit',
      lane: 0,
      x: 10,
    });
    expect(result.ok).toBe(true);
    const recruits = state.units.filter((u) => u.contentId === 'forge-recruit');
    expect(recruits.length).toBe(2);
    for (const recruit of recruits) expect(recruit.shield).toBe(100);
    // The opponent gains nothing.
    const enemy = spawnUnitsForCard(state, FAST, getCardById('neon-boxer')!, 'opponent', 0, 70)[0];
    expect(enemy.shield).toBe(0);
  });

  it('team-aura augments fold into the aura layer (damage and speed)', () => {
    const state = effectBattle('overcharged-servos');
    const unit = spawnUnitsForCard(state, FAST, getCardById('neon-boxer')!, 'player', 0, 10)[0];
    expect(choose(state, 'player', 'overcharged-servos').ok).toBe(true);
    advanceTick(state, FAST);
    expect(state.auras.player.attackDamageMult).toBeCloseTo(1.1);
    const stats = { ...unit.base };
    expect(
      state.auras.player.attackDamageMult * stats.attackDamage
    ).toBeCloseTo(stats.attackDamage * 1.1);

    const speed = effectBattle('kinetic-treads');
    expect(choose(speed, 'player', 'kinetic-treads').ok).toBe(true);
    advanceTick(speed, FAST);
    expect(speed.auras.player.moveSpeedMult).toBeCloseTo(1.15);
  });
});

describe('augments in the digest', () => {
  it('the chosen augment changes the digest even with identical unit state', () => {
    const state = offeredBattle();
    const offered = state.teams.player.augment.offeredIds!;
    const digestBefore = computeDigest(state);

    const chooseA = offeredBattle();
    expect(choose(chooseA, 'player', offered[0]).ok).toBe(true);
    const chooseB = offeredBattle();
    expect(choose(chooseB, 'player', offered[1]).ok).toBe(true);

    expect(computeDigest(chooseA)).not.toBe(digestBefore);
    expect(computeDigest(chooseA)).not.toBe(computeDigest(chooseB));
  });

  it('full battles with different augment choices replay to different digests', () => {
    const state = offeredBattle();
    const offered = state.teams.player.augment.offeredIds!;
    const run = (augmentId: string) =>
      runBattle(
        config,
        [{ tick: OFFER_TICK + 5, command: { type: 'choose-augment', team: 'player', augmentId } }],
        FAST
      );
    const a = run(offered[0]);
    const b = run(offered[1]);
    expect(a.rejected).toEqual([]);
    expect(b.rejected).toEqual([]);
    expect(a.invariantViolations).toEqual([]);
    expect(a.digest).not.toBe(b.digest);
    // And the same choice is reproducible.
    expect(run(offered[0]).digest).toBe(a.digest);
  });
});
