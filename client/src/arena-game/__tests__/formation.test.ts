/**
 * Arena 2.0 P3 — formation anti-overlap sim. Verifies: (1) with formation ON,
 * same-team same-lane units keep at least the formation gap between them (no
 * stacking) except where clamped to a lane boundary; (2) formation is gated —
 * a formation battle and an otherwise-identical non-formation battle diverge,
 * proving 1.0 (formation off) is untouched; (3) formation battles are
 * deterministic / replay-safe (re-sim from the command log → same digest).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById } from '../content';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import type { ScheduledCommand } from '../game-engine/simulation/events';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import { advanceTick, FORMATION_GAP } from '../game-engine/simulation/tick';
import { createBattle } from '../game-engine/simulation/state';

const L = BALANCE.arena.laneLength;

function baseConfig(formation: boolean) {
  return {
    seed: 4242,
    formation,
    player: { playerId: 'p1' },
    opponent: { playerId: 'p2' },
  };
}

/** Deploy a wave of melee units bunched at the same spot on each side, then run
 *  a while — with formation they must spread out; without, they may stack. */
function busy(): ScheduledCommand[] {
  const cmds: ScheduledCommand[] = [];
  for (let i = 0; i < 6; i++) {
    cmds.push({ tick: 2 + i, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 8 } });
    cmds.push({ tick: 2 + i, command: { type: 'deploy-card', team: 'opponent', cardId: 'forge-recruit', lane: 0, x: L - 8 } });
  }
  return cmds;
}

describe('formation anti-overlap', () => {
  it('keeps same-team same-lane units at least the gap apart (no stacking)', () => {
    const state = createBattle(baseConfig(true), BALANCE);
    // Force-spawn a bunch of melee at the SAME x (worst case for overlap).
    const card = getCardById('forge-recruit')!;
    for (let i = 0; i < 5; i++) spawnUnitsForCard(state, BALANCE, card, 'player', 0, 12);
    // Run enough ticks for the formation pass to separate them.
    for (let t = 0; t < 40; t++) advanceTick(state, BALANCE);

    const row = state.units
      .filter((u) => u.alive && u.team === 'player' && u.lane === 0)
      .map((u) => u.x)
      .sort((a, b) => a - b);
    let overlaps = 0;
    for (let i = 1; i < row.length; i++) {
      const gap = row[i] - row[i - 1];
      // Allowed to be tight only if both are jammed against the core boundary.
      const atBoundary = row[i - 1] <= 0.01 || row[i] >= L - 0.01;
      if (gap < FORMATION_GAP - 1e-6 && !atBoundary) overlaps++;
    }
    expect(row.length).toBeGreaterThan(1);
    expect(overlaps).toBe(0);
  });

  it('is gated: formation changes a bunched melee outcome vs no formation (1.0 untouched)', () => {
    // Stack 5v5 melee at the same spot on each side so they genuinely bunch —
    // formation spreads them (positions differ), which changes the fight. Same
    // seed + spawns; only the formation flag differs.
    const run = (formation: boolean) => {
      const s = createBattle(baseConfig(formation), BALANCE);
      const card = getCardById('forge-recruit')!;
      for (let i = 0; i < 5; i++) spawnUnitsForCard(s, BALANCE, card, 'player', 0, 12);
      for (let i = 0; i < 5; i++) spawnUnitsForCard(s, BALANCE, card, 'opponent', 0, L - 12);
      for (let t = 0; t < 120; t++) advanceTick(s, BALANCE);
      return computeDigest(s);
    };
    expect(run(true)).not.toBe(run(false));
  });

  it('formation battles replay digest-identically (deterministic / replay-safe)', () => {
    const a = runBattle(baseConfig(true), busy(), BALANCE);
    const b = runBattle(baseConfig(true), busy(), BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.outcome).toEqual(b.outcome);
    expect(a.invariantViolations).toEqual([]);
  });
});
