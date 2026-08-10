# V5.1 MIGRATION — STATUS AND HANDOFF

Updated 2026-08-09. Plan: `~/.claude/plans/you-are-implementing-the-quizzical-stardust.md`.
Spec of record: `docs/ENGAGEMENT_V5.md`. Audit: `docs/V5_MIGRATION_AUDIT.md`.

All on `expo-rewrite` (auto-deploys). **Migrations 159–187 applied to production.
Next free number is 188.**

---

## Where it stands

| Phase | State |
|---|---|
| 1 Audit | ✅ |
| 2 Module boundaries (enforced by test) | ✅ |
| 3 Economy + ledger — 160 | ✅ |
| 4 Forge Reveal + board retirement — 161, 162 | ✅ |
| 5 Forge Trial ✅ · pool server 180–183 ✅ · pool client 184–186 ✅ | ✅ |
| 6 Physics pool — two-pan scale, owner tints, crucible, settlement lines 187 | ✅ |
| 7 Margin 164 ✅, Cache + Recovery 166 ✅, supporter UI removed ✅, §6 grace/pause 179 ✅ | ✅ |
| 8 Copy sweep — **78 → 0**, CI-enforced | ✅ |

**Numbering shifted by one from the plan**: 162 became the board retirement, so
Forge Trial is 163, third-party staking 164, vocabulary 165, cache/recovery 166.

### Both governing invariants are now structural

- **Balance-decrease**: no deduction anywhere is downstream of randomness. The board
  is gone; `forge_reveal_claim` takes one uuid and no stake; `reveal_bonus`,
  `forge_cache` and `recovery_cache` are additive by CHECK constraint.
- **Chance–stake separation**: enforced at build time by
  `client/src/domain/__tests__/module-boundaries.test.ts`, falsified five ways.
  Zero RNG in any pledge path, asserted in SQL by 163.

---

## What remains

### 1. Golden Dot pools (Phase 5)
The five unapplied `hitdoubt-pot` migrations in `../hitdoubt-pot/migrations/` are
still HIT/DOUBT-shaped and numbered 159–163. Rework to BACK/PUSH + pool +
settlement, renumber to **167+**. Verifier ≥200 per §5.

~~Also: the tray should call `forge_trial_allowance`~~ — **done** (`26ee0d3`).
`domain/forge-trial.ts::trialCeiling` reconciles wallet against allowance, the rail
narrows to it, and the server's own sentence is captioned inline before commitment.

### 2. ~~Physics pool visuals~~ — **DONE** (Phase 6, `a49f650` + `bc8dd52`)
`chip-world.ts` untouched, as required. Each pan is a REAL world, so the tilt-gravity
ingots survived (Tyson asked for that explicitly).

| piece | where |
|---|---|
| two-pan scale, never merged | `ui/callouts/pool-scale.tsx` |
| owner tint on every ingot | `commit({ownerId})` + `ChipSurface toneFor` + `ownerTone` |
| crucible for your OWN pledge | `ChipWagerTable vessel="crucible"` |
| per-person settlement lines | 187 + `ui/callouts/pool-settlement.tsx` |

**The distinction that makes the pans work:** the WORLD stays unlocked so it keeps
reading the phone; the SURFACE is locked so nobody drags another person's ingot out.
Push the pool around, but you cannot take metal that is not yours.

**A crucible is about whose metal it is**, not who is training — both pledge surfaces
use it. The pans are the shared table.

**Settlement reads `sum(coin_events.amount)`, never `entries.payout`** — only joiners
have an entry row, so the payout column would omit both principals, who are usually
the largest positions. The lines sum to zero and the total is shown so it is
checkable.

### 3. ~~Dead supporter UI~~ — **DONE** (`cfab5f2`)
14 files, `supporter-meter.tsx` deleted, reactions split to `duel-reactions.tsx`,
`describe('supporter maths')` removed. Spectating kept per audit §4. Removing it
exposed four §10 violations the sweep could not see — see Traps.

### 4. ~~§6 streaks~~ — **DONE** (179, `84c621e`)
Grace (2 per rolling 30, on by default) and an unrationed one-tap pause. Both the
SQL and the TS port implement the rule — the number on screen never came from
`scheduled_streak`, so the migration alone would have changed nothing visible.
Neither is purchasable and the harness asserts no pause function reaches
`coin_events`. 11/11 through real JWTs including owner-only.

### 4b. What §6 looked like before (kept for the record)
**Already compliant**: `scheduled_streak` is plan-aware and rest BRIDGES rather
than breaks; best is preserved; the framing is positive throughout
("CONSISTENCY IS THE CHEAT CODE") and there is no "streak about to die" copy
anywhere in the tree. Cache + Recovery Run shipped in 166.

**Missing**, both needing a migration plus UI:
- **grace days / streak protection**, on by default. A missed *planned* day
  currently breaks the run outright.
- **one-tap pause** for injury, illness, travel.

### 5. Golden Dot pools (Phase 5/6) — **DECIDED: BUILD IT** (Tyson, 2026-08-09)

