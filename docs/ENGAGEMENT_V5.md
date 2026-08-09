# EvoForge Handoff Pack — Design of Record

Commit this file (or its three parts) to the repo, e.g. `docs/specs/`, and point the migrating session at it. Reading order:

1. **Migration briefing** — the work order: convert the staked plinko build and the v1-style wager system to the v5 design. Its section references (§3, §4, §5, §9, §11) point into Document 2.
2. **Spec v5 (definitive)** — the complete target design. This is the authority; the briefing implements it.
3. **v5.1 amendment** — adds the PR-triggered reveal as the second (and final) Forge Drop producer.

Superseded documents (v2 base spec, v3 18+ addendum, v4 Forge Trial addendum) are intentionally excluded — v5 absorbed them. Do not source design decisions from repo code: the existing wager and plinko implementations are the *migration input*, not the design.

---

# DOCUMENT 1 of 3

# Briefing: Migrate the Staked Plinko Build to Forge Drop v5.1

**To:** the Claude session (or any agent) currently holding the staked plinko implementation for EvoForge
**From:** design/compliance review
**Status of the staked plinko feature: rejected. Do not continue it in any form.**

## Why this migration exists (read before touching code)

The staked plinko mechanic — player feeds Forge Coins into a peg-board drop, RNG bucket determines a multiplier that can return less than went in — is simulated gambling under the Guidelines for the Classification of Computer Games 2023 (in force since 22 September 2024). It mandates R18+ in Australia and 17+/18+ on Apple, which is incompatible with this product's 16+ single-app requirement. This is a mechanics test, not a money test: earned-only coins and no cash-out do not exempt it. There is no wording, theming, or accounting framing that changes this — "the coins were just earned this session" does not alter the transaction analysis, and sub-1.0× outcomes are losses regardless of narrative.

The design of record is **Spec v5 (definitive) + the v5.1 PR-reveal amendment**. Two governing rules decide everything in this migration:

1. **Balance-decrease test:** the player's coin balance must never be lower after an RNG event than immediately before it. Randomness only adds.
2. **Chance–stake separation:** stakes exist only in skill-resolved mechanics (Forge Trial, Golden Dot pledges — zero RNG in those code paths); chance exists only in no-stake reveals. No mechanic or transaction chain bridges them.

Plus the screenshot test: no surface may be mistakable for a casino product. A peg board with multiplier buckets is a casino product's signature even unstaked.

## Salvage map — most of your work survives

**Keep as-is (est. 60–80% of a typical build):**

* Server RNG service, outcome logging, audit reproducibility → becomes the reveal's outcome engine unchanged.
* Idempotent transaction/settlement layer, offline-reconnect handling, rapid-tap guards → required by v5 §9 verbatim.
* Probability-table config system and any odds-display UI → becomes the published drop table (v5 requires it viewable before every reveal).
* Coin ledger integration, server-authoritative balance sync → unchanged.
* Drop physics/animation engine → **keep the physics, kill the frame.** The tumbling-object animation is fully reusable; re-skin as a molten ingot falling through the forge into a mould.
* Session summary scaffolding → maps to the reveal summary.

**Convert (targeted edits):**

* Outcome table: replace the multiplier ladder (0.2×…10×) with flat additive amounts, floor > 0. Reference table from v5 §3: 20 (45%), 28 (30%), 40 (15%), 60 (8%), 150 (2%). No outcome may reference or scale by any input amount, because there is no input amount.
* Entry flow: delete the stake/bet-slip screen entirely. The reveal is granted by the two producers (workout completion; qualifying PR per v5.1, max one PR reveal per workout) and claimed from the post-workout summary card or the Home banked chip. Nothing is ever inserted, and no coin-deposit ceremony or animation may remain — pantomimed staking fails the screenshot test even with clean mechanics.
* Animation targeting: server decides the outcome first; the physics must land on it. Strip any near-miss choreography (deliberate bounces off the top bucket, slow-rolls past big prizes). Anticipation yes, engineered almost-wins no.
* Visual assets: remove pegs-and-buckets board, multiplier labels, and all casino-adjacent iconography (reels/wheels/cards/dice/coin-spray/jackpot styling). Forge, smelting, tempering metaphors only. Flat aesthetic.
* Vocabulary sweep (code identifiers can stay internal, but no user-facing string, asset, or store copy may contain): bet, wager, stake, odds, gamble, jackpot, spin, roll, casino, house, payout, cash out, double down, all-in, near miss. Use: reveal, drop table, bonus, temper, claim.

