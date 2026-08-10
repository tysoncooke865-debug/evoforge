# EvoForge — evidence pack for external legal review

**Prepared 2026-08-10. Not a legal opinion, and not a claim that the app is cleared.**

This document exists because Spec v5 requires a one-off external legal sanity check
before first submission with Forge Trials live, and because that review is cheaper and
better if it argues about consequences rather than first having to discover what the
app does.

Everything below is **measured**, not asserted. `node tools/compliance-gate.mjs`
reproduces every factual claim against the live database and exits non-zero if any has
stopped being true; it runs on every CI build. It was falsified by creating a table
matching the cash-out pattern and confirming it went red.

**What we are asking for:** a judgement on whether these mechanics support the
intended IARC answers ("no simulated gambling", "no paid chance purchases") and a 16+
rating in Australia, the EU, the UK and North America.

---

## 1. What the app is

A training app. An athlete logs workouts; the app scores progression. **Forge Coins**
are an in-app points currency earned by training.

Three features involve coins and are the subject of this review.

| Feature | Chance? | Stake? | How it resolves |
|---|---|---|---|
| **Forge Trial / Call Out** | none | yes | 100% on the athlete's own logged set |
| **Forge Pool** | none | yes | 100% on the athlete's logged set; friends take a side |
| **Forge Reveal** | yes | **none** | random additive bonus, granted by training |

The design rule the build enforces is that **the two columns never meet**: anything
with a stake has no randomness, and anything with randomness has no stake.

---

## 2. The four factual claims, and how each is verified

### 2.1 No coin deduction is downstream of randomness

This is the claim that matters most. A stake that a random outcome can reduce is the
mechanic that mandates R18+ under the *Guidelines for the Classification of Computer
Games 2023*, and an earned-only currency does **not** exempt it — it is a mechanics
test, not a currency test.

- **Three** server functions in the entire database use `random()`.
- **One** of them can reach the coin ledger: `forge_reveal_claim`.
- That function's signature is `forge_reveal_claim(p_reveal_id uuid)` — **it takes no
  amount**, so a staked reveal is not merely refused, it is unconstructible.
- A `CHECK` constraint on the ledger enforces the direction:
  `CHECK ((kind <> 'reveal_bonus') OR (amount > 0))`.
- **Zero** randomness appears in any call out, duel, trial or settlement function.

Live evidence: 7 reveals granted, 292 coins paid by reveals, **0 negative reveal
rows** across 2,743 ledger rows.

A staked chance mechanic (a plinko-style board where coins entered and an RNG bucket
could return less) **was built and then removed** — migrations 162 and 167 dropped 15
functions. It never shipped to the public.

### 2.2 Chance and pledge cannot combine

Enforced at build time, not by convention:
`client/src/domain/__tests__/module-boundaries.test.ts` fails the build if the chance
modules and the pledge modules import each other. Falsified five ways when written.

### 2.3 The money walls

- Coins **cannot be bought**. There is no purchase, receipt, payment, IAP or product
  table, and **no payment SDK of any kind ships in the client**.
- Coins **cannot be cashed out**. No withdrawal, payout-request or cash-out path
  exists.
- Coins **cannot be gifted or transferred**. The only movement between people is
  settlement of a pledge both sides entered.
- Coins **buy only cosmetics** — `purchase_skin`, `purchase_palette`,
  `purchase_character`. No intermediate currency exists.
- The ledger is **append-only and owner-scoped**: the sole client policies are
  `owner_insert` and `owner_select`. No UPDATE, no DELETE. Every amount is
  overwritten server-side by a guard trigger, so a client cannot choose what it earns.

### 2.4 Vocabulary and presentation

§10 of the spec bans a vocabulary (bet, wager, stake, odds, gamble, jackpot, spin,
roll, casino, house, payout, cash out, double down, all-in, near miss) on every
user-facing surface **including SQL exception text**, which reaches athletes as
toasts. `tools/sweep-vocabulary.mjs --strict` is a CI step and is clean; it went from
78 hits to zero.

