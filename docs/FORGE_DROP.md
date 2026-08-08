# FORGE DROP

A single-player Plinko board played with Forge Coins. Pick a chip off the rack,
flick it at the board, and while it is still falling pick up another. It is the
only place in EvoForge where coins are wagered against the house rather than
against another athlete.

Shipped 2026-08-08. Migrations **154** (board + ledger), **155** (play) and
**156** (concurrency + batch recovery). Reachable from the Vault, from More,
from Customise when short of coins, and from the rest timer between sets.

---

## 1. What it is, and what it is deliberately not

A drop is: choose a lane, choose a stake, watch a puck fall through twelve rows
of pegs, get paid what the slot it lands in says. The board the athlete plays is
decided by their **Evo Rating**, which is the only link between the two systems
and it runs one way only:

> **Forge Drop reads Evo Rating. It never writes it.**
> No drop, no streak of drops, no jackpot and no wipeout moves a rating by a
> point. Rating is earned by training and by nothing else. A game that could
> move it would make it a currency, and the whole progression system is built on
> it not being one.

It is not a slot machine dressed as progression, and the things that make one
are all absent on purpose:

- No near-miss animation. The puck lands where it lands; nothing is staged to
  look like an almost-win.
- No loss-chasing copy. A loss says what happened and stops.
- No streaks, no daily bonus, no "one more and your luck turns".
- No purchasing. Forge Coins are earned by training, cannot be bought, cannot be
  sold, and cannot be cashed out — stated on the screen itself, every time.
- No entry point inside the workout logger. The set-logging controls carry no
  wager affordance of any kind; you reach Forge Drop from the Vault, from More,
  or from Customise when you are short of coins for a cosmetic.

---

## 2. The five boards

Centralised in the `forge_drop_tiers` table (migration 154), not in code. A
rebalance is an `insert … on conflict do update` that bumps `config_version`;
nothing is redeployed and the client redraws from the new row.

| Tier | Evo | Board | Max stake | Target RTP | Max payout |
|---|---|---|---|---|---|
| 1 | 1–20 | SCRAP RIG | 5 | 80% | 15 |
| 2 | 21–40 | FORGE LINE | 10 | 83% | 35 |
| 3 | 41–60 | CYBER FOUNDRY | 15 | 86% | 60 |
| 4 | 61–80 | REACTOR CORE | 20 | 89% | 100 |
| 5 | 81–100 | CELESTIAL FORGE | 25 | 92% | 150 |

Twelve peg rows, thirteen slots, three lanes (5, 6, 7). Higher tiers are
**gentler, not richer in expectation**: the RTP climbs toward 100% but never
reaches it, so a stronger athlete keeps more of what they stake without the game
ever becoming a source of coins.

`target_rtp` is a **ceiling**, not a promise of the average. Each of the three
lanes has its own true return and all three sit at or below it — the centre lane
is the safest and returns least. `validateTier()` in `domain/forge-drop.ts`
refuses any board where a lane's return exceeds the tier's ceiling or reaches
100%, and it runs both in the test suite (over the shipped defaults) and in
`tools/falsify-forge-drop.mjs` (over the **live rows**), so a rebalance done in
SQL is checked by the same rules as one done in code.

**The tier is snapshotted at drop start.** `forge_drops` stores `evo_rating`,
`tier`, `config_version`, `multipliers` and `rows` on the row itself. A rating
that changes mid-fall, or a board retuned between the stake and the settle,
cannot alter a drop already in flight.

---

## 3. The maths

### The walk

A peg deflects the puck by **half a column**, not a whole one. This is the
detail the first implementation got wrong, and it is worth stating plainly
because the bug it caused was invisible in the animation and fatal in the
economy: stepping ±1 whole column made half the slots unreachable and pushed a
side lane's return **above 100%**.

So the walk tracks half-columns `h` in `0 … 2*rows`, and the slot is `h/2`:

```sql
h := 2 * p_lane;
for i in 1..p_rows loop
  step := case when random() < 0.5 then -1 else 1 end;
  if h + step < 0 or h + step > 2 * p_rows then step := -step; end if;
  h := h + step;
end loop;
```

Which requires `rows` to be **even** for `h/2` to be a whole slot, and requires a
wall to **reflect** rather than clamp — clamping would pile probability on the
rim slots, which are the biggest multipliers.

`random()` is Postgres's, evaluated on the server. Nothing in the outcome is
derived from anything the client sent, and no part of it is returned before the
stake is spent.

