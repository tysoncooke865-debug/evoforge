# Live Workout Call Outs

> Status 2026-08-08: **SHIPPED.** Migrations 150–153 applied to production and
> falsified (137 SQL assertions). Browser tour green (57 assertions, two phones).

"50 says you can't hit this." / "You're on."

A lightweight competitive layer over **one upcoming working set**. Not a mode,
not a page, not a creator. The workout already defines the bet, so the athlete
types nothing: the logger knows the exercise, the load and the reps.

---

## 1. The rule everything else serves

**A logger who never touches this must reach the end of their workout with
exactly the same taps.** That is an acceptance test, not an aspiration — TEST A
in `tools/tour-workout-callouts.mjs` asserts, mechanically:

- no call out card, tray or badge is in the DOM;
- nothing overlaps the LOG button (`elementFromPoint` on its own centre);
- logging a set fires **zero** `/rpc/callout_*` requests;
- the set lands and the rest timer starts, as always.

Every callout prop on `ExerciseCard` is optional and absent by default, which is
also why the Arena's Volume Duel — the card's other consumer — is untouched.

## 2. The structural idea: the trigger resolves the set

`workout_log` is already the source of truth for a performed set, so logging a
called set is the **same tap** as logging any other. Migration 153 hangs an
`AFTER INSERT OR UPDATE` trigger on `workout_log` that finds the matching call
and fills in the result from the row itself.

That buys four things at once:

1. it works through the **durable offline queue** (the row lands later; the
   trigger fires then);
2. it works for AI-transcribed workouts, because it sits **under** every write
   path rather than beside one;
3. the athlete cannot type their own wager result — there is nothing to type;
4. "no SUBMIT WAGER RESULT button" is structural, not a UI promise.

**The whole trigger body is wrapped in `exception when others then null`.** A
failure inside an AFTER trigger rolls back the parent row: a bug here would not
break a call out, it would eat the athlete's set. *The call out is allowed to be
stale. The training is not allowed to be lost.*

Match key is the composite `workout_log` already uses —
`(user, date, workout, exercise, set)`. An upcoming set has no id, on either
side of the wire.

## 3. Lifecycle

```
offered ──accept──► accepted ──set logged──► awaiting_verification ──verify──► settled
   │                   │                              │
   │ decline           │ both call off                │ dispute
   ▼                   ▼                              ▼
declined           cancelled                      disputed ──timeout──► expired
   │                                                                      ▲
   └── offer timeout ─────────────────────────────────────────────────────┘
```

`expires_at` is **the deadline for the current state**, re-armed on every
transition (offer 30m → attempt 6h → verify 48h → dispute 72h). The sweep needs
one column and one comparison instead of four.

**No timeout ever pays anybody.** Silence from the opponent must not hand the
athlete a pot (trivially farmable); silence from the athlete must not hand the
opponent one either (a gym closes, a back tweaks, a phone dies). Every timeout
refunds both and the card says NOT ATTEMPTED. Among friends playing for
fictional coins, the social cost is the right deterrent — Tyson's call.

## 4. The economy

Escrow rides `coin_events`, exactly like the duel: `coin_total()` is
`sum(amount)`, so a negative row genuinely removes the coins.

- `callout_stake` — NEGATIVE, both athletes, at **acceptance**. Nothing moves on
  an offer.
- `callout_payout` — POSITIVE. The winner takes the whole escrow, or both sides
  are refunded on a timeout, a mutual call-off or an orphan repair.

Both are server-only, admitted by `coin_events_guard()` **only** when the
transaction carries `evoforge.callout_authorized`. That is a **separate GUC**
from the duel's `evoforge.challenge_authorized` on purpose: learning one must
not unlock the other.

`-s -s +2s = 0` on every path, asserted per call out and in aggregate.

## 5. Odds

`client/src/domain/callout-odds.ts`, pure and vitest-pinned. Computed on the
**athlete's** device from rows already in the cache (the opponent cannot read the
athlete's log — RLS), then snapshotted onto the row with the handful of numbers
"WHY THESE ODDS?" prints.

```
capacity / demand → logistic → shrink toward 50% by evidence → clamp [10%, 90%]
```