He chose the spec as written: the athlete pledges on their own set and up to seven
others join across two sides, with an independent verifier at ≥200. Recorded as a
product decision — it is skill-resolved with zero RNG and the money walls hold, so
it trips neither governing invariant, but it IS third parties putting coins on
another person's performance and it should be named as such at review.

**THE FIVE `hitdoubt-pot` MIGRATIONS CANNOT BE PORTED BY RENAMING.** 2,803 lines
written against the pre-v5 schema, referencing four things that no longer exist:

| reference | killed by |
|---|---|
| `hit_probability` | 163 (odds columns dropped) |
| `odds` throughout | 163, and §10 bans the concept |
| `workout_callouts_one_live` | 172, replaced by `..._one_live_per_set` |
| `forge_drop_play` | 162/167 (board retired) |

So this is a rewrite against the current schema, not a rename plus a renumber.
**Do not apply them as they stand** — they will fail, and a partly-applied set is
the worst possible state for the callouts table.

**BUILT, 180–183.** The rewrite landed as four migrations; the plan below is kept
because each step's reasoning is still the reasoning.

| # | what | proof |
|---|---|---|
| 180 | `mode`, `workout_callout_entries`, `callout_pool`, no write policies | falsify-callout-pool 10/10 |
| 181 | `callout_pool_open` (invite) + `callout_pool_join` (escrow) | falsify-pool-join 11/11 |
| 182 | refund-by-ledger, independent verifier ≥200, proportional split | falsify-pool-settle 13/13 |
| 183 | the remainder collided with the unique index — most settlements | same harness |

**Decisions taken (Tyson, 2026-08-09):** friends of the ATHLETE only, and
invite-only discovery — there is deliberately no browsable list of open pools, and
182 asserts none exists. A feed of things to put coins on is what a lobby looks
like.

**Three traps this uncovered, all worth keeping:**
- `callout_refund_both` named `athlete_id`/`opponent_id`, so a joiner's escrow was
  stranded on EVERY refund path. Refund what the ledger holds, grouped by holder —
  never name participants.
- `coin_events` is uniquely indexed on (user_id, kind, source_id). One payout row
  per person per call out. Fold rounding in before writing, never after.
- A migration's own `do $$` block asserts the SHAPE of a function. 182's checks all
  passed on code that could not execute. Settlement must be driven with real
  balances.

**Still outstanding:** the client. No athlete can open a pool yet.

THE ORIGINAL PLAN, for reference:

1. **Schema** — `mode` ('duel' default, 'pot'), `workout_callout_entries`
   (athlete side + joiners, BACK/PUSH, unequal stakes), owner-or-participant RLS.
   Must respect `workout_callouts_one_live_per_set` (172) rather than the index
   it replaced.
2. **Join** — `callout_pot_join(callout, side, stake)`. Reuses
   `forge_trial_allowance` for the joiner's own ceiling; the athlete's escalation
   ramp must NOT bound a third party, and a third party's stake must not feed the
   athlete's ramp. Both directions need a test.
3. **Verify** — independent verifier at ≥200 total: not a participant, cannot
   pick a side, chooses COUNTS / DOESN'T COUNT, deterministic and final.
