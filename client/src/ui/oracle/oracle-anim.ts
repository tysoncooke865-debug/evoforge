/**
 * ORACLE_REDESIGN — the reveal primitives used across the Oracle's scan
 * cards. Moved to `ui/core/count-up.ts` on 2026-08-05 once Fuel's hero
 * wanted the exact same count-up beat for the calories-remaining figure —
 * this file re-exports so every existing Oracle import keeps working.
 */
export { useCountUp, useReveal, type RevealPhase } from '@/ui/core/count-up';
