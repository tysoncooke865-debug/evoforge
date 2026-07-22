/**
 * Milestone 10 — STABILITY HARNESS + RANKED SIMULATION + SAVE/RESTART GATES.
 *
 * 1. Stability harness: 117 fully automated AI-vs-AI matches run headless —
 *    both sides driven by the SAME opponent-AI heuristics (the player team
 *    via the mirrored-view driver in features/arena/ai-driver.ts) across
 *    seeds x difficulties x configs (with/without champions, squads, decks,
 *    fitness scaling). Hard gates: zero stalls, zero invariant violations,
 *    zero thrown errors, every match produces a valid outcome, and the
 *    master prompt's acceptance criterion "20 consecutive automated matches
 *    finish without deadlock" as an explicit sub-test. Per-tick invariants
 *    are checked on half the matches (>= 50) for speed; the other half run
 *    unchecked and are still gated on stalls/outcomes/errors. Win rates are
 *    logged as a distribution and asserted only for sanity (neither side
 *    wins 100% across the full mixed set).
 *
 * 2. Ranked simulation: battle mode 'ranked' is functionally identical to
 *    'standard' (the beta treats standard battles AS the ranked ladder) —
 *    rank points move identically, records persist on the standard ladder,
 *    and every scaling in a ranked config respects the fitness cap
 *    (services/progression/ranked.ts).
 *
 * 3. Save/restart gates: full save round-trip at the CURRENT schema (v3,
 *    incl. gym war stats) and both documented migration chains (v1→v3,
 *    v2→v3) landing valid saves.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../content';
import type { AiDifficulty } from '../content';
import { createPlayerAiDriver, runPlayerAi } from '../features/arena/ai-driver';
import {
  createLiveBattle,
  LiveBattle,
  LiveBattleOptions,
  liveDigest,
  stepLiveBattle,
} from '../features/arena/battle-controller';
import { createBattleStore } from '../features/arena/battle-store';
import {
  computeFitnessScaling,
  FitnessRatings,
  NEUTRAL_SCALING,
} from '../game-engine/balance/fitness-scaling';
import { seedFromString } from '../game-engine/random/rng';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { verifyBattleRecord } from '../game-engine/simulation/replay';
import { runBattle } from '../game-engine/simulation/run';
import { LocalMockPlayerProvider } from '../integration/evoforge/local-mock-provider';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymProfile,
  PlayerProfile,
} from '../integration/evoforge/types';
import { loadBattleRecords } from '../services/persistence/battle-records';
import {
  createDefaultGymState,
  createDefaultSave,
  DEFAULT_DECK_CARD_IDS,
  isValidSave,
  loadSave,
  persistSave,
  SAVE_KEY,
  SAVE_VERSION,
  SaveData,
} from '../services/persistence/save';
import { KeyValueStorage, MemoryStorage } from '../services/persistence/storage';
import { createPlayerStore } from '../services/player-data/player-store';
import {
  battleConfigWithinRankedCap,
  isWithinRankedCap,
  totalScalingAdvantage,
} from '../services/progression/ranked';

/** Engine backstop: timeout + sudden death + margin. Never reached by a healthy battle. */
const MAX_TICKS = BALANCE.battle.durationTicks + BALANCE.battle.suddenDeathTicks + 10;

const CHAMPION_IDS = [
  'champion-titan',
  'champion-speedster',
  'champion-shredder',
  'champion-hybrid',
] as const;

const ALL_DIFFICULTIES: readonly AiDifficulty[] = ['training', 'standard', 'advanced'];

function rotChampion(n: number): string {
  return CHAMPION_IDS[((n % CHAMPION_IDS.length) + CHAMPION_IDS.length) % CHAMPION_IDS.length];
}

function strongScaling() {
  const ratings: FitnessRatings = {
    strength: 90,
    cardio: 75,
    muscularity: 85,
    leanness: 70,
    aesthetics: 95,
  };
  return computeFitnessScaling(ratings, BALANCE);
}

function maxedScaling() {
  const ratings: FitnessRatings = {
    strength: 100,
    cardio: 100,
    muscularity: 100,
    leanness: 100,
    aesthetics: 100,
  };
  return computeFitnessScaling(ratings, BALANCE);
}

// ---------------------------------------------------------------------------
// Match harness
// ---------------------------------------------------------------------------

type ConfigKind = 'full' | 'decks-only' | 'free-pool' | 'squads' | 'scaled';
const CONFIG_KINDS: readonly ConfigKind[] = [
  'full',
  'decks-only',
  'free-pool',
  'squads',
  'scaled',
];

interface MatchSpec {
  seed: number;
  playerDifficulty: AiDifficulty;
  opponentDifficulty: AiDifficulty;
  config: ConfigKind;
  /** Run checkInvariants after EVERY tick of this match. */
  checkEveryTick: boolean;
}

