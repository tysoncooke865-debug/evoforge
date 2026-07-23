/**
 * Battle store — owns a live battle and its real-time tick loop.
 *
 * The loop runs on a 50ms `setInterval`, using a wall-clock accumulator
 * (`Date.now()`) rather than assuming each timer fire corresponds to exactly
 * one simulation tick — JS timers are not precise and can be delayed (e.g.
 * the app briefly backgrounded). Catch-up per fire is capped at
 * `MAX_CATCHUP_TICKS` so a stall plays out at normal speed afterwards
 * instead of skipping straight to the end.
 *
 * The result-recording provider and the battle-record storage are injected
 * lazily via refs. Importing `services/app-services` at module load time
 * would pull in the AsyncStorage-backed provider, which cannot be
 * constructed in the Vitest (Node) environment — so the default refs stay
 * empty and the real services are `import()`ed the first time they are
 * actually needed. Tests supply fakes up front via
 * `createBattleStore({ current: fakeProvider }, { current: memoryStorage })`
 * so those dynamic imports never run.
 *
 * M8 — battle modes and recording:
 *  - 'standard' battles record a BattleResult through the provider AND
 *    persist a verifiable BattleRecord into the battle-record ring buffer.
 *  - 'ranked' (M10) is functionally IDENTICAL to 'standard': the beta treats
 *    standard battles AS the ranked ladder (rank points already move on every
 *    standard battle). The BattleResult reports mode 'ranked' so a future
 *    backend can split ladders; the persisted record keeps debug.mode
 *    'standard' (record schema unchanged). See services/progression/ranked.ts.
 *  - 'tutorial' battles record a BattleResult (mode 'tutorial', always a
 *    ZERO rank-point delta — a guided lesson never moves the ladder, P11)
 *    but are NEVER persisted as battle records.
 *  - 'ghost' battles (startGhost) are fully offline: no provider call, no
 *    rank movement — but they ARE persisted as battle records (mode
 *    'ghost'), with display snapshots derived from the source record so no
 *    profile lookup is needed.
 *  - 'dev-stress' battles (premium P1/P3 render-stress lab) are fully
 *    inert: no provider call, no rank movement, and NEVER persisted — the
 *    stress driver force-spawns units outside the command log, so a stored
 *    record could never replay to its digest.
 */
import { createStore } from 'zustand/vanilla';
import { BALANCE, getCardById } from '../../content';
import type { LaneId } from '../../game-engine/types';
import {
  BATTLE_RECORD_SCHEMA_VERSION,
  BattleRecord,
  CombatantSnapshot,
} from '../../game-engine/simulation/replay';
import type { BattleResult, EvoForgePlayerProvider } from '../../integration/evoforge/types';
import { ratingDeltaForOutcome } from '../../services/progression/rank';
import { appendBattleRecord } from '../../services/persistence/battle-records';
import type { KeyValueStorage } from '../../services/persistence/storage';
import {
  createGhostLiveBattle,
  createLiveBattle,
  liveDigest,
  LiveBattle,
  LiveBattleOptions,
  queueChampionAbility,
  queueChampionUltimate,
  queueChooseAugment,
  queuePlayerDeploy,
  queuePlayerPlayCard,
  resolveCardTargetForLane,
  stepLiveBattle,
} from './battle-controller';

/** Simulation loop cadence, in milliseconds. */
const LOOP_INTERVAL_MS = 50;
/** Ticks advanced per timer fire is capped here so a stall doesn't fast-forward the battle. */
const MAX_CATCHUP_TICKS = 5;
/** P4 combat feel: bounds on transient time dilation (hit-stop / slow-mo).
 *  A dilation is a SHORT presentation beat — the cap keeps a buggy caller
 *  from freezing the battle. Scale 0 = hit-stop, 0<scale<1 = slow motion. */
const MAX_DILATION_MS = 450;
/** P9: cap for the pre-battle intro hold (countdown) — longer than a combat
 *  beat, still bounded so a buggy caller cannot park the battle forever. */
const MAX_INTRO_HOLD_MS = 3500;
/** Matches the default save's player id (see services/persistence/save.ts). */
const DEFAULT_PLAYER_ID = 'local-player';

export type BattleMode = 'standard' | 'ranked' | 'tutorial' | 'ghost' | 'gym-war' | 'dev-stress';

