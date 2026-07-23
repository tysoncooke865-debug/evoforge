import type { QueryClient } from '@tanstack/react-query';

/**
 * TABLE → READER KEYS (audit C3, 2026-07-19). The invalidation-gap bug
 * class: a mutation writes a table but refreshes only the caches ITS
 * screen reads, leaving every other reader stale (privacy toggles,
 * PR coins, post-review player stats…). This map is the single answer to
 * "who reads table X" — a mutation that touches a table calls
 * `invalidateTable` and cannot miss a reader added later, PROVIDED new
 * hooks register their key here.
 *
 * RULES:
 * - Keys are the PREFIX form (['name'] matches ['name', userId, …]).
 * - `profile` has a documented exception: useBindOrigin deliberately skips
 *   ['profile'] mid-ceremony (the awakening race, 047 gotcha #1) and does
 *   its own invalidation on completion — it must NOT use this helper for
 *   profile. Every other profile writer should.
 */
export const TABLE_READERS: Record<string, readonly string[]> = {
  // NOT the two leaderboard keys (perf, 2026-07-23): a name/privacy edit
  // reorders nothing, and /rank refetches on visit anyway (staleTime 30s +
  // the focused 60s poll) — invalidating them here refired the app's two
  // most expensive RPCs, across every metric tab, for a one-string write.
  // Rank ORDER changes ride the `user_progression` entry below.
  public_profile: [
    'public_profile',
    'athlete_profile',
    'discover_athletes',
    'search_athletes',
  ],
  coin_events: ['coin_total', 'coin_events'],
  xp_events: ['xp_total', 'xp_ledger', 'xp_server_granted'],
  xp_ledger: ['xp_ledger', 'user_progression'],
  user_progression: ['user_progression', 'leaderboard_metric'],
  physique_ratings: ['physique_ratings', 'physique_history'],
  bodyfat_log: ['bodyfat_series', 'bodyfat_history'],
  player_stats: ['player_stats'],
  profile: ['profile', 'origin_status'],
  user_plans: ['user_plans'],
  workout_schedule: ['workout_schedule'],
};

export function invalidateTable(queryClient: QueryClient, table: keyof typeof TABLE_READERS): void {
  for (const key of TABLE_READERS[table] ?? []) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
