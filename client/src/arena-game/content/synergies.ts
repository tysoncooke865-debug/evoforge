/**
 * Autobattler synergy definitions. Thresholds count distinct living
 * combatants (units + Champion) with the tag on one team.
 */
import type { SynergyDefinition } from './types';

export const SYNERGIES: SynergyDefinition[] = [
  {
    id: 'titan-bulwark',
    name: 'Titan Bulwark',
    description: '3 Titan combatants: frontline gains 8 flat armour per hit.',
    tag: 'titan',
    threshold: 3,
    bonus: { armorFlat: 8 },
  },
  {
    id: 'speedster-momentum',
    name: 'Momentum',
    description: '3 Speedster combatants: +15% movement speed.',
    tag: 'speedster',
    threshold: 3,
    bonus: { moveSpeedMult: 1.15 },
  },
  {
    id: 'support-network',
    name: 'Support Network',
    description: '2 Support combatants: healing effects +25%.',
    tag: 'support',
    threshold: 2,
    bonus: { healingMult: 1.25 },
  },
  {
    id: 'balanced-forge',
    name: 'Balanced Forge',
    description: 'Combatants from 3+ different Paths: +5% damage to everyone.',
    tag: 'mixed-paths',
    threshold: 3,
    bonus: { attackDamageMult: 1.05 },
  },
];
