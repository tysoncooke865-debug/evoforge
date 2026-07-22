# Balance Guide

## The official roster (balance 0.6.0)

Five Champions — exactly EvoForge's live BranchV2 slugs, ids `champion-<slug>`,
display names pinned by content validation. Fitness scaling applies the same
±12%-capped five-way mapping to every champion (Strength→damage,
Cardio→cooldowns, Size→health, Leanness→speed, Aesthetics→ult charge), shown
openly on the champion detail screen.

| | Aesthetics (`aesthetic`) |
|---|---|
| Role | Flexible tactician / support |
| Stats | 1050 HP · 60 dmg / 1.0s · range 3.5 · speed 0.24 |
| Passive | **Flow State** — team receives +10% healing while alive (aura layer) |
| Ability | **Stance Shift** (12s): toggle Bulwark (0.7× damage taken) / Assault (+25% damage) for 8s |
| Ultimate | **Forge Rally**: all allies +25% damage, 120 heal over 5s |
| Counters | Burst assassins (The Shredder) — kill it before the rally value accrues |

| | Titan (`titan`) |
|---|---|
| Role | Tank / controller — explosive impact + control |
| Stats | 1400 HP · 70 dmg / 1.5s · range 3.5 · speed 0.16 |
| Passive | **Iron Hide** — every hit against it reduced by 5 flat (min 1) |
| Ability | **Quake Stomp** (14s): stun all enemies in radius 10, both lanes, 1.5s |
| Ultimate | **Seismic Smash**: 320 damage + 0.8s stun, radius 14, both lanes |
| Counters | Ranged chip (armour is melee-relevant only for its own frontline rule); kiting its 0.16 speed |

| | Mass Monster (`mass`) |
|---|---|
| Role | Durable bruiser / area presence — sustained pressure, NOT burst |
| Stats | 1900 HP (×1.1 passive = 2090 at spawn) · 55 dmg / 1.4s · range 3.5 · speed 0.14 |
| Passive | **Colossal Frame** — spawns with +10% max health (baked at spawn) |
| Ability | **Gravity Well** (12s): slow enemies in radius 10 (both lanes) to 60% speed for 4s |
| Ultimate | **Mass Uprising**: summon two Titan Guards at its position, one per lane |
| Counters | Executes/% damage (Final Cut ignores the health pool), tempo (outpace the 0.14 speed), AoE clears the summons |

| | The Shredder (`shredder`) |
|---|---|
| Role | Assassin / backline disruption |
| Stats | 750 HP · 90 dmg / 1.1s · range 3 · speed 0.26 |
| Passive | **Killer Instinct** — its own hits deal +25% vs targets below 35% health |
| Ability | **Phase Dash** (12s): dash to the furthest in-lane enemy in aggro range, 120 damage |
| Ultimate | **Final Cut**: 250 to the lowest-health in-lane enemy; executes below 30% (through shields) |
| Counters | Stuns (750 HP melts under Seismic Smash), shields blunt the opener (not the execute) |

| | Cardio Machine (`cardio`) |
|---|---|
| Role | Tempo specialist — speed, energy efficiency, sustained pressure |
| Stats | 850 HP · 45 dmg / 0.6s · range 3 · speed 0.34 |
| Passive | **Perpetual Motion** — team Forge Energy regen ×1.05 while alive (aura layer) |
| Ability | **Lane Shift** (10s): teleport to the same x in the other lane |
| Ultimate | **Overclock**: 6s of 2× attack speed + 60% move speed, refunds 1 energy on cast |
| Counters | Kill it to shut the energy engine off; area control (Gravity Well) traps the tempo game |

Synergy tags follow the same slugs (`cardio-momentum`, `mass-presence`,
`titan-bulwark`, `support-network`, `balanced-forge` over 5 distinct paths).

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

## P8 — five-champion balance tune (2026-07-23, overnight hardening)

Data source: the P5 deep stability harness (`ARENA_STABILITY_DEEP=1`,
362 AI-vs-AI matches: 25 matchups × 3 tiers × 3 seeds + squads +
timeout paths; fully deterministic, so numbers are reproducible).

Baseline win rates: Mass 57% · Shredder 53% · Cardio 53% · Titan 50% ·
**Aesthetics 39%** — an 18-point spread with one clear laggard.

Changes (content-only; BALANCE_VERSION stays 0.6.0 — unreleased):
- **Aesthetics**: maxHealth 1050 → 1150, attackDamage 60 → 66, Stance
  Shift cooldown 12s → 10s, Forge Rally heal 120 → 150. Rationale: its
  team-support auras underperform in champion-centric matches, so the
  base line needed real teeth; the stance loop is its identity, so it
  cycles faster.
- **Mass Monster**: maxHealth 1900 → 1820 (baked ×1.1 → 2002) and
  `ultimateChargePerDamageTaken` 0.06 → 0.045. Rationale: the huge HP
  pool made Mass charge Mass Uprising almost passively; slowing
  taken-damage charge trims summon tempo without touching the kit.
- A pure stat nudge alone (round 1: ±80–100 HP) moved win rates by <2
  points — the charge-rate and DPS levers carried the change.

Result: **Shredder 53% · Mass 53% · Aesthetics 50% · Cardio 49% ·
Titan 46%** — 7-point spread, all five inside [46, 53]. Titan's 46% is
within one-seed noise for n≈130 fielded slots; deliberately NOT tuned
further to avoid overfitting the fixed seed set.

## P9 — cards & synergies (2026-07-23, overnight hardening)

Card-catalog-only pass (see PROGRESS.md P9 for the full audit): renamed
six cyberpunk/generic-fantasy card names to fitness-forge terminology
(ids unchanged), added `'aesthetic'` to `cyber-medic`/Recovery Coach and
`'mass'` to `power-belt` so all five paths have fighter-card presence,
and shipped two new path synergies — `aesthetic-poise` (2 Aesthetic
combatants, +10% move speed) and `shredder-cut-deep` (3 Shredder
combatants, +12% damage) — closing the gap left by P2/P3 shipping only
`titan-bulwark`/`mass-presence`/`cardio-momentum`. No card was added,
removed, or had its stats/energy cost changed; `BALANCE_VERSION` stays
0.6.0.

Re-ran the P8 deep stability harness after the change (362 matches):
**Aesthetics 50% · Titan 46% · Mass 53% · Shredder 53% · Cardio 49%** —
identical to the P8 result. No champion re-tuning triggered or needed;
card retags/new synergies alone did not move win rates outside
[46%, 53%].

## P10 addendum — re-tune under the tendency-aware AI (2026-07-23)

The P10 AI tendencies legitimately shifted the meta (smarter Final Cut
holding made The Shredder 58%, and a more-executable Titan fell to 43%).
Tendency-knob tuning was measured and did NOT close the gap
(stompMinTargets 2→1: Titan 40; combo charge 0.8→0.55: Titan 41 — both
reverted). Stat levers did: **Titan maxHealth 1400 → 1470**, **Shredder
ultimateChargePerDamageDealt 0.07 → 0.06**. Deep-harness result:
Shredder 54 · Mass 54 · Titan 50 · Cardio 47 · Aesthetics 45 — 9-point
spread, all inside [45, 54], zero stalls, 30/30 digest-identical ghosts.