interface MatchOutcome {
  spec: MatchSpec;
  /** Battle reached 'finished' with a structurally valid outcome. */
  finished: boolean;
  /** Loop hit the tick backstop without the engine finishing (must never happen). */
  stalled: boolean;
  error: string | null;
  winner: 'player' | 'opponent' | 'draw' | null;
  endTick: number;
  violations: string[];
  rejectedCount: number;
  playerCommandCount: number;
  opponentCommandCount: number;
  digest: number;
  playerChampionId: string | null;
  opponentChampionId: string | null;
  /** Card plays (deploy + technique) split by whether the playing side won. */
  cardUse: Record<string, { byWinner: number; byLoser: number }>;
}

function specLabel(spec: MatchSpec): string {
  return `${spec.config}/${spec.playerDifficulty}-vs-${spec.opponentDifficulty}/seed=${spec.seed}`;
}

function optionsFor(spec: MatchSpec): LiveBattleOptions {
  const { seed, config, opponentDifficulty } = spec;
  const decks = {
    playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
  };
  switch (config) {
    case 'full':
      return { ...decks, playerChampionId: rotChampion(seed), aiDifficulty: opponentDifficulty };
    case 'decks-only':
      return { ...decks, aiDifficulty: opponentDifficulty };
    case 'free-pool':
      // No decks, no champions — legacy free-deploy fighters on both sides.
      return { aiDifficulty: opponentDifficulty };
    case 'squads': {
      // Gym-war-shaped: captains + borrowed auto-cast champions, mixed
      // fitness scalings (always inside the ranked cap by construction).
      // The bigger squad (3 borrowed + scaled captain) alternates sides by
      // seed parity so the aggregate win rate measures the engine, not a
      // baked-in material advantage for one side (a 3-vs-2 borrowed squad
      // reliably wins — see the harness report).
      const bigSquad = {
        captain: { championId: rotChampion(seed + 3), scaling: strongScaling() },
        borrowed: [
          { championId: rotChampion(seed), lane: 1 as const },
          { championId: rotChampion(seed + 1), lane: 0 as const },
          { championId: rotChampion(seed + 2), lane: 1 as const },
        ],
      };
      const smallSquad = {
        captain: { championId: rotChampion(seed) },
        borrowed: [
          { championId: rotChampion(seed + 1), lane: 1 as const, sourcePlayerId: 'stab-member-a' },
          {
            championId: rotChampion(seed + 2),
            lane: 0 as const,
            scaling: strongScaling(),
            sourcePlayerId: 'stab-member-b',
          },
        ],
      };
      const playerGetsBig = seed % 2 === 0;
      return {
        ...decks,
        aiDifficulty: opponentDifficulty,
        playerSquad: playerGetsBig ? bigSquad : smallSquad,
        opponentSquad: playerGetsBig ? smallSquad : bigSquad,
        opponentPlayerId: 'gym-stability-rival',
      };
    }
    case 'scaled':
      return {
        ...decks,
        playerChampionId: rotChampion(seed + 2),
        playerChampionScaling: maxedScaling(),
        aiDifficulty: opponentDifficulty,
      };
  }
}

/** Drives one full AI-vs-AI battle and returns the finished LiveBattle. */
function playLive(spec: MatchSpec, violations: string[]): LiveBattle {
  const live = createLiveBattle(spec.seed, 'stability-player', optionsFor(spec));
  const driver = createPlayerAiDriver(spec.seed, spec.playerDifficulty);
  while (live.state.phase !== 'finished' && live.state.tick <= MAX_TICKS) {
    // Player AI first, opponent AI inside stepLiveBattle — both queue for the
    // NEXT tick through the ordinary command log (replay-exact).
    runPlayerAi(live.state, live.commandLog, driver);
    stepLiveBattle(live, 1);
    if (spec.checkEveryTick) {
      const v = checkInvariants(live.state, BALANCE);
      if (v.length > 0) violations.push(...v.map((x) => `tick ${live.state.tick}: ${x}`));
    }
  }
  return live;
}