**Delete (no home in v5):**

* Stake selection, stake validation, and any loss-side ledger entries for this feature.
* Any sub-1.0× or zero outcomes.
* Any streak-, purchase-, or history-linked odds modulation, if present.
* Any second entry point beyond the two producers (no mid-workout access, no app-open surprise, no other-feature triggers).

**If loss-appetite was the point of the staked design:** that demand routes to the existing skill-side mechanics — Forge Trial (v5 §4) and Golden Dot pledges (§5) already deliver genuine stakes, losses, and 2× returns, resolved by logged performance with zero RNG. Do not rebuild loss into the chance side.

## Wager system migration (Golden Dot / trials)

If the build's pledge system was implemented from the v1 spec ("workout wager", "50 SAYS I HIT THIS", HIT/DOUBT, stake/pot terminology), migrate it to v5 §4–5 as follows. The mechanic survives fully — a pledge on the user's own logged performance is skill, not chance, and is the lawful home for all loss/risk appetite in this product — but its language, eligibility, and guardrails change.

**Vocabulary and flow (rename, don't rebuild):**

* Feature name: "set pledge" / "Forge Trial", never "wager". CTA: "PLEDGE 50 ON THIS SET" replaces "50 SAYS I HIT THIS".
* Friend responses: **BACK** / **PUSH** replace HIT/DOUBT. "Pool" replaces "pot". "Settle/settlement" replaces "payout".
* The user-facing vocabulary ban in this briefing applies here with full force — this is the feature most likely to still contain "stake", "bet", and "odds" strings. Sweep UI copy, notification templates, accessibility labels, analytics event names surfaced to users, and store assets.
* Fixed symmetric settlement only (e.g., 2× return on solo trials; proportional pool split for groups). If any odds computation, dynamic multipliers, or house-margin logic exists: delete it. Never display anything as "odds".
* **Chips do not migrate as chips.** The current implementation (colour-coded circles valued 5/10/15/25/50/100, deducted from the coin balance into the pool) is mechanically correct — single currency, direct deduction, keep that. The presentation changes in exactly two ways: (1) remove denomination colour-coding — value-to-colour on round tokens is the casino chip convention itself; all amounts render in one neutral flat style (pills or circles differing only by printed number). (2) Remove any disc-into-pot physicality — no token objects travelling into or stacking in a pool. The pool displays as a numeric total with participant avatars and a per-person contribution ledger ("Pool: 150 · you, Sarah, Marcus"), which reads as a group challenge rather than an ante. (3) The falling chip/puck asset from the plinko board belongs to the reveal side only, re-skinned as the molten ingot — pledges have no drop ceremony; they resolve when sets are logged. If any intermediate "chips" currency layer exists (coins converted to chips and back), delete it entirely — one currency, one server-authoritative balance.

**Resolution purity (the R18+ wall on this side):**

* Resolution must be 100% determined by the user's validated logged performance against the stated target. Audit every pledge code path — creation, resolution, pool settlement, refunds, expiry, tie-breaks — and remove any RNG call, random tie-break, "bonus round", or chance modifier, however small. Ambiguity resolves in the user's favour by deterministic rule.
* No bridge to Forge Drop in either direction: no reveal granted for pledge wins, no pledge whose outcome or size any RNG influences, no shared transactions between the two features. If the plinko build shared utilities, verify RNG helpers did not leak into pledge modules.

**Eligibility (overtraining wall — likely absent from a v1-based build):**

* Targets selectable only from the day's planned workout, within programmed progression. PR attempts and above-program loads are never pledge-eligible. Enforce by UI (pick-from-plan) and server validation — no free-entry target field.
* No ad-hoc sets added after the pledge sheet opens.

**Chase prevention (likely absent from a v1-based build):**

* One trial per exercise per session; a missed pledge cannot be re-pledged on any target the same day; daily stake cap (~150) disclosed inline; escalation limited to 2× the user's previous pledge per 7 days.
* Miss state is final and kind — no re-entry button, no "try again", XP and streak explicitly unaffected. The absent button is the mechanic; do not add one.

**Social conduct (retain from v1 if present, add if not):**

* Participation optional; no penalties, guilt copy, urgency, or team resets for non-response. Copy: "Join if you want" · "Respond whenever ready" · "No response required".
* Independent verification required for pools ≥200 coins; clear expiry and refund rules; proportional, idempotent settlement; payouts below honest earning rates for equivalent effort.

## Acceptance criteria for the migrated feature

* Balance-decrease test provably passes: no code path exists where the reveal reduces a balance; attempted stake+chance constructions fail in tests.
* Zero RNG imports/calls in trial and pledge modules (unchanged v5 check — verify the plinko work didn't leak RNG utilities into them), and no odds/dynamic-multiplier logic anywhere in pledge settlement.
* Pledge eligibility enforced server-side: PR attempts and above-program loads cannot be targeted; targets come only from the day's plan.
* Chase prevention verified: same-day re-pledge after a miss impossible; per-exercise, daily-cap, and escalation limits enforced server-side; miss screen contains no re-entry action.
* Full-text sweep of pledge-related strings, labels, and assets finds none of the banned vocabulary (this feature is the highest-risk surface for residual "wager"/"stake"/"odds" copy).
* Statistical audit: shipped animation outcomes match the published table; no near-miss choreography in the animation state machine.
* Producers limited to workout completion + qualifying PR (v5.1 caps enforced server-side); claim only from summary card / Home chip; banked reveals never expire and never notify.
* Screenshot review of every screen and store asset: no casino-recognisable frame; vocabulary sweep clean.
* Economy simulation: deterministic sources ≥70% of expected daily income, including the novice high-PR-frequency case.
* IARC posture intact: the honest answers remain "no simulated gambling" and "no paid chance purchases."

## Non-negotiables going forward

Do not reintroduce the rejected mechanic under any renaming, re-theming, "no-loss plinko board", freshly-earned-coins framing, or optional/hidden mode. If a stakeholder instruction conflicts with the two governing rules above, stop and escalate to the product owner with reference to this briefing and Spec v5 — do not implement first and flag later.


---

# DOCUMENT 2 of 3

# EvoForge Engagement System — Definitive Spec (v5)

This supersedes v2, v3, and v4. It is the complete, self-contained version: one app, 16+ or lower in every market, no simulated gambling, maximum earned engagement. Implement directly in the existing codebase. Preserve the fitness-tracker-first principle: ordinary workout logging stays frictionless and fast, always.

## The five invariants

Every future feature, rebalance, and "quick experiment" is tested against these. They are standing rules, not launch-day choices.

1. **The balance-decrease test.** The player's coin balance must never be lower after any RNG event than immediately before it. Randomness may only add. No sub-1.0× outcomes, no staked reveals, no "house money" reasoning about freshly earned coins — the transaction is what's assessed, not the session narrative.
2. **Chance and stake never combine.** Stakes exist (Forge Trial, Golden Dot pledges) but resolve 100% on logged performance — zero RNG in any pledge path, including tie-breaks. Chance exists (Forge Drop) but nothing is ever risked in it. No mechanic, chain of transactions, or future feature may bridge the two.
3. **The screenshot test.** No screen, animation, sound, or store asset may be mistakable for a casino product. No reels, wheels, cards, dice, peg-boards-with-multiplier-buckets, jackpot language, or coin-spray. Forge, smelting, tempering, and crafting metaphors only. Drop-physics animation is permitted when the frame is a forge, not a paytable.
4. **Deterministic majority.** Predictable, effort-linked sources must always constitute the clear majority (~70–80%) of expected daily coin income. The random component is garnish. The economy must feel complete with the forge deleted.
5. **The physiotherapist test.** No mechanic may reward training the user's program doesn't call for. Rest is a mechanic, not an absence. Nothing decays, expires, or punishes recovery, illness, travel, or life.

## 1. Core loop

Open → see what changed → train → log sets → earn coins and XP → temper bonuses in the forge → optionally pledge on yourself or with friends → improve Evo Rating → unlock progression → close with a summary → return when ready.

Every screen offers one clear next action. No screen ever forces the user toward a chance or pledge feature.

## 2. Economy design (deterministic backbone)

Target: ~200 coins for a typical full workout day, split roughly 80/20 deterministic/variable.

| Source | Reward | Notes |
|---|---|---|
| Legitimate logged set | 12 coins + fixed XP | Whole, legible, predictable mid-workout |
| Workout completion | 20 coins | |
| PR | 25 coins | Fixed — never randomized |
| Daily mission | fixed | Training-linked, never login-linked |
| Weekly mission | fixed | |
| Forge Drop reveal | ~36 coins average | See §3 |
| Milestones / Forge Levels / Evo tiers / Arc chapters | fixed unlocks | |

Rules:

* Show every reward before or immediately after its action. Full reward table viewable in-app.
* No rewards for empty, duplicated, edited, or implausible sets. Daily caps prevent farming.
* Rebalance the whole ledger together: set rewards, drop table, pledge stakes (25/50/100), sink prices (boards ~500), and the 50-coin Recovery Cache must stay proportionate. A pledge should feel meaningful, never like half a day's income on one exercise.
* Ceiling discipline: tune EV by compressing the drop table's top end before touching base set rewards. Variance, not average, is where jackpot psychology lives.

## 3. Forge Drop — the reveal (chance, no stake)

One reveal granted per completed qualifying workout. The forge produces a bonus; the player feeds nothing in.

* Strictly additive: floor > 0, no multiplier framing, outcomes are flat amounts or items ("+20 coins", "temper crystal"). Sample table: 20 (45%), 28 (30%), 40 (15%), 60 (8%), 150 (2%) — average ~30, ceiling ≈ one workout's base income, never a fortune.
* Full drop table (outcomes and probabilities) viewable before every reveal.
* Server decides the outcome first; the animation lands where the result says. No engineered near-misses, no choreographed drifts past the top prize, no outcome or odds variation by user history, balance, or churn risk.
* Animation: molten ingot tumbling through the forge into a mould is fine — kinetic anticipation without casino frame. No deposit ceremony, no "insert coins" theatre.
* Cadence is naturally rationed by training frequency: one reveal per workout, never per-set or per-tap randomness. Logging must never acquire a slot cadence.
* Never required for XP, Evo Rating, Arc progression, or any mission. Core progression is 100% deterministic.

## 4. Forge Trial — the stake (skill, no chance)

Optional coin pledge on the user's own planned performance.

Flow: PLEDGE 50 ON THIS TRIAL → target selected from today's planned sets → fixed 2× return on completion, coins burn on a miss → resolution solely by logged performance.

* Eligibility: targets only from the day's planned workout, within programmed progression. PR attempts and above-program loads are never trial-eligible. No ad-hoc stunt sets added after the trial sheet opens — enforced by UI (pick from plan, no free entry).
* Fixed multiplier stated up front. Never expressed as odds; never variable.
* Chase prevention: one trial per exercise per session; a miss cannot be re-pledged on anything that day; daily stake cap (~150) shown inline; stake escalation limited to 2× the previous stake per 7 days.
* Miss screen: clean, final, kind. "The forge takes its due — back tomorrow." Credits the training that happened, confirms XP and streak are untouched, and contains no re-entry button. The absent button is the mechanic.
* Ambiguity resolves in the user's favour by deterministic rule. Zero RNG anywhere in the trial code path — enforced by test and code review.
* Payouts sit below honest earning rates for equivalent effort; trials ≥200 coins route through verification.

## 5. Golden Dot — social pledges

The Golden Dot sits beside the swap-exercise icon on every eligible exercise header (visible, accessible, screen-reader labelled). It opens the social version of the trial:

* Invite friends who respond BACK (believe) or PUSH (challenge); shared pools with proportional settlement; different exercises per participant supported.
* Resolution: performance only. Same zero-RNG wall as trials.
* Verification for pools ≥200 coins (EvoForge verifiers or external links). Clear expiry and refund rules; idempotent settlement.
* Non-coercion: no penalties for not responding, no guilt notifications, no team resets from absence, no urgency. Copy: "Join if you want" · "Respond whenever ready" · "No response required."

## 6. Streaks, rest, and pacing

* Streaks count training days and rest days per the user's plan; grace days and streak protection on by default; best historical streak preserved permanently; presented as achievement ("12 training days"), never threat. No "streak about to die" messaging, ever.
* Rest is generative: planned rest days advance recovery-linked progression (evolution steps land on recovery, matching real physiology). Nothing decays. No stat loss for absence, illness, injury, or travel; one-tap pause for life events.
* Daily Forge Cache: tied to genuine training activity, never app-opening. Escalating 7-day schedule (25/30/40/50/60/75/150 + Weekly Cache); rewards never expire at midnight and can be claimed late.
* Zero-balance recovery: below 5 coins, RECOVERY RUN appears (3 legitimate sets → 50-coin Recovery Cache), free, guaranteed, non-farmable, re-armable after genuine recovery. A player can never be locked out of the economy.

## 7. Progress visibility and stopping points

* Every reward connects to a visible goal: "340/500 toward Industrial Forge" · "2 more sets for today's reward" · "1 more PR until Champion evolution." No hidden progress, no arbitrary waits.
* Natural endings everywhere: workout summary (sets, XP, coins, PRs, mission and social results, next recommended action), reveal summary, weekly summary, Arc chapter-complete, "you're all caught up" in Social, "return when you're ready." Nothing auto-launches another mode. No infinite feeds or autoplay.

## 8. Leaving, scarcity, and notifications

* Frictionless exits: pause Arcs, leave challenges before lock, hide Forge Drop permanently, mute everything, take a break. No sunk-cost copy of any kind.
* Genuine scarcity only — treat fake urgency as a compliance defect (ACL misleading-conduct exposure), not a style choice: no fake or recurring countdowns, no vanishing rewards without disclosed reasons, no pressure to unlock now. User-created challenge deadlines allowed when disclosed, optional, and refundable.
* Notifications: user-selected training days, friend joined, reward earned, milestone, verifier request — nothing else. No midnight urgency, no streak threats, no guilt, no repeats after dismissal. Every category mutable.

## 9. Economy integrity

Server-authoritative balances matching every visible value; idempotent settlement for reveals, trials, and pools; tested against ledger drift, duplicate payouts/XP, rapid-tap and refresh settlement, offline/reconnect. Clean number formatting everywhere (`124.80`, `−0.20`).

## 10. Compliance gate (run before every store submission)

* **Money walls (absolute):** coins never purchasable — directly or via any chain of conversions from anything purchasable; never cashable out; never transferable, giftable, or tradeable; no real-world prize ever. Breaking any wall converts features from rated game mechanics into gambling exposure.
* **Classification:** IARC answers are honestly "no simulated gambling" and "no paid chance purchases," and must remain so; any change that would flip an answer is blocked pending legal review and a deliberate rating decision. App rates 16+ or lower in all target markets.
* **ACL:** no false urgency, fabricated scarcity, or misleading reward representations.
* **Platform:** no gambling advertising if ads ever exist; no links to real-money gambling; odds-disclosure obligations should never arise (no purchasable randomized items).
* **Vocabulary ban** (UI, notifications, marketing, store listing): bet, wager, stake, odds, gamble, jackpot, spin, roll, casino, house, payout, cash out, double down, all-in, near miss. Use: pledge, back, push, pool, trial, reveal, drop table, bonus, claim, settle.
* One-off external legal sanity-check before first submission with pledges live (expected clean: no consideration, no prize of value, no chance in staked mechanics — but get it in writing).

## 11. Acceptance criteria

* Logging remains fast; Golden Dot renders beside the swap icon.
* Static check passes: zero RNG imports/calls in trial and pledge modules; automated tests prove stake+chance combinations are unconstructible and all money-wall paths fail.
* Drop table matches server RNG distribution in statistical audit; animations land on pre-decided results.
* Deterministic sources ≥70% of expected daily income in economy simulation; forge-deleted economy still functions end-to-end.
* PR attempts and above-program loads cannot be selected as trial targets; same-day re-pledge after a miss is impossible; caps enforced server-side.
* Rest days advance (never harm) progression; nothing expires from absence; Recovery Run works from a zero balance.
* No near-misses, guilt copy, sunk-cost copy, fake scarcity, casino iconography, or banned vocabulary anywhere, including store assets.
* All summaries and stopping points implemented; nothing auto-launches.
* Economy integrity suite green; IARC answers archived with the build; app rates 16+ or lower everywhere.
* The app is compelling because training has visible, meaningful, honest consequences — and for no other reason.


---

# DOCUMENT 3 of 3

# EvoForge — Forge Drop v5.1: Add the PR Reveal (Implementation Prompt)

Amend the v5 engagement system. Replace the current single-producer Forge Drop with the two-producer version below. All v5 invariants remain in force; this prompt changes §3 and tightens the anti-drift rule around it.

## What changes

Forge Drop now has exactly **two producers**, both training outcomes, and this set is closed:

1. **Workout completion** (existing, unchanged)
2. **Personal record** (new)

Nothing else may ever grant a reveal. Any future PR adding a third producer must be rejected against this document.

## PR reveal rules

**Granting:**

* A qualifying PR grants one reveal, server-side, silently, at the moment the PR set is logged and validated.
* Qualifying PR = a validated set on a planned exercise that exceeds the user's previous best by at least the meaningful-increment threshold for that lift (configure per exercise class; e.g. ≥2.5 kg or ≥1 rep at equal load for barbell lifts). Plausibility checks apply as for all rewards.
* Cap: maximum **one PR-granted reveal per workout**, regardless of how many PRs occur. Maximum one PR reveal per exercise per rolling 7 days (anti-farming of micro-increments).
* Combined ceiling: a single training day can therefore produce at most two reveals (completion + PR).

**Claiming — unchanged from v5:**

* The PR moment in the logger keeps its existing treatment: fixed +25 coins and the current celebration. No forge imagery, animation, teaser, or mention appears mid-workout — the reveal is granted invisibly.
* The reveal surfaces only on the workout-complete summary, as a second claim card beside the completion reveal (or a single card reading "2 reveals ready"). Claim flow, banking, Home chip, no-expiry, and no-notification rules are identical to v5. Banked completion and PR reveals are interchangeable in the queue.

**Odds and presentation:**

* The PR reveal uses the **identical drop table** as the completion reveal — same outcomes, same probabilities, published in the same place. Never a boosted, special, or seasonal-boosted table for PR reveals.
* Differentiation is cosmetic only: a "masterwork" visual frame on the claim card and reveal screen (distinct forge art, same flat aesthetic, screenshot test still applies).
* Result is a flat amount from the shared table. Nothing multiplies, nothing is staked, floor > 0.

**Solicitation ban (the safety core of this change):**

* The app must never prompt, suggest, or hint at PR attempts to earn reveals. Prohibited everywhere (UI, notifications, missions, copy, marketing): "go for a PR", "you're close to a PR reveal", "one more kilo for the forge", PR-reveal progress indicators, or any mission/challenge whose objective is "set a PR".
* PRs remain trial-ineligible and pledge-ineligible (v5 §4–5 unchanged). No coin stake may ever attach to a PR attempt.
* The weekly summary may celebrate PRs after the fact; it may not forecast or encourage them.

## Amendments to v5 text

* §3, first line becomes: "Reveals are granted by exactly two producers — completed qualifying workouts and qualifying PRs (max one PR reveal per workout) — and by nothing else."
* §3 cadence note becomes: "Cadence is naturally rationed by training: at most two reveals per training day, never per-set or per-tap randomness."
* Invariant 5 gains: "The forge must never be a reason to attempt a PR: no solicitation of PR attempts anywhere in the product, and PR reveals defer to the post-workout summary so no variable reward lands mid-session."
* §11 acceptance criteria gain:
  * PR reveal granted only on validated PRs meeting increment thresholds; micro-increment and duplicate-PR farming fails in tests.
  * Per-workout and per-exercise-per-week PR reveal caps enforced server-side.
  * No forge surface, string, or asset renders mid-workout, including at the PR moment (verified by UI test at the PR celebration).
  * PR and completion reveals draw from one shared table; statistical audit covers both paths together.
  * Full-text search of UI strings, notification templates, and store assets finds no PR-solicitation copy.
  * Economy simulation re-run: with a realistic novice PR frequency (PR most sessions), deterministic sources remain ≥70% of expected daily income. If the simulation fails, compress the drop table, do not raise it.

## What does not change

Everything else in v5: the deterministic economy, Forge Trials, Golden Dot pledges, streak and rest design, stopping points, notifications, economy integrity, the compliance gate, vocabulary bans, and all five invariants as amended above. The money walls and the chance–stake separation are untouched — this feature adds a second chance-side producer and nothing on the stake side.

Implement directly in the existing codebase, test all states and edge cases listed above, and do not add replacement mechanics that recreate solicitation pressure through other surfaces.
