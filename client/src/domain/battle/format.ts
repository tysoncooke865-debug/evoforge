/**
 * TRANSFORM P7: display names for the battle formats, and the split the
 * Arena hub sorts on. Pure, engine-adjacent but NOT the engine — the byte-
 * pinned engine.ts stays untouched (its copies are verified by CI).
 *
 * The hub used to hardcode "Friendly Blitz" on every history row, so a
 * Volume Duel and a Heads or Tails both lied about what they were.
 */

/** The only fields the split needs — structural, so domain/ keeps its
 *  no-imports-from-data rule and BattleMatch satisfies it by shape. */
export interface MatchLike {
  status: string;
  created_at: string;
}

export function formatLabel(format: string): string {
  if (format === 'volume_duel') return 'Volume Duel';
  if (format === 'heads_or_tails') return 'Heads or Tails';
  return 'Friendly Blitz';
}

export function formatGlyph(format: string): string {
  if (format === 'volume_duel') return '⚖';
  if (format === 'heads_or_tails') return '🪙';
  return '⚔️';
}

/** In flight: the match needs one or both athletes to act. */
export const LIVE_STATUSES = ['matched', 'active', 'judging'] as const;

export function isLive(m: MatchLike): boolean {
  return (LIVE_STATUSES as readonly string[]).includes(m.status);
}

/** Waiting on an opponent to enter the code. */
export function isOpenInvite(m: MatchLike): boolean {
  return m.status === 'inviting';
}

export function isFinished(m: MatchLike): boolean {
  return m.status === 'settled' || m.status === 'abandoned';
}

export interface HubBattles<T extends MatchLike> {
  /** Live matches, newest first — the hub shows these ABOVE everything. */
  live: T[];
  /** Open invites of ours, newest first. */
  invites: T[];
  /** Settled/abandoned, newest first. */
  history: T[];
}

/**
 * Split the athlete's matches into the three things the hub renders.
 * A match is in exactly one bucket; anything with an unknown status falls
 * to history rather than vanishing (a silently-dropped match would be a
 * battle the athlete can never reach again).
 */
export function splitBattles<T extends MatchLike>(matches: T[]): HubBattles<T> {
  const newestFirst = [...matches].sort((a, b) =>
    String(a.created_at) < String(b.created_at) ? 1 : -1
  );
  return {
    live: newestFirst.filter(isLive),
    invites: newestFirst.filter(isOpenInvite),
    history: newestFirst.filter((m) => !isLive(m) && !isOpenInvite(m)),
  };
}
