/**
 * Runtime validation for all game content. Runs once at app boot (and in
 * tests). The app refuses to start a battle with invalid content; the debug
 * screen shows the full report.
 */
import { ALL_AVATAR_PATHS, ALL_UNIT_TAGS } from '../game-engine/types';
import type { CombatStats } from '../game-engine/types';
import { ALL_AI_DIFFICULTIES, BALANCE } from './balance';
import { getCardById } from './cards';
import type {
  AugmentDefinition,
  CardDefinition,
  ChampionDefinition,
  SynergyDefinition,
} from './types';

export interface ContentValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: { cards: number; champions: number; synergies: number; augments: number };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateStats(prefix: string, stats: CombatStats, errors: string[]): void {
  if (!isFiniteNumber(stats.maxHealth) || stats.maxHealth <= 0)
    errors.push(`${prefix}: maxHealth must be > 0`);
  if (!isFiniteNumber(stats.attackDamage) || stats.attackDamage < 0)
    errors.push(`${prefix}: attackDamage must be >= 0`);
  if (!isFiniteNumber(stats.attackIntervalTicks) || stats.attackIntervalTicks < 1)
    errors.push(`${prefix}: attackIntervalTicks must be >= 1`);
  if (!isFiniteNumber(stats.attackRange) || stats.attackRange <= 0)
    errors.push(`${prefix}: attackRange must be > 0`);
  if (!isFiniteNumber(stats.moveSpeedPerTick) || stats.moveSpeedPerTick < 0)
    errors.push(`${prefix}: moveSpeedPerTick must be >= 0`);
  if (stats.attackRange > BALANCE.arena.laneLength / 2)
    errors.push(`${prefix}: attackRange exceeds half the lane length`);
}

function validateTags(prefix: string, tags: string[], errors: string[]): void {
  for (const tag of tags) {
    if (!ALL_UNIT_TAGS.includes(tag as (typeof ALL_UNIT_TAGS)[number])) {
      errors.push(`${prefix}: unknown tag '${tag}'`);
    }
  }
}

export function validateCards(cards: CardDefinition[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const card of cards) {
    const prefix = `card '${card.id}'`;
    if (!card.id || !/^[a-z0-9-]+$/.test(card.id)) errors.push(`${prefix}: invalid id`);
    if (seenIds.has(card.id)) errors.push(`${prefix}: duplicate id`);
    seenIds.add(card.id);
    if (!card.name) errors.push(`${prefix}: missing name`);
    if (!card.description) errors.push(`${prefix}: missing description`);
    if (!isFiniteNumber(card.energyCost) || card.energyCost < 1 || card.energyCost > BALANCE.energy.max)
      errors.push(`${prefix}: energyCost must be 1..${BALANCE.energy.max}`);
    validateTags(prefix, card.tags, errors);

    if (card.category === 'fighter') {
      if (!card.unit) {
        errors.push(`${prefix}: fighter card missing unit definition`);
      } else {
        validateStats(prefix, card.unit.stats, errors);
        if (card.unit.deployCount < 1 || card.unit.deployCount > 5)
          errors.push(`${prefix}: deployCount must be 1..5`);
      }
      if (card.target !== 'deploy-lane')
        errors.push(`${prefix}: fighter cards must use 'deploy-lane' targeting`);
      if (card.effects) errors.push(`${prefix}: fighter cards must not define effects`);
    } else {
      if (card.unit) errors.push(`${prefix}: non-fighter card must not define a unit`);
      if (!card.effects || Object.keys(card.effects).length === 0) {
        errors.push(`${prefix}: ${card.category} card requires at least one effect`);
      } else {
        for (const [key, value] of Object.entries(card.effects)) {
          if (!isFiniteNumber(value) || value < 0)
            errors.push(`${prefix}: effect '${key}' must be a finite number >= 0`);
        }
        if (card.category === 'equipment' && !card.effects.durationTicks && !card.effects.shield)
          warnings.push(`${prefix}: equipment usually has a duration or shield`);
      }
      if (card.target === 'deploy-lane')
        errors.push(`${prefix}: non-fighter cards cannot use 'deploy-lane' targeting`);
    }
    if (!card.art) errors.push(`${prefix}: missing art placeholder key`);
    if (!isFiniteNumber(card.upgrade.statMultPerLevel) || card.upgrade.statMultPerLevel < 1)
      errors.push(`${prefix}: upgrade.statMultPerLevel must be >= 1`);
  }
  return { errors, warnings };
}