### The rounding — where the published number becomes true

A payout must be whole coins, and `stake × multiplier` rarely is. What happens
to the fraction decides whether the RTP on the screen is real.

**Flooring it is the obvious rule and it is wrong.** It loses up to a coin on
every drop *regardless of stake*, so the smallest stakes lose the most. On
CYBER FOUNDRY, published at 86%:

| Stake | 1 | 2 | 3 | 5 | 10 | 15 |
|---|---|---|---|---|---|---|
| Returned, floored | **15%** | 57% | 72% | 72% | 78% | 78% |

Every slot below ×1 floored to nothing at a 1-coin stake. No stake on any tier
ever reached its published figure. The number on the tin was true of a
continuous game nobody was playing.

So **the fraction is paid as a probability**: 10.5 coins is 10 coins and a
coin-flip for the eleventh.

```sql
pay := floor(p_stake * mult)::int
     + case when random() < (p_stake * mult) - floor(p_stake * mult) then 1 else 0 end;
```

`E[payout] = stake × multiplier` exactly, which makes each tier's target RTP
true at **every** stake rather than only in the limit. It is strictly better for
the athlete than flooring at every stake on every board, and it cannot overpay
the ceiling: every tier's top multiplier times its max stake is already a whole
number (3×5, 3.5×10, 4×15, 5×20, 6×25), so the biggest advertised payout has no
fraction left to round up. That is asserted, not assumed.

The house edge survives untouched — it lives in the multipliers, never in the
rounding.

### What the athlete is shown

`PayoutTable` prints, before anything is committed: every distinct multiplier,
what it pays **at this stake in whole coins**, and the chance of that slot from
**this lane**. Where a payout falls between two coins the row reads `10 or 11`
and says how often the higher one lands — an average is a number nobody can
actually be paid, so it is not presented as the outcome.

---

## 3b. Several chips in the air

The board takes concurrent drops: **three on a phone, five on a desktop**
(`dropCapacity`). Each flick is its own drop with its own idempotency key, its
own server call and its own independent result, and results may land in any
order. The limit is on UNREVEALED drops, so a fast athlete is throttled by what
they can watch rather than by what they can afford — five pucks crossing a 320px
board is a smear, and a five-row rail pushes the rack under the fold.

### The lock that had to exist first

`forge_drop_play` read the balance with `coin_total()` and compared it to the
stake **without a lock**. One drop at a time, that was fine. Concurrency turned
it into a live bug: two transactions read the same balance, both concluded they
could afford it, and both debited.

Measured against production before migration 156: **six concurrent five-coin
drops fired at a ten-coin balance were all six accepted.** Nothing refused.

Migration 156 takes a transaction-scoped advisory lock per user before the
balance is read. It is namespaced `evoforge.coin_spend:<user>` rather than
`forge_drop:<user>` deliberately — the same race exists in principle between any
two coin spenders, so the next one to adopt it is protected against the ones
already here, not only against itself.

Do not assert "the balance went negative" to test this. Payouts land in the same
transaction as their stake, so winnings quietly refinance the overdraft and the
closing balance can look perfectly healthy while six drops were authorised
against funds for two. What is broken is the AUTHORISATION, so that is what the
harness asserts: with one stake affordable, somebody has to be told no.

### What the wallet reads while chips are falling

Four numbers, because one is a lie while anything is in the air:

| | |
|---|---|
| **BALANCE** | spendable now |
| **IN PLAY** | committed to chips that have not landed |
| **WHEN THEY LAND** | what it becomes once everything settles |
| **FALLING** | how many chips are in the air, against the limit |

All of it is derived from the server's own `coin_total()` every render, adjusted
only to **hide what has not been shown**:

- **falling** — the server counted the stake and the payout. Count the stake,
  subtract the payout back out, so the chip reads as a loss until it lands and
  the balance can never announce a result the animation is still delivering.
- **pending** — the cached total predates the request. Subtract the stake, so
  coins committed to a chip already thrown cannot be committed again.
- **revealed** — already in the total and already shown. Nothing to adjust.

The first version anchored to the balance at the moment the board last went
quiet and applied every movement on top. It **double-counted**: once the board
went quiet again the anchor became the post-settlement total, and the revealed
drops were re-applied to it. The browser tour caught it as a one-coin
disagreement between the header and the ledger — small, permanent, and exactly
the kind of drift that makes a wallet untrustworthy. Deriving from the server
every time cannot drift, because there is nothing to keep in step.

