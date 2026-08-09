# V5.1 MIGRATION — AUDIT AND ARCHITECTURE MAP

Phase 1 of the migration in `docs/ENGAGEMENT_V5.md`. Every path in the live system
where **RNG**, **coin deduction**, **a pledge**, or **settlement** exists, and what
happens to it.

Read the disposition column as a commitment, not a suggestion: anything marked DELETE
must be gone before Phase 8 signs off, and anything marked KEEP must still be working.

---

## 1. Every RNG call in the schema

`gen_random_uuid()` is excluded throughout — an identifier is not an outcome.

| Migration | Call | What it decides | Disposition |
|---|---|---|---|
| `155/156/157_forge_drop_play` | `random() < 0.5` | each peg deflection of the puck walk | **CONVERT** → the reveal's outcome engine. The RNG service, its audit trail and its reproducibility survive; the *frame* dies. |
| `155/156/157_forge_drop_play` | `random() < frac` | probabilistic rounding of a fractional payout | **DELETE** — already obsolete. 158 replaced it with `round(stake*m, 2)`; only the harness still modelled it (fixed this session). No home in a flat additive table. |
| `034_rpg_challenges` | `random()::text` | 6-char join code | **KEEP** — identifier generation, not an outcome. |
| `036_friends_rivalry` | `random()::text` | 6-char rivalry code | **KEEP** — same. |
| `074_live_matchmaking` | `random()::text` | match code | **KEEP** — same. |
| `070_gym_battle_engine` | `floor(random() * 2e9)` | **seed for the client battle sim** | **KEEP, but see §5** — outcome-bearing and coin-bearing. Passes both governing invariants; changes the economy maths. |
| `076_gym_discovery` | `floor(random() * 2e9)` | discovery ordering seed | **KEEP** — presentation ordering, no coin consequence. |
| `104_command_flags` | (comment only) | — | **KEEP** — internal Command studio, outside the player economy. |

**There is no RNG in any pledge path.** `migrations/144`–`148` (Duel), `150`–`153`
(Call Outs) and the unapplied hitdoubt-pot files contain no `random()` at all. Invariant 2's
SQL side is already clean; Phase 2's static test exists to keep it that way.

---

## 2. Every coin-deduction path

Deduction = a `coin_events` row with a negative amount. The kinds that can write one:

| Kind | Written by | Deducts for | Disposition |
|---|---|---|---|
| `spend` | `purchase_character`, cosmetics | a sink (cosmetics, boards) | **KEEP** — a shop, not a pledge. |
| `forge_drop_stake` | `forge_drop_play` | **staking on chance** | **DELETE** — this is the rejected mechanic. |
| `forge_drop_unlock` | `forge_drop_unlock` | buying a board early | **DELETE** — the boards go with the mechanic. |
| `challenge_stake` | Forge Challenge escrow | a challenge stake | **CONVERT** — §4. |
| `duel_support_stake` | Duel supporter escrow | **staking on a third party** | **DELETE** — §4. |
| `callout_stake` | `callout_create` | a 1v1 call out | **CONVERT** → `trial_pledge`, §5 of the plan. |

`forge_drop_stake` and `forge_drop_unlock` are the only two deductions that follow an RNG
event, and both die in Phase 4. After that, **no deduction anywhere is downstream of
randomness** — which is invariant 1 discharged structurally rather than by assertion.

---

## 3. Pledge and settlement paths

| System | Migrations | Resolution | Disposition |
|---|---|---|---|
| Workout Call Outs | `150`–`153` | logged set vs stated target, via a `workout_log` trigger | **CONVERT** → Forge Trial. Mechanic survives; vocabulary, eligibility and chase prevention change. |
| hitdoubt-pot | 5 files, **unapplied, uncommitted** | multi-participant pot | **REWORK** → Golden Dot pools. Never shipped, so this is a rewrite on paper, not a migration of live data. |
| Forge Duel | `144`–`148` | duel result | **CONVERT** — §4 below. |
| Forge Challenges | escrow + Damage Assessment | challenge result | **CONVERT** — vocabulary and margin only. |

All four are 100% performance-resolved with zero RNG. The R18+ wall on the skill side is
already standing; what is missing is eligibility, chase prevention and vocabulary.

---

## 4. Forge Duel supporters — the decision, and why

`144_forge_duel_economy.sql` implements a **pari-mutuel book**:

- supporters escrow coins on **someone else's** duel outcome,
- `support_close_pct` closes the market partway through the window,
- and the config carries *"the platform's cut of the **LOSING** supporter pool, in basis
  points"* — **a house margin**.

