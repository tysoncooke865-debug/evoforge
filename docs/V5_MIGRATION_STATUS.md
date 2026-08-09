# V5.1 MIGRATION — STATUS AND HANDOFF

Updated 2026-08-09. Plan: `~/.claude/plans/you-are-implementing-the-quizzical-stardust.md`.
Spec of record: `docs/ENGAGEMENT_V5.md`. Audit: `docs/V5_MIGRATION_AUDIT.md`.

All on `expo-rewrite` (auto-deploys). **Migrations 159–176 applied to production.
Next free number is 177.**

---

## Where it stands

| Phase | State |
|---|---|
| 1 Audit | ✅ |
| 2 Module boundaries (enforced by test) | ✅ |
| 3 Economy + ledger — 160 | ✅ |
| 4 Forge Reveal + board retirement — 161, 162 | ✅ |
| 5 Forge Trial — server 163 ✅, Golden Dot ✅, allowance in the tray ✅, **pools ❌** | ⚠️ |
| 6 Physics pool — **domain ✅, visuals ❌** | ⚠️ |
| 7 House margin 164 ✅, Cache + Recovery 166 ✅, **dead supporter UI ❌** | ⚠️ |
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

### 2. Physics pool visuals (Phase 6)
Domain is done (metals, radii, densities, audio). The visual half is not:
two-pan balance scale (BACK one pan, PUSH the other, never merged), crucible commit,
owner identification on every pool ingot, per-person settlement lines.
`client/src/ui/duel/physics/` stays untouched — identity only.

### 3. Dead supporter UI (Phase 7)
~10 client files still reference the retired supporter surface (`challenges/`,
`data/forge-duel.ts`, `domain/forge-duel.ts`). They compile and no position can be
taken — 164 dropped the functions — but the surface should come out.

### 4. Not yet reviewed against §6
Streaks exist via `scheduled_streak`, but grace days, streak protection, pause
controls and "plan-adherent" framing have not been checked against the spec.

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
