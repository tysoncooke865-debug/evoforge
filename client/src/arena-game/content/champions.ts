/**
 * The four initial Champions — one per Avatar Path.
 * Ability/ultimate numerics live here (data-driven), interpreted by the
 * engine's ability system from Milestone 5.
 */
import { secondsToTicks } from './balance';
import type { ChampionDefinition } from './types';

export const CHAMPIONS: ChampionDefinition[] = [
  {
    id: 'champion-titan',
    name: 'Titan',
    path: 'titan',
    role: 'Tank and heavy frontline damage',
    description:
      'An immovable wall of forged muscle. Anchors a lane, absorbs punishment and flattens whatever stands in front of it.',
    stats: {
      maxHealth: 1400,
      attackDamage: 70,
      attackIntervalTicks: secondsToTicks(1.5),
      attackRange: 3.5,
      moveSpeedPerTick: 0.16,
      isRanged: false,
    },
    tags: ['titan', 'brawler'],
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
    id: 'champion-speedster',
    name: 'Speedster',
    path: 'speedster',
    role: 'Mobility and rapid pressure',
    description:
      'A blur of neon motion. Punishes slow reactions, swaps lanes in a heartbeat and overwhelms with attack tempo.',
    stats: {
      maxHealth: 850,
      attackDamage: 45,
      attackIntervalTicks: secondsToTicks(0.6),
      attackRange: 3,
      moveSpeedPerTick: 0.34,
      isRanged: false,
    },
    tags: ['speedster', 'brawler'],
    ability: {
      id: 'speedster-lane-shift',
      name: 'Lane Shift',
      description: 'Dash instantly to the same position in the other lane.',
      cooldownTicks: secondsToTicks(10),
      kind: 'active',
      effects: {}, // Movement effect — interpreted by the ability system.
    },
    ultimate: {
      id: 'speedster-overclock',
      name: 'Overclock',
      description: 'For 6s, attack twice as fast and move 60% faster.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: {
        durationTicks: secondsToTicks(6),
        attackIntervalMult: 0.5,
        moveSpeedMult: 1.6,
      },
    },
    ultimateChargePerDamageDealt: 0.08,
    ultimateChargePerDamageTaken: 0.04,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'run', 'attack', 'dash', 'ultimate', 'hit', 'death'],
    art: 'champion-speedster',
  },
  {
    id: 'champion-shredder',
    name: 'Shredder',
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
    ultimateChargePerDamageDealt: 0.07,
    ultimateChargePerDamageTaken: 0.05,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'dash', 'ultimate', 'hit', 'death'],
    art: 'champion-shredder',
  },
  {
    id: 'champion-hybrid',
    name: 'Hybrid',
    path: 'hybrid',
    role: 'Adaptable all-rounder',
    description:
      'Balanced in every dimension. Reads the battle and shifts stance to become what the squad needs.',
    stats: {
      maxHealth: 1050,
      attackDamage: 60,
      attackIntervalTicks: secondsToTicks(1.0),
      attackRange: 3.5,
      moveSpeedPerTick: 0.24,
      isRanged: false,
    },
    tags: ['hybrid', 'support'],
    ability: {
      id: 'hybrid-stance-shift',
      name: 'Stance Shift',
      description:
        'Toggle stance for 8s: Bulwark (+30% damage taken reduction) or Assault (+25% damage).',
      cooldownTicks: secondsToTicks(12),
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
      id: 'hybrid-rally',
      name: 'Forge Rally',
      description: 'Allies everywhere gain +25% damage and heal 120 over 5s.',
      cooldownTicks: 0,
      kind: 'ultimate',
      effects: {
        durationTicks: secondsToTicks(5),
        attackDamageMult: 1.25,
        heal: 120,
      },
    },
    ultimateChargePerDamageDealt: 0.06,
    ultimateChargePerDamageTaken: 0.06,
    ultimateChargeRequired: 100,
    animationStates: ['idle', 'walk', 'attack', 'stance', 'ultimate', 'hit', 'death'],
    art: 'champion-hybrid',
  },
];

export function getChampionById(id: string): ChampionDefinition | undefined {
  return CHAMPIONS.find((c) => c.id === id);
}

export function getChampionByPath(path: string): ChampionDefinition | undefined {
  return CHAMPIONS.find((c) => c.path === path);
}