/**
 * The OFFICIAL display names, pinned per path — exactly EvoForge's five live
 * branches (branchDisplayNameV2 minus the emoji). "The Shredder" keeps its
 * article. A rename here is a product decision, not a refactor.
 */
export const OFFICIAL_CHAMPION_NAMES: Record<string, string> = {
  aesthetic: 'Aesthetics',
  titan: 'Titan',
  mass: 'Mass Monster',
  shredder: 'The Shredder',
  cardio: 'Cardio Machine',
};

function validatePassive(prefix: string, ch: ChampionDefinition, errors: string[]): void {
  const passive = ch.passive;
  if (!passive || typeof passive !== 'object') {
    errors.push(`${prefix}: missing passive`);
    return;
  }
  const pp = `${prefix} passive '${passive.id}'`;
  if (!passive.id || !/^[a-z0-9-]+$/.test(passive.id)) errors.push(`${pp}: invalid id`);
  if (!passive.name || !passive.description) errors.push(`${pp}: missing name/description`);
  const e = passive.effects ?? {};
  const kinds = [e.selfArmorFlat, e.spawnMaxHealthMult, e.lowHealthBonus, e.teamAura].filter(
    (v) => v !== undefined
  );
  if (kinds.length === 0) errors.push(`${pp}: needs at least one effect`);
  if (e.selfArmorFlat !== undefined && (!isFiniteNumber(e.selfArmorFlat) || e.selfArmorFlat <= 0))
    errors.push(`${pp}: selfArmorFlat must be > 0`);
  if (
    e.spawnMaxHealthMult !== undefined &&
    (!isFiniteNumber(e.spawnMaxHealthMult) || e.spawnMaxHealthMult <= 0)
  )
    errors.push(`${pp}: spawnMaxHealthMult must be > 0`);
  if (e.lowHealthBonus !== undefined) {
    const b = e.lowHealthBonus;
    if (
      !isFiniteNumber(b.belowHealthFraction) ||
      b.belowHealthFraction <= 0 ||
      b.belowHealthFraction >= 1
    )
      errors.push(`${pp}: lowHealthBonus.belowHealthFraction must be in (0, 1)`);
    if (!isFiniteNumber(b.damageMult) || b.damageMult <= 1)
      errors.push(`${pp}: lowHealthBonus.damageMult must be > 1`);
  }
  if (e.teamAura !== undefined) {
    const fields = [e.teamAura.energyRegenMult, e.teamAura.healingMult];
    if (fields.every((v) => v === undefined))
      errors.push(`${pp}: teamAura needs at least one multiplier`);
    for (const v of fields) {
      if (v !== undefined && (!isFiniteNumber(v) || v <= 0))
        errors.push(`${pp}: teamAura multipliers must be > 0`);
    }
  }
}