It is skill-resolved, so it clears invariant 2's chance/stake wall. It fails elsewhere:

- v5 §4–5 sanction a pledge on **the athlete's own planned performance**. Backing a third
  party is neither a Forge Trial nor a Golden Dot.
- The migration briefing is explicit: *"If any odds computation, dynamic multipliers, or
  house-margin logic exists: delete it."* A rake on the losing side is the clearest form of
  the thing being banned.
- "house" is itself on the §10 vocabulary list.

**Decision: retire third-party staking; keep spectating.**

1. **Delete the margin first**, as an isolated change — it is the sharpest edge and needs no
   redesign to remove.
2. **Retire the supporter position.** Do not fold it into Golden Dot: BACK/PUSH is a response
   to *the athlete's own* pledge on *their own* planned set, and re-pointing it at a third
   party's duel would smuggle the same mechanic back under a sanctioned name. That is exactly
   the "do not reintroduce under a renaming" clause.
3. **Refund all open supporter escrow** at migration time — coins return to the supporter,
   full stop. No forfeiture; nobody loses a balance to a rule change they did not make.
4. **Spectating survives** with no coins attached. Watching a friend's duel is not the
   mechanic that was rejected.

Recorded here because the briefing never named this feature, and a future reader will
otherwise find a deleted table with no explanation.

---

## 5. The finding that changes Phase 3

**Battle rewards are a chance-influenced coin source, and they are large.**

`070_gym_battle_engine` mints a server random seed; the client runs a deterministic sim from
it; `grant_battle_reward` (033) then mints coins. Entry is **free** and the grant is
**additive only**, capped at **120 coins/day** (`v_coins_cap := 120`) alongside 200 XP.

- Invariant 1 — **passes**. No deduction, so no balance can fall after the RNG.
- Invariant 2 — **passes**. No stake exists to combine with the chance.
- Invariant 4 — **at risk**. v5 targets ~200 coins/day with deterministic sources at
  70–80%. A variable source permitted to contribute 120/day is up to 60% of the target on
  its own. Add the reveal (~36 average, up to 2/day) and the variable share can exceed the
  deterministic one outright.

**Consequence:** `tools/simulate-economy.mjs` must count battle rewards as *variable*
income, not ignore them because they predate this work. If the deterministic share fails,
the brief's rule is to compress the variable side — so the lever is the **battle daily cap**,
then the drop table, and never the base set reward.

This is flagged rather than actioned: changing the battle cap is a product decision, and it
belongs to Phase 3 with the simulation numbers in hand rather than to an audit.

---

## 6. What must be preserved

| Asset | Where | Why |
|---|---|---|
| Rigid-body physics (gravity/tilt/stack/drag) | `client/src/ui/duel/physics/` — 2,719 lines | Required wholesale by the brief. Identity changes; engine does not. |
| Idempotent settlement | advisory lock + idempotency key + txn-local GUC (`152`, `155`, `156`) | v5 §9 verbatim. Already proven against production. |
| Server RNG + audit trail | `forge_drop_walk`, drop-row logging | Becomes the reveal's outcome engine unchanged. |
| Exact ledger | `coin_events`, `coin_events_guard`, `coin_total_exact()` | One currency, server-authoritative. |
| Plan model | `buildEffectivePlan`, `DayOverrides.added` (`domain/session-plan.ts`) | The only honest answer to "is this exercise in today's plan?", which is what gates pledge eligibility. |
| Golden Dot slot | `◉` beside `⇄`/`✕`, `ui/train/exercise-logger.tsx:265-300` | The placement the brief asks for already exists. |

---

## 7. Numbering

`git ls-tree origin/expo-rewrite migrations/` stops at **158**, but **159 is applied in
production** (uncommitted — see the memory note on the repo/DB divergence). The repo's own
"take the next number from origin" rule therefore yields a number that is already taken.

**New migrations start at 160.**

---

## 8. Open items for external counsel

Carried forward to the final deliverables; none are resolved by this audit.

1. Whether retiring third-party supporter staking is sufficient, or whether historical
   supporter settlements need any further treatment.
2. Whether a free-entry, additive-only, RNG-seeded battle reward is inside or outside the
   "no simulated gambling" IARC answer. It takes no consideration and cannot reduce a
   balance, so the analysis should be clean — but it is chance affecting coin income and is
   worth naming explicitly rather than discovering at submission.
3. The one-off sanity check the brief requires before first submission with Trials live.

**No part of this document asserts the app is legally cleared.**
