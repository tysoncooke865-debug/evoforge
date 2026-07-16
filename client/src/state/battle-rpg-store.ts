import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { BattleMode, BattleRewards, ChampionId } from '@/domain/battle-rpg/types';

/**
 * BATTLE RPG persistence (Tyson beta, 2026-07-16). LOCAL-FIRST by design:
 * this store is the repository behind services/battle-repo. The Supabase
 * seam is documented in migrations/032_battle_rpg.sql and battle-repo.ts —
 * swap the store reads/writes for Supabase there without touching the UI.
 *
 * Rewards are recorded here (coins/XP earned in battle) rather than minted
 * into the server-guarded coin ledger — wiring that needs a server RPC
 * (see the migration). DOCTRINE: cleared on sign-out in auth-context.
 */

export interface GymProgress {
  cleared: boolean;
  firstClearClaimed: boolean;
  bestTurns: number | null;
}

export interface RivalryRecord {
  wins: number;
  losses: number;
  streak: number; // + = win streak, - = loss streak
  lastWinner: 'player' | 'rival' | null;
  lastBattleAt: number | null;
}

export interface BattleResultRecord {
  id: string;
  mode: BattleMode;
  playerChampion: ChampionId;
  opponentChampion: ChampionId;
  opponentName: string;
  result: 'win' | 'loss';
  turns: number;
  rewards: BattleRewards;
  at: number;
}

interface BattleRpgState {
  selectedChampion: ChampionId | null;
  gymProgress: Record<string, GymProgress>;
  rivalry: RivalryRecord;
  history: BattleResultRecord[];
  /** Local tally of coins/XP earned in battle (not yet banked to the ledger). */
  earnedCoins: number;
  earnedForgeXp: number;
  _hydrated: boolean;

  setSelectedChampion: (id: ChampionId) => void;
  recordResult: (r: Omit<BattleResultRecord, 'id' | 'at'> & { at: number; id: string }) => void;
  markGymClear: (gymId: string, turns: number, claimedFirstClear: boolean) => void;
  recordRival: (won: boolean, at: number) => void;
  reset: () => void;
}

const EMPTY_RIVALRY: RivalryRecord = { wins: 0, losses: 0, streak: 0, lastWinner: null, lastBattleAt: null };

export const useBattleRpgStore = create<BattleRpgState>()(
  persist(
    (set) => ({
      selectedChampion: null,
      gymProgress: {},
      rivalry: EMPTY_RIVALRY,
      history: [],
      earnedCoins: 0,
      earnedForgeXp: 0,
      _hydrated: false,

      setSelectedChampion: (id) => set({ selectedChampion: id }),

      recordResult: (r) =>
        set((s) => ({
          history: [{ ...r }, ...s.history].slice(0, 30),
          earnedCoins: s.earnedCoins + r.rewards.coins,
          earnedForgeXp: s.earnedForgeXp + r.rewards.forgeXp,
        })),

      markGymClear: (gymId, turns, claimedFirstClear) =>
        set((s) => {
          const prev = s.gymProgress[gymId] ?? { cleared: false, firstClearClaimed: false, bestTurns: null };
          return {
            gymProgress: {
              ...s.gymProgress,
              [gymId]: {
                cleared: true,
                firstClearClaimed: prev.firstClearClaimed || claimedFirstClear,
                bestTurns: prev.bestTurns === null ? turns : Math.min(prev.bestTurns, turns),
              },
            },
          };
        }),

      recordRival: (won, at) =>
        set((s) => {
          const streak = won ? Math.max(1, s.rivalry.streak + 1) : Math.min(-1, s.rivalry.streak - 1);
          return {
            rivalry: {
              wins: s.rivalry.wins + (won ? 1 : 0),
              losses: s.rivalry.losses + (won ? 0 : 1),
              streak,
              lastWinner: won ? 'player' : 'rival',
              lastBattleAt: at,
            },
          };
        }),

      reset: () =>
        set({
          selectedChampion: null,
          gymProgress: {},
          rivalry: EMPTY_RIVALRY,
          history: [],
          earnedCoins: 0,
          earnedForgeXp: 0,
        }),
    }),
    {
      name: 'evoforge-battle-rpg',
      storage: createJSONStorage(() => AsyncStorage),
      // Merge defaults under saved values (same migration lesson as the
      // loadout store) so a save from an earlier build is always complete.
      merge: (persisted, current) => {
        const saved = (persisted as Partial<BattleRpgState> | undefined) ?? {};
        return { ...current, ...saved, rivalry: { ...EMPTY_RIVALRY, ...(saved.rivalry ?? {}) } };
      },
      onRehydrateStorage: () => (state) => {
        if (state) state._hydrated = true;
      },
    }
  )
);
