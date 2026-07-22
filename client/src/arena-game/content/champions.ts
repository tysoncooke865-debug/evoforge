/**
 * THE OFFICIAL ROSTER — five Champions, one per live EvoForge BranchV2 slug
 * ('hybrid' is retired). Ids are stable and slug-aligned ('champion-<path>');
 * display names are pinned by content validation (incl. "The Shredder").
 * Ability/ultimate/passive numerics live here (data-driven), interpreted by
 * the engine's ability system and the passive hooks (spawn/combat/auras).
 */
import { secondsToTicks } from './balance';
import type { ChampionDefinition } from './types';

export const CHAMPIONS: ChampionDefinition[] = [
  {
    id: 'champion-aesthetic',
    name: 'Aesthetics',
    path: 'aesthetic',
    role: 'Flexible tactician and support',
    description:
      'Precision in every line. Reads the battle, times abilities perfectly and shifts stance to become what the squad needs.',
    stats: {
      maxHealth: 1150,
      attackDamage: 66,
      attackIntervalTicks: secondsToTicks(1.0),
      attackRange: 3.5,
      moveSpeedPerTick: 0.24,
      isRanged: false,
    },
    tags: ['aesthetic', 'support'],
    passive: {
      id: 'aesthetic-flow-state',
      name: 'Flow State',
      description: 'While Aesthetics is alive, your team receives 10% more healing.',
      effects: { teamAura: { healingMult: 1.1 } },
    },
    ability: {
      id: 'aesthetic-stance-shift',
      name: 'Stance Shift',
      description:
        'Toggle stance for 8s: Bulwark (+30% damage taken reduction) or Assault (+25% damage).',
      cooldownTicks: secondsToTicks(10),
      kind: 'active',
      // The ability system applies exactly one of these per use: Bulwark
      // takes damageTakenMult, Assault takes attackDamageMult (alternating).
      effects: {
        durationTicks: secondsToTicks(8),
        attackDamageMult: 1.25,
        damageTakenMult: 0.7,
      },
    },
    ultimate: {
      id: 'aesthetic-rally',
      name: 'Forge Rally',
      description: 'Allies everywhere gain +25% damage and heal 150 over 5s.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: {
        durationTicks: secondsToTicks(5),
        attackDamageMult: 1.25,
        heal: 150,
      },
    },
    ultimateChargePerDamageDealt: 0.06,
    ultimateChargePerDamageTaken: 0.06,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'stance', 'ultimate', 'hit', 'death'],
    art: 'champion-aesthetic',
  },
  {
    id: 'champion-titan',
    name: 'Titan',
    path: 'titan',
    role: 'Tank and heavy frontline damage',
    description:
      'An immovable wall of forged muscle. Anchors a lane, absorbs punishment and flattens whatever stands in front of it.',
    stats: {
      maxHealth: 1470,
      attackDamage: 70,
      attackIntervalTicks: secondsToTicks(1.5),
      attackRange: 3.5,
      moveSpeedPerTick: 0.16,
      isRanged: false,
    },
    tags: ['titan', 'brawler'],
    passive: {
      id: 'titan-iron-hide',
      name: 'Iron Hide',
      description: 'Every hit against the Titan is reduced by 5 (never below 1 damage).',
      effects: { selfArmorFlat: 5 },
    },
    ability: {
      id: 'titan-quake-stomp',
      name: 'Quake Stomp',
      description: 'Stun all enemies in a nearby area for 1.5s.',
      cooldownTicks: secondsToTicks(14),
      kind: 'active',
      effects: { radius: 10, stunTicks: secondsToTicks(1.5) },
    },
    ultimate: {
      id: 'titan-ground-smash',
      name: 'Seismic Smash',
      description: 'Smash the ground: 320 damage to all enemies in a wide area.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: { damage: 320, radius: 14, stunTicks: secondsToTicks(0.8) },
    },
    ultimateChargePerDamageDealt: 0.06,
    ultimateChargePerDamageTaken: 0.05,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'ability', 'ultimate', 'hit', 'death'],
    art: 'champion-titan',
  },
  {
    id: 'champion-mass',
    name: 'Mass Monster',
    path: 'mass',
    role: 'Durable bruiser and area presence',
    description:
      'Sheer scale weaponised. Too big to move, too big to ignore — grinds a lane down under sustained pressure and endless bulk.',
    // Deliberately DISTINCT from Titan: Titan is explosive impact + control
    // (stun stomp, 320-damage smash); the Mass Monster is an enormous health
    // pool with lower sustained damage, area denial (slow field) and a
    // summoning ultimate instead of burst.
    stats: {
      maxHealth: 1820,
      attackDamage: 55,
      attackIntervalTicks: secondsToTicks(1.4),
      attackRange: 3.5,
      moveSpeedPerTick: 0.14,
      isRanged: false,
    },
    tags: ['mass', 'brawler'],
    passive: {
      id: 'mass-colossal-frame',
      name: 'Colossal Frame',
      description: 'The Mass Monster spawns with 10% bonus max health.',
      effects: { spawnMaxHealthMult: 1.1 },
    },
    ability: {
      id: 'mass-gravity-well',
      name: 'Gravity Well',
      description: 'Enemies in a nearby area are slowed to 60% move speed for 4s.',
      cooldownTicks: secondsToTicks(12),
      kind: 'active',
      effects: { radius: 10, durationTicks: secondsToTicks(4), moveSpeedMult: 0.6 },
    },
    ultimate: {
      id: 'mass-summon',
      name: 'Mass Uprising',
      description:
        'Summon two Titan Guards at the Mass Monster’s position — one in each lane.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: { summon: { cardId: 'titan-guard', count: 2 } },
    },
    ultimateChargePerDamageDealt: 0.05,
    ultimateChargePerDamageTaken: 0.045,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'ability', 'ultimate', 'hit', 'death'],
    art: 'champion-mass',
  },
  {
    id: 'champion-shredder',
    name: 'The Shredder',
    path: 'shredder',
    role: 'Assassin and backline disruption',
    description:
      'Carved definition, zero wasted motion. Slips past the frontline and deletes priority targets.',
    stats: {
      maxHealth: 750,
      attackDamage: 90,
      attackIntervalTicks: secondsToTicks(1.1),
      attackRange: 3,
      moveSpeedPerTick: 0.26,
      isRanged: false,
    },
    tags: ['shredder'],
    passive: {
      id: 'shredder-killer-instinct',
      name: 'Killer Instinct',
      description:
        'The Shredder’s own hits deal 25% more damage to targets below 35% health.',
      effects: { lowHealthBonus: { belowHealthFraction: 0.35, damageMult: 1.25 } },
    },
    ability: {
      id: 'shredder-phase-dash',
      name: 'Phase Dash',
      description: 'Dash to the furthest enemy unit in range and strike for 120.',
      cooldownTicks: secondsToTicks(12),
      kind: 'active',
      effects: { damage: 120 },
    },
    ultimate: {
      id: 'shredder-execute',
      name: 'Final Cut',
      description:
        'Strike the lowest-health enemy in range for 250; executes below 30% health.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: { damage: 250, executeBelowHealthFraction: 0.3 },
    },
    ultimateChargePerDamageDealt: 0.06,
    ultimateChargePerDamageTaken: 0.05,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'dash', 'ultimate', 'hit', 'death'],
    art: 'champion-shredder',
  },
  {
    id: 'champion-cardio',
    name: 'Cardio Machine',
    path: 'cardio',
    role: 'Tempo and sustained pressure',
    description:
      'An engine that never stops. Swaps lanes in a heartbeat, keeps the whole team fuelled and overwhelms with attack tempo.',
    stats: {
      maxHealth: 850,
      attackDamage: 45,
      attackIntervalTicks: secondsToTicks(0.6),
      attackRange: 3,
      moveSpeedPerTick: 0.34,
      isRanged: false,
    },
    tags: ['cardio', 'brawler'],
    passive: {
      id: 'cardio-perpetual-motion',
      name: 'Perpetual Motion',
      description:
        'While the Cardio Machine is alive, your Forge Energy regenerates 5% faster.',
      effects: { teamAura: { energyRegenMult: 1.05 } },
    },
    ability: {
      id: 'cardio-lane-shift',
      name: 'Lane Shift',
      description: 'Dash instantly to the same position in the other lane.',
      cooldownTicks: secondsToTicks(10),
      kind: 'active',
      effects: {}, // Movement effect — interpreted by the ability system.
    },
    ultimate: {
      id: 'cardio-overclock',
      name: 'Overclock',
      description:
        'For 6s, attack twice as fast and move 60% faster. Refunds 1 Forge Energy on cast.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: {
        durationTicks: secondsToTicks(6),
        attackIntervalMult: 0.5,
        moveSpeedMult: 1.6,
        energyRefund: 1,
      },
    },
    ultimateChargePerDamageDealt: 0.08,
    ultimateChargePerDamageTaken: 0.04,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'run', 'attack', 'dash', 'ultimate', 'hit', 'death'],
    art: 'champion-cardio',
  },
];

export function getChampionById(id: string): ChampionDefinition | undefined {
  return CHAMPIONS.find((c) => c.id === id);
}

export function getChampionByPath(path: string): ChampionDefinition | undefined {
  return CHAMPIONS.find((c) => c.path === path);
}

/** Player-facing display name for an Avatar Path slug (the champion name). */
export function pathDisplayName(path: string): string {
  return getChampionByPath(path)?.name ?? path;
}
