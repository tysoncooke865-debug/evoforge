/**
 * Mid-match augments (M6). At BALANCE.augment.offerTick each team is offered
 * `choiceCount` of these (drawn deterministically from the battle RNG) and may
 * choose exactly one for the rest of the battle.
 *
 * Array order doubles as the opponent AI's deterministic preference order
 * (earlier = preferred) — keep the strongest general-purpose picks first.
 */
import { secondsToTicks } from './balance';
import type { AugmentDefinition } from './types';

export const AUGMENTS: AugmentDefinition[] = [
  {
    id: 'overcharged-servos',
    name: 'Overcharged Servos',
    description: 'Your combatants deal 10% more damage.',
    effect: { kind: 'team-aura', attackDamageMult: 1.1 },
  },
  {
    id: 'nano-repair-swarm',
    name: 'Nano Repair Swarm',
    description: 'Every 10s, all your combatants recover 40 health.',
    effect: { kind: 'heal-pulse', amount: 40, intervalTicks: secondsToTicks(10) },
  },
  {
    id: 'forge-conduits',
    name: 'Forge Conduits',
    description: 'Forge Energy regenerates 10% faster.',
    effect: { kind: 'energy-regen', regenMult: 1.1 },
  },
  {
    id: 'kinetic-treads',
    name: 'Kinetic Treads',
    description: 'Your combatants move 15% faster.',
    effect: { kind: 'team-aura', moveSpeedMult: 1.15 },
  },
  {
    id: 'prefab-shielding',
    name: 'Prefab Shielding',
    description: 'Fighters you deploy start with a 100-point shield.',
    effect: { kind: 'deploy-shield', amount: 100 },
  },
  {
    id: 'core-reconstruction',
    name: 'Core Reconstruction',
    description: 'Instantly repair your Forge Core for 150.',
    effect: { kind: 'core-repair', amount: 150 },
  },
];

export function getAugmentById(id: string): AugmentDefinition | undefined {
  return AUGMENTS.find((a) => a.id === id);
}