- **Bodyweight work compares reps to reps.** There is no honest e1RM when the
  legacy weight is 0 by design, and inventing a bodyweight would be worse.
- **A set already meeting the call TODAY floors the estimate at 72% — after the
  shrink, not before.** The shrink exists because inferring from other loads and
  other days is uncertain; having done the exact thing an hour ago is not an
  inference.
- Sparse or stale history says **EARLY ESTIMATE** and means it.
- Display only in V1: stakes are equal and matched, so a tampered client can
  distort hype and nothing else. Clamped server-side regardless, and versioned.

## 6. Physics

Nothing is duplicated. `useChipTable` + `ChipSurface` + `chip-audio` +
`chip-haptics` + `ForgeChip` are the duel's, at three scales:

| Where | Height | Bodies | Interactive |
|---|---|---|---|
| Tray (creating) | 104pt | ≤34 | yes — tap, flick, drag out |
| Micro pot (incoming / verify card) | 96pt | ≤12 | no (`locked`) |
| Payout overlay | 74pt | ≤10 | no, and `pointerEvents="none"` |

`ChipWagerTable` gained `tableHeight` / `chipSize` / `denominations` / `compact`
— sizes, not a second component. A parallel "small chip table" would be a second
physics identity to keep in sync, and the first bug would be the two disagreeing.

**`potChips()`, not `decompose()`, at micro scale.** `decompose` deliberately
picks the smallest denomination that still FILLS a table, so it drew a 50-coin
pot as ten grey 5s — illegible at 96pt and the wrong colour band entirely. The
minimal breakdown is the right picture when the number is beside it.

## 7. What is NOT built (V1 scope)

Variable payouts · spectator betting on a set · public markets · parlays ·
raises · video or AI refereeing · real money · more than one live call per
athlete · Forge Drop.

**Direction B** ("50 says Tyson MISSES 5", opened by the friend) is modelled —
`initiated_by` is on the row — and not built. It needs an athlete's upcoming set
published to friends, which is a new privacy surface; V1 never publishes one.

**Web push** is deferred: `send-push` derives its recipient from
`forge_challenges`, so extending it means an edge-function deploy for a feature
whose premise is that both people are in the gym with the app open.

## 8. Verifying it

```bash
node tools/falsify-workout-callouts.mjs   # 137 SQL assertions against production
node tools/tour-workout-callouts.mjs      # 57 browser assertions, two athletes
```

Run **both**. The first proves the server is right; the second proves an athlete
can reach it, and it is the one that found the empty micro pot, the see-through
card and the SEND button below the fold — all of which passed every structural
test that existed at the time.

Section 16 of the SQL harness **removes each guard, shows the test go red, and
rolls it back**: the one-live index, the judge, and the coin guard. A guard that
cannot fail is not a guard.

## 9. Things worth not relearning

- **Migration 133 is NOT applied in production.** `workout_log` is still the
  legacy 13 columns. The trigger reads load fields through `to_jsonb(new)` so a
  missing column is NULL instead of a runtime error the exception block would
  swallow — which would have made the feature silently never resolve. The judge
  has a legacy `(weight, reps)` path, and both paths are asserted.
- **The reveal gates CREATING, never ANSWERING.** Hiding an offer a friend has
  already staked coins on would leave those coins in an invite nobody can see.
  The setting gates both, and the server checks the setting, not the reveal.
- **`both` is a reserved word in plpgsql** (`trim(both …)`) and fails as a
  variable name with a bare syntax error on the assignment line.
- **A `not exists` in HAVING that mentions the raw column is an ungrouped-column
  error.** Close the aggregate in a subquery first.
- **RLS with no UPDATE/DELETE policy does not raise — it matches nothing.** A
  test that asks "did it throw?" passes on a wide-open table. Ask what changed.
- **`set_config('request.jwt.claims', …)` alone does not enforce RLS** through
  the management API: it still runs as the table owner. `set local role
  authenticated` is what drops the exemption.
- The tour runs **phone-sized but not `hasTouch`**, because `pad-env.ts`
  switches every number field to the in-app keypad on a coarse pointer and
  deliberately keeps desktop web typeable for exactly this.
