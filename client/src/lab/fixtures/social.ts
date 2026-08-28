import type { MetricRow } from '@/domain/leaderboard';

/**
 * The lab's CROSS-USER fixtures — the only ones that are not the lab
 * athlete's own rows.
 *
 * Home's leaderboard teaser reads two things: this athlete's opt-in public
 * identity, and the `leaderboard_by_metric` RPC (the ONE cross-user read
 * surface). Neither is user-scoped data a fixture can derive, so both are
 * fabricated here — the same licence fixtures/athlete.ts already takes.
 *
 * Opted IN on purpose: opted out, the teaser renders its JOIN THE BOARD
 * door and a Home variant never shows the board itself, which is the whole
 * surface a designer opens the teaser to look at.
 *
 * The rows carry every column rankByMetric reads. `rank_position` is the
 * RPC's own window numbering, so it must agree with the array order —
 * the lab test pins that, because a board that renumbers itself is exactly
 * the bug the server-side ordering exists to prevent.
 */

export const LAB_PUBLIC_IDENTITY: { displayName: string | null; isPublic: boolean } = {
  displayName: 'LAB ATHLETE',
  isPublic: true,
};

/** The metric the Home teaser asks for, and how many rows — the query key
 *  carries both, so seeding must use the same pair (fixtures/index.ts). */
export const LAB_BOARD_METRIC = 'evo';
export const LAB_BOARD_ROWS = 10;

/** EVERY row count Home asks the board for. `useLeaderboardByMetric(metric, n)`
 *  puts n in the key, and Home reads it at two sizes: the teaser's 10 and the
 *  standing rail / expanded board's 100. Seeding one size leaves the other
 *  fetching for real, silently, on every mount. */
export const LAB_BOARD_ROW_COUNTS: readonly number[] = [LAB_BOARD_ROWS, 100];

export const LAB_LEADERBOARD: MetricRow[] = [
  { display_name: 'IRONCLAD', xp: 41_200, base_level: 4, forge_level: 22, evo_rating: 71, momentum_weeks: 9, rank_position: 1 },
  { display_name: 'NOVA', xp: 38_450, base_level: 3, forge_level: 20, evo_rating: 66, momentum_weeks: 7, rank_position: 2 },
  { display_name: 'THE SHREDDER', xp: 33_100, base_level: 5, forge_level: 19, evo_rating: 61, momentum_weeks: 12, rank_position: 3 },
  { display_name: 'ATLAS', xp: 29_880, base_level: 2, forge_level: 17, evo_rating: 58, momentum_weeks: 4, rank_position: 4 },
  { display_name: 'KESTREL', xp: 24_010, base_level: 3, forge_level: 15, evo_rating: 54, momentum_weeks: 6, rank_position: 5 },
  { display_name: 'LAB ATHLETE', xp: 3_400, base_level: 3, forge_level: 7, evo_rating: 42, momentum_weeks: 3, rank_position: 6 },
  // Null Evo Rating = the athlete keeps it private. A board of all-populated
  // ratings would hide the dash the row view renders for exactly this case.
  { display_name: 'QUIETONE', xp: 2_950, base_level: 1, forge_level: 6, evo_rating: null, momentum_weeks: 2, rank_position: 7 },
];