function runMatch(spec: MatchSpec): MatchOutcome {
  const out: MatchOutcome = {
    spec,
    finished: false,
    stalled: false,
    error: null,
    winner: null,
    endTick: 0,
    violations: [],
    rejectedCount: 0,
    playerCommandCount: 0,
    opponentCommandCount: 0,
    digest: 0,
    playerChampionId: null,
    opponentChampionId: null,
    cardUse: {},
  };
  try {
    const live = playLive(spec, out.violations);
    out.stalled = live.state.phase !== 'finished';
    const outcome = live.state.outcome;
    out.finished =
      !out.stalled &&
      outcome !== null &&
      (outcome.winner === 'player' || outcome.winner === 'opponent' || outcome.winner === 'draw') &&
      Number.isInteger(outcome.endTick) &&
      outcome.endTick >= 1 &&
      outcome.endTick <= MAX_TICKS;
    if (outcome) {
      out.winner = outcome.winner;
      out.endTick = outcome.endTick;
    }
    out.rejectedCount = live.rejected.length;
    for (const { command } of live.commandLog) {
      if (command.team === 'player') out.playerCommandCount++;
      else out.opponentCommandCount++;
      if (
        (command.type === 'deploy-card' || command.type === 'play-card') &&
        (out.winner === 'player' || out.winner === 'opponent')
      ) {
        const bucket = (out.cardUse[command.cardId] ??= { byWinner: 0, byLoser: 0 });
        if (command.team === out.winner) bucket.byWinner++;
        else bucket.byLoser++;
      }
    }
    out.digest = liveDigest(live);
    out.playerChampionId =
      live.config.player.squad?.captain.championId ?? live.config.player.championId ?? null;
    out.opponentChampionId =
      live.config.opponent.squad?.captain.championId ?? live.config.opponent.championId ?? null;
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return out;
}

function buildSpecs(): MatchSpec[] {
  const specs: MatchSpec[] = [];
  let index = 0;
  const mirrorSeeds = [11, 137, 4242, 9001, 20260722, 555443, 987654];
  for (const difficulty of ALL_DIFFICULTIES) {
    for (const config of CONFIG_KINDS) {
      for (const s of mirrorSeeds) {
        specs.push({
          seed: seedFromString(`stability:${difficulty}:${config}:${s}`),
          playerDifficulty: difficulty,
          opponentDifficulty: difficulty,
          config,
          checkEveryTick: index++ % 2 === 0,
        });
      }
    }
  }
  // Cross-difficulty matches keep the "neither side wins 100%" sanity check
  // honest: an advanced driver against a training opponent (and vice versa)
  // guarantees genuinely mixed outcomes across the full set.
  const crossPairs: readonly (readonly [AiDifficulty, AiDifficulty])[] = [
    ['advanced', 'training'],
    ['training', 'advanced'],
    ['standard', 'training'],
    ['training', 'standard'],
    ['advanced', 'standard'],
    ['standard', 'advanced'],
  ];
  for (const [playerDifficulty, opponentDifficulty] of crossPairs) {
    for (const s of [77, 20101]) {
      specs.push({
        seed: seedFromString(`stability-cross:${playerDifficulty}:${opponentDifficulty}:${s}`),
        playerDifficulty,
        opponentDifficulty,
        config: 'full',
        checkEveryTick: index++ % 2 === 0,
      });
    }
  }
  return specs;
}

interface WinAgg {
  player: number;
  opponent: number;
  draw: number;
  ticks: number;
  n: number;
}

function emptyAgg(): WinAgg {
  return { player: 0, opponent: 0, draw: 0, ticks: 0, n: 0 };
}

function addToAgg(agg: WinAgg, r: MatchOutcome): void {
  agg.n++;
  agg.ticks += r.endTick;
  if (r.winner === 'player') agg.player++;
  else if (r.winner === 'opponent') agg.opponent++;
  else if (r.winner === 'draw') agg.draw++;
}

function aggLine(label: string, agg: WinAgg): string {
  if (agg.n === 0) return `  ${label}: (none)`;
  const pct = (n: number) => `${((100 * n) / agg.n).toFixed(0)}%`;
  const avgTicks = agg.ticks / agg.n;
  return (
    `  ${label}: n=${agg.n} player ${agg.player} (${pct(agg.player)}) / ` +
    `opponent ${agg.opponent} (${pct(agg.opponent)}) / draw ${agg.draw} (${pct(agg.draw)}) | ` +
    `avg ${avgTicks.toFixed(0)} ticks (${(avgTicks / BALANCE.ticksPerSecond).toFixed(1)}s)`
  );
}

describe('M10 stability harness — 100+ automated AI-vs-AI matches', () => {
  let results: MatchOutcome[] = [];
  let checkedCount = 0;
  let uncheckedCount = 0;

  beforeAll(() => {
    const specs = buildSpecs();
    results = specs.map(runMatch);
    checkedCount = results.filter((r) => r.spec.checkEveryTick).length;
    uncheckedCount = results.length - checkedCount;

    // ---- report (numbers logged for the balance pass; assertions below) ----
    const durations = results.map((r) => r.endTick).filter((t) => t > 0);
    const avgTicks = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length);
    const totalRejected = results.reduce((a, r) => a + r.rejectedCount, 0);
    const matchesWithRejections = results.filter((r) => r.rejectedCount > 0).length;
    const mirror = results.filter((r) => r.spec.playerDifficulty === r.spec.opponentDifficulty);
    const cross = results.filter((r) => r.spec.playerDifficulty !== r.spec.opponentDifficulty);

    const perDifficulty = new Map<string, WinAgg>();
    for (const r of mirror) {
      const key = r.spec.opponentDifficulty;
      if (!perDifficulty.has(key)) perDifficulty.set(key, emptyAgg());
      addToAgg(perDifficulty.get(key)!, r);
    }
    const perConfig = new Map<string, WinAgg>();
    for (const r of results) {
      if (!perConfig.has(r.spec.config)) perConfig.set(r.spec.config, emptyAgg());
      addToAgg(perConfig.get(r.spec.config)!, r);
    }
    const perCross = new Map<string, WinAgg>();
    for (const r of cross) {
      const key = `${r.spec.playerDifficulty}-vs-${r.spec.opponentDifficulty}`;
      if (!perCross.has(key)) perCross.set(key, emptyAgg());
      addToAgg(perCross.get(key)!, r);
    }
    const perChampion = new Map<string, { fielded: number; won: number }>();
    for (const r of results) {
      for (const [champ, side] of [
        [r.playerChampionId, 'player'],
        [r.opponentChampionId, 'opponent'],
      ] as const) {
        if (!champ) continue;
        if (!perChampion.has(champ)) perChampion.set(champ, { fielded: 0, won: 0 });
        const c = perChampion.get(champ)!;
        c.fielded++;
        if (r.winner === side) c.won++;
      }
    }

    const lines: string[] = [
      'STABILITY REPORT',
      `matches: ${results.length} | completed: ${results.filter((r) => r.finished).length} | ` +
        `stalled: ${results.filter((r) => r.stalled).length} | ` +
        `errors: ${results.filter((r) => r.error !== null).length} | ` +
        `draws: ${results.filter((r) => r.winner === 'draw').length}`,
      `invariants: checked every tick on ${checkedCount} matches ` +
        `(violations: ${results.reduce((a, r) => a + r.violations.length, 0)}), ` +
        `unchecked (speed) on ${uncheckedCount}`,
      `avg duration: ${avgTicks.toFixed(0)} ticks (${(avgTicks / BALANCE.ticksPerSecond).toFixed(1)}s) | ` +
        `min ${Math.min(...durations)} | max ${Math.max(...durations)} | ` +
        `design timeout ${BALANCE.battle.durationTicks} ticks`,
      `rejected commands (documented same-tick invalidations, report-only): ` +
        `${totalRejected} across ${matchesWithRejections} matches`,
      'win rates — mirror set (same difficulty both sides):',
      ...[...perDifficulty.entries()].map(([k, v]) => aggLine(k, v)),
      'win rates — cross-difficulty set (playerDiff-vs-opponentDiff):',
      ...[...perCross.entries()].map(([k, v]) => aggLine(k, v)),
      'win rates — per config (full mixed set):',
      ...[...perConfig.entries()].map(([k, v]) => aggLine(k, v)),
      'captain champions — fielded/won (either side, full mixed set):',
      ...[...perChampion.entries()].map(
        ([k, v]) => `  ${k}: fielded ${v.fielded}, won ${v.won} (${((100 * v.won) / v.fielded).toFixed(0)}%)`
      ),
      'card plays — winner share (plays by the eventual winner / all plays):',
      ...(() => {
        const perCard = new Map<string, { byWinner: number; byLoser: number }>();
        for (const r of results) {
          for (const [card, use] of Object.entries(r.cardUse)) {
            if (!perCard.has(card)) perCard.set(card, { byWinner: 0, byLoser: 0 });
            const c = perCard.get(card)!;
            c.byWinner += use.byWinner;
            c.byLoser += use.byLoser;
          }
        }
        return [...perCard.entries()]
          .map(([card, c]) => ({ card, total: c.byWinner + c.byLoser, share: c.byWinner / (c.byWinner + c.byLoser) }))
          .sort((a, b) => b.share - a.share)
          .map((x) => `  ${x.card}: ${(100 * x.share).toFixed(0)}% of ${x.total} plays`);
      })(),
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  }, 180_000);

  it('runs at least 100 matches, with per-tick invariants on at least 50', () => {
    expect(results.length).toBeGreaterThanOrEqual(100);
    expect(checkedCount).toBeGreaterThanOrEqual(50);
    expect(uncheckedCount).toBeGreaterThanOrEqual(1);
  });

  it('zero thrown errors', () => {
    const errors = results
      .filter((r) => r.error !== null)
      .map((r) => `${specLabel(r.spec)}: ${r.error}`);
    expect(errors).toEqual([]);
  });

  it('zero stalled matches (every battle terminates inside the engine backstop)', () => {
    const stalled = results.filter((r) => r.stalled).map((r) => specLabel(r.spec));
    expect(stalled).toEqual([]);
  });

  it('zero invariant violations across every checked tick of every checked match', () => {
    const violations = results
      .filter((r) => r.violations.length > 0)
      .map((r) => `${specLabel(r.spec)}: ${r.violations.slice(0, 3).join('; ')}`);
    expect(violations).toEqual([]);
  });

  it('every match produces exactly one valid outcome', () => {
    const invalid = results
      .filter((r) => !r.finished)
      .map((r) => `${specLabel(r.spec)}: winner=${String(r.winner)} endTick=${r.endTick}`);
    expect(invalid).toEqual([]);
  });

  it('both AIs actually command their teams in every match', () => {
    const inert = results
      .filter((r) => r.playerCommandCount === 0 || r.opponentCommandCount === 0)
      .map(
        (r) =>
          `${specLabel(r.spec)}: player=${r.playerCommandCount} opponent=${r.opponentCommandCount}`
      );
    expect(inert).toEqual([]);
  });

  it('win-rate sanity: neither side wins 100% across the full mixed set', () => {
    const playerWins = results.filter((r) => r.winner === 'player').length;
    const opponentWins = results.filter((r) => r.winner === 'opponent').length;
    expect(playerWins).toBeGreaterThanOrEqual(1);
    expect(opponentWins).toBeGreaterThanOrEqual(1);
  });

  it(
    'acceptance: 20 consecutive automated matches finish without deadlock',
    { timeout: 120_000 },
    () => {
      for (let k = 0; k < 20; k++) {
        const spec: MatchSpec = {
          seed: seedFromString(`stability-consecutive:${k}`),
          playerDifficulty: 'standard',
          opponentDifficulty: 'standard',
          config: k % 2 === 0 ? 'full' : 'squads',
          checkEveryTick: true,
        };
        const r = runMatch(spec);
        expect(r.error, `match ${k + 1}/20 (${specLabel(spec)})`).toBeNull();
        expect(r.stalled, `match ${k + 1}/20 (${specLabel(spec)})`).toBe(false);
        expect(r.finished, `match ${k + 1}/20 (${specLabel(spec)})`).toBe(true);
        expect(r.violations, `match ${k + 1}/20 (${specLabel(spec)})`).toEqual([]);
      }
    }
  );

  it('AI-vs-AI matches are deterministic: same spec twice → identical digests', { timeout: 60_000 }, () => {
    const specs: MatchSpec[] = [
      {
        seed: seedFromString('stability-determinism:a'),
        playerDifficulty: 'standard',
        opponentDifficulty: 'standard',
        config: 'full',
        checkEveryTick: false,
      },
      {
        seed: seedFromString('stability-determinism:b'),
        playerDifficulty: 'advanced',
        opponentDifficulty: 'training',
        config: 'squads',
        checkEveryTick: false,
      },
    ];
    for (const spec of specs) {
      const a = runMatch(spec);
      const b = runMatch(spec);
      expect(a.error).toBeNull();
      expect(a.digest, specLabel(spec)).toBe(b.digest);
      expect(a.endTick, specLabel(spec)).toBe(b.endTick);
      expect(a.winner, specLabel(spec)).toBe(b.winner);
    }
  });

  it(
    'recorded command logs replay digest-identically through runBattle with no AI present',
    { timeout: 60_000 },
    () => {
      for (const config of ['full', 'squads', 'free-pool'] as const) {
        const spec: MatchSpec = {
          seed: seedFromString(`stability-replay:${config}`),
          playerDifficulty: 'standard',
          opponentDifficulty: 'standard',
          config,
          checkEveryTick: false,
        };
        const live = playLive(spec, []);
        expect(live.state.phase, config).toBe('finished');
        expect(
          live.commandLog.some((c) => c.command.team === 'player'),
          config
        ).toBe(true);
        const rerun = runBattle(live.config, live.commandLog, BALANCE);
        expect(rerun.digest, config).toBe(liveDigest(live));
        expect(rerun.outcome, config).toEqual(live.state.outcome);
        expect(rerun.invariantViolations, config).toEqual([]);
        expect(rerun.stalled, config).toBe(false);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// Ranked simulation (M10)
// ---------------------------------------------------------------------------

describe('ranked simulation — mode ranked ≡ standard, cap enforced', () => {
  const RANKED_SEED = 991177;

  function makeFakeProvider(): { provider: EvoForgePlayerProvider; calls: BattleResult[] } {
    const calls: BattleResult[] = [];
    const provider: EvoForgePlayerProvider = {
      async getCurrentPlayer(): Promise<PlayerProfile> {
        return {
          playerId: 'p1',
          displayName: 'Stability Tester',
          championId: 'champion-titan',
          rankPoints: 0,
        };
      },
      async getFitnessProfile(): Promise<FitnessProfile> {
        throw new Error('not used by this test');
      },
      async getGymProfile(): Promise<GymProfile | null> {
        return null;
      },
      async getGymMembers() {
        return [];
      },
      async listRivalGyms() {
        return [];
      },
      async recordBattleResult(result: BattleResult): Promise<void> {
        calls.push(result);
      },
    };
    return { provider, calls };
  }

  const rankedOptions: LiveBattleOptions = {
    playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
    opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    playerChampionId: 'champion-titan',
    playerChampionScaling: maxedScaling(),
    aiDifficulty: 'advanced',
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'a ranked battle records a mode-ranked result with standard rank-point movement and persists a verifiable standard-ladder record',
    { timeout: 120_000 },
    async () => {
      const { provider, calls } = makeFakeProvider();
      const storage = new MemoryStorage();
      const store = createBattleStore({ current: provider }, { current: storage });

      store.getState().start(RANKED_SEED, 'p1', rankedOptions, 'ranked');
      expect(store.getState().mode).toBe('ranked');
      await vi.advanceTimersByTimeAsync((MAX_TICKS + 100) * 50);
      expect(store.getState().status).toBe('finished');

      // Provider result: mode 'ranked', rank delta exactly the standard table.
      expect(calls.length).toBe(1);
      const result = calls[0];
      expect(result.mode).toBe('ranked');
      const expectedDelta =
        result.outcome === 'win'
          ? BALANCE.rank.pointsPerWin
          : result.outcome === 'loss'
            ? BALANCE.rank.pointsPerLoss
            : BALANCE.rank.pointsPerDraw;
      expect(result.rankPointsDelta).toBe(expectedDelta);
      expect(result.balanceVersion).toBe(BALANCE.balanceVersion);

      // Battle record: persisted on the standard ladder, verifiable, and the
      // recorded ranked config respects the fitness cap.
      await vi.advanceTimersByTimeAsync(500);
      const records = await loadBattleRecords(storage);
      expect(records.length).toBe(1);
      expect(records[0].debug?.mode).toBe('standard');
      expect(verifyBattleRecord(records[0], BALANCE).ok).toBe(true);
      expect(battleConfigWithinRankedCap(records[0].config, BALANCE)).toBe(true);

      store.getState().stop();
    }
  );

  it(
    'ranked is functionally identical to standard: same seed → same outcome, duration and delta; only the reported mode differs',
    { timeout: 120_000 },
    async () => {
      const play = async (mode: 'standard' | 'ranked') => {
        const { provider, calls } = makeFakeProvider();
        const store = createBattleStore({ current: provider }, { current: new MemoryStorage() });
        store.getState().start(RANKED_SEED, 'p1', rankedOptions, mode);
        await vi.advanceTimersByTimeAsync((MAX_TICKS + 100) * 50);
        expect(store.getState().status).toBe('finished');
        store.getState().stop();
        expect(calls.length).toBe(1);
        return calls[0];
      };

      const standard = await play('standard');
      const ranked = await play('ranked');
      expect(standard.mode).toBe('standard');
      expect(ranked.mode).toBe('ranked');
      expect(ranked.outcome).toBe(standard.outcome);
      expect(ranked.durationTicks).toBe(standard.durationTicks);
      expect(ranked.rankPointsDelta).toBe(standard.rankPointsDelta);
      expect(ranked.playerCoreHealth).toBe(standard.playerCoreHealth);
      expect(ranked.opponentCoreHealth).toBe(standard.opponentCoreHealth);
      expect(ranked.battleId).toBe(standard.battleId);
    }
  );

  it('rank points move through the real provider in ranked mode (win/draw, loss floored at zero)', async () => {
    const storageRef: { current: KeyValueStorage | null } = { current: null };
    const playerStore = createPlayerStore(storageRef);
    await playerStore.getState().initialize(new MemoryStorage());
    const provider = new LocalMockPlayerProvider(playerStore);

    const mk = (outcome: 'win' | 'loss' | 'draw', delta: number): BattleResult => ({
      battleId: `ranked-${outcome}`,
      balanceVersion: BALANCE.balanceVersion,
      seed: 1,
      playerId: 'local-player',
      opponentId: 'ai-advanced',
      outcome,
      playerCoreHealth: 1000,
      opponentCoreHealth: 0,
      durationTicks: 1000,
      rankPointsDelta: delta,
      mode: 'ranked',
      completedAt: new Date().toISOString(),
    });

    // Loss first: the floor clamps 0 + pointsPerLoss at 0.
    await provider.recordBattleResult(mk('loss', BALANCE.rank.pointsPerLoss));
    expect(playerStore.getState().save.player.rankPoints).toBe(0);
    await provider.recordBattleResult(mk('win', BALANCE.rank.pointsPerWin));
    expect(playerStore.getState().save.player.rankPoints).toBe(BALANCE.rank.pointsPerWin);
    await provider.recordBattleResult(mk('draw', BALANCE.rank.pointsPerDraw));
    expect(playerStore.getState().save.player.rankPoints).toBe(
      BALANCE.rank.pointsPerWin + BALANCE.rank.pointsPerDraw
    );

    const { stats, gym } = playerStore.getState().save;
    expect(stats).toEqual({ battlesPlayed: 3, wins: 1, losses: 1, draws: 1 });
    // Ranked results never touch the gym block.
    expect(gym).toEqual(createDefaultGymState());
  });

  it('fitness scaling stays inside the ranked cap for ANY ratings profile (incl. garbage)', () => {
    const cap = BALANCE.fitness.rankedMaxTotalAdvantage;
    const profiles: FitnessRatings[] = [
      { strength: 0, cardio: 0, muscularity: 0, leanness: 0, aesthetics: 0 },
      { strength: 100, cardio: 100, muscularity: 100, leanness: 100, aesthetics: 100 },
      { strength: 90, cardio: 10, muscularity: 100, leanness: 0, aesthetics: 55 },
      { strength: 50, cardio: 50, muscularity: 50, leanness: 50, aesthetics: 50 },
      { strength: NaN, cardio: Infinity, muscularity: -Infinity, leanness: 1e9, aesthetics: -500 },
    ];
    for (const ratings of profiles) {
      const scaling = computeFitnessScaling(ratings, BALANCE);
      expect(isWithinRankedCap(scaling, BALANCE), JSON.stringify(ratings)).toBe(true);
      expect(totalScalingAdvantage(scaling)).toBeLessThanOrEqual(cap + 1e-9);
    }
    // A maxed profile lands exactly ON the cap; neutral has zero advantage.
    expect(totalScalingAdvantage(maxedScaling())).toBeCloseTo(cap, 10);
    expect(totalScalingAdvantage(NEUTRAL_SCALING)).toBe(0);
    // The guard genuinely detects violations (not vacuously true).
    expect(
      isWithinRankedCap({ ...NEUTRAL_SCALING, attackDamageMult: 1 + cap * 2 }, BALANCE)
    ).toBe(false);
  });

  it('every scaling in a ranked-shaped battle config (incl. squads) respects the cap', () => {
    // Champion + maxed scaling (the ranked store test's exact config shape).
    const scaled = createLiveBattle(RANKED_SEED, 'p1', rankedOptions);
    expect(battleConfigWithinRankedCap(scaled.config, BALANCE)).toBe(true);

    // Full squads with per-member scalings on both sides.
    const squadSpec: MatchSpec = {
      seed: RANKED_SEED,
      playerDifficulty: 'standard',
      opponentDifficulty: 'standard',
      config: 'squads',
      checkEveryTick: false,
    };
    const squads = createLiveBattle(RANKED_SEED, 'p1', optionsFor(squadSpec));
    expect(battleConfigWithinRankedCap(squads.config, BALANCE)).toBe(true);

    // And the guard catches an over-cap squad member.
    expect(
      battleConfigWithinRankedCap(
        {
          seed: 1,
          player: {
            playerId: 'p1',
            squad: {
              captain: { championId: 'champion-titan' },
              borrowed: [
                {
                  championId: 'champion-speedster',
                  lane: 1,
                  scaling: { ...NEUTRAL_SCALING, moveSpeedMult: 2 },
                },
              ],
            },
          },
          opponent: { playerId: 'p2' },
        },
        BALANCE
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Save/restart gates (v3 schema + migration chains)
// ---------------------------------------------------------------------------

describe('save/restart gates — v3 round-trip and v1→v3 migration chains', () => {
  it('full round-trip at the current schema (v3) preserves everything incl. gym war stats', async () => {
    const storage = new MemoryStorage();
    const save: SaveData = {
      ...createDefaultSave('2026-07-22T00:00:00.000Z'),
      player: {
        playerId: 'local-player',
        displayName: 'Round Tripper',
        championId: 'champion-shredder',
        rankPoints: 1234,
        onboardingComplete: true,
      },
      stats: { battlesPlayed: 42, wins: 20, losses: 20, draws: 2 },
      settings: { showDebugPanel: true, aiDifficulty: 'advanced' },
      gym: {
        selectedSquad: ['iron-anna', 'cardio-carl'],
        championStats: {
          'iron-anna': { appearances: 5, wins: 3, warContribution: 11 },
          'cardio-carl': { appearances: 2, wins: 0, warContribution: 2 },
        },
        warsPlayed: 5,
        warsWon: 3,
      },
    };
    expect(save.saveVersion).toBe(SAVE_VERSION);

    await persistSave(storage, save);
    const loaded = await loadSave(storage);
    expect(loaded.fresh).toBe(false);
    expect(loaded.recovered).toBe(false);
    expect(isValidSave(loaded.save)).toBe(true);
    // persistSave rewrites updatedAt; everything else must round-trip exactly.
    expect(loaded.save).toEqual({ ...save, updatedAt: loaded.save.updatedAt });
    expect(loaded.save.gym.championStats['iron-anna'].warContribution).toBe(11);
    expect(loaded.save.gym.warsWon).toBe(3);
  });

  it('restart chain: fresh install → mutate → reload (app restart) stays valid and keeps data', async () => {
    const storage = new MemoryStorage();

    // First boot: no stored data.
    const first = await loadSave(storage);
    expect(first.fresh).toBe(true);
    await persistSave(storage, first.save);

    // Session: gym war + rank movement persisted.
    const mutated: SaveData = {
      ...first.save,
      player: { ...first.save.player, rankPoints: 65 },
      stats: { battlesPlayed: 2, wins: 2, losses: 0, draws: 0 },
      gym: {
        ...first.save.gym,
        warsPlayed: 1,
        warsWon: 1,
        championStats: { 'stab-member-a': { appearances: 1, wins: 1, warContribution: 3 } },
      },
    };
    await persistSave(storage, mutated);

    // App restart: everything survives, nothing recovers.
    const second = await loadSave(storage);
    expect(second.fresh).toBe(false);
    expect(second.recovered).toBe(false);
    expect(isValidSave(second.save)).toBe(true);
    expect(second.save.player.rankPoints).toBe(65);
    expect(second.save.gym.championStats['stab-member-a'].wins).toBe(1);

    // And the player store initializes cleanly over the same storage twice.
    for (let boot = 0; boot < 2; boot++) {
      const ref: { current: KeyValueStorage | null } = { current: null };
      const store = createPlayerStore(ref);
      await store.getState().initialize(storage);
      expect(store.getState().status).toBe('ready');
      expect(store.getState().recovered).toBe(false);
      expect(store.getState().save.player.rankPoints).toBe(65);
    }
  });

  it('v1 → v3 migration chain lands a valid current save preserving player data', async () => {
    const storage = new MemoryStorage();
    const base = createDefaultSave('2026-01-01T00:00:00.000Z');
    // A faithful v1 save: no settings.aiDifficulty, no gym block.
    const v1: Record<string, unknown> = {
      saveVersion: 1,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      player: { ...base.player, displayName: 'Migrator', rankPoints: 640 },
      fitness: { ...base.fitness, strengthRating: 77 },
      decks: base.decks,
      stats: { battlesPlayed: 12, wins: 7, losses: 4, draws: 1 },
      settings: { showDebugPanel: true },
    };
    await storage.setItem(SAVE_KEY, JSON.stringify(v1));

    const loaded = await loadSave(storage);
    expect(loaded.fresh).toBe(false);
    expect(loaded.recovered).toBe(false);
    expect(loaded.save.saveVersion).toBe(SAVE_VERSION);
    expect(isValidSave(loaded.save)).toBe(true);
    // Preserved through BOTH steps.
    expect(loaded.save.player.rankPoints).toBe(640);
    expect(loaded.save.player.displayName).toBe('Migrator');
    expect(loaded.save.fitness.strengthRating).toBe(77);
    expect(loaded.save.stats).toEqual({ battlesPlayed: 12, wins: 7, losses: 4, draws: 1 });
    expect(loaded.save.decks.all[0].cardIds).toEqual([...DEFAULT_DECK_CARD_IDS]);
    expect(loaded.save.settings.showDebugPanel).toBe(true);
    // Added by v1→v2 and v2→v3 respectively.
    expect(loaded.save.settings.aiDifficulty).toBe('standard');
    expect(loaded.save.gym).toEqual(createDefaultGymState());
  });

  it('v2 → v3 migration lands valid, preserving aiDifficulty and replacing malformed gym data', async () => {
    const storage = new MemoryStorage();
    const base = createDefaultSave('2026-03-01T00:00:00.000Z');
    const v2: Record<string, unknown> = {
      saveVersion: 2,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      player: { ...base.player, rankPoints: 310 },
      fitness: base.fitness,
      decks: base.decks,
      stats: { battlesPlayed: 9, wins: 5, losses: 3, draws: 1 },
      settings: { showDebugPanel: false, aiDifficulty: 'advanced' },
      // Malformed pre-existing 'gym' field of the wrong shape — the v2→v3
      // migration must replace it so the migrated save always validates.
      gym: 'corrupt-garbage',
    };
    await storage.setItem(SAVE_KEY, JSON.stringify(v2));

    const loaded = await loadSave(storage);
    expect(loaded.recovered).toBe(false);
    expect(loaded.save.saveVersion).toBe(SAVE_VERSION);
    expect(isValidSave(loaded.save)).toBe(true);
    expect(loaded.save.settings.aiDifficulty).toBe('advanced');
    expect(loaded.save.player.rankPoints).toBe(310);
    expect(loaded.save.gym).toEqual(createDefaultGymState());
  });
});
