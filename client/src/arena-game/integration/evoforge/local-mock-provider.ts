/**
 * LocalMockPlayerProvider — the standalone beta's implementation of the
 * EvoForge integration boundary, backed by the local player store.
 *
 * EvoForge integration later replaces this class with a
 * SupabaseEvoForgePlayerProvider implementing the same interface; nothing
 * else in the game should change.
 *
 * M9 gyms: the local player belongs to the seeded 'forge-district' gym. Gym
 * rosters are generated deterministically in services/gyms/gym-data and only
 * reach the rest of the game through this boundary — screens never import
 * gym data directly.
 */
import { BALANCE } from '../../content/balance';
import { applyGymWarResult } from '../../services/gyms/contribution';
import {
  generateGym,
  gymProfileOf,
  SEED_GYM_IDS,
} from '../../services/gyms/gym-data';
import type { PlayerStore } from '../../services/player-data/player-store';
import type {
  BattleResult,
  EvoForgePlayerProvider,
  FitnessProfile,
  GymMemberInfo,
  GymProfile,
  PlayerProfile,
} from './types';

/** The seeded gym the local player belongs to in the beta. */
export const LOCAL_PLAYER_GYM_ID = 'forge-district';

export class LocalMockPlayerProvider implements EvoForgePlayerProvider {
  constructor(private readonly store: PlayerStore) {}

  async getCurrentPlayer(): Promise<PlayerProfile> {
    const { save } = this.store.getState();
    return {
      playerId: save.player.playerId,
      displayName: save.player.displayName,
      championId: save.player.championId,
      rankPoints: save.player.rankPoints,
    };
  }

  async getFitnessProfile(playerId: string): Promise<FitnessProfile> {
    const { save } = this.store.getState();
    if (playerId !== save.fitness.playerId) {
      throw new Error(`unknown player '${playerId}' — mock provider only knows the local player`);
    }
    return { ...save.fitness };
  }

  async getGymProfile(playerId: string): Promise<GymProfile | null> {
    const { save } = this.store.getState();
    if (playerId !== save.player.playerId) return null;
    const profile = gymProfileOf(generateGym(LOCAL_PLAYER_GYM_ID));
    // The local player is a member of their gym alongside the seeded roster.
    return { ...profile, memberIds: [...profile.memberIds, save.player.playerId] };
  }

  async getGymMembers(gymId: string): Promise<GymMemberInfo[]> {
    if (!SEED_GYM_IDS.includes(gymId as (typeof SEED_GYM_IDS)[number])) {
      throw new Error(`unknown gym '${gymId}'`);
    }
    const members: GymMemberInfo[] = generateGym(gymId).members.map((m) => ({
      playerId: m.playerId,
      displayName: m.displayName,
      fitness: { ...m.fitness },
    }));
    if (gymId === LOCAL_PLAYER_GYM_ID) {
      const { save } = this.store.getState();
      members.push({
        playerId: save.player.playerId,
        displayName: save.player.displayName,
        fitness: { ...save.fitness },
      });
    }
    return members;
  }

  async listRivalGyms(): Promise<GymProfile[]> {
    return SEED_GYM_IDS.filter((id) => id !== LOCAL_PLAYER_GYM_ID).map((id) =>
      gymProfileOf(generateGym(id))
    );
  }

  async recordBattleResult(result: BattleResult): Promise<void> {
    await this.store.getState().update((save) => ({
      ...save,
      player: {
        ...save.player,
        rankPoints: Math.max(0, save.player.rankPoints + result.rankPointsDelta),
      },
      stats: {
        battlesPlayed: save.stats.battlesPlayed + 1,
        wins: save.stats.wins + (result.outcome === 'win' ? 1 : 0),
        losses: save.stats.losses + (result.outcome === 'loss' ? 1 : 0),
        draws: save.stats.draws + (result.outcome === 'draw' ? 1 : 0),
      },
      // Gym War contribution stats (M9): only gym-war results touch the gym
      // block; fielded members are credited via the attribution payload.
      gym:
        result.mode === 'gym-war'
          ? applyGymWarResult(
              save.gym,
              result.gymWar?.fieldedMemberIds ?? [],
              result.outcome === 'win',
              BALANCE
            )
          : save.gym,
    }));
  }
}
