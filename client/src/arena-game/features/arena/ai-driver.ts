/**
 * Player-side AI driver (M10 stability harness) — commands the PLAYER team
 * with the exact same heuristics as the opponent AI, by construction rather
 * than by duplication: it builds a read-only MIRRORED VIEW of the battle
 * state (teams swapped, x reflected across the lane axis) and runs the real
 * `runOpponentAi` over it, then transforms the staged commands back into
 * player-team commands (team swap; deploy x un-mirrored). The heuristics can
 * therefore never drift from `opponent-ai.ts` — any future AI change is
 * automatically exercised on both sides by the stability suite.
 *
 * Purity/determinism contract:
 *  - The mirrored view is built fresh per invocation and NEVER mutated by the
 *    AI (runOpponentAi and validateChampionAbility only read state); nothing
 *    written to the view can leak back (its log is a fresh array, staged
 *    commands go to a scratch list).
 *  - All randomness comes from the driver's own SeededRng, derived from the
 *    battle seed with a DIFFERENT xor constant than the opponent's stream
 *    (0x3c6ef372 vs the controller's 0x9e3779b9), so the two AIs never share
 *    a random sequence. Same seed + same difficulty ⇒ identical decisions.
 *  - Commands are queued for the NEXT tick through the ordinary command log,
 *    exactly like human/opponent commands — a recorded commandLog replays
 *    digest-identically through runBattle with no AI code present.
 *
 * The mirror is exact because the arena is symmetric by construction: cores
 * at x=0 / x=laneLength, identical deploy zones, and every AI heuristic works
 * on relative distances (|x1 - x2| is mirror-invariant) and team-relative
 * filters. Entity ids are preserved by the view, so unit-targeted commands
 * transform by team swap alone.
 */
import { AiDifficulty, BALANCE } from '../../content';
import { SeededRng } from '../../game-engine/random/rng';
import type { ScheduledCommand } from '../../game-engine/simulation/events';
import type { BattleState, UnitState } from '../../game-engine/simulation/state';
import type { TeamId } from '../../game-engine/types';
import {
  createOpponentAiRuntime,
  OpponentAiRuntime,
  runOpponentAi,
} from './opponent-ai';

export interface PlayerAiDriver {
  /** The driver's own RNG stream — never the battle's, never the opponent's. */
  rng: SeededRng;
  /** Decision cadence + ultimate hold bookkeeping (same shape as the opponent). */
  runtime: OpponentAiRuntime;
  difficulty: AiDifficulty;
}

/** Seed-derivation constant for the player-side stream (≠ opponent's 0x9e3779b9). */
const PLAYER_AI_SEED_XOR = 0x3c6ef372;

export function createPlayerAiDriver(seed: number, difficulty: AiDifficulty): PlayerAiDriver {
  const rng = new SeededRng((seed ^ PLAYER_AI_SEED_XOR) >>> 0);
  return { rng, runtime: createOpponentAiRuntime(rng, difficulty), difficulty };
}

function swapTeam(team: TeamId): TeamId {
  return team === 'player' ? 'opponent' : 'player';
}

/**
 * Read-only mirrored view: every unit/core team-swapped and reflected to
 * x' = laneLength - x; team blocks (energy/cards/augment) and auras swapped.
 * Nested objects (base stats, modifiers, champion sub-state, cards, augment)
 * are shared by reference — the AI treats state as read-only, and the
 * stability suite's replay-fidelity checks would catch any mutation.
 */
function mirroredView(state: BattleState): BattleState {
  const { laneLength } = BALANCE.arena;
  const units: UnitState[] = state.units.map((u) => ({
    ...u,
    team: swapTeam(u.team),
    x: laneLength - u.x,
  }));
  return {
    balanceVersion: state.balanceVersion,
    seed: state.seed,
    tick: state.tick,
    phase: state.phase,
    suddenDeathEndsAtTick: state.suddenDeathEndsAtTick,
    // Present for structural completeness only — the AI never consumes the
    // battle RNG (it uses the stream passed to runOpponentAi).
    rng: state.rng,
    nextEntityId: state.nextEntityId,
    units,
    cores: {
      player: { ...state.cores.opponent, team: 'player', x: laneLength - state.cores.opponent.x },
      opponent: { ...state.cores.player, team: 'opponent', x: laneLength - state.cores.player.x },
    },
    teams: {
      player: { ...state.teams.opponent, team: 'player' },
      opponent: { ...state.teams.player, team: 'opponent' },
    },
    auras: { player: state.auras.opponent, opponent: state.auras.player },
    outcome: state.outcome,
    // Fresh array: nothing the AI could ever log may leak into the real log.
    log: [],
  };
}

/**
 * One player-side AI evaluation pass. Call once per tick BEFORE advancing the
 * simulation (mirroring how the live controller calls runOpponentAi), so
 * queued commands land on the next tick like every other input path.
 *
 * The cheap gate below replicates runOpponentAi's own early-outs (augment
 * pending / decision due) so the mirrored view is only built on ticks where
 * the AI would actually act — behaviourally identical to calling it every
 * tick, because the skipped calls consume no RNG and change no state.
 */
export function runPlayerAi(
  state: BattleState,
  commandLog: ScheduledCommand[],
  driver: PlayerAiDriver
): void {
  if (state.phase === 'finished') return;
  const cfg = BALANCE.ai.difficulties[driver.difficulty];
  const augment = state.teams.player.augment;
  const augmentDue =
    augment.offeredIds !== null &&
    augment.chosenId === null &&
    state.tick >= BALANCE.augment.offerTick + cfg.augmentChoiceDelayTicks;
  const decisionDue = state.tick >= driver.runtime.nextDecisionTick;
  if (!augmentDue && !decisionDue) return;

  const view = mirroredView(state);
  const staged: ScheduledCommand[] = [];
  runOpponentAi(view, staged, driver.rng, driver.runtime, driver.difficulty);

  const { laneLength } = BALANCE.arena;
  for (const { tick, command } of staged) {
    switch (command.type) {
      case 'deploy-card':
        // Un-mirror the deploy position: the view's opponent zone
        // [laneLength - deployZoneDepth, laneLength] maps exactly onto the
        // real player zone [0, deployZoneDepth].
        commandLog.push({
          tick,
          command: { ...command, team: 'player', x: laneLength - command.x },
        });
        break;
      case 'play-card':
      case 'champion-ability':
      case 'champion-ultimate':
      case 'choose-augment':
        // Entity ids and augment ids are preserved by the view — team swap
        // is the whole transform.
        commandLog.push({ tick, command: { ...command, team: 'player' } });
        break;
      default:
        // The opponent AI emits only the five command types above. A new AI
        // command kind must teach this mirror its transform — dropping it
        // here keeps the driver fail-safe (never emits an untransformed
        // opponent-team command).
        break;
    }
  }
}
