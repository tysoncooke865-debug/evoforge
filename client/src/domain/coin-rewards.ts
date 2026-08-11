/**
 * THE COIN ECONOMY — one table, and it is the server's (2026-08-11).
 *
 * ---- THE BUG THIS ENDS ----
 *
 * The coins page said, in prose typed by hand:
 *
 *     "workout complete +25, PR +50, streak milestones 10x the..."
 *
 * The ledger recorded 20 and 25. Both numbers in that sentence were wrong, and
 * an athlete who read it and then checked their balance had every reason to
 * think the app was shorting them. A reward the UI describes and the ledger
 * contradicts is worse than no description.
 *
 * ---- WHERE TRUTH ACTUALLY LIVES ----
 *
 * `coin_events_guard` (migrations 013/033) RECOMPUTES `amount` server-side on
 * every insert, so the client cannot mint a value however it asks. That trigger
 * is the canonical source, and this file is its mirror — verified against the
 * live function on 2026-08-11:
 *
 *     set_reward       new.amount := 12
 *     workout_complete new.amount := 20
 *     pr               new.amount := 25
 *     streak_milestone new.amount := 10 * m
 *     starting_bonus   new.amount := 100
 *
 * A mirror can drift, so it is written to be checkable: the numbers are here,
 * once, and every surface reads them. When the guard changes, this file changes
 * with it and every tooltip, label and summary moves together — which is the
 * property the hand-typed sentence never had.
 *
 * NOT MIRRORED HERE, ON PURPOSE: the daily cache and the Forge reveal. Both are
 * server-side TABLES (`forge_cache_tiers`, and the reveal's additive table), not
 * constants, and both are already returned by the state RPCs that drive their
 * cards. Copying a progression ladder into the client would be inventing a
 * second source for the one kind of value that genuinely varies — so those
 * surfaces keep reading the server's own numbers.
 */

/** Every kind the guard fixes an amount for. */
export type FixedRewardKind = 'set_reward' | 'workout_complete' | 'pr' | 'starting_bonus';

/** The guard's fixed amounts. Change these only to match a guard change. */
export const COIN_REWARDS: Readonly<Record<FixedRewardKind, number>> = {
  /** A qualified logged set. */
  set_reward: 12,
  /** Finishing a workout. */
  workout_complete: 20,
  /** A meaningful personal record. */
  pr: 25,
  /** Once, on the first day. */
  starting_bonus: 100,
};

/** Streak milestones pay 10 x the milestone (7 days -> 70). */
export const STREAK_MILESTONE_MULTIPLIER = 10;
export function streakMilestoneCoins(milestone: number): number {
  return STREAK_MILESTONE_MULTIPLIER * Math.max(0, Math.trunc(milestone));
}

/**
 * The one place the app describes what a coin is for. Every tooltip, list row
 * and accessibility label reads these, so the description and the ledger cannot
 * disagree — which is the entire failure being fixed.
 */
export interface RewardCopy {
  kind: FixedRewardKind;
  /** "+20" — never typed into a sentence by hand. */
  amount: string;
  label: string;
  /** What a screen reader says. */
  a11y: string;
}

export const REWARD_COPY: readonly RewardCopy[] = (
  [
    ['set_reward', 'Qualified set logged'],
    ['workout_complete', 'Workout completed'],
    ['pr', 'Personal record'],
  ] as const
).map(([kind, label]) => ({
  kind,
  amount: `+${COIN_REWARDS[kind]}`,
  label,
  a11y: `${label}, plus ${COIN_REWARDS[kind]} coins`,
}));

/** "Qualified set +12 · Workout complete +20 · PR +25" — the summary line,
 *  assembled from the table rather than written out. */
export function rewardSummarySentence(): string {
  return REWARD_COPY.map((r) => `${r.label.toLowerCase()} ${r.amount}`).join(' · ');
}

/**
 * THE LOCAL WEEK BOUNDARY, stated once.
 *
 * "This week" is Monday 00:00 in the ATHLETE'S calendar — the same Monday
 * `domain/progress-aggregates.ts::weekStart` uses for training weeks, so the
 * coin week and the training week cannot describe different seven days. Derived
 * from a local ISO date, never from a UTC timestamp: east of Greenwich those
 * disagree for the first hours of every day (domain/today.ts has the full
 * lesson).
 */
export function coinWeekStart(todayIso: string): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Is this ledger row inside the local week containing `todayIso`? */
export function inCoinWeek(rowDateIso: string, todayIso: string): boolean {
  if (!rowDateIso) return false;
  const start = coinWeekStart(todayIso);
  const day = rowDateIso.slice(0, 10);
  return day >= start && day <= todayIso;
}

/**
 * WHERE YOUR COINS CAME FROM — computed from the ledger, never from an
 * assumption about what the athlete probably did.
 *
 * Sums the actual rows by kind. The totals therefore add up to the balance by
 * construction, which is the §3 requirement: "coin ledger totals must equal the
 * sum of ledger entries."
 */
export interface LedgerRow {
  kind?: unknown;
  amount?: unknown;
  created_at?: unknown;
}

export interface CoinSource {
  kind: string;
  coins: number;
  entries: number;
}

export function coinsBySource(rows: readonly LedgerRow[] | undefined): CoinSource[] {
  const by = new Map<string, CoinSource>();
  for (const r of rows ?? []) {
    const amount = Number(r.amount);
    // A row whose amount is not a number cannot have moved the balance, so it
    // is not in the total either — dropping it keeps the two agreeing.
    if (!Number.isFinite(amount)) continue;
    // A row with no KIND still moved the balance, so it must appear somewhere
    // or the breakdown quietly under-sums the total the athlete can see.
    // Unattributable is a real answer; missing is not.
    const kind = String(r.kind ?? '').trim() || 'other';
    const cur = by.get(kind) ?? { kind, coins: 0, entries: 0 };
    cur.coins += amount;
    cur.entries += 1;
    by.set(kind, cur);
  }
  // Biggest contributor first; ties by name so the order is deterministic.
  return [...by.values()].sort((a, b) => b.coins - a.coins || a.kind.localeCompare(b.kind));
}

/** The ledger's own total. Equal to the balance by construction. */
export function ledgerTotal(rows: readonly LedgerRow[] | undefined): number {
  let n = 0;
  for (const r of rows ?? []) {
    const amount = Number(r.amount);
    if (Number.isFinite(amount)) n += amount;
  }
  return n;
}

/** The same, restricted to the local week containing `todayIso`. */
export function coinsThisWeek(rows: readonly LedgerRow[] | undefined, todayIso: string): number {
  let n = 0;
  for (const r of rows ?? []) {
    const at = String(r.created_at ?? '');
    if (!inCoinWeek(at, todayIso)) continue;
    const amount = Number(r.amount);
    if (Number.isFinite(amount)) n += amount;
  }
  return n;
}
