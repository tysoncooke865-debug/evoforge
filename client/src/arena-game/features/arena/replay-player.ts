/**
 * Replay player (M8) — pure TS incremental playback of a verified
 * BattleRecord. Drives a local BattleState by calling advanceTick with the
 * record's command schedule; the UI steps it on a timer at the chosen speed.
 * No store singletons, no React — fully testable headless, and stepping in
 * ANY chunk sizes produces the exact same final state as one-shot runBattle
 * (the schedule is prepared with the same prepareCommandSchedule the runner
 * uses).
 *
 * Callers are expected to verifyBattleRecord BEFORE creating a player — an
 * unverified record must show an error state instead of playing. Creation
 * still fails safely (never throws) on unusable configs as a second line of
 * defence.
 */
import { BALANCE } from '../../content';
import type { RejectedCommand, ScheduledCommand } from '../../game-engine/simulation/events';
import type { BattleRecord } from '../../game-engine/simulation/replay';
import { computeDigest, prepareCommandSchedule } from '../../game-engine/simulation/run';
import { BattleState, createBattle } from '../../game-engine/simulation/state';
import { advanceTick } from '../../game-engine/simulation/tick';

export interface ReplayPlayer {
  record: BattleRecord;
  state: BattleState;
  /** The prepared (validated + sorted) schedule advanceTick consumes. */
  schedule: ScheduledCommand[];
  /** Commands the simulation rejected so far (debug display). */
  rejected: RejectedCommand[];
}

export type ReplayPlayerResult =
  | { ok: true; player: ReplayPlayer }
  | { ok: false; reason: string };

/** Builds a fresh player positioned at tick 0. Never throws. */
export function createReplayPlayer(record: BattleRecord): ReplayPlayerResult {
  let state: BattleState;
  try {
    state = createBattle(record.config, BALANCE);
  } catch (e) {
    return {
      ok: false,
      reason: `replay failed to start: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const rejected: RejectedCommand[] = [];
  const schedule = prepareCommandSchedule(record.commands, rejected);
  return { ok: true, player: { record, state, schedule, rejected } };
}

/**
 * Advances up to `ticks` simulation ticks; stops early when the battle
 * finishes. Returns the number of ticks actually advanced.
 */
export function stepReplay(player: ReplayPlayer, ticks: number): number {
  let advanced = 0;
  for (let i = 0; i < ticks; i++) {
    if (player.state.phase === 'finished') break;
    advanceTick(player.state, BALANCE, player.schedule, player.rejected);
    advanced++;
  }
  return advanced;
}

export function replayFinished(player: ReplayPlayer): boolean {
  return player.state.phase === 'finished';
}

/** Digest of the replay state so far (dev overlay + tests). */
export function replayDigest(player: ReplayPlayer): number {
  return computeDigest(player.state);
}
