import { movesForChampion, RECOVER_MOVE } from './moves';
import { hasStatus } from './status';
import type { AiPersonality, BattleMove, Combatant, Rng } from './types';

/**
 * THE AI — lightweight, legal-by-construction. It scores its usable moves by
 * personality and picks the best; it ALWAYS returns a legal action (Recover
 * is the floor), never selects an unaffordable/cooling move, and reacts to
 * health, stamina and statuses. Not random, not omniscient.
 */

export function isMoveUsable(move: BattleMove, c: Combatant): boolean {
  if (move.staminaCost > c.stats.currentStamina) return false;
  if ((c.cooldowns[move.id] ?? 0) > 0) return false;
  return true;
}

/** Pick the AI's move. Guaranteed legal (falls back to Recover). */
export function chooseAiMove(self: Combatant, foe: Combatant, personality: AiPersonality, rng: Rng): BattleMove {
  const pool = movesForChampion(self.championId).filter((m) => isMoveUsable(m, self));
  if (pool.length === 0) return RECOVER_MOVE;

  const selfHpFrac = self.stats.currentHealth / self.stats.maxHealth;
  const foeHpFrac = foe.stats.currentHealth / foe.stats.maxHealth;
  const staminaFrac = self.stats.currentStamina / self.stats.maxStamina;

  const score = (m: BattleMove): number => {
    let s = 1;
    const dmg = m.basePower > 0;
    const finisher = m.category === 'ultimate';

    if (dmg) s += m.basePower * 0.6;
    // Finish the player when they are low.
    if (finisher && foeHpFrac < 0.4) s += 60;
    if (m.conditional?.kind === 'execute_below' && foeHpFrac <= (m.conditional.threshold ?? 0)) s += 50;
    // Exploit statuses.
    if (m.conditional?.kind === 'stronger_if_bleeding' && hasStatus(foe, 'bleed')) s += 25;
    if (m.effects.some((e) => e.status === 'bleed') && !hasStatus(foe, 'bleed')) s += 12;
    // Defensive value when threatened.
    if (m.category === 'defence' && selfHpFrac < 0.4) s += 30;
    // Recovery when gassed.
    if (m.category === 'recovery' && staminaFrac < 0.35) s += 40;
    // Buffs early, not when about to die.
    if (m.category === 'buff') s += selfHpFrac > 0.5 ? 14 : -10;
    // Don't dump the whole stamina bar unless it's worth it.
    if (m.staminaCost > self.stats.currentStamina * 0.7 && !finisher) s -= 15;

    // Personality shaping.
    if (personality === 'aggressive') { if (dmg) s += 18; if (m.category === 'defence') s -= 14; }
    if (personality === 'defensive') { if (m.category === 'defence' || m.category === 'recovery') s += 16; if (finisher) s += 6; }

    return s + rng() * 6; // small jitter to avoid robotic repetition
  };

  let best = pool[0];
  let bestScore = -Infinity;
  for (const m of pool) {
    const sc = score(m);
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  // If the best scoring move is barely better than resting while low on
  // stamina, rest instead (prevents flailing with a single cheap move).
  if (staminaFrac < 0.2 && best.staminaCost > self.stats.currentStamina * 0.6) return RECOVER_MOVE;
  return best;
}
