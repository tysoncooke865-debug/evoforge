/**
 * Battle records — the serialized, verifiable form of a battle (Milestone 8
 * foundation). A record contains everything needed to reproduce a battle
 * bit-for-bit: config (decks/champions/seed), the full command stream, the
 * balance version it ran under, and the outcome + digest it produced.
 *
 * Uses: ghost battles, replays, PvP verification, cheat detection, bug
 * reproduction, Gym War attacks.
 *
 * Contract: parsing and verification NEVER throw on untrusted data — they
 * return structured failures ("Invalid replays fail safely").
 */
import type { BalanceConfig } from '../../content/balance';
import { isValidChampionScaling } from '../balance/fitness-scaling';
import type { ScheduledCommand } from './events';
import { runBattle } from './run';
import type { BattleConfig, BattleOutcome } from './state';

export const BATTLE_RECORD_SCHEMA_VERSION = 1;

/**
 * Generous upper bound on a record's command count. Legitimate battles
 * record a few commands per second at the very most (~20/minute typical,
 * max battle length four minutes), so 10,000 is orders of magnitude above
 * real use — the cap exists only to refuse hostile padding: re-simulation
 * scans the full schedule once per tick (O(ticks × commands)), so an
 * unbounded record could stall verification and ghost battles for minutes
 * on the UI thread (P4 fix).
 */
export const MAX_RECORD_COMMANDS = 10_000;

/** Display-only metadata snapshot; never feeds the simulation. */
export interface CombatantSnapshot {
  playerId: string;
  displayName: string;
  championId: string | null;
  rankPoints: number;
}

/**
 * Optional debug metadata (M8) — display/diagnostics only, never simulation
 * input. `aiDifficulty` is a plain string (not the content AiDifficulty
 * union) so records survive future difficulty renames; null for battles with
 * no AI opponent (ghost battles).
 */
export interface BattleRecordDebugInfo {
  /** Commands the simulation rejected during the original run. */
  rejectedCount: number;
  /** Battle mode the record was captured from ('gym-war' added in M9). */
  mode: 'standard' | 'ghost' | 'gym-war';
  aiDifficulty: string | null;
}

export interface BattleRecord {
  schemaVersion: number;
  balanceVersion: string;
  seed: number;
  /** Full simulation input (decks, champions, player ids). */
  config: BattleConfig;
  /** Display metadata for both sides (not simulation input). */
  playerSnapshot: CombatantSnapshot;
  opponentSnapshot: CombatantSnapshot;
  /** The complete command stream, as scheduled. */
  commands: ScheduledCommand[];
  outcome: BattleOutcome;
  /** Final-state digest the original run produced. */
  digest: number;
  recordedAt: string;
  /**
   * Optional stable id for storage lookup (M8). Records without it (schema
   * v1 predates it) still parse — see parseBattleRecord.
   */
  recordId?: string;
  /** Optional debug block (M8). Records without it still parse. */
  debug?: BattleRecordDebugInfo;
}

export type ParseResult =
  | { ok: true; record: BattleRecord }
  | { ok: false; reason: string };

export type VerifyResult =
  | { ok: true; outcome: BattleOutcome; digest: number }
  | { ok: false; reason: string };