4. **Resolve** — proportional split of the losing side, **no rake of any kind**
   (164 deleted the duel's; do not reintroduce it here under another name), and
   settlement idempotent under the existing advisory-lock + idempotency-key
   pattern.
5. **Client + Phase 6** — two-pan balance scale (BACK one pan, PUSH the other,
   never merged), crucible commit, owner identification on every ingot,
   per-person settlement lines. `client/src/ui/duel/physics/` stays untouched:
   identity only.

Vocabulary: 58 HIT/DOUBT occurrences across the five files, all of which become
BACK/PUSH. The sweep will catch any that survive.

### 5b. The decision that was open (resolved above)
The five `hitdoubt-pot` migrations add a `mode = 'pot'`: the athlete pledges on
their own set and up to seven others join across two sides, with an independent
verifier at ≥200.

**This is in tension with the audit's own §4 decision.** Retiring Forge Duel
supporters was justified as "do not re-point BACK/PUSH at a third party" — and a
pot is third parties putting coins on an athlete's performance. The spec (§4, §5)
plainly describes pools and a non-participant verifier, so the spec and the audit
disagree. It is not a governing-invariant conflict — a pot is skill-resolved with
zero RNG and the money walls hold — so it is a product call, not an escalation.
**Do not build it until that call is made.** Phase 6's two-pan balance scale is
downstream of the same decision.

---

## Product overrides (Tyson, 2026-08-09)

Five deviations from Spec v5/v5.1, each asked for after the rule was explained,
each recorded in its migration header. **None touches classification**: every one
is skill-resolved with zero RNG, and the money walls are untouched, so the IARC
answers are identical before and after.

| # | Spec said | Now | Why it is safe |
|---|---|---|---|
| 170 | daily stake cap ~150 | removed | The cap served neither the chance/skill test nor the money walls. |
| 171 | one trial per exercise per session | unlimited | *A miss ends the day* is the brake that does the real work; extra trials only happen while succeeding. The ramp had to be pinned to previous days in the same migration or it would compound within a session. |
| 172 | — | one live pledge per **set**, not per athlete | The unique index was the real binding constraint; 171 is inert without it. Inseparable pair. |
| 173 | — | a first-time exercise is eligible | An exercise never logged is *new*, not a max attempt. My over-implementation, not the spec. |
| 174–176 | "no coin stake may ever attach to a PR attempt" | **overridden**, by informed consent | See below. |

### The PR-attempt override, stated plainly

I objected first: invariant 5's physiotherapist test is the one eligibility rule
here with a physical-harm rationale rather than a behavioural one, and coins on a
max attempt are a reason to grind out a rep under fatigue. Tyson reaffirmed it.
Implemented as consent rather than deletion, with three narrowing properties:

1. **Per pledge.** `above_program_ack` defaults false, so an untaught client
   behaves exactly as before.
2. **Recorded** on the row, so "who accepted what" is answerable.
3. **Pays nothing extra.** Fixed 2×, so coins are never the *reason*.

**v5.1's other half is NOT overridden and must stay.** It bans two things — a stake
on a PR attempt, and *the app suggesting one*. Only the first was lifted. There is
no badge, hint or "go bigger" affordance anywhere; the confirmation appears only
after the athlete has typed an above-best target themselves and been refused, and
editing the weight or reps retracts it. **Do not add a prompt, mission, progress
indicator or copy that encourages a PR attempt.**

176 puts `hint = 'above_program_ack'` on that one guard branch so the client can
tell a question from a wall; a count assertion keeps it on exactly one branch.

### And one reversal of my own

`trialEligibility` refused athlete-added exercises as "not programmed work"
(`b13bca7`). The server never had that rule — the trigger checks the *workout* is on
the plan and the target is not above the athlete's logged best; `workout_log` stores
a name, not a provenance. Reported from production as a missing Golden Dot. Same
class as 173: a narrowing I invented, enforced nowhere else, hiding a working
feature.

---

## Traps

**The repo disagrees with production, repeatedly.** Six times now: 159
applied-but-uncommitted; `grant_battle_reward`'s parameter *order*;
`odds_model_version`; `hit_probability`; `max_support`; and a `callout_create` that
144/145's files no longer describe. **Enumerate from `information_schema`, never
from a migration file.**

**Never edit an applied migration to fix its wording.** It changes the repo and not
the database. 165 redefines live functions from their own bodies instead;
`tools/sweep-vocabulary.mjs` has a `SUPERSEDED` map naming which migration replaced
each historical file.

**A coin kind needs FOUR edits.** CHECK constraint, guard branch, `COIN_LABELS`, and
the claim toast's `amounts` map. Missed four times. `node tools/falsify-coin-labels.mjs`
checks all four against the live guard body — run it after any coin change.

**Regenerate the RLS manifest in the same commit as a migration that adds a table.**
CI failed for six commits because I did not, and the `client` job being green each
time hid it. `node tools/verify-rls.mjs --write-manifest`.

**Falsify every guard, and assert the control is green first.** One brake was
outright inert (`status = 'lost'`, not an allowed value). A falsification run once
reported five clean catches that were all fake — `--reporter=basic` does not exist
in vitest 4, so every run died at startup and the script read silence as success.

**Generating JS through a shell heredoc mangles backslashes.** `/\r?\n/` arrived as a
literal CR three times. Use `String.fromCharCode(10)`, or write the patch to a file.
Em dashes and other non-ASCII in a heredoc patch string corrupt the same way — an
`assert old in s` catches it, which is why every patch here has one.

**A `do $$` block proving a guard is not proof the client sees it.** 176's own check
read `pg_exception_hint` *inside* Postgres, which says nothing about what
supabase-js receives. `tools/falsify-ack-hint.mjs` signs in as ALPHA and reads the
JSON body from a real `/rest/v1/rpc/` call. Falsified by stripping the hint from the
live guard: red on exactly one check, green on restore.

**A client-side rule with no server counterpart is a liability, not defence-in-depth.**
Three of these shipped (173, the ad-hoc block, the tray's unclamped rail). Each one
either hid a working feature or offered something the server would refuse. If the
server does not enforce it, ask why the client is.

---

## Verification loop

```bash
cd client && npx tsc --noEmit && npx expo lint && npx vitest run   # 2326 passing
node tools/sweep-vocabulary.mjs --strict     # 0 hits; also a CI step
node tools/simulate-economy.mjs              # PASS, worst cohort 73.7%
node tools/falsify-coin-labels.mjs           # 7/7; also a CI step
node tools/verify-rls.mjs                    # manifest + anonymous reads
node tools/falsify-ack-hint.mjs              # 9/9, through real PostgREST; self-cleaning
# falsify-forge-reveal.sql, falsify-forge-trial.sql, falsify-cache-recovery.sql
# run via the management API, each inside begin…rollback
```

**Nothing here asserts the app is legally cleared.** The one-off external check
before first submission with Trials live remains open, along with the two questions
in `V5_MIGRATION_AUDIT.md` §8 — including whether a free-entry, additive,
RNG-seeded battle reward sits inside the "no simulated gambling" IARC answer.
