# Balance Guide

## Where numbers live

Every tunable number is in exactly one of these places:

| What | File |
| --- | --- |
| Global knobs (energy, timers, arena, core HP, fitness caps, rank points, augment offer, AI heuristics/difficulties) | `src/content/balance.ts` |
| Card costs/stats/effects | `src/content/cards.ts` |
| Champion stats/abilities/ultimates | `src/content/champions.ts` |
| Synergy thresholds/bonuses | `src/content/synergies.ts` |
| Mid-match augment effects | `src/content/augments.ts` |

Engine code and components must never contain gameplay constants. If you find
one, move it into balance/content and reference it.

## How to tune safely

1. Change values only in the files above.
2. Bump `BALANCE_VERSION` in `src/content/balance.ts` (semver: patch for pure
   number tweaks, minor for new mechanics/cards). Battle records and replays
   are stamped with this version — replays refuse to run across versions.
3. Run `npm run typecheck && npm test`. Validation enforces structural sanity
   (cost ranges, positive stats, ascending rank tiers, the ranked fitness cap
   staying within 0.05–0.15).
4. From Milestone 10 on, run the stability harness (100 simulated matches) and
   check the win-rate distribution before shipping a balance change.

## Guardrails encoded in validation

- Energy costs must be 1..10.
- `fitness.rankedMaxTotalAdvantage` must stay within 0.05..0.15 (the mandated
  10–15% competitive cap on fitness-derived advantage).
- Rank tiers must be strictly ascending.
- Attack ranges cannot exceed half the lane length.
- The augment offer must fall inside the main battle phase; every augment
  needs exactly one well-formed effect; AI decision intervals must be >= 2
  ticks (commands queue one tick ahead) and mistake chances in [0, 1].
- AI difficulties may only change decision quality — the engine offers no
  stat-boost path to configure, and tests assert no unexplained modifiers
  or energy ever appear on AI units.

## Time units

The simulation runs at 20 ticks/second. All durations in content are in ticks;
author them with `secondsToTicks(x)` for readability.
