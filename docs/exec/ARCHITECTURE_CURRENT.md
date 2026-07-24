# EvoForge — current architecture (2026-07-24)

> Root `ARCHITECTURE.md` describes the **retired Streamlit app** (last touched
> 2026-07-10). It is history, not the system. This file is the current one.
> Operational doctrine still lives in `HANDOVER.md`; this is the *shape* of the
> thing, for someone deciding what to build next.

---

## 1. One product, three tiers

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENT — Expo SDK 57 universal app (client/)                │
│  branch expo-rewrite → Cloudflare Pages (PWA today)          │
│  React 19.2.3 · RN 0.86 · expo-router · NativeWind 4 ·       │
│  Reanimated 4 · TanStack Query 5 · Zustand 5 · TS 6          │
└───────────────┬──────────────────────────────────────────────┘
                │ supabase-js (RLS as the user) + rpc()
┌───────────────▼──────────────────────────────────────────────┐
│  DATA — Supabase Postgres, FREE plan                         │
│  ~85 tables · owner-only RLS · 86 migration files (→082)     │
│  cross-user reads ONLY via security-definer RPCs             │
└───────────────┬──────────────────────────────────────────────┘
                │ invoke()
┌───────────────▼──────────────────────────────────────────────┐
│  COMPUTE — 19 Deno edge functions (supabase/functions/)      │
│  all AI calls, all privileged battle writes, push, deletion  │
└──────────────────────────────────────────────────────────────┘
```

**Nothing privileged runs on the client.** `EXPO_PUBLIC_*` compiles into the
shipped bundle, so the client holds the publishable key only; every secret-key
operation is an edge function.

---

## 2. The correctness contract (the load-bearing bit)

This is the single most unusual thing about the codebase and the reason its
maths has stayed right through a full platform rewrite:

```
domain/*.py  +  config/constants.py        ← Python, RETIRED APP, STILL THE ARBITER
        │
        │ tools/gen_fixtures.py
        ▼
contracts/fixtures/*.json                  ← 3,323 golden cases
        │
        │ src/domain/__tests__/parity.test.ts (exact equality, floats included)
        ▼
client/src/domain/*.ts                     ← 59 pure modules, the TS port
```

CI runs `gen_fixtures.py --check` next to the Vitest suite, so **drift on either
side fails the build**. To change XP, avatar stats, catalogs or summary shaping
you change the Python first, regenerate, then re-port. A tolerance is banned —
both sides are IEEE-754 doubles and a tolerance would let a wrong formula pass.

Parallel guards, all falsifiable, all in CI:

| Guard | What it pins |
|---|---|
| `verify-tokens.mjs` | `theme/tokens.js` ⟷ `assets/styles.css :root`, both directions |
| `verify-battle-engine.mjs` | the battle engine is byte-pinned |
| `verify-motion.mjs` | reduced-motion is honoured (a real regex, falsified) |
| `verify-arena-purity.mjs` | the arena engine imports nothing from React |
| `verify-arena-anim.mjs` | AutoSprite atlases are well-formed |
| `verify-glicko.mjs` | rating maths |

**Rule of the house: the thinking is pure and tested in `domain/`; screens are
surface.** 105 test files, ~1,634 tests.

---

## 3. Client layout

```
client/src/
  app/(auth)/        sign-in, sign-up, MFA          — signed-in users bounce out
  app/onboarding/    Origin flow; writes profile    — the onboarded flag
  app/(main)/        35 routes, gated on session+profile
  arena-game/        the battle product (see §5) — its own engine, docs, tests
  data/              supabase client, auth-context, ~45 hooks/services,
                     offline queues, analytics emitter
  domain/            59 pure modules — the ported maths + everything else pure
  state/             Zustand stores (session, battle, …) — cleared on sign-out
  theme/             tokens.js = the single copy of every design value
  ui/                17 feature folders (train, arena, home, social, fuel, …)
                     — no barrels, deliberately
```

**Screens (35)** — the surface is far wider than the funnel:
`index` Home · `today` Train hub · `workout` · `progress` · `avatar` Forge ·
`arena` + `forge-arena/*` · `social` · `fuel` · `evo` / `evo-scan` Oracle ·
`gym/*` · `pvp` · `rival` · `rank` · `insights` (admin) · `damage` · `awards` ·
`coins` · `goals` · `streak` · `schedule` · `routine` · `friends` · `profile` …

### The training loop (the part that earns the money)
- `today.tsx` — the hub. Week bars, plan sources (MY PLAN / AI PLAN / BUILT-IN),
  cardio, quick-start. **No logging UI.**
- `workout.tsx` — the workout. Editable only when `date === today` and unfinished.
- `domain/week-status.ts` — status derives WITHOUT a finish marker; locking keys
  ONLY on the marker. (Conflating the two cost a year of history reading as MISSED.)
- `domain/plan-sources.ts::resolveDayIn` — the selected source is asked FIRST.
- `state/session-store.ts` — deviations (skip/remove/±sets/ad-hoc/daySwap),
  persisted, self-expiring at midnight, cleared on sign-out.
- `data/set-queue.ts` + `data/finish-queue.ts` — **offline durability**. Idempotent
  by a server unique index, generation-counted so an in-flight flush cannot
  resurrect a cleared queue.

---

## 4. Data model, in one breath

~85 tables. Every one is owner-only RLS (`user_id = auth.uid()`,
`DEFAULT auth.uid()`). Cross-user reads go through security-definer RPCs — never
client-side filtering, which is not a security measure.

| Cluster | Tables (representative) |
|---|---|
| Training | `workout_log` · `workout_sessions` · `workout_schedule` · `routines` · `user_exercises` · `cardio_log` |
| Progression | `xp_events` (append-only) · `xp_ledger` · `user_progression` · `evo_rating_*` · `avatar_progression` · `achievements` |
| Identity | `profile` · `public_profile` · `paths` · `user_paths` · `evo_assessments` |
| Battle | `battle_matches` · `battle_participants` · `battle_rounds` · `battle_ratings` · `battle_seasons` · `pvp_*` · `competitive_*` · `gym_battles` |
| Social | `social_posts` · `social_comments` · `social_reactions` · `friendships` · `gyms` · `social_notifications` · `blocked_users` · `content_reports` |
| Fuel | `nutrition_log` · `nutrition_targets` · `saved_meals` · `nutrition_prefs` |
| Telemetry | `analytics_events` · `user_activity` · `app_admins` |

Hard rules learned the expensive way:
- **`xp_events` is append-only**; a trigger recomputes amounts server-side. Flat
  10 XP/set, 2 XP/cardio-min, curve `500 + (L-1)*25`.
- **Never gate a SECURITY DEFINER trigger on `current_user`** — use a txn-local
  GUC or `service_role` (the 030/033 lesson).
- **`profile` has always allowed multiple rows per user**; the convention is
  "latest wins". Migration 082 exists because one RPC forgot that and used
  `RETURNING INTO`, which raises P0003 on two rows — see §7.
- Migrations are hand-applied via the management API and falsified against the
  smoke accounts **before** the client commit that depends on them.

---

## 5. The arena, as a subsystem

`client/src/arena-game/` is effectively a second product inside the app: its own
engine, content, screens, 561+ tests and 21 design documents.

```
game-engine/     pure deterministic sim — 20 Hz fixed tick, x∈[0,100] per lane,
                 seeded RNG, command log, replay + digest. Imports no React.
content/         champions, mobs, abilities, anim metadata
features/arena/  the SHIPPED 1.0 portrait vertical-lane renderer
features/arena2/ the IN-PROGRESS landscape side-scroller (P0–P5a, flag-gated)
screens/         arena screens + dev labs (anim lab, battle lab, stress lab)
services/flags/  arena2 flag registry
```

**The determinism doctrine (why 1.0 replays never break):** new arena2 state is
kept *out* of `computeDigest`; only its *effects* are digested. New config is a
flag threaded through `BattleConfig`, off in 1.0. That is what lets an engine
change ship without invalidating a single recorded battle.

Arena 2.0 status: P0 pipeline → P1 landscape renderer → P2 champion controller →
P3 formation sim → P4 battle feel → P5a AutoSprite champions **all shipped
today**, all behind flags. Outstanding: four champions still need AutoSprite art
(a manual step — there is no AutoSprite API in the repo), the five champion kits
need engine ability handlers, then P6 meta/ranked and P7 cutover.

---

## 6. Compute, CI and deploy

**19 edge functions.** AI: `ai-plan`, `ai-plan-scan`, `ai-bodyfat`, `ai-physique`,
`ai-nutrition`, `meal-scan`, `evo-scan`, `damage-assessment`. Battle (privileged
writes): `battle-invite/join/pick/ready/settle/cancel`, `battle-physique`,
`rival-settle`. Ops: `send-push`, `delete-account`.

Cost routing is deliberate: planners run `gpt-5-mini` (reasoning:low,
json_object); the three **judges** stay on `gpt-5.1` on purpose — verdict
consistency and battle fairness are worth the tokens. ~69 lifetime OpenAI calls,
under $1. 10 calls/user/hour cap. Supabase is on the FREE plan.

**CI** (`.github/workflows/client.yml`, 4 jobs) fires on `client/**`,
`supabase/**`, `contracts/**`, `domain/**`, `config/constants.py`,
`assets/styles.css`:

1. **client** — cold lint, tsc, vitest, every verify-* guard, `expo export`
2. **lighthouse** — budgets as *ratchets*: raise when the build clears them, never
   lower one to make a red run green
3. **fixtures** — the Python-side golden check
4. **deploy** — Cloudflare Pages **and every edge function** (added after a
   functions-only push once deployed nothing)

Docs-only commits touch none of those paths and deploy nothing.

---

## 7. Where the architecture is actually weak

Ranked by what it is costing right now, not by tidiness.

1. **There is no production observability.** No Sentry, no PostHog, no alerting.
   `analytics_events` is written but nothing *watches* it. One real athlete hit a
   hard onboarding failure on 2026-07-21 and emitted **20,051 `session_start`
   events and 146 `origin_binding_failed` over 46 hours**; the system did not
   notice, and the fix (migration 082) landed two days later only because a human
   happened to look. See `docs/exec/EXECUTIVE_REPORT_2026-07-24.md`.
2. **`analytics_events` has no write throttle.** One stuck client wrote 20k rows
   unbounded on a FREE-plan database. That is a cost and abuse vector as much as
   a telemetry-quality one.
3. **Duplicate `profile` rows are tolerated but not normalised.** Two users have
   them. Every single-row read must remember to `order by created_at desc limit
   1`; 082 fixed the two RPCs that forgot. The next one that forgets is the same
   outage again.
4. **Web LCP ~6s** — one large JS bundle. Async routes cut the entry 3.5 MB →
   1.1 MB; the remaining fix is native builds, not more web micro-optimisation.
   This is currently the *first thing a new user experiences.*
5. **Surface area vastly exceeds validated demand.** 35 screens; the product's
   entire measured usage outside training is 20 battles, 17 social posts, 5
   friendships, 1 gym, 2 PvP matches, 0 measurements, 0 damage photos.
6. **No native build yet.** Push notifications and Sentry both wait on it, and
   push is the standard retention instrument for a habit app.

---

## 8. Map for a new session

`HANDOVER.md` (state + rules + verify loop) → `client/CLAUDE.md` (stack,
doctrine) → root `CLAUDE.md` (the Python contract) → `docs/exec/` (this file,
the executive report, the roadmap, the dashboard proposal) →
`client/src/arena-game/*.md` for the arena.