### The chips

`DROP_CHIPS` is 1 / 5 / 10 / 15 / 25 / 50 — not the duel's `FORGE_CHIPS`, which
starts at 5 and runs to 500 because a duel is a week-long wager between two
people. A board with a five-coin ceiling needs a 1, and nothing here needs a 500.

Every denomination is always ON the rack. One that cannot be played is disabled
and **says why** — over the board's ceiling, unaffordable, or blocked by the
capacity limit — because a chip that vanishes teaches nothing, and an athlete
who cannot find it does not conclude they are out of coins.

Pick a chip up, drag it, and flick: the horizontal component picks the lane, so
aiming and committing are one motion. A slow drag PREVIEWS the lane and stakes
nothing. `flickLane` returns null for a tap, a nudge, a sideways swipe, a
downward drag or a slow smear — **a wager must never be the default outcome of
touching the screen**. Tapping a chip selects it instead, and the lane buttons
and DROP button do everything the flick does, because a gesture cannot be tabbed
to, described to a screen reader, or performed one-handed on a bus.

---

## 4. Settlement

`forge_drop_play(p_key uuid, p_stake int, p_lane int)` — SECURITY DEFINER, one
transaction, in this order:

1. **Validate** — stake within the tier's range, lane legal, rating present,
   balance sufficient, config version current.
2. **Debit** the stake (`forge_drop_stake`, negative).
3. **Resolve** the walk and the payout.
4. **Credit** the payout (`forge_drop_payout`, positive) when it is above zero.

All four or none. There is no window in which coins have left and no drop row
exists, and no window in which a drop exists unpaid.

**Idempotence** is a unique index on `(user_id, idempotency_key)`, and with
concurrent drops there can be several keys in flight at once — so they are held
on disk as a list and `forge_drop_fetch_many` answers for all of them in one
round trip. On a connection that has already proven unreliable, N round trips to
ask "did any of these land?" is N more chances to be interrupted. The client
mints the key and writes it to disk *before* the request goes out; replaying the
same key returns the original drop with `replayed: true` and **charges nothing**.
A dead tunnel, a closed tab or a sleeping phone therefore leaves something to ask
about — `forge_drop_fetch(p_key)` is the asking, and it is why the recovery path
never re-wagers. `forge_drop_fetch` returning null means the key was never
played, so the coins were never taken and the key can be discarded.

**The balance is never invented on the client.** Every settlement returns the
server's own `coin_total()`, and that is the number the screen shows. Nothing is
applied optimistically. Home, Challenges, Customise, the Vault and Forge Drop all
read the same `['coin_total']` query key, so they reconcile the moment a drop
settles.

**Coin kinds** followed the THREE EDITS rule (the 139/142 lesson): the CHECK
constraint, the `coin_events_guard()` branch, and the client labels. The guard
admits `forge_drop_stake` / `forge_drop_payout` only when the transaction-local
GUC `evoforge.forge_drop_authorized` matches the row's `source_id`. A separate
GUC from the callout and challenge ones on purpose — learning one must not
unlock another.

RLS on `forge_drops` is **SELECT only**. There is no INSERT, UPDATE or DELETE
policy anywhere; every write is a definer function.

---

## 5. The fall is a replay, not a simulation

The server has already decided where the puck landed before any pixel moves.
`buildTrajectory()` derives believable motion **along the route it actually
took**, from the `path` the resolver returned.

A physics engine let loose here would land somewhere else, and nudging one until
it agreed would be a rigged simulation pretending to be an honest one. So the
animation is explicitly a replay of a settled fact, and the result is revealed
only when the puck arrives.

**Reduced motion skips the fall, not the result.** With `useReducedMotion()` or
the app's own perf mode, the puck is placed in its slot at once and the outcome
is announced identically. There is no version of this where somebody waits longer
or learns less because they asked for less movement.

---

## 5b. During a rest, and inside Challenges

**The rest timer** carries an optional DROP button, offered only while a rest is
actually running and never below twenty seconds remaining. The rules are mostly
about what it must not do:

- **It never opens itself.** Nothing opens the panel except that button — not
  finishing a set, not a personal record, not a streak. A gambling surface that
  appeared unbidden after every set would be a slot machine attached to a
  barbell.
