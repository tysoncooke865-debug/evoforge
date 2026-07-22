/**
 * Ranked simulation (M10 beta hardening).
 *
 * Ladder semantics: the beta treats standard battles AS the ranked ladder.
 * Every standard battle already moves rank points through the provider
 * (BALANCE.rank.pointsPerWin/Loss/Draw, applied by recordBattleResult), so
 * battle mode 'ranked' is functionally IDENTICAL to 'standard' in the battle
 * store — same result recording, same rank-point movement, same battle-record
 * persistence (records keep debug.mode 'standard'; the BattleResult reports
 * mode 'ranked' so a future backend can split ladders without any schema
 * change). Verified by src/tests/stability.test.ts.
 *
 * What ranked additionally guarantees is the FITNESS CAP: any fitness-derived
 * champion scaling entering a ranked battle config must stay inside
 * BALANCE.fitness.rankedMaxTotalAdvantage (the ±12% band mandated by the
 * master prompt). computeFitnessScaling enforces this by construction; the
 * helpers below let tests — and future matchmaking/anti-cheat — re-verify it
 * on any config about to be recorded, including full M9 squads.
 */
import type { BalanceConfig } from '../../content/balance';
import type { ChampionFitnessScaling } from '../../game-engine/balance/fitness-scaling';
import type { BattleConfig, BattleTeamConfig } from '../../game-engine/simulation/state';

/**
 * Total fitness-derived combat advantage of a scaling: the sum of every
 * multiplier's deviation from neutral (cooldown counted as 1 - mult, since
 * lower is better there). This is the exact quantity the ranked cap bounds.
 */
export function totalScalingAdvantage(scaling: ChampionFitnessScaling): number {
  return (
    Math.abs(scaling.attackDamageMult - 1) +
    Math.abs(1 - scaling.abilityCooldownMult) +
    Math.abs(scaling.maxHealthMult - 1) +
    Math.abs(scaling.moveSpeedMult - 1) +
    Math.abs(scaling.ultimateChargeMult - 1)
  );
}

/** An absent scaling is neutral — zero advantage, always inside the cap. */
export function isWithinRankedCap(
  scaling: ChampionFitnessScaling | undefined,
  balance: BalanceConfig,
  epsilon = 1e-9
): boolean {
  if (!scaling) return true;
  return totalScalingAdvantage(scaling) <= balance.fitness.rankedMaxTotalAdvantage + epsilon;
}

/**
 * Every scaling a team config can carry — the legacy championScaling field or
 * the M9 squad's captain + borrowed members — is inside the ranked cap.
 */
export function teamConfigWithinRankedCap(
  team: BattleTeamConfig,
  balance: BalanceConfig
): boolean {
  if (team.squad) {
    return (
      isWithinRankedCap(team.squad.captain.scaling, balance) &&
      team.squad.borrowed.every((b) => isWithinRankedCap(b.scaling, balance))
    );
  }
  return isWithinRankedCap(team.championScaling, balance);
}

/** Both sides of a battle config respect the ranked fitness cap. */
export function battleConfigWithinRankedCap(
  config: BattleConfig,
  balance: BalanceConfig
): boolean {
  return (
    teamConfigWithinRankedCap(config.player, balance) &&
    teamConfigWithinRankedCap(config.opponent, balance)
  );
}
