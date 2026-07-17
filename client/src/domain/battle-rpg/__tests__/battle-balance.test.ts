import { describe, expect, it } from 'vitest';

import { chooseAiMove } from '../ai';
import { buildCombatant, createBattle, resolveTurn } from '../engine';
import { createBattleStats } from '../stat-scaler';
import { styleEffectiveness, styleMultiplier, CHAMPION_STYLE } from '../style';
import type { ChampionId, BattleState } from '../types';

/**
 * THE BALANCE SIM (FireRed plan Phase C) — with the style triangle live,
 * prove no champion dominates. AI-vs-AI (balanced personality, both sides)
 * across all 16 matchups on identical training-scaled stats, seeded RNG so
 * the sim is exact and fast. The invariants:
 *   - counter matchups tilt (the triangle MEANS something) but never wall
 *     (the countered side still takes ≥15% of games);
 *   - every champion's aggregate win rate across all opponents stays inside
 *     [0.30, 0.70] — rock-paper-scissors balances the wheel.
 */

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

const IDS: ChampionId[] = ['aesthetic', 'titan', 'apex', 'shredded'];
const BATTLES_PER_MATCHUP = 40;
const MAX_TURNS = 60;

function runBattle(a: ChampionId, b: ChampionId, rng: () => number): 'player' | 'opponent' {
  const player = buildCombatant({ championId: a, name: a, stats: createBattleStats(a, null, 'training'), spriteBranch: 'aesthetic', spriteStage: 3 });
  const opponent = buildCombatant({ championId: b, name: b, stats: createBattleStats(b, null, 'training'), spriteBranch: 'aesthetic', spriteStage: 3 });
  let state: BattleState = createBattle('sim', 'training', player, opponent);
  for (let t = 0; t < MAX_TURNS && !state.winner; t++) {
    const pMove = chooseAiMove(state.player, state.opponent, 'balanced', rng);
    const oMove = chooseAiMove(state.opponent, state.player, 'balanced', rng);
    state = resolveTurn(state, pMove, oMove, rng);
  }
  // A stalled battle counts for whoever holds more health — never undefined.
  if (state.winner) return state.winner;
  return state.player.stats.currentHealth / state.player.stats.maxHealth >=
    state.opponent.stats.currentHealth / state.opponent.stats.maxHealth
    ? 'player'
    : 'opponent';
}

describe('style triangle', () => {
  it('the wheel turns: FORCE > FORM > FLOW > FORCE, ×1.3 / ×0.77', () => {
    expect(styleMultiplier(styleEffectiveness('force', 'form'))).toBe(1.3);
    expect(styleMultiplier(styleEffectiveness('form', 'flow'))).toBe(1.3);
    expect(styleMultiplier(styleEffectiveness('flow', 'force'))).toBe(1.3);
    expect(styleMultiplier(styleEffectiveness('form', 'force'))).toBe(0.77);
    expect(styleMultiplier(styleEffectiveness('flow', 'form'))).toBe(0.77);
    expect(styleMultiplier(styleEffectiveness('force', 'flow'))).toBe(0.77);
    expect(styleMultiplier(styleEffectiveness('force', 'force'))).toBe(1);
    expect(styleMultiplier(styleEffectiveness('form', 'form'))).toBe(1);
  });
});

describe('AI-vs-AI balance sim', () => {
  // One deterministic sweep, shared by both assertions.
  const wins: Record<ChampionId, number> = { aesthetic: 0, titan: 0, apex: 0, shredded: 0 };
  const games: Record<ChampionId, number> = { aesthetic: 0, titan: 0, apex: 0, shredded: 0 };
  const matchupWins = new Map<string, number>();
  const rng = seeded(20260718);
  for (const a of IDS) {
    for (const b of IDS) {
      if (a === b) continue;
      let aWins = 0;
      for (let g = 0; g < BATTLES_PER_MATCHUP; g++) {
        const w = runBattle(a, b, rng);
        if (w === 'player') aWins++;
      }
      matchupWins.set(`${a}>${b}`, aWins);
      wins[a] += aWins;
      wins[b] += BATTLES_PER_MATCHUP - aWins;
      games[a] += BATTLES_PER_MATCHUP;
      games[b] += BATTLES_PER_MATCHUP;
    }
  }

  // Diagnostic table — printed so a failing bound is tunable at a glance.
  console.log(
    [...matchupWins.entries()].map(([k, v]) => `${k}: ${(v / BATTLES_PER_MATCHUP).toFixed(2)}`).join('  ') +
      '  || ' +
      IDS.map((id) => `${id}=${(wins[id] / games[id]).toFixed(2)}`).join(' ')
  );

  it('ran a non-empty sweep (guards cannot pass vacuously)', () => {
    expect(matchupWins.size).toBe(12);
    for (const id of IDS) expect(games[id]).toBeGreaterThan(0);
  });

  it('no champion dominates: aggregate win rate within [0.30, 0.70]', () => {
    for (const id of IDS) {
      const rate = wins[id] / games[id];
      expect(rate, `${id} aggregate win rate ${rate.toFixed(2)}`).toBeGreaterThanOrEqual(0.3);
      expect(rate, `${id} aggregate win rate ${rate.toFixed(2)}`).toBeLessThanOrEqual(0.7);
    }
  });

  it('counter matchups tilt but never wall (loser still takes ≥15%)', () => {
    for (const a of IDS) {
      for (const b of IDS) {
        if (a === b) continue;
        const rate = (matchupWins.get(`${a}>${b}`) ?? 0) / BATTLES_PER_MATCHUP;
        expect(rate, `${a} (${CHAMPION_STYLE[a]}) vs ${b} (${CHAMPION_STYLE[b]}) win rate ${rate.toFixed(2)}`).toBeGreaterThanOrEqual(0.15);
        expect(rate, `${a} vs ${b}`).toBeLessThanOrEqual(0.85);
      }
    }
  });
});
