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
 * Flip to true only once migrations 139–142 are applied to production (they
 * are) AND two founders have run the manual pass end to end. Real coins move;
 * a half-tested settlement is somebody's balance.
 */
export const challengeFeatures = {
  challengesEnabled: false,
  /** Keep Arena reachable by URL while the swap is being tested. Set false to
   *  hide it entirely once Challenges is the shipped answer. */
  arenaRoutesReachable: true,
} as const;
