import { chooseAiMove } from './ai';
import { championForBranch } from './champions';
import { buildCombatant, createBattle, resolveTurn } from './engine';
import { createBattleStats } from './stat-scaler';
import type { BattleState, SpriteBranch } from './types';

/**
 * GYM-vs-GYM BATTLE (Tyson, 2026-07-19) — a REAL fight through the RPG combat
 * engine, member-vs-member. Each gym's roster (from gym_battle_prepare) is
 * paired seat-for-seat by descending rating; each pairing is a full headless
 * battle (the exact loop the balance sim runs), and the gym that wins the most
 * duels wins. A missing seat on one side is a bye (the deeper roster's member
 * takes the point).
 *
 * DETERMINISTIC: seeded from the server-chosen seed so the same rosters + seed
 * always produce the same result — reproducible and auditable. Gym battles
 * grant nothing farmable (win/loss record only), so running the client-only
 * engine here has no exploit surface (see migration 070).
 */

export interface GymCombatMember {
  user_id: string;
  name: string;
  path: string | null;
  size: number;
  aes: number;
  str: number;
  cnd: number;
}

export interface GymDuel {
  a_name: string;
  b_name: string;
  winner: 'a' | 'b';
  a_hp_pct: number;
  b_hp_pct: number;
}

export interface GymBattleResult {
  a_score: number;
  b_score: number;
  duels: GymDuel[];
}

/** mulberry32 — the same seeded PRNG the balance sim uses (exact + fast). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_TURNS = 60;

function makeFighter(m: GymCombatMember) {
  const branch = (m.path ?? 'aesthetic') as SpriteBranch;
  const champ = championForBranch(branch);
  const stats = createBattleStats(champ, { size: m.size, aes: m.aes, str: m.str, cnd: m.cnd }, 'gym');
  return buildCombatant({ championId: champ, name: m.name, stats, spriteBranch: branch, spriteStage: 3 });
}

function duel(a: GymCombatMember, b: GymCombatMember, rng: () => number): GymDuel {
  let state: BattleState = createBattle('gym', 'gym', makeFighter(a), makeFighter(b));
  for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
    const pMove = chooseAiMove(state.player, state.opponent, 'balanced', rng);
    const oMove = chooseAiMove(state.opponent, state.player, 'balanced', rng);
    state = resolveTurn(state, pMove, oMove, rng);
  }
  const aHp = state.player.stats.currentHealth / state.player.stats.maxHealth;
  const bHp = state.opponent.stats.currentHealth / state.opponent.stats.maxHealth;
  // A stalled duel goes to whoever holds more health — never a non-result.
  const winner: 'a' | 'b' =
    state.winner === 'player' ? 'a' : state.winner === 'opponent' ? 'b' : aHp >= bHp ? 'a' : 'b';
  return { a_name: a.name, b_name: b.name, winner, a_hp_pct: Math.round(aHp * 100), b_hp_pct: Math.round(bHp * 100) };
}

export function runGymBattle(
  my: readonly GymCombatMember[],
  opp: readonly GymCombatMember[],
  seed: number
): GymBattleResult {
  const n = Math.max(my.length, opp.length);
  const duels: GymDuel[] = [];
  let a_score = 0;
  let b_score = 0;
  const rng = seeded(seed || 1);
  for (let i = 0; i < n; i++) {
    const am = my[i];
    const bm = opp[i];
    if (am && bm) {
      const d = duel(am, bm, rng);
      duels.push(d);
      if (d.winner === 'a') a_score += 1;
      else b_score += 1;
    } else if (am) {
      a_score += 1;
      duels.push({ a_name: am.name, b_name: '—', winner: 'a', a_hp_pct: 100, b_hp_pct: 0 });
    } else if (bm) {
      b_score += 1;
      duels.push({ a_name: '—', b_name: bm.name, winner: 'b', a_hp_pct: 0, b_hp_pct: 100 });
    }
  }
  return { a_score, b_score, duels };
}