export function validateChampions(champions: ChampionDefinition[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const ch of champions) {
    const prefix = `champion '${ch.id}'`;
    if (!ch.id || !/^[a-z0-9-]+$/.test(ch.id)) errors.push(`${prefix}: invalid id`);
    if (seenIds.has(ch.id)) errors.push(`${prefix}: duplicate id`);
    seenIds.add(ch.id);
    if (seenPaths.has(ch.path)) errors.push(`${prefix}: duplicate path '${ch.path}'`);
    seenPaths.add(ch.path);
    if (!ALL_AVATAR_PATHS.includes(ch.path)) errors.push(`${prefix}: unknown path '${ch.path}'`);
    // Stable slug-aligned ids + pinned official display names.
    if (ch.id !== `champion-${ch.path}`)
      errors.push(`${prefix}: id must be 'champion-${ch.path}' (slug-aligned)`);
    const officialName = OFFICIAL_CHAMPION_NAMES[ch.path];
    if (officialName !== undefined && ch.name !== officialName)
      errors.push(`${prefix}: display name must be '${officialName}', found '${ch.name}'`);
    validateStats(prefix, ch.stats, errors);
    validateTags(prefix, ch.tags, errors);
    validatePassive(prefix, ch, errors);

    for (const ability of [ch.ability, ch.ultimate]) {
      const ap = `${prefix} ability '${ability.id}'`;
      if (!ability.id) errors.push(`${ap}: missing id`);
      if (!ability.name || !ability.description) errors.push(`${ap}: missing name/description`);
      if (!isFiniteNumber(ability.cooldownTicks) || ability.cooldownTicks < 0)
        errors.push(`${ap}: cooldownTicks must be >= 0`);
      // Summon payloads must reference a real fighter card (Mass Monster).
      const summon = ability.effects?.summon;
      if (summon !== undefined) {
        const card = getCardById(summon.cardId);
        if (!card || card.category !== 'fighter' || !card.unit)
          errors.push(`${ap}: summon.cardId '${summon.cardId}' is not a fighter card`);
        if (!Number.isInteger(summon.count) || summon.count < 1 || summon.count > 5)
          errors.push(`${ap}: summon.count must be 1..5`);
      }
    }
    if (ch.ability.kind !== 'active') errors.push(`${prefix}: ability.kind must be 'active'`);
    if (ch.ultimate.kind !== 'ultimate') errors.push(`${prefix}: ultimate.kind must be 'ultimate'`);
    if (ch.ability.cooldownTicks < 1) errors.push(`${prefix}: active ability needs a cooldown`);
    if (!isFiniteNumber(ch.ultimateChargeRequired) || ch.ultimateChargeRequired <= 0)
      errors.push(`${prefix}: ultimateChargeRequired must be > 0`);
    if (ch.ultimateChargePerDamageDealt < 0 || ch.ultimateChargePerDamageTaken < 0)
      errors.push(`${prefix}: ultimate charge rates must be >= 0`);
    if (ch.animationStates.length === 0) errors.push(`${prefix}: needs animation states`);
    if (!ch.animationStates.includes('death')) warnings.push(`${prefix}: no 'death' animation state`);
  }
  // THE OFFICIAL ROSTER: exactly five champions, one per live branch.
  if (champions.length !== ALL_AVATAR_PATHS.length)
    errors.push(`expected ${ALL_AVATAR_PATHS.length} champions (one per path), found ${champions.length}`);
  for (const path of ALL_AVATAR_PATHS) {
    if (!seenPaths.has(path)) errors.push(`no champion for path '${path}'`);
  }
  return { errors, warnings };
}

/**
 * `cards`/`champions` are optional so existing call sites that only care
 * about per-synergy shape (duplicate ids, tag existence, threshold/bonus
 * sanity) keep working; passing them turns on two extra, content-wide
 * checks: every tag synergy must be reachable by the actual roster, and
 * every official Avatar Path must have a path-identity synergy.
 */
