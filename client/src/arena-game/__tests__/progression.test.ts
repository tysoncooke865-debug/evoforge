import { describe, expect, it } from 'vitest';
import { BALANCE, getChampionById } from '../content';
import {
  computeFitnessScaling,
  FitnessRatings,
  NEUTRAL_SCALING,
} from '../game-engine/balance/fitness-scaling';
import { runBattle } from '../game-engine/simulation/run';
import { createBattle } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { applyCommand } from '../game-engine/simulation/events';
import {
  rankTierForPoints,
  ratingDeltaForOutcome,
  ratingLineFor,
} from '../services/progression/rank';

function ratings(all: number): FitnessRatings {
  return { strength: all, cardio: all, muscularity: all, leanness: all, aesthetics: all };
}

function totalAdvantage(s: ReturnType<typeof computeFitnessScaling>): number {
  return (
    Math.abs(s.attackDamageMult - 1) +
    Math.abs(1 - s.abilityCooldownMult) +
    Math.abs(s.maxHealthMult - 1) +
    Math.abs(s.moveSpeedMult - 1) +
    Math.abs(s.ultimateChargeMult - 1)
  );
}

describe('fitness scaling', () => {
  it('baseline ratings produce neutral scaling', () => {
    const s = computeFitnessScaling(ratings(BALANCE.fitness.baselineRating), BALANCE);
    expect(s).toEqual(NEUTRAL_SCALING);
  });

  it('maxed profile stays exactly within the ranked advantage cap', () => {
    const s = computeFitnessScaling(ratings(BALANCE.fitness.maxRating), BALANCE);
    expect(totalAdvantage(s)).toBeLessThanOrEqual(BALANCE.fitness.rankedMaxTotalAdvantage + 1e-9);
    // Every stat is buffed, cooldown reduced.
    expect(s.attackDamageMult).toBeGreaterThan(1);
    expect(s.maxHealthMult).toBeGreaterThan(1);
    expect(s.moveSpeedMult).toBeGreaterThan(1);
    expect(s.ultimateChargeMult).toBeGreaterThan(1);
    expect(s.abilityCooldownMult).toBeLessThan(1);
  });

  it('minimum profile is a mirror-image disadvantage within the cap', () => {
    const s = computeFitnessScaling(ratings(BALANCE.fitness.minRating), BALANCE);
    expect(totalAdvantage(s)).toBeLessThanOrEqual(BALANCE.fitness.rankedMaxTotalAdvantage + 1e-9);
    expect(s.attackDamageMult).toBeLessThan(1);
    expect(s.abilityCooldownMult).toBeGreaterThan(1);
  });

  it('scaling is monotonic in each rating', () => {
    const low = computeFitnessScaling({ ...ratings(50), strength: 20 }, BALANCE);
    const high = computeFitnessScaling({ ...ratings(50), strength: 90 }, BALANCE);
    expect(high.attackDamageMult).toBeGreaterThan(low.attackDamageMult);
    // Other stats unaffected by strength.
    expect(high.maxHealthMult).toBe(1);
    expect(high.moveSpeedMult).toBe(1);
  });

  it('out-of-range and non-finite ratings are clamped, never explode', () => {
    const s = computeFitnessScaling(
      { strength: 10_000, cardio: -50, muscularity: NaN, leanness: Infinity, aesthetics: 100 },
      BALANCE
    );
    expect(totalAdvantage(s)).toBeLessThanOrEqual(BALANCE.fitness.rankedMaxTotalAdvantage + 1e-9);
    for (const v of Object.values(s)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0.5);
      expect(v).toBeLessThan(1.5);
    }
  });

  it('single-stat advantage never exceeds its 1/5 share of the budget', () => {
    const s = computeFitnessScaling({ ...ratings(50), muscularity: 100 }, BALANCE);
    expect(s.maxHealthMult - 1).toBeLessThanOrEqual(
      BALANCE.fitness.rankedMaxTotalAdvantage / 5 + 1e-9
    );
  });
});

