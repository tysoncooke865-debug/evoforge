/**
 * FORGE CHALLENGES feature flags.
 *
 * `challengesEnabled` decides which tab the athlete gets. OFF (the shipping
 * default) leaves ARENA exactly where it is and Challenges unreachable from
 * the primary UI; ON swaps the tab for CHALLENGES and moves Arena out of the
 * bar. The brief: "the feature is behind a feature flag until the founders
 * complete manual testing."
 *
 * The flag switches WHICH TAB EXISTS, not whether the code ships — both route
 * trees are built either way, so flipping this is a one-line change with no
 * bundle surprise, and the Arena routes stay intact for later.
 *
 * ON since 2026-08-07 (Tyson: "arena should be replaced with the wager
 * system, and the damage assesment mode and thats it"). Migrations 139-143 are
 * applied; create → accept → escrow is verified end-to-end in two browsers,
 * and settlement — winner, draw, refund, idempotency, ledger conservation — is
 * falsified in SQL against production. What is NOT yet exercised is settlement
 * through the UI on a window that has really elapsed, because that takes seven
 * days. Set this back to false to restore Arena in one line.
 */
export const challengeFeatures = {
  challengesEnabled: true,
  /** Keep Arena reachable by URL while the swap is being tested. Set false to
   *  hide it entirely once Challenges is the shipped answer. */
  arenaRoutesReachable: true,
} as const;