/**
 * Dev-only frame instrumentation seam (premium P1). The stress lab's frame
 * profiler sets `current` while mounted so it can time the sim step and the
 * store publish (which includes React's synchronous subscriber flush);
 * normal play pays a single null check per 50ms frame. Never set outside
 * dev tooling.
 */
export const devFrameHook: {
  current:
    | ((info: { gapMs: number; simMs: number; publishMs: number; ticks: number }) => void)
    | null;
} = { current: null };

export interface BattleStoreState {
  status: 'idle' | 'running' | 'finished';
  live: LiveBattle | null;
  /** Bumped on every applied frame so selectors re-render while the sim mutates in place. */
  version: number;
  /** Current battle mode — drives recording behaviour and UI labels (M8). */
  mode: BattleMode;
  selectedCardId: string | null;
  /** Rejection reason from the last failed deploy attempt, for toast-style UI feedback. */
  lastRejection: string | null;

  start(seed: number, playerId?: string, options?: LiveBattleOptions, mode?: BattleMode): void;
  /**
   * Start a ghost battle against the player side of a stored record (M8).
   * Fails safely (no state change) on unusable records — returns the reason.
   */
  startGhost(
    record: BattleRecord,
    seed: number,
    playerId?: string,
    options?: LiveBattleOptions
  ): { ok: true } | { ok: false; reason: string };
  selectCard(id: string | null): void;
  deploy(lane: LaneId, x: number): void;
  /** Queue the player champion's active ability for the next tick. */
  championAbility(): void;
  /** Queue the player champion's ultimate for the next tick. */
  championUltimate(): void;
  /** Queue the player's mid-match augment choice for the next tick. */
  chooseAugment(augmentId: string): void;
  /** Surface a UI-side rejection (e.g. tapping an unaffordable card). */
  flagRejection(reason: string): void;
  /**
   * P4 combat feel — briefly dilate battle time: scale 0 freezes the sim
   * (hit-stop), 0<scale<1 plays it in slow motion. Purely presentational
   * pacing: ticks are only DELAYED, never skipped or reordered, so command
   * recording and replay digests are untouched. A stronger (slower) active
   * dilation is never overridden by a weaker one.
   */
  applyTimeDilation(scale: number, durationMs: number): void;
  /**
   * P9 match flow — freeze the sim for the battle-intro countdown, right
   * after start(). Same delay-only mechanism as applyTimeDilation (ticks
   * are never skipped; replays unaffected) with a longer, intro-sized cap.
   * Player commands queued during the hold apply on the first real tick.
   */
  holdForIntro(durationMs: number): void;
  stop(): void;
  restart(seed: number, playerId?: string, options?: LiveBattleOptions, mode?: BattleMode): void;
  /** Stop the loop and return to idle — leaving the screen abandons the battle. */
  reset(): void;
  clearRejection(): void;
}