The reveal deliberately avoids casino imagery: no reels, wheels, cards, dice, peg
boards or jackpot styling. The animation replays a decided server result, the fall
duration is **fixed regardless of the amount** (no engineered near-miss), and outcomes
that did not land are never rendered. The full outcome table is shown before every
claim.

---

## 3. What we specifically want reviewed

These are the areas we consider least settled. They are listed because we would
rather they were examined than discovered.

### 3.1 Forge Pool — third parties backing an athlete

A friend may put coins on another athlete's upcoming set, choosing BACK or PUSH. The
winning side divides the losing side in proportion to what each put in.

- Zero randomness; it resolves entirely on the athlete's logged performance.
- **No rake.** Nothing is taken by the platform; a predecessor feature that took a
  cut of the losing pool was deleted outright (migration 164). Settlement asserts
  conservation before committing and rolls back if the pool does not balance.
- Invitation-only. **There is no browsable list of open pools** — the absence is
  deliberate and asserted in migration 182 — and only friends of the athlete may be
  invited. Maximum 8 participants.
- Above ~200 coins, verification requires somebody with **no position** in the pool.

**The honest concern:** a joiner cannot influence the outcome. That makes it the
closest mechanic in the product to wagering on a third party's performance, even
though no chance element exists and no money can enter or leave.

### 3.2 Battle rewards — additive but chance-influenced

Battle outcomes are influenced by RNG and pay a coin reward, capped at 25/day. Entry
is free, no stake is placed, and a balance cannot fall. Whether an RNG-seeded reward
sits inside a "no simulated gambling" answer is a question we cannot answer ourselves.

### 3.3 Deliberate deviations from our own spec

Taken by the product owner on 2026-08-09, after each was explained. None alters the
chance/skill test or the money walls, and all are recorded with reasoning in their
migration headers:

| Migration | Change |
|---|---|
| 170 | daily pledge cap (~150) removed |
| 171 / 172 | unlimited trials per exercise; escalation fixed at day start |
| 173 | first-time exercises became eligible |
| 174–176 | pledging above your own logged best, by explicit per-pledge consent |
| 178 | the "a miss ends the day" brake removed |
| 188 | escalation ramp widened from 2x to 5x of the previous week's largest pledge |

**Consumer-protection framing, not classification:** with 170, 171 and 178 all
removed, the remaining bounds on a single session are the escalation ramp (**five
times** the previous week's largest pledge since 188, fixed at the start of the day),
a 500 per-pledge config limit, and the athlete's balance. At 5x the ramp stops binding
once an athlete has pledged 100 in the previous week, because 5 x 100 exceeds the 500
per-pledge limit that then takes over. An athlete with no pledge history has no ramp
to bound them on their first day. Coins cannot be purchased, so the floor is a balance
near zero, and a Recovery Run returns 50 coins for three legitimate sets — nobody can
be locked out. We flag this as a duty-of-care question rather than a rating one.

### 3.4 A physical-safety override worth naming

Migrations 174–176 permit a pledge on a target above anything the athlete has logged.
Implemented as informed consent: acknowledged per pledge, recorded on the row, and
paying **exactly the same** as any other pledge, so coins are never the reason to
attempt it. The app still **never suggests** such an attempt — that half of the rule
was not overridden. We raised the injury objection before implementing and record it
here.

### 3.5 Outside this repo

Store listing metadata and marketing copy are not covered by our vocabulary sweep and
are subject to the same rules.

---

## 4. Reproducing all of it

```bash
node tools/compliance-gate.mjs        # every claim in §2, from the live database
node tools/sweep-vocabulary.mjs --strict
node tools/simulate-economy.mjs       # deterministic share of income by cohort
cd client && npx vitest run           # includes the chance/pledge boundary test
```

Design of record: `docs/ENGAGEMENT_V5.md`. Disposition of every pre-existing
mechanic: `docs/V5_MIGRATION_AUDIT.md`. What shipped, and every deviation:
`docs/V5_MIGRATION_STATUS.md`.

---

## 5. The statement we are *not* making

Nothing here says EvoForge is legally cleared, and no automated check in this repo can
establish that. §2 is a description of mechanics, verified. Whether those mechanics
clear a given jurisdiction is the judgement we are commissioning.
