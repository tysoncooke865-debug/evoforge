/**
 * P10 — champion-path tendency profiles for the opponent AI.
 *
 * Each official champion gets a small, DATA-DRIVEN tendency profile that
 * shapes WHEN the AI casts that champion's ability/ultimate — the numeric
 * knobs live in the TENDENCY table below, the shape rules in
 * CHAMPION_TENDENCIES. Everything here is a pure function of battle state
 * (no RNG, no mutation), so decisions stay deterministic and the mirrored
 * player-side driver exercises the identical logic by construction.
 *
 * Legality contract: tendencies only ever HOLD a cast the baseline logic
 * already validated, or RELAX the ultimate trigger for a cast that still
 * passes the same validation — the caller (opponent-ai.ts maybeUseChampion)
 * always checks validateChampionAbility / validateChampionAutoCast plus
 * cooldown/charge before queueing, and the engine re-validates at apply
 * time. A tendency can therefore never produce an illegal command.
 *
 * Tier scaling: BALANCE.ai.difficulties[tier].tendencyFollowChance decides
 * per decision (deterministic seeded roll in opponent-ai.ts) whether the
 * profile is consulted at all — training 0 (pure baseline; it also never
 * commands champions), standard 0.75 (mostly follows, sometimes reverts to
 * baseline = its "mistake"), advanced 1 (always follows).
 *
 * Escape hatches: every ultimate tendency that can HOLD keeps at least one
 * pressure valve (core threatened, and usually the charge-held-too-long
 * timer) so a followed tendency can delay an ultimate but never strand it —
 * the single deliberate exception is the Cardio Machine, which drops the
 * held-too-long valve because Overclock while walking alone is exactly the
 * waste the tendency exists to prevent (see KNOWN_ISSUES P10 note).
 */
import { BALANCE } from '../../content';
import type { AiDifficultyConfig, ChampionDefinition } from '../../content';
import type { CardEffects } from '../../game-engine/types';
import { enemyOf } from '../../game-engine/simulation/state';
import type { BattleState, UnitState } from '../../game-engine/simulation/state';

/** Everything a tendency may read. Built by opponent-ai.ts per decision. */
export interface ChampionTendencyContext {
  state: BattleState;
  cfg: AiDifficultyConfig;
  /** The AI team's commandable captain (alive; checked by the caller). */
  champion: UnitState;
  definition: ChampionDefinition;
  /** Living enemies within aggroRange of the champion, lane-blind (baseline metric). */
  enemiesNearChampion: number;
  /** Threat score of the champion's CURRENT lane (opponent-ai laneThreat). */
  championLaneThreatScore: number;
  /** Own core at/below the difficulty's ultimateCoreThreatFraction. */
  coreThreatened: boolean;
  /** Ultimate charge has been full for >= the difficulty's ultimateHoldTicks. */
  heldLong: boolean;
}

/**
 * The numeric tendency knobs — one row per champion path. Tune HERE (never
 * champion stats) if a tendency pushes a champion outside the win-rate band.
 */
export const TENDENCY = {
  titan: {
    /** Hold Quake Stomp until this many enemies sit inside its radius... */
    stompMinTargets: 2,
    /** ...unless the ultimate is near-ready — then stomp sets up the stun→smash combo.
     *  (A low-health "defensive peel" valve was tried and REVERTED: the deep
     *  harness measured it moving Titan 43→42 and Shredder 58→59 — noise-level
     *  but in the wrong direction on both edges. See PROGRESS P10.) */
    comboUltimateChargeFraction: 0.8,
    /** Prefer Seismic Smash on a real clump inside its own radius. */
    smashMinTargets: 2,
  },
  mass: {
    /** Gravity Well is worth casting offensively on this many slowed enemies... */
    wellMinTargets: 2,
    /** ...or defensively whenever the champion's lane is under real threat
     *  (championLaneThreatScore >= BALANCE.ai.threatTriggerScore). */
  },
  shredder: {
    /* Final Cut holds for a target the strike would actually kill — the
     * thresholds are the ultimate's own content numbers (damage, execute
     * fraction), read from the definition at decision time. */
  },
  cardio: {
    /* Overclock waits for an engaged fight: a living enemy in the champion's
     * lane within BALANCE.arena.aggroRange. */
  },
  aesthetic: {
    /** Bulwark is right when the champion is at/below this health fraction... */
    bulwarkHealthFraction: 0.55,
    /** ...or focused by this many same-lane enemies in aggro range. */
    bulwarkPressureCount: 2,
    /** Assault is right when winning trades: at/above this health fraction
     *  with at least one enemy in reach. */
    assaultHealthFraction: 0.7,
    /** Forge Rally wants this many living allied units besides the captain. */
    rallyMinAllies: 2,
  },
} as const;

/** Living enemies (units and champions) within |x| radius of the champion. */
function enemiesWithin(
  state: BattleState,
  champion: UnitState,
  radius: number,
  sameLane = false
): UnitState[] {
  const enemyTeam = enemyOf(champion.team);
  return state.units.filter(
    (u) =>
      u.alive &&
      u.team === enemyTeam &&
      (!sameLane || u.lane === champion.lane) &&
      Math.abs(u.x - champion.x) <= radius
  );
}

/** Lowest current health, ties broken by lower id — MIRRORS the engine's
 *  Final Cut target selection (champion-abilities.ts lowestHealth). */
function lowestHealthTarget(units: readonly UnitState[]): UnitState | null {
  let best: UnitState | null = null;
  for (const u of units) {
    if (best === null || u.health < best.health || (u.health === best.health && u.id < best.id)) {
      best = u;
    }
  }
  return best;
}

