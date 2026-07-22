/**
 * Autobattler synergy definitions. Thresholds count distinct living
 * combatants (units + Champion) with the tag on one team.
 */
import type { SynergyDefinition } from './types';

export const SYNERGIES: SynergyDefinition[] = [
  // ── One path synergy per official Avatar Path (aesthetic/titan/mass/
  // shredder/cardio — content validation enforces this coverage) ──────────
  {
    id: 'aesthetic-poise',
    name: 'Poise',
    description: '2 Aesthetic combatants: +10% movement speed.',
    tag: 'aesthetic',
    threshold: 2,
    bonus: { moveSpeedMult: 1.1 },
  },
  {
    id: 'titan-bulwark',
    name: 'Titan Bulwark',
    description: '3 Titan combatants: frontline gains 8 flat armour per hit.',
    tag: 'titan',
    threshold: 3,
    bonus: { armorFlat: 8 },
  },
  {
    id: 'mass-presence',
    name: 'Mass Presence',
    description: '2 Mass combatants: frontline gains 4 flat armour per hit.',
    tag: 'mass',
    threshold: 2,
    bonus: { armorFlat: 4 },
  },
  {
    id: 'shredder-cut-deep',
    name: 'Cut Deep',
    description: '3 Shredder combatants: +12% damage.',
    tag: 'shredder',
    threshold: 3,
    bonus: { attackDamageMult: 1.12 },
  },
  {
    id: 'cardio-momentum',
    name: 'Momentum',
    description: '3 Cardio combatants: +15% movement speed.',
    tag: 'cardio',
    threshold: 3,
    bonus: { moveSpeedMult: 1.15 },
  },

  // ── Cross-path synergies ─────────────────────────────────────────────────
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
