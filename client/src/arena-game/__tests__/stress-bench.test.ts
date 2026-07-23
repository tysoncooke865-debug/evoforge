/**
 * Headless stress bench (premium program P3) — env-gated like the deep
 * stability harness. Measures the per-tick JS cost of the simulation and of
 * the per-frame render derivations at combatant densities 10/20/30/40 per
 * team, feeding ARENA_STRESS_TEST_REPORT.md.
 *
 *   $env:ARENA_STRESS_BENCH='1'; npx vitest run src/arena-game/__tests__/stress-bench.test.ts
 *
 * Two honest exclusions: `collectCombatFx` and `renderOrder` are
 * module-private inside RN-importing components and cannot load under Node —
 * `deriveCombatSignals` + `computeStackOffsets` cover their dominant costs
 * (the private functions are thin wrappers over these plus O(n log n) sorts).
 *
 * This measures JS cost only. Layout/paint cost is measured by the browser
 * sweep (scripts/arena-stress-measure.mjs); phone-hardware figures remain
 * pending a device pass.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE, getCardById } from '../content';
import { CHAMPIONS } from '../content/champions';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import type { LaneId, TeamId } from '../game-engine/types';
import {
  createLiveBattle,
  stepLiveBattle,
  type LiveBattle,
} from '../features/arena/battle-controller';
import { buildUnitLookup, deriveCombatSignals } from '../features/arena/components/combat-fx';
import { detectFiredAttacks, deriveProjectiles } from '../features/arena/components/impact';
import { computeLaneMomentum, computeStackOffsets } from '../features/arena/components/readability';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

const BENCH = process.env.ARENA_STRESS_BENCH === '1';

const DENSITIES = [10, 20, 30, 40] as const;
const MEASURE_TICKS = 200;
const WARMUP_TICKS = 20;
const RANGED_FRACTION = 0.3;

interface BenchRow {
  density: number;
  medianUnits: number;
  simAvgUs: number;
  simWorstUs: number;
  fxAvgUs: number;
  fxWorstUs: number;
  offsetsAvgUs: number;
  projAvgUs: number;
  logEntriesPerTick: number;
}

function topUp(live: LiveBattle, perTeam: number, counter: { n: number }): void {
  const laneLength = BALANCE.arena.laneLength;
  for (const team of ['player', 'opponent'] as TeamId[]) {
    const alive = live.state.units.filter((u) => u.alive && u.kind === 'unit' && u.team === team);
    let deficit = perTeam - alive.length;
    while (deficit > 0) {
      const ranged = (counter.n % 10) / 10 < RANGED_FRACTION;
      const card = getCardById(ranged ? 'drone-archer' : 'neon-boxer');
      if (!card || !card.unit) throw new Error('bench content missing');
      const lane: LaneId = (counter.n % 2) as LaneId;
      const frac = 0.25 + ((counter.n * 7) % 5) * 0.05;
      const x = team === 'player' ? laneLength * frac : laneLength * (1 - frac);
      const spawned = spawnUnitsForCard(live.state, BALANCE, card, team, lane, x);
      deficit -= spawned.length;
      counter.n++;
    }
  }
}

function benchDensity(density: number): BenchRow {
  const live = createLiveBattle(1234, 'bench', {
    playerChampionId: CHAMPIONS[0].id,
    playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    aiDifficulty: 'standard',
  });
  const counter = { n: 0 };
  topUp(live, density, counter);
  stepLiveBattle(live, WARMUP_TICKS);

  let simTotal = 0;
  let simWorst = 0;
  let fxTotal = 0;
  let fxWorst = 0;
  let offsetsTotal = 0;
  let projTotal = 0;
  let logDelta = 0;
  const unitCounts: number[] = [];
  let prevCooldowns = new Map<number, number>();

  for (let t = 0; t < MEASURE_TICKS; t++) {
    if (t % 20 === 0) topUp(live, density, counter);
    if (live.state.phase === 'finished') break;

    const fromIndex = live.state.log.length;
    const s0 = performance.now();
    stepLiveBattle(live, 1);
    const s1 = performance.now();
    const simMs = s1 - s0;
    simTotal += simMs;
    if (simMs > simWorst) simWorst = simMs;

    const alive = live.state.units.filter((u) => u.alive);
    unitCounts.push(alive.length);
    logDelta += live.state.log.length - fromIndex;

    // The per-frame FX derivation exactly as the screen consumes it: the
    // log delta since the last frame against a fresh unit lookup.
    const f0 = performance.now();
    const lookup = buildUnitLookup(alive);
    deriveCombatSignals(live.state.log, fromIndex, lookup);
    const f1 = performance.now();
    const fxMs = f1 - f0;
    fxTotal += fxMs;
    if (fxMs > fxWorst) fxWorst = fxMs;

    // Projectile detection (cooldown diff) as arena-screen runs it.
    const p0 = performance.now();
    const fired = detectFiredAttacks(alive, prevCooldowns);
    const unitMap = new Map(alive.map((u) => [u.id, u]));
    deriveProjectiles(fired, unitMap);
    prevCooldowns = new Map(alive.map((u) => [u.id, u.attackCooldownTicks]));
    const p1 = performance.now();
    projTotal += p1 - p0;

    // Readability derivations per lane, as lane-strip runs them.
    const o0 = performance.now();
    for (const lane of [0, 1] as LaneId[]) {
      const laneUnits = alive.filter((u) => u.lane === lane);
      computeStackOffsets(laneUnits);
      computeLaneMomentum(laneUnits);
    }
    const o1 = performance.now();
    offsetsTotal += o1 - o0;
  }

  const ticks = unitCounts.length || 1;
  const sorted = [...unitCounts].sort((a, b) => a - b);
  return {
    density,
    medianUnits: sorted[Math.floor(sorted.length / 2)] ?? 0,
    simAvgUs: (simTotal / ticks) * 1000,
    simWorstUs: simWorst * 1000,
    fxAvgUs: (fxTotal / ticks) * 1000,
    fxWorstUs: fxWorst * 1000,
    offsetsAvgUs: (offsetsTotal / ticks) * 1000,
    projAvgUs: (projTotal / ticks) * 1000,
    logEntriesPerTick: logDelta / ticks,
  };
}

describe.skipIf(!BENCH)('arena stress bench (ARENA_STRESS_BENCH=1)', () => {
  it('measures sim + render-derivation cost across densities', () => {
    const rows = DENSITIES.map((d) => benchDensity(d));
    console.table(
      rows.map((r) => ({
        'units/team': r.density,
        'median alive': r.medianUnits,
        'sim avg µs': r.simAvgUs.toFixed(1),
        'sim worst µs': r.simWorstUs.toFixed(0),
        'fx avg µs': r.fxAvgUs.toFixed(1),
        'fx worst µs': r.fxWorstUs.toFixed(0),
        'offsets µs': r.offsetsAvgUs.toFixed(1),
        'proj µs': r.projAvgUs.toFixed(1),
        'log/tick': r.logEntriesPerTick.toFixed(1),
      }))
    );
    // Sanity, not thresholds: the bench must actually have measured combat
    // at every density (falsified once by asserting medianUnits > 1000).
    for (const r of rows) {
      expect(r.medianUnits).toBeGreaterThan(r.density); // both teams populated
      expect(r.simAvgUs).toBeGreaterThan(0);
    }
  });
});