/**
 * Would Final Cut kill this target outright or via the execute? Shield-aware
 * approximation of the engine's resolution (damage soaks shield first; the
 * execute threshold is checked AFTER the hit and kills through shields).
 * Deliberately ignores armor/damage-taken modifiers — a conservative-enough
 * heuristic, and legality never depends on it.
 */
function finalCutWouldKill(target: UnitState, ultimate: CardEffects): boolean {
  const damage = ultimate.damage ?? 0;
  const throughShield = Math.max(0, damage - target.shield);
  if (throughShield >= target.health) return true;
  const threshold = ultimate.executeBelowHealthFraction ?? 0;
  return threshold > 0 && target.health - throughShield < threshold * target.baseMaxHealth;
}

export interface ChampionTendencyProfile {
  /**
   * Extra gate on the ACTIVE ability: called only after the baseline gate
   * (combat nearby + cooldown ready + validateChampionAutoCast) passed.
   * Return false to hold the cast for a better moment.
   */
  abilityWantsCast?(ctx: ChampionTendencyContext): boolean;
  /**
   * REPLACES the baseline ultimate trigger (clump / core threat / held-long):
   * called only after charge is full and validateChampionAbility passed.
   * Each profile folds in the escape hatches it wants from the context.
   */
  ultimateWantsCast?(ctx: ChampionTendencyContext): boolean;
}

export const CHAMPION_TENDENCIES: Record<string, ChampionTendencyProfile> = {
  /** Titan: stomp real clumps (or combo into a near-ready smash); smash clumps. */
  'champion-titan': {
    abilityWantsCast: (ctx) => {
      const t = TENDENCY.titan;
      const inStomp = enemiesWithin(
        ctx.state,
        ctx.champion,
        ctx.definition.ability.effects.radius ?? 0
      ).length;
      const champ = ctx.champion.champion!;
      const ultimateNearReady =
        champ.ultimateCharge >= t.comboUltimateChargeFraction * champ.chargeRequired;
      return inStomp >= t.stompMinTargets || (inStomp >= 1 && ultimateNearReady);
    },
    ultimateWantsCast: (ctx) => {
      const inSmash = enemiesWithin(
        ctx.state,
        ctx.champion,
        ctx.definition.ultimate.effects.radius ?? 0
      ).length;
      return inSmash >= TENDENCY.titan.smashMinTargets || ctx.coreThreatened || ctx.heldLong;
    },
  },

  /** Mass Monster: Gravity Well on clumps or defensively when its lane is
   *  losing; Mass Uprising also fires early as a defensive summon when pushed. */
  'champion-mass': {
    abilityWantsCast: (ctx) => {
      const inWell = enemiesWithin(
        ctx.state,
        ctx.champion,
        ctx.definition.ability.effects.radius ?? 0
      ).length;
      const laneLosing = ctx.championLaneThreatScore >= BALANCE.ai.threatTriggerScore;
      return inWell >= TENDENCY.mass.wellMinTargets || laneLosing;
    },
    ultimateWantsCast: (ctx) =>
      // Baseline triggers PLUS the defensive relaxation: summon when pushed.
      ctx.enemiesNearChampion >= ctx.cfg.ultimateClumpSize ||
      ctx.championLaneThreatScore >= BALANCE.ai.threatTriggerScore ||
      ctx.coreThreatened ||
      ctx.heldLong,
  },

  /** The Shredder: hold Final Cut for a target it actually kills/executes. */
  'champion-shredder': {
    ultimateWantsCast: (ctx) => {
      const targets = enemiesWithin(ctx.state, ctx.champion, BALANCE.arena.aggroRange, true);
      const target = lowestHealthTarget(targets);
      return (
        (target !== null && finalCutWouldKill(target, ctx.definition.ultimate.effects)) ||
        ctx.coreThreatened ||
        ctx.heldLong
      );
    },
  },

  /** Cardio Machine: Overclock only inside an engaged fight — never while
   *  walking alone (deliberately NO held-long valve; see module docs). */
  'champion-cardio': {
    ultimateWantsCast: (ctx) =>
      enemiesWithin(ctx.state, ctx.champion, BALANCE.arena.aggroRange, true).length > 0 ||
      ctx.coreThreatened,
  },

  /** Aesthetics: time the stance the toggle would produce (Bulwark when
   *  focused/low, Assault when winning trades); rally a real squad. */
  'champion-aesthetic': {
    abilityWantsCast: (ctx) => {
      const t = TENDENCY.aesthetic;
      const champ = ctx.champion.champion!;
      const nextIsBulwark = champ.stanceShifts % 2 === 0;
      const healthFraction = ctx.champion.health / ctx.champion.baseMaxHealth;
      const engagedSameLane = enemiesWithin(
        ctx.state,
        ctx.champion,
        BALANCE.arena.aggroRange,
        true
      ).length;
      if (nextIsBulwark) {
        return healthFraction <= t.bulwarkHealthFraction || engagedSameLane >= t.bulwarkPressureCount;
      }
      return healthFraction >= t.assaultHealthFraction && engagedSameLane >= 1;
    },
    ultimateWantsCast: (ctx) => {
      const allies = ctx.state.units.filter(
        (u) => u.alive && u.team === ctx.champion.team && u.id !== ctx.champion.id
      ).length;
      return allies >= TENDENCY.aesthetic.rallyMinAllies || ctx.coreThreatened || ctx.heldLong;
    },
  },
};
