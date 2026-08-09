# V5.1 MIGRATION — STATUS AND HANDOFF

Written 2026-08-09. Plan: `~/.claude/plans/you-are-implementing-the-quizzical-stardust.md`.
Spec of record: `docs/ENGAGEMENT_V5.md`. Audit: `docs/V5_MIGRATION_AUDIT.md`.

All work is on `expo-rewrite` (auto-deploys). Migrations **159–164 are applied to
production**. Latest commit `6cecc60`.

---

## Done

| Phase | State | Migration |
|---|---|---|
| 1 Audit | ✅ | — |
| 2 Module boundaries | ✅ | — |
| 3 Economy + ledger | ✅ | 160 |
| 4 Forge Reveal (server + client + retirement) | ✅ | 161, 162 |
| 5 Forge Trial — **server only** | ⚠️ partial | 163 |
| 6 Physics pool | ❌ not started | — |
| 7 Duel margin ✅ · streaks/caches ❌ | ⚠️ partial | 164 |
| 8 Copy sweep | ⚠️ partial | — |

**Numbering shifted by one from the plan**: 162 became the board retirement, so
Forge Trial is 163 and third-party staking is 164. **Next free migration is 165.**

---

## What remains, in the order I would do it

### 1. Phase 5 client — Golden Dot (largest remaining compliance item)

The server is done and enforcing. The client has not caught up.

- **`ui/train/exercise-logger.tsx:265-300`** — the `◉` glyph already sits beside
  `⇄`. It needs: gating to planned exercises (`buildEffectivePlan` minus
  `DayOverrides.added`, `domain/session-plan.ts`), hiding on rest days and for
  above-program loads, and a screen-reader label. Today it shows on every exercise
  and the server refuses the pledge afterwards — a screen offering something
  settlement rejects, which is the thing `forge_trial_allowance` exists to prevent.
  **Call `forge_trial_allowance(exercise, date)` and render `max_stake` and
  `message` inline** — §4 requires the cap shown *before* commitment.
- Vocabulary through the tray and cards: `PLEDGE 50 ON THIS SET`, BACK/PUSH,
  pool, settle. `callout-tray.tsx:456` still says `${stake} SAYS I HIT THIS`.
- **Golden Dot pools** — the five unapplied `hitdoubt-pot` migrations in
  `../hitdoubt-pot/migrations/` are still HIT/DOUBT-shaped and numbered 159–163.
  Rework to BACK/PUSH + pool + settlement and renumber to **165+**.

### 2. Phase 8 — vocabulary to zero

`node tools/sweep-vocabulary.mjs` → **51 hits across 19 files** (stake 41,
all-in 13… note those overlap). Biggest clusters:

- `ui/duel/offer-sheet.tsx` (7), `domain/forge-duel.ts` (6),
  `ui/duel/chip-table.tsx` (3), `ui/duel/duel-result.tsx` (3)
- 13 × **all-in** — the duel's ALL IN control

Then wire `--strict` into `.github/workflows/client.yml`, and write
`tools/compliance-gate.mjs` (money walls, zero-RNG static check, IARC answers).

### 3. Phase 7 remainder

- ~10 client files still reference the retired supporter UI (`challenges/`,
  `data/forge-duel.ts`, `domain/forge-duel.ts`). They compile — the RPC call is
  dynamic — and no position can be taken, but the dead surface should come out.
- Streaks as plan-adherent days, grace + protection, pause controls.
- Daily Forge Cache 25/30/40/50/60/75/150 + Weekly.
- Recovery Run: below 5 coins, 3 sets → exactly 50, non-farmable.

### 4. Phase 6 — physics pool

Untouched. `client/src/ui/duel/physics/` (2,719 lines) must be **preserved
wholesale**; only identity changes. `FORGE_CHIPS = [5,10,25,50,100,250,500]`
(`domain/forge-duel.ts:25`) → copper 5 / bronze 10 / iron 15 / steel 25 /
silver 50 / gold 100. Two-pan balance scale, crucible commit, owner-coloured
ingots, per-person settlement lines.

---

## Things that will bite you

**The repo disagrees with production, repeatedly.** Four times this session:
migration 159 applied but uncommitted; `grant_battle_reward`'s parameter *order*;
`odds_model_version` and `hit_probability` existing where 150's CREATE said
otherwise; `max_support` in the duel config. **Enumerate from
`information_schema` rather than from a migration file.**

**A coin kind needs FOUR edits, not three.** CHECK constraint, guard branch,
`COIN_LABELS`, *and* the claim toast's `amounts` map — that last one is a second
copy of the server's numbers. Missed three times.
`node tools/falsify-coin-labels.mjs` checks all four against the live guard body.

**Destructive proofs run in `begin … rollback`.** The management API honours it,
verified repeatedly. Every falsification here seeds production, asserts, and rolls
back; each then re-checks that production is unchanged.

**Falsify every guard.** Three of mine failed for the wrong reason before working
(string-matching a normalised constraint, probing a CHECK that a BEFORE trigger
answered first, comparing `pg_get_function_identity_arguments` to a string that
includes parameter names). One was outright inert: chase prevention filtered on
`status = 'lost'`, which is not an allowed value.

**Generating JS through a shell heredoc mangles backslashes** — `/\r?\n/` arrived
as a literal CR three times. Use `String.fromCharCode(10)` or write the patch
script to a file.

---

## Verification loop

```bash
cd client && npx tsc --noEmit && npx expo lint && npx vitest run
node tools/sweep-vocabulary.mjs        # 51 → must reach 0
node tools/simulate-economy.mjs        # PASS, worst cohort 73.7%
node tools/falsify-coin-labels.mjs     # 7/7
# falsify-forge-reveal.sql and falsify-forge-trial.sql run via the management API
```

**No completion claim while any non-negotiable invariant fails, and nothing here
asserts the app is legally cleared** — the one-off external check before first
submission with Trials live remains open, along with the two questions in
`V5_MIGRATION_AUDIT.md` §8.