export function validateSynergies(
  synergies: SynergyDefinition[],
  cards?: CardDefinition[],
  champions?: ChampionDefinition[]
): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const s of synergies) {
    const prefix = `synergy '${s.id}'`;
    if (!s.id) errors.push(`${prefix}: missing id`);
    if (seenIds.has(s.id)) errors.push(`${prefix}: duplicate id`);
    seenIds.add(s.id);
    if (s.tag !== 'mixed-paths' && !ALL_UNIT_TAGS.includes(s.tag))
      errors.push(`${prefix}: unknown tag '${s.tag}'`);
    if (!isFiniteNumber(s.threshold) || s.threshold < 2)
      errors.push(`${prefix}: threshold must be >= 2`);
    if (Object.keys(s.bonus).length === 0) errors.push(`${prefix}: empty bonus`);
    for (const [key, value] of Object.entries(s.bonus)) {
      if (!isFiniteNumber(value) || value <= 0)
        errors.push(`${prefix}: bonus '${key}' must be a positive number`);
    }
  }

  // Reachability: a tag synergy is dead content if no fighter card or
  // champion can ever carry enough of the tag to hit its threshold. Only
  // FIGHTER cards count — techniques/equipment never spawn a combatant, so
  // their tags never enter the aura layer's tag count (synergies.ts).
  if (cards !== undefined && champions !== undefined) {
    const fighterTagCounts = new Map<string, number>();
    for (const card of cards) {
      if (card.category !== 'fighter') continue;
      for (const tag of card.tags) fighterTagCounts.set(tag, (fighterTagCounts.get(tag) ?? 0) + 1);
    }
    const championTagCounts = new Map<string, number>();
    for (const ch of champions) {
      for (const tag of ch.tags) championTagCounts.set(tag, (championTagCounts.get(tag) ?? 0) + 1);
    }
    for (const s of synergies) {
      if (s.tag === 'mixed-paths' || !isFiniteNumber(s.threshold)) continue;
      const reachable = (fighterTagCounts.get(s.tag) ?? 0) + (championTagCounts.get(s.tag) ?? 0);
      if (reachable < s.threshold) {
        errors.push(
          `synergy '${s.id}': threshold ${s.threshold} exceeds the ${reachable} fighter cards + champions that can ever carry tag '${s.tag}'`
        );
      }
    }

    // Every official Avatar Path needs at least one path-identity synergy.
    for (const path of ALL_AVATAR_PATHS) {
      if (!synergies.some((s) => s.tag === path)) {
        errors.push(`no synergy for official path '${path}'`);
      }
    }
  }

  return { errors, warnings };
}

export function validateAugments(augments: AugmentDefinition[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const a of augments) {
    const prefix = `augment '${a.id}'`;
    if (!a.id || !/^[a-z0-9-]+$/.test(a.id)) errors.push(`${prefix}: invalid id`);
    if (seenIds.has(a.id)) errors.push(`${prefix}: duplicate id`);
    seenIds.add(a.id);
    if (!a.name) errors.push(`${prefix}: missing name`);
    if (!a.description) errors.push(`${prefix}: missing description`);
    const e = a.effect;
    switch (e.kind) {
      case 'team-aura': {
        const fields = [e.attackDamageMult, e.moveSpeedMult, e.healingMult, e.armorFlat];
        if (fields.every((v) => v === undefined))
          errors.push(`${prefix}: team-aura augment needs at least one bonus`);
        for (const v of fields) {
          if (v !== undefined && (!isFiniteNumber(v) || v <= 0))
            errors.push(`${prefix}: team-aura bonuses must be positive numbers`);
        }
        break;
      }
      case 'energy-regen':
        if (!isFiniteNumber(e.regenMult) || e.regenMult <= 0)
          errors.push(`${prefix}: regenMult must be > 0`);
        break;
      case 'heal-pulse':
        if (!isFiniteNumber(e.amount) || e.amount <= 0)
          errors.push(`${prefix}: heal-pulse amount must be > 0`);
        if (!isFiniteNumber(e.intervalTicks) || e.intervalTicks < 1)
          errors.push(`${prefix}: heal-pulse intervalTicks must be >= 1`);
        break;
      case 'core-repair':
        if (!isFiniteNumber(e.amount) || e.amount <= 0)
          errors.push(`${prefix}: core-repair amount must be > 0`);
        break;
      case 'deploy-shield':
        if (!isFiniteNumber(e.amount) || e.amount <= 0)
          errors.push(`${prefix}: deploy-shield amount must be > 0`);
        break;
      default: {
        const k = (e as { kind?: unknown }).kind;
        errors.push(`${prefix}: unknown effect kind '${String(k)}'`);
      }
    }
  }
  if (augments.length < BALANCE.augment.choiceCount)
    errors.push(
      `only ${augments.length} augments but choiceCount is ${BALANCE.augment.choiceCount}`
    );
  return { errors, warnings };
}