describe('fitness scaling applied in battle (M7 wiring)', () => {
  const maxScaling = computeFitnessScaling(ratings(BALANCE.fitness.maxRating), BALANCE);

  function championBattle(scaling?: typeof maxScaling) {
    const state = createBattle(
      {
        seed: 99,
        player: { playerId: 'p1', championId: 'champion-titan', championScaling: scaling },
        opponent: { playerId: 'p2', championId: 'champion-titan' },
      },
      BALANCE
    );
    const player = state.units.find((u) => u.kind === 'champion' && u.team === 'player')!;
    const opponent = state.units.find((u) => u.kind === 'champion' && u.team === 'opponent')!;
    return { state, player, opponent };
  }

  it('spawn stats scale exactly by the capped multipliers', () => {
    const def = getChampionById('champion-titan')!;
    const { player, opponent } = championBattle(maxScaling);
    expect(player.baseMaxHealth).toBe(Math.round(def.stats.maxHealth * maxScaling.maxHealthMult));
    expect(player.base.attackDamage).toBeCloseTo(def.stats.attackDamage * maxScaling.attackDamageMult);
    expect(player.base.moveSpeedPerTick).toBeCloseTo(
      def.stats.moveSpeedPerTick * maxScaling.moveSpeedMult
    );
    // Unscaled opponent is the neutral reference.
    expect(opponent.baseMaxHealth).toBe(def.stats.maxHealth);
    // Advantage stays inside the mandated band.
    const healthAdvantage = player.baseMaxHealth / opponent.baseMaxHealth - 1;
    expect(healthAdvantage).toBeLessThanOrEqual(BALANCE.fitness.rankedMaxTotalAdvantage);
  });

  it('ability cooldown and charge rates carry the scaling', () => {
    const def = getChampionById('champion-titan')!;
    const { player } = championBattle(maxScaling);
    expect(player.champion!.abilityCooldownTotalTicks).toBe(
      Math.max(1, Math.round(def.ability.cooldownTicks * maxScaling.abilityCooldownMult))
    );
    expect(player.champion!.chargePerDamageDealt).toBeCloseTo(
      def.ultimateChargePerDamageDealt * maxScaling.ultimateChargeMult
    );
  });

  it('using the ability applies the SCALED cooldown', () => {
    const { state, player } = championBattle(maxScaling);
    state.tick = 1;
    // Give the stomp a target so validation passes.
    const enemy = state.units.find((u) => u.team === 'opponent')!;
    enemy.x = player.x + 2;
    enemy.lane = player.lane;
    const result = applyCommand(state, BALANCE, { type: 'champion-ability', team: 'player' });
    expect(result.ok).toBe(true);
    expect(player.champion!.abilityCooldownTicks).toBe(player.champion!.abilityCooldownTotalTicks);
    expect(player.champion!.abilityCooldownTicks).toBeLessThan(
      getChampionById('champion-titan')!.ability.cooldownTicks
    );
  });

  it('scaled battles stay deterministic and replay-identical', () => {
    const config = {
      seed: 424242,
      player: { playerId: 'p1', championId: 'champion-cardio', championScaling: maxScaling },
      opponent: { playerId: 'p2', championId: 'champion-shredder' },
    };
    const a = runBattle(config, [], BALANCE);
    // Serialize the config through JSON like a battle record would.
    const roundTripped = JSON.parse(JSON.stringify(config));
    const b = runBattle(roundTripped, [], BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantViolations).toEqual([]);
  });

  it('neutral scaling battles are unchanged from scaling-less battles', () => {
    const withNeutral = createBattle(
      {
        seed: 7,
        player: { playerId: 'p1', championId: 'champion-aesthetic', championScaling: NEUTRAL_SCALING },
        opponent: { playerId: 'p2' },
      },
      BALANCE
    );
    const without = createBattle(
      {
        seed: 7,
        player: { playerId: 'p1', championId: 'champion-aesthetic' },
        opponent: { playerId: 'p2' },
      },
      BALANCE
    );
    for (let i = 0; i < 200; i++) {
      advanceTick(withNeutral, BALANCE);
      advanceTick(without, BALANCE);
    }
    const champA = withNeutral.units[0];
    const champB = without.units[0];
    expect(champA.x).toBe(champB.x);
    expect(champA.health).toBe(champB.health);
  });
});

describe('rank tiers', () => {
  it('resolves tier boundaries exactly', () => {
    const tiers = BALANCE.rank.tiers;
    expect(rankTierForPoints(0, BALANCE).name).toBe(tiers[0].name);
    for (const tier of tiers) {
      expect(rankTierForPoints(tier.minPoints, BALANCE).name).toBe(tier.name);
      if (tier.minPoints > 0) {
        expect(rankTierForPoints(tier.minPoints - 1, BALANCE).name).not.toBe(tier.name);
      }
    }
  });

  it('reports next tier and progress', () => {
    const first = BALANCE.rank.tiers[0];
    const second = BALANCE.rank.tiers[1];
    const halfway = Math.floor((first.minPoints + second.minPoints) / 2);
    const info = rankTierForPoints(halfway, BALANCE);
    expect(info.name).toBe(first.name);
    expect(info.next?.name).toBe(second.name);
    expect(info.progress).toBeGreaterThan(0.3);
    expect(info.progress).toBeLessThan(0.7);
  });

  it('top tier reports full progress and no next', () => {
    const top = BALANCE.rank.tiers[BALANCE.rank.tiers.length - 1];
    const info = rankTierForPoints(top.minPoints + 5000, BALANCE);
    expect(info.name).toBe(top.name);
    expect(info.next).toBeNull();
    expect(info.progress).toBe(1);
  });

  it('handles garbage input safely', () => {
    expect(rankTierForPoints(NaN, BALANCE).name).toBe(BALANCE.rank.tiers[0].name);
    expect(rankTierForPoints(-500, BALANCE).name).toBe(BALANCE.rank.tiers[0].name);
  });
});

describe('ratingDeltaForOutcome + ratingLineFor (P11 — results clarity)', () => {
  it('standard/ranked/gym-war move by the BALANCE.rank table', () => {
    for (const mode of ['standard', 'ranked', 'gym-war'] as const) {
      expect(ratingDeltaForOutcome(mode, 'player', BALANCE)).toBe(BALANCE.rank.pointsPerWin);
      expect(ratingDeltaForOutcome(mode, 'opponent', BALANCE)).toBe(BALANCE.rank.pointsPerLoss);
      expect(ratingDeltaForOutcome(mode, 'draw', BALANCE)).toBe(BALANCE.rank.pointsPerDraw);
    }
  });

  it('tutorial and ghost battles never move Arena Rating', () => {
    for (const mode of ['tutorial', 'ghost'] as const) {
      for (const winner of ['player', 'opponent', 'draw'] as const) {
        expect(ratingDeltaForOutcome(mode, winner, BALANCE)).toBe(0);
      }
    }
  });

  it('the overlay line matches the delta, sign included', () => {
    expect(ratingLineFor('standard', BALANCE.rank.pointsPerWin)).toBe(
      `Arena Rating +${BALANCE.rank.pointsPerWin}`
    );
    expect(ratingLineFor('standard', BALANCE.rank.pointsPerLoss)).toBe(
      `Arena Rating ${BALANCE.rank.pointsPerLoss}`
    );
    expect(ratingLineFor('tutorial', 0)).toBe('Tutorial — Arena Rating unchanged');
    expect(ratingLineFor('ghost', 0)).toBe('Ghost battle — Arena Rating unchanged');
  });
});