- **It never touches the clock.** It reads the rest clock and writes nothing, so
  it cannot pause, extend or reset a rest. It closes itself when rest ends
  rather than waiting to be dismissed — the next set is the point.
- **It never blocks the next set.** `pointerEvents="box-none"` throughout, above
  the tab bar rather than over the logger. The workout's own state is untouched:
  it is a sibling overlay that shares nothing with the logger but the screen.
- **It stops before the rest does.** New drops are refused in the final ten
  seconds. Chips already falling settle in the background and are waiting on the
  Forge Drop screen afterwards — a settled wager is never lost to a closing
  panel.
- Three drops maximum. A rest is not a session.

**Challenges** already run on the same chip system and were not rebuilt for this:
`ChipWagerTable`, `ForgeChip`, `ChipSurface` and `ForgePot` back doubting and
accepting a call-out (`callout-tray`), raising and going all-in (`offer-sheet`),
friends backing a side and participant contributions (`challenges/[id]`),
spectating (`challenges/watch/[id]`) and calling a wager off. Forge Drop's rack
joins that system through `ForgeChip` rather than forking it — the component was
widened to take any whole denomination and a tone token, which is what let the
board rack a 1 and a 15 without a second chip component existing.

Friend verification and server-confirmed evidence are unchanged: no wager
settles without them or an explicit cancellation.

---

## 6. Accessibility

- Every control is a real button with a `Text` label — lane, stake, drop, drop
  again. Nothing is a bare pressable icon.
- The result is announced through a live region, so it does not depend on seeing
  the puck land.
- The landed slot is marked by a **border and a caret**, never by colour alone.
  Wins say "up" in words; the payout table says "even" rather than relying on a
  colour to mean parity.
- The board carries an `accessibilityLabel` describing it; the real odds live in
  the payout table below, which is a list a screen reader can walk.
- Verified at 320, 390, 768 and 1280 px. The board is measured from its own
  layout rather than assuming a size, and slot labels shrink to fit — no
  horizontal overflow at any width.

---

## 7. Error states

| Situation | What happens |
|---|---|
| Not enough coins | The drop button is disabled and says so; the shortfall is named. |
| Stake outside the tier | Clamped client-side, and refused server-side regardless. |
| No Evo Rating yet | The lowest board, labelled as such — not an error, and not implying they were assessed and placed at the bottom. |
| Network dies **before** settlement | Key on disk, no drop row. `forge_drop_fetch` returns null, the key is discarded, nothing was charged. |
| Network dies **after** settlement | Key on disk, drop row exists. Recovery fetches the real result and the ledger is already correct. |
| Duplicate submission | The unique key returns the original result, uncharged. |
| Two tabs at once | Same — proven by two `forge_drop_play` calls with one key in a single round trip. |
| Config changed mid-drop | The drop carries its own `config_version` and `multipliers`; it settles on the board it started on. |

---

## 8. How it is verified

- `client/src/domain/__tests__/forge-drop.test.ts` — 65 tests. Includes a
  100 000-sample seeded statistical test per lane per tier asserting the slot
  distribution to three sigma and the return to the published figure, a
  regression test walking **every legal stake** (not just the maximum — the
  maximum is the one stake where flooring looked nearly acceptable), and a proof
  that no rounding can exceed a tier's advertised ceiling.
- `tools/falsify-forge-drop.mjs` — SQL against production. Ledger conservation on
  every path, atomicity, idempotence, concurrency, RLS, stake ceilings, and
  100 000 samples of the **real resolver** per lane per tier — sampling the
  payout in whole coins at both the minimum and maximum stake, not just the mean
  multiplier. Sampling only the multiplier is how the flooring bug survived this
  harness the first time.
- `tools/tour-forge-drop.mjs` — Playwright, 70 assertions. Drives the real UI at
  three Evo tiers, four viewport widths and with reduced motion, screenshots
  every state, reloads mid-request to exercise recovery, and throws three chips
  of different denominations into different lanes without waiting for any of
  them — asserting that more than one puck is on the board at once, that each
  settles independently, that the ledger moved by the sum of their nets and
  nothing else, and that the phone limit refuses the fourth and says why.

---

## 9. Analytics

`forge_drop_opened`, `forge_drop_staked`, `forge_drop_settled`,
`forge_drop_failed`, `forge_drop_replayed`. Small scalar props (tier, lane,
stake, slot, net). No amounts beyond the stake and net, no session-level
aggregation designed to find heavy players.