export function validateBalance(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const b = BALANCE;
  if (!/^\d+\.\d+\.\d+$/.test(b.balanceVersion)) errors.push('balanceVersion must be semver');
  if (b.ticksPerSecond < 1) errors.push('ticksPerSecond must be >= 1');
  if (b.battle.durationTicks < b.ticksPerSecond * 30) errors.push('battle too short');
  if (b.energy.max < 1 || b.energy.regenPerTick <= 0) errors.push('invalid energy config');
  if (b.energy.startingEnergy > b.energy.max) errors.push('startingEnergy > max energy');
  if (b.arena.deployZoneDepth >= b.arena.laneLength) errors.push('deploy zone covers whole lane');
  if (b.core.maxHealth <= 0) errors.push('core maxHealth must be > 0');
  if (b.champion.respawnTicks < 1) errors.push('champion respawnTicks must be >= 1');
  if (b.champion.respawnHealthFraction <= 0 || b.champion.respawnHealthFraction > 1)
    errors.push('champion respawnHealthFraction must be in (0, 1]');
  if (b.champion.spawnOffsetFromCore <= 0 || b.champion.spawnOffsetFromCore >= b.arena.laneLength)
    errors.push('champion spawnOffsetFromCore must be inside the lane');
  if (b.fitness.rankedMaxTotalAdvantage < 0.05 || b.fitness.rankedMaxTotalAdvantage > 0.15)
    errors.push('fitness rankedMaxTotalAdvantage must stay within 0.05..0.15');
  const tierPoints = b.rank.tiers.map((t) => t.minPoints);
  for (let i = 1; i < tierPoints.length; i++) {
    if (tierPoints[i] <= tierPoints[i - 1]) errors.push('rank tiers must be strictly ascending');
  }
  if (b.augment.offerTick < 1 || b.augment.offerTick >= b.battle.durationTicks)
    errors.push('augment offerTick must fall inside the main battle phase');
  if (b.augment.choiceCount < 2) errors.push('augment choiceCount must be >= 2');
  if (!Number.isInteger(b.gym.maxBorrowed) || b.gym.maxBorrowed < 0)
    errors.push('gym maxBorrowed must be a non-negative integer');
  if (b.gym.contributionPerWar < 0 || b.gym.contributionWinBonus < 0)
    errors.push('gym contribution values must be >= 0');
  for (const difficulty of ALL_AI_DIFFICULTIES) {
    const d = b.ai.difficulties[difficulty];
    const prefix = `ai '${difficulty}'`;
    if (!d) {
      errors.push(`${prefix}: missing config`);
      continue;
    }
    if (d.decisionIntervalTicks < 2)
      errors.push(`${prefix}: decisionIntervalTicks must be >= 2 (AI queues one tick ahead)`);
    if (d.decisionJitterTicks < 0) errors.push(`${prefix}: decisionJitterTicks must be >= 0`);
    if (d.mistakeChance < 0 || d.mistakeChance > 1)
      errors.push(`${prefix}: mistakeChance must be in [0, 1]`);
    if (d.energyReserve < 0 || d.energyReserve >= b.energy.max)
      errors.push(`${prefix}: energyReserve must be in [0, max energy)`);
    if (d.augmentChoiceDelayTicks < 1)
      errors.push(`${prefix}: augmentChoiceDelayTicks must be >= 1`);
  }
  if (
    b.ai.threatMidlineFraction <= 0 ||
    b.ai.threatMidlineFraction >= 1 ||
    b.ai.threatTriggerScore <= 0 ||
    b.ai.swarmCountThreshold < 2
  )
    errors.push('invalid ai threat config');
  return { errors, warnings };
}
