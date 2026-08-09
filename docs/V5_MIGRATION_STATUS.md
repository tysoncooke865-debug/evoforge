# V5.1 MIGRATION — STATUS AND HANDOFF

Updated 2026-08-09. Plan: `~/.claude/plans/you-are-implementing-the-quizzical-stardust.md`.
Spec of record: `docs/ENGAGEMENT_V5.md`. Audit: `docs/V5_MIGRATION_AUDIT.md`.

All on `expo-rewrite` (auto-deploys). **Migrations 159–166 applied to production.
Next free number is 167.**

---

## Where it stands

| Phase | State |
|---|---|
| 1 Audit | ✅ |
| 2 Module boundaries (enforced by test) | ✅ |
| 3 Economy + ledger — 160 | ✅ |
| 4 Forge Reveal + board retirement — 161, 162 | ✅ |
| 5 Forge Trial — server 163 ✅, Golden Dot gating ✅, **pools ❌** | ⚠️ |
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

Also: the tray should call `forge_trial_allowance(exercise, date)` and render its
`max_stake` and `message` inline — §4 wants the cap shown *before* commitment. The
server returns prose for exactly this.

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

---

## Verification loop

```bash
cd client && npx tsc --noEmit && npx expo lint && npx vitest run   # 2318 passing
node tools/sweep-vocabulary.mjs --strict     # 0 hits; also a CI step
node tools/simulate-economy.mjs              # PASS, worst cohort 73.7%
node tools/falsify-coin-labels.mjs           # 7/7; also a CI step
node tools/verify-rls.mjs                    # manifest + anonymous reads
# falsify-forge-reveal.sql, falsify-forge-trial.sql, falsify-cache-recovery.sql
# run via the management API, each inside begin…rollback
```

**Nothing here asserts the app is legally cleared.** The one-off external check
before first submission with Trials live remains open, along with the two questions
in `V5_MIGRATION_AUDIT.md` §8 — including whether a free-entry, additive,
RNG-seeded battle reward sits inside the "no simulated gambling" IARC answer.