/** A fresh 32-bit seed for a new battle (initial load, rematch). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export type ProviderRef = { current: EvoForgePlayerProvider | null };
export type StorageRef = { current: KeyValueStorage | null };

const AI_DISPLAY_NAME: Record<string, string> = {
  training: 'Training AI',
  standard: 'Standard AI',
  advanced: 'Advanced AI',
};

export function createBattleStore(
  providerRef: ProviderRef = { current: null },
  storageRef: StorageRef = { current: null }
) {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock time of the last frame() — real elapsed time is measured
   *  against this, then scaled by any active dilation into sim-time debt. */
  let lastFrameRealMs = 0;
  /** Scaled sim-time not yet consumed as whole ticks (the accumulator). */
  let simTimeOwedMs = 0;
  /** Active transient time dilation, or null at normal speed (P4). */
  let dilation: { scale: number; untilMs: number } | null = null;
  let resultRecorded = false;
  let recordPersisted = false;
  let currentMode: BattleMode = 'standard';
  /** Source record of the current ghost battle (snapshot data, no provider). */
  let ghostSourceRecord: BattleRecord | null = null;
  /** Serializes ring-buffer writes so rapid finishes can't interleave. */
  let persistChain: Promise<void> = Promise.resolve();

  function clearLoop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  async function resolveProvider(): Promise<EvoForgePlayerProvider> {
    if (providerRef.current) return providerRef.current;
    const { playerProvider } = await import('../../services/app-services');
    providerRef.current = playerProvider;
    return playerProvider;
  }

  async function resolveStorage(): Promise<KeyValueStorage> {
    if (storageRef.current) return storageRef.current;
    const { appStorage } = await import('../../services/app-services');
    storageRef.current = appStorage;
    return appStorage;
  }

  /**
   * Records the outcome exactly once per battle, guarded by `resultRecorded`.
   * Ghost battles never reach the provider — they are offline and move no
   * rank points (you cannot farm progression off your own ghost).
   */
  function recordResult(live: LiveBattle): void {
    if (resultRecorded) return;
    const outcome = live.state.outcome;
    if (!outcome) return;
    resultRecorded = true;
    // Ghost battles are offline; dev-stress battles are lab runs whose
    // outcome is meaningless (the driver force-spawns armies) — neither may
    // ever reach the provider.
    if (currentMode === 'ghost' || currentMode === 'dev-stress') return;

    // Shared with the result overlay display (P11): tutorial battles move 0
    // Arena Rating (a guided lesson is not the ladder) — they still count in
    // battle stats, so a tutorial win unlocks the harder AI tiers.
    const rankPointsDelta = ratingDeltaForOutcome(currentMode, outcome.winner, BALANCE);

    const result: BattleResult = {
      battleId: `battle-${live.state.seed}-${outcome.endTick}`,
      balanceVersion: BALANCE.balanceVersion,
      seed: live.state.seed,
      playerId: live.config.player.playerId,
      opponentId: live.config.opponent.playerId,
      outcome:
        outcome.winner === 'player' ? 'win' : outcome.winner === 'opponent' ? 'loss' : 'draw',
      playerCoreHealth: outcome.playerCoreHealth,
      opponentCoreHealth: outcome.opponentCoreHealth,
      durationTicks: outcome.endTick,
      rankPointsDelta,
      mode:
        currentMode === 'tutorial'
          ? 'tutorial'
          : currentMode === 'gym-war'
            ? 'gym-war'
            : currentMode === 'ranked'
              ? 'ranked'
              : 'standard',
      completedAt: new Date().toISOString(),
    };

    // Gym War attribution (M9): which members' borrowed champions were
    // fielded — the provider credits contribution stats from this.
    if (currentMode === 'gym-war') {
      const borrowed = live.config.player.squad?.borrowed ?? [];
      result.gymWar = {
        enemyGymId: live.config.opponent.playerId.replace(/^gym-/, ''),
        fieldedMemberIds: borrowed
          .map((b) => b.sourcePlayerId)
          .filter((id): id is string => typeof id === 'string'),
      };
    }

    void resolveProvider().then((provider) => provider.recordBattleResult(result));
  }

  /**
   * Persists a verifiable BattleRecord for the finished battle (M8), exactly
   * once, guarded by `recordPersisted`. Tutorial battles are never recorded.
   * The record is built synchronously from the finished LiveBattle (config,
   * command log, outcome, digest) so later store mutations cannot corrupt
   * it; only the display snapshots may need an async provider lookup.
   */
  function persistBattleRecord(live: LiveBattle): void {
    if (recordPersisted) return;
    const outcome = live.state.outcome;
    if (!outcome) return;
    if (currentMode === 'tutorial') return;
    // Dev-stress battles must never be persisted: driver spawns are not in
    // the command log, so the record's digest could never replay true.
    if (currentMode === 'dev-stress') return;
    recordPersisted = true;

    // Mode 'ranked' deliberately falls through to 'standard' here: the record
    // schema's debug.mode union is unchanged and the beta's ranked ladder IS
    // the standard ladder (see services/progression/ranked.ts).
    const mode: 'standard' | 'ghost' | 'gym-war' =
      currentMode === 'ghost' ? 'ghost' : currentMode === 'gym-war' ? 'gym-war' : 'standard';
    const digest = liveDigest(live);
    const commands = [...live.commandLog];
    const rejectedCount = live.rejected.length;
    const source = ghostSourceRecord;

    const buildSnapshots = async (): Promise<{
      player: CombatantSnapshot;
      opponent: CombatantSnapshot;
    }> => {
      if (mode === 'ghost' && source) {
        // Offline: derive both snapshots from the source record — display
        // data may be slightly stale (rank points), which is acceptable for
        // metadata that never feeds the simulation.
        return {
          player: { ...source.playerSnapshot },
          opponent: {
            playerId: live.config.opponent.playerId,
            displayName: `Ghost of ${source.playerSnapshot.displayName}`,
            championId: live.config.opponent.championId ?? null,
            rankPoints: source.playerSnapshot.rankPoints,
          },
        };
      }
      const provider = await resolveProvider();
      const profile = await provider.getCurrentPlayer();
      return {
        player: {
          playerId: profile.playerId,
          displayName: profile.displayName,
          championId: profile.championId,
          rankPoints: profile.rankPoints,
        },
        opponent: {
          playerId: live.config.opponent.playerId,
          displayName:
            live.opponentDisplayName ??
            AI_DISPLAY_NAME[live.aiDifficulty] ??
            `AI (${live.aiDifficulty})`,
          championId:
            live.config.opponent.squad?.captain.championId ??
            live.config.opponent.championId ??
            null,
          rankPoints: 0,
        },
      };
    };

    persistChain = persistChain
      .then(async () => {
        const snapshots = await buildSnapshots();
        const record: BattleRecord = {
          schemaVersion: BATTLE_RECORD_SCHEMA_VERSION,
          balanceVersion: BALANCE.balanceVersion,
          seed: live.state.seed,
          config: live.config,
          playerSnapshot: snapshots.player,
          opponentSnapshot: snapshots.opponent,
          commands,
          outcome,
          digest,
          recordedAt: new Date().toISOString(),
          // recordedAt-suffixed so same-seed battles (e.g. deliberate replays
          // of a seed) never collide on the storage lookup key.
          recordId: `battle-${live.state.seed}-${outcome.endTick}-${Date.now().toString(36)}`,
          debug: {
            rejectedCount,
            mode,
            aiDifficulty: mode === 'ghost' ? null : live.aiDifficulty,
          },
        };
        const storage = await resolveStorage();
        await appendBattleRecord(storage, record);
      })
      .catch((e) => {
        // Recording is best-effort — a storage failure must never break the
        // battle flow.
        console.warn('[battle] failed to persist battle record', e);
      });
  }

  return createStore<BattleStoreState>((set, get) => {
    function frame(): void {
      const { live } = get();
      if (!live) return;
      const now = Date.now();
      // Real elapsed time scaled by any active dilation becomes sim-time
      // debt; whole ticks are consumed from the debt (remainder kept), with
      // the same per-fire catch-up cap as before. At scale 1 this is exactly
      // the old accumulator; at scale 0 (hit-stop) no debt accrues, so the
      // sim resumes cleanly with no burst.
      const delta = Math.max(0, now - lastFrameRealMs);
      if (dilation) {
        // Piecewise: the part of the elapsed span inside the dilation window
        // is scaled, the remainder runs at full speed — a frame landing on
        // (or past) the window's end must not retroactively undo the hold.
        const dilatedMs = Math.max(
          0,
          Math.min(now, dilation.untilMs) - Math.min(lastFrameRealMs, dilation.untilMs)
        );
        simTimeOwedMs += dilatedMs * dilation.scale + (delta - dilatedMs);
        if (now >= dilation.untilMs) dilation = null;
      } else {
        simTimeOwedMs += delta;
      }
      lastFrameRealMs = now;
      let ticks = Math.floor(simTimeOwedMs / LOOP_INTERVAL_MS);
      if (ticks <= 0) return;
      if (ticks > MAX_CATCHUP_TICKS) ticks = MAX_CATCHUP_TICKS;
      simTimeOwedMs -= ticks * LOOP_INTERVAL_MS;

      const hook = devFrameHook.current;
      if (hook) {
        const t0 = performance.now();
        stepLiveBattle(live, ticks);
        const t1 = performance.now();
        set((s) => ({ version: s.version + 1 }));
        const t2 = performance.now();
        hook({ gapMs: delta, simMs: t1 - t0, publishMs: t2 - t1, ticks });
      } else {
        stepLiveBattle(live, ticks);
        set((s) => ({ version: s.version + 1 }));
      }

      if (live.state.phase === 'finished') {
        clearLoop();
        set({ status: 'finished' });
        recordResult(live);
        persistBattleRecord(live);
      }
    }

    function beginBattle(live: LiveBattle, mode: BattleMode): void {
      clearLoop();
      resultRecorded = false;
      recordPersisted = false;
      currentMode = mode;
      lastFrameRealMs = Date.now();
      simTimeOwedMs = 0;
      dilation = null;
      set({
        status: 'running',
        live,
        version: 0,
        mode,
        selectedCardId: null,
        lastRejection: null,
      });
      intervalId = setInterval(frame, LOOP_INTERVAL_MS);
    }

    return {
      status: 'idle',
      live: null,
      version: 0,
      mode: 'standard',
      selectedCardId: null,
      lastRejection: null,

      start(
        seed: number,
        playerId: string = DEFAULT_PLAYER_ID,
        options: LiveBattleOptions = {},
        mode: BattleMode = 'standard'
      ) {
        ghostSourceRecord = null;
        beginBattle(createLiveBattle(seed, playerId, options), mode);
      },

      startGhost(
        record: BattleRecord,
        seed: number,
        playerId: string = DEFAULT_PLAYER_ID,
        options: LiveBattleOptions = {}
      ) {
        const result = createGhostLiveBattle(record, seed, playerId, options);
        if (!result.ok) return result;
        ghostSourceRecord = record;
        beginBattle(result.live, 'ghost');
        return { ok: true as const };
      },

      selectCard(id: string | null) {
        set({ selectedCardId: id });
      },

      deploy(lane: LaneId, x: number) {
        const { live, selectedCardId, status } = get();
        if (!live || status !== 'running') return;
        if (!selectedCardId) {
          set({ lastRejection: 'Select a card first' });
          return;
        }
        const card = getCardById(selectedCardId);
        let result;
        if (card && card.category !== 'fighter') {
          // Techniques/equipment: the tap picks a lane; the controller
          // resolves a deterministic target in it (most-wounded ally for
          // heals/shields, frontmost ally for buffs, closest threat for
          // offensive cards).
          const targetId = resolveCardTargetForLane(live, selectedCardId, lane);
          if (targetId === null) {
            set({ lastRejection: 'No valid target in that lane' });
            return;
          }
          result = queuePlayerPlayCard(live, selectedCardId, targetId);
        } else {
          result = queuePlayerDeploy(live, selectedCardId, lane, x);
        }
        if (!result.ok) {
          set({ lastRejection: result.reason });
          return;
        }
        set({ selectedCardId: null, lastRejection: null });
      },

      championAbility() {
        const { live, status } = get();
        if (!live || status !== 'running') return;
        const result = queueChampionAbility(live);
        if (!result.ok) set({ lastRejection: result.reason });
      },

      championUltimate() {
        const { live, status } = get();
        if (!live || status !== 'running') return;
        const result = queueChampionUltimate(live);
        if (!result.ok) set({ lastRejection: result.reason });
      },

      chooseAugment(augmentId: string) {
        const { live, status } = get();
        if (!live || status !== 'running') return;
        const result = queueChooseAugment(live, augmentId);
        if (!result.ok) set({ lastRejection: result.reason });
      },

      flagRejection(reason: string) {
        set({ lastRejection: reason });
      },

      applyTimeDilation(scale: number, durationMs: number) {
        const { status } = get();
        if (status !== 'running') return;
        if (!Number.isFinite(scale) || !Number.isFinite(durationMs) || durationMs <= 0) return;
        const now = Date.now();
        const clampedScale = Math.min(1, Math.max(0, scale));
        if (clampedScale >= 1) return;
        // A slower active dilation wins — an ultimate's slow-mo shouldn't be
        // cut short by a light hit-stop landing during it.
        if (dilation && dilation.untilMs > now && dilation.scale <= clampedScale) return;
        dilation = { scale: clampedScale, untilMs: now + Math.min(MAX_DILATION_MS, durationMs) };
      },

      holdForIntro(durationMs: number) {
        const { status } = get();
        if (status !== 'running') return;
        if (!Number.isFinite(durationMs) || durationMs <= 0) return;
        dilation = { scale: 0, untilMs: Date.now() + Math.min(MAX_INTRO_HOLD_MS, durationMs) };
      },

      stop() {
        clearLoop();
      },

      restart(
        seed: number,
        playerId: string = DEFAULT_PLAYER_ID,
        options: LiveBattleOptions = {},
        mode: BattleMode = 'standard'
      ) {
        clearLoop();
        get().start(seed, playerId, options, mode);
      },

      reset() {
        clearLoop();
        resultRecorded = false;
        recordPersisted = false;
        currentMode = 'standard';
        ghostSourceRecord = null;
        dilation = null;
        simTimeOwedMs = 0;
        set({
          status: 'idle',
          live: null,
          version: 0,
          mode: 'standard',
          selectedCardId: null,
          lastRejection: null,
        });
      },

      clearRejection() {
        set({ lastRejection: null });
      },
    };
  });
}

export type BattleStore = ReturnType<typeof createBattleStore>;

/** App-wide singleton — screens read this via `useBattle`. */
export const battleStore: BattleStore = createBattleStore();
