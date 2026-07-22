/**
 * EvoForge integration boundary — types.
 *
 * These interfaces are THE contract between the standalone game and the real
 * EvoForge app. Game systems must never read fitness values from storage or
 * UI state directly; they go through an EvoForgePlayerProvider.
 *
 * See EVOFORGE_INTEGRATION.md for the integration guide.
 */
import type { AvatarPath } from '../../game-engine/types';

export interface PlayerProfile {
  playerId: string;
  displayName: string;
  /** Selected Champion definition id (derived from avatarPath in EvoForge). */
  championId: string;
  rankPoints: number;
}

export interface FitnessProfile {
  playerId: string;
  /** Overall Evo Rating (0..100 in the mock; EvoForge supplies real values). */
  evoRating: number;
  strengthRating: number;
  cardioRating: number;
  muscularityRating: number;
  leannessRating: number;
  aestheticsRating: number;
  forgeLevel: number;
  avatarPath: AvatarPath;
  avatarStage: number;
}

export interface GymProfile {
  gymId: string;
  name: string;
  /** Member player ids — champion roles are derived from member fitness. */
  memberIds: string[];
}

/**
 * A gym member as needed by the squad/roster systems (M9): identity plus the
 * full FitnessProfile their borrowed champion is derived from. Champion role
 * titles are computed client-side from member fitness (computeGymChampions).
 */
export interface GymMemberInfo {
  playerId: string;
  displayName: string;
  fitness: FitnessProfile;
}

export interface BattleResult {
  battleId: string;
  balanceVersion: string;
  seed: number;
  playerId: string;
  opponentId: string;
  outcome: 'win' | 'loss' | 'draw';
  playerCoreHealth: number;
  opponentCoreHealth: number;
  durationTicks: number;
  rankPointsDelta: number;
  mode: 'standard' | 'ranked' | 'gym-war' | 'tutorial';
  completedAt: string; // ISO timestamp
  /**
   * Gym War attribution (M9, mode 'gym-war' only): the gym members whose
   * borrowed champions were fielded, so the provider can credit contribution
   * stats (the mock updates local save data; EvoForge would credit
   * server-side).
   */
  gymWar?: {
    /** The rival gym that was attacked. */
    enemyGymId: string;
    /** Member player ids whose champions were borrowed into the squad. */
    fieldedMemberIds: string[];
  };
}

export interface EvoForgePlayerProvider {
  getCurrentPlayer(): Promise<PlayerProfile>;
  getFitnessProfile(playerId: string): Promise<FitnessProfile>;
  getGymProfile(playerId: string): Promise<GymProfile | null>;
  /**
   * Roster of a gym (M9) — the current player's own gym or a rival gym.
   * Rejects unknown gym ids.
   */
  getGymMembers(gymId: string): Promise<GymMemberInfo[]>;
  /** Gyms available as Gym War opponents (never includes the player's own). */
  listRivalGyms(): Promise<GymProfile[]>;
  recordBattleResult(result: BattleResult): Promise<void>;
}