export function serializeBattleRecord(record: BattleRecord): string {
  return JSON.stringify(record);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validates every fitness-scaling shape a team config can carry (legacy
 * championScaling, squad captain, borrowed members) plus the minimal squad
 * structure needed to reach them safely. createBattle re-checks and throws;
 * rejecting here refuses the record up front with an honest reason instead
 * (a 1e999 multiplier parses to Infinity and would otherwise field an
 * unkillable champion in ghost battles — P4 fix).
 */
function isTeamScalingValid(team: Record<string, unknown>): boolean {
  if (team.championScaling !== undefined && !isValidChampionScaling(team.championScaling)) {
    return false;
  }
  if (team.squad === undefined) return true;
  const squad = team.squad;
  if (!isObject(squad) || !isObject(squad.captain)) return false;
  if (squad.captain.scaling !== undefined && !isValidChampionScaling(squad.captain.scaling)) {
    return false;
  }
  if (squad.borrowed !== undefined) {
    if (!Array.isArray(squad.borrowed)) return false;
    for (const b of squad.borrowed as unknown[]) {
      if (!isObject(b)) return false;
      if (b.scaling !== undefined && !isValidChampionScaling(b.scaling)) return false;
    }
  }
  return true;
}

function isSnapshot(v: unknown): v is CombatantSnapshot {
  if (!isObject(v)) return false;
  return (
    typeof v.playerId === 'string' &&
    typeof v.displayName === 'string' &&
    (typeof v.championId === 'string' || v.championId === null) &&
    typeof v.rankPoints === 'number'
  );
}

/** Structural validation of untrusted record JSON. Never throws. */
export function parseBattleRecord(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  return validateBattleRecordValue(raw);
}

/**
 * Structural validation of an untrusted already-parsed value (e.g. an entry
 * inside a stored envelope). Never throws. parseBattleRecord = JSON.parse +
 * this.
 */
export function validateBattleRecordValue(raw: unknown): ParseResult {
  if (!isObject(raw)) return { ok: false, reason: 'record must be an object' };

  if (raw.schemaVersion !== BATTLE_RECORD_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schema version ${String(raw.schemaVersion)}` };
  }
  if (typeof raw.balanceVersion !== 'string') return { ok: false, reason: 'missing balanceVersion' };
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed))
    return { ok: false, reason: 'invalid seed' };
  if (!isObject(raw.config)) return { ok: false, reason: 'missing config' };
  const config = raw.config as Partial<BattleConfig>;
  if (!isObject(config.player) || typeof config.player.playerId !== 'string')
    return { ok: false, reason: 'invalid config.player' };
  if (!isObject(config.opponent) || typeof config.opponent.playerId !== 'string')
    return { ok: false, reason: 'invalid config.opponent' };
  if (config.seed !== raw.seed) return { ok: false, reason: 'config.seed mismatch' };
  if (!isTeamScalingValid(config.player as unknown as Record<string, unknown>))
    return { ok: false, reason: 'invalid config.player champion scaling' };
  if (!isTeamScalingValid(config.opponent as unknown as Record<string, unknown>))
    return { ok: false, reason: 'invalid config.opponent champion scaling' };
  if (!isSnapshot(raw.playerSnapshot)) return { ok: false, reason: 'invalid playerSnapshot' };
  if (!isSnapshot(raw.opponentSnapshot)) return { ok: false, reason: 'invalid opponentSnapshot' };
  if (!Array.isArray(raw.commands)) return { ok: false, reason: 'commands must be an array' };
  if (raw.commands.length > MAX_RECORD_COMMANDS) {
    return {
      ok: false,
      reason: `too many commands (${raw.commands.length} > ${MAX_RECORD_COMMANDS})`,
    };
  }
  for (const c of raw.commands as unknown[]) {
    if (!isObject(c) || typeof c.tick !== 'number' || !isObject(c.command)) {
      return { ok: false, reason: 'malformed command entry' };
    }
    // Command payloads themselves are validated by the engine at apply time
    // (rejected, never thrown) — structural shape is all we require here.
  }
  if (!isObject(raw.outcome) || typeof raw.outcome.winner !== 'string')
    return { ok: false, reason: 'invalid outcome' };
  if (typeof raw.digest !== 'number') return { ok: false, reason: 'missing digest' };
  if (typeof raw.recordedAt !== 'string') return { ok: false, reason: 'missing recordedAt' };

  // Optional M8 fields: absent is fine (older/foreign records), but when
  // present they must be well-formed — screens render them directly.
  if (raw.recordId !== undefined && typeof raw.recordId !== 'string') {
    return { ok: false, reason: 'invalid recordId' };
  }
  if (raw.debug !== undefined) {
    const d = raw.debug;
    if (
      !isObject(d) ||
      typeof d.rejectedCount !== 'number' ||
      !Number.isFinite(d.rejectedCount) ||
      (d.mode !== 'standard' && d.mode !== 'ghost' && d.mode !== 'gym-war') ||
      (typeof d.aiDifficulty !== 'string' && d.aiDifficulty !== null)
    ) {
      return { ok: false, reason: 'invalid debug block' };
    }
  }

  return { ok: true, record: raw as unknown as BattleRecord };
}

/**
 * Re-simulates the record and checks it reproduces the recorded outcome and
 * digest. Refuses to verify across balance versions — battle numbers differ,
 * so divergence would be meaningless.
 */
export function verifyBattleRecord(record: BattleRecord, balance: BalanceConfig): VerifyResult {
  if (record.balanceVersion !== balance.balanceVersion) {
    return {
      ok: false,
      reason: `balance version mismatch: record ${record.balanceVersion}, current ${balance.balanceVersion}`,
    };
  }
  let result;
  try {
    // createBattle throws on structurally invalid decks; untrusted records
    // must fail safely instead. Invariant checks stay OFF here: the digest
    // comparison is the verification authority, and per-tick invariant
    // auditing roughly doubles the re-sim cost on the UI thread (M10 audit).
    result = runBattle(record.config, record.commands, balance, {
      checkInvariantsEveryTick: false,
    });
  } catch (e) {
    return { ok: false, reason: `replay failed to run: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (result.stalled) return { ok: false, reason: 'replay stalled (engine bug or corrupt record)' };
  if (result.digest !== record.digest) {
    return {
      ok: false,
      reason: `digest mismatch: recorded ${record.digest}, replayed ${result.digest}`,
    };
  }
  if (
    result.outcome.winner !== record.outcome.winner ||
    result.outcome.endTick !== record.outcome.endTick
  ) {
    return { ok: false, reason: 'outcome mismatch despite matching digest schema' };
  }
  return { ok: true, outcome: result.outcome, digest: result.digest };
}
