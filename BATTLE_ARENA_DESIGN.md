# BATTLE ARENA — technical design (v1, 2026-07-11)

> Status: **P0 + P1 SHIPPED (2026-07-11).** Migration 009 applied and
> falsified in production; friendly BLITZ battles (Round 1, strength) are
> live end-to-end and were battle-tested with two real accounts against
> production. Next: P2 (rounds 2+3).
> Read with: `client/CLAUDE.md` (invariants), `PARITY.md` (v2 layer rules),
> `migrations/006` (the anti-mint pattern this design extends).

Turns EvoForge from a solo fitness RPG into 1v1 competitive fitness battles:
three rounds (Strength / Cardio / Physique), server-authoritative scoring,
realtime spectating of the opponent's progress, trophies and an XP payout —
every point earned by real training.

---

## 0. Ground truths this design is built on (from the codebase, not assumed)

1. **Two real users.** Matchmaking with a 10% rating band will find nobody.
   → Friendly battles (invite) ship first; Quick/Ranked queue on the same
   architecture; ghost battles (race a recording) make the arena playable
   solo from day one.
2. **A full strength session is 45–60 minutes of real lifting.** The
   Clash-Royale feel comes from two directions (D1): a **BLITZ** format —
   compressed targets, ~20–30 minutes for the whole battle, both players
   online, rounds back-to-back — and a **FULL** format, live-only, one
   shared 90-minute window. Targets scale by format; the engine is the same.
3. **Photos were never persisted** (client CLAUDE.md invariant) — Tyson
   amended this FOR BATTLES ONLY (D2): round-3 photos are stored in a
   private storage bucket so opponents can view them. Solo Oracle scans
   stay judge-and-discard, unchanged. Hashes are still recorded for reuse
   detection; bucket access is participants-of-that-match only.
4. **`xp_events` cannot be minted by a raw POST** — the 006 trigger
   recomputes every amount from a real owned source row. Battle XP follows
   the identical pattern: a new `kind='battle'` recomputed from a settled
   `battle_matches` row, not extended trust.
5. **`workout_log` is user-writable** (root CLAUDE.md, problem #7's known
   gap). Battle volume therefore never trusts a bare number: every battle
   event must reference an owned `workout_log`/`cardio_log` row id, written
   inside the round window, and passes plausibility caps (§10).
6. **Streamlit must not break**: migration 009 is new-tables-only; nothing
   existing changes. The Python side never learns the arena exists.
7. **The design system already is the brief** ("dark, blue neon, glow,
   particles"): tokens.js, GlowCard, NeonButton, HeroStage, ScanFrame,
   ParticleLayer, level-up overlay. The arena reuses them; it invents no
   second visual language.

---

## 1. Product shape

New main-nav tab **Arena** (between Avatar and More) →

| Surface | v1 | Notes |
|---|---|---|
| Quick Match | Phase 3 | queue + matchmaker |
| Ranked | Phase 4 | same queue, rating at stake, seasons |
| Friendly Battle | **Phase 1** | 6-char invite code — testable with 2 users |
| Ghost Battle | Phase 3 | race your/opponent's recorded round (PvE fallback) |
| Battle History | Phase 1 | list over `battle_matches` |
| Leaderboards | Phase 4 | `battle_leaderboard_top()` security-definer fn |
| Seasons | placeholder card | table exists from 009; UI "SEASON 0 — PREVIEW" |

**Battle**: 3 rounds, fixed budget 1200/1050/750 = 3000 pts. Higher total
wins. Trophies = battle rating (Elo, §8). XP payout through the ledger.

**Pacing** (D1, decided): two synchronous formats, both online, chosen at
match creation and carried in `battle_matches.format`:
- **BLITZ** (Quick Match default, friendly option): the mini-game battle.
  Strength 12 min / cardio 10 min / physique capture 5 min, back-to-back;
  targets compressed to blitz tier (e.g. strength ≈ 1,800–3,000 effective
  kg — an intense focused burst, not a full session). Whole battle
  ~25–30 min. This is the matchable format.
- **FULL** (live-only, friendly + ranked later): one shared 90-minute
  window covering rounds 1+2 at full-session targets; round-3 photo
  immediately after, 15-min capture window.
Ghost battles replay a recorded performance against either format, so the
arena is playable solo from day one. The event model is identical in both —
only `spec.targets` and window lengths differ.

---

## 2. Folder structure

```
client/src/app/(main)/arena/
  _layout.tsx          stack within the tab
  index.tsx            hub: mode cards, rating chip, season banner, history strip
  queue.tsx            searching animation, est. wait, cancel
  battle/[id].tsx      the battle screen (all phases: vs → rounds → results)
  history.tsx          past matches
  leaderboard.tsx      arena ladder
client/src/domain/battle/
  types.ts             Match/Round/Event/Score shapes (mirrors DB jsonb specs)
  catalog.ts           objects, cardio challenges, poses (GENERATED, see §7)
  coefficients.ts      exercise + cardio coefficient tables (GENERATED)
  scoring.ts           display-mirror of the server engine (see §7 parity rule)
  power.ts             character power rating + the 15%-cap multiplier
client/src/data/battle/
  hooks.ts             useMatch, useMyRating, useHistory, useQueue (TanStack)
  realtime.ts          useBattleChannel(matchId) — subscribe/reconnect/replay
  mutations.ts         enqueue, invite, accept, ready, submit-photo, forfeit
client/src/state/battle-store.ts   ephemeral channel state (Zustand) —
                                   MUST be added to the sign-out clear list
                                   in auth-context.tsx (cache invariant)
client/src/ui/battle/
  vs-header.tsx        both avatars (HeroStage size=150), names, power, rank
  object-stage.tsx     the object sprite rising as % completes (ParticleLayer)
  dual-progress.tsx    two XpBar-style bars, mine accent / theirs epic
  round-card.tsx       GlowCard variant with round kind + budget + timer
  score-panel.tsx      per-component score breakdown rows (StatMeter reuse)
  results-overlay.tsx  modeled on level-up-overlay: count-up, winner bloom
supabase/functions/
  battle-invite/       create friendly match + code
  battle-join/         accept code / queue position → participants + snapshot
  battle-matchmaker/   service-role pairing (invoked on enqueue; pg_cron later)
  battle-ready/        readiness + round 1 spec roll (server rolls the object)
  battle-settle-round/ recompute a round from events → battle_round_scores
  battle-physique/     camera photo → pose-compliance AI judge → media hash + verdict
  battle-settle/       final totals, winner, Elo, xp_events grant, stats
  _shared/battle/
    scoring.ts         THE scoring engine (single source of truth)
    catalog.ts         objects/challenges/poses + coefficient tables
    plausibility.ts    anti-cheat checks (§10)
contracts/battle/      scoring.ts + catalog.ts + coefficients.ts masters
scripts/verify-battle-parity.mjs   byte-parity guard (§7)
migrations/009_battle_arena.sql
```

---

## 3. Database schema (migration 009, additive only)

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz
not null default now()` unless noted. RLS ON everywhere, owner-only by
default; cross-user reads only where stated, always through participant
checks or security-definer functions (the 004/005 doctrine).

```sql
battle_seasons   (id, name text, starts_at, ends_at, is_active bool)
                 -- seeded with SEASON 0; read: any authed user.

battle_ratings   (user_id uuid pk default auth.uid(), season_id fk,
                  rating int default 1000, wins int, losses int,
                  streak int, updated_at)
                 -- one row per user per season (unique (user_id, season_id)).
                 -- SELECT own; ALL writes service-role only.

battle_queue     (id, user_id default auth.uid(), mode text
                  check (mode in ('quick','ranked')), level int,
                  power int, rating int, status text default 'waiting',
                  enqueued_at)
                 -- INSERT/SELECT/DELETE own. Matchmaker (service) pairs and
                 -- deletes. Index (mode, status, rating).

battle_matches   (id, season_id fk, mode text check (mode in
                  ('friendly','quick','ranked','ghost')),
                  status text check (status in ('inviting','matched','active',
                  'judging','settled','abandoned')),
                  pacing text check (pacing in ('async','live')),
                  invite_code text unique,        -- friendly only
                  current_round int default 0,
                  round_window_hours int default 24,
                  winner_user_id uuid null, settled_at null)
                 -- SELECT via participant policy (below). INSERT via
                 -- battle-invite/matchmaker functions only.

battle_participants (match_id fk, user_id, seat int check (seat in (1,2)),
                  snapshot jsonb not null,  -- level, power, class, branch,
                                            -- rating, win_rate AT MATCH TIME
                  ready_at, total_score int, rating_delta int,
                  xp_awarded int, primary key (match_id, user_id))
                 -- Participant visibility rule: a user may SELECT rows
                 -- (their own AND their opponent's) for matches they are in:
                 --   using (exists (select 1 from battle_participants me
                 --          where me.match_id = match_id
                 --            and me.user_id = auth.uid()))
                 -- Snapshot is the ONLY cross-user data exposed — no body
                 -- data, no logs. Identity comes from public_profile (D4).

battle_rounds    (match_id fk, round_no int, kind text check (kind in
                  ('strength','cardio','physique')),
                  spec jsonb not null,   -- rolled by server: object/challenge,
                                         -- target units, scale multiplier,
                                         -- pose, coefficient table VERSION
                  starts_at, ends_at, status,
                  primary key (match_id, round_no))
                 -- SELECT: participants. INSERT/UPDATE: service only.

battle_events    (id, match_id fk, user_id default auth.uid(), round_no int,
                  kind text check (kind in ('volume','cardio','photo_hash',
                  'ready','forfeit','flag')),
                  source_table text, source_id uuid,  -- the owned log row
                  payload jsonb, server_ts timestamptz default now())
                 -- APPEND-ONLY (no update/delete policies, like xp_events).
                 -- INSERT own, and a BEFORE INSERT trigger (the 006 pattern):
                 --   * caller is a participant, match active, round open
                 --   * volume/cardio events MUST reference an owned
                 --     workout_log/cardio_log row whose timestamp falls
                 --     inside the round window; amounts recomputed server-
                 --     side from that row × the round's coefficient version
                 --   * plausibility caps (§10) — violations insert a 'flag'
                 --     event instead of rejecting silently
                 -- SELECT: participants (this is what realtime broadcasts).
                 -- Index (match_id, round_no, server_ts).

battle_round_scores (match_id fk, round_no, user_id, components jsonb,
                  points int, judged_at,
                  primary key (match_id, round_no, user_id))
                 -- INSERT/UPDATE service-role only. Clients read, never write:
                 -- the client NEVER decides scores.

battle_media     (id, match_id fk, user_id, round_no, sha256 text,
                  phash text, pose text, storage_path text, verdict jsonb,
                  confidence text, compliant bool)
                 -- D2 (decided): image bytes live in a PRIVATE storage
                 -- bucket `battle-media`, path {match_id}/{user_id}/{round}.
                 -- Bucket RLS: read only for participants of that match_id;
                 -- write only via battle-physique (service role). sha256
                 -- unique per user across ALL matches = reuse detection.
                 -- Row SELECT: own + opponent rows of own matches.
                 -- Retention: rows + objects deleted with the match via
                 -- cascade + a cleanup call in battle-settle for abandoned
                 -- matches. Solo Oracle scans remain never-persisted.
```

`battle_history` = a view over matches+participants. `battle_stats` = the
ratings row + aggregates; no separate table until something needs it.
**XP**: 006's trigger gains one branch — `kind='battle'` allowed when a
settled `battle_matches` row exists with `xp_awarded` matching for
`auth.uid()`; amount recomputed from that row. Inserted by `battle-settle`
(service role), same idempotence unique-index as set grants.

---

## 4. API architecture (edge functions, the `ai-physique` pattern)

Every function: caller JWT verified (`callerClient`), CORS headers, JSON
in/out. Functions that must write scores/ratings/matches use the
service-role client **internally** after validating the caller — the anon
key never gains write paths to authoritative tables (RLS enforces this even
if a function has a bug: score tables have no client policies at all).

| Function | Auth writes | Purpose |
|---|---|---|
| battle-invite | service | create friendly match, mint code |
| battle-join | service | code/queue → second participant, snapshot both |
| battle-matchmaker | service | pair queue rows: rating band ±10% widening 5%/30s; timeout → suggest ghost |
| battle-ready | service | both ready → roll round 1 spec (server RNG; seeds recorded in spec for audit) |
| battle-settle-round | service | fold events → components → points; idempotent (recompute-and-replace) |
| battle-physique | service | camera-capture dataURI → pose compliance + physique judging (reuses `_shared/ai.ts`); low confidence → `retry_requested`, unranked |
| battle-settle | service | totals ×15%-cap character multiplier already applied per round; winner, Elo delta, ratings, xp_events grant, toasts payload |

Client set/cardio logging **reuses the existing Today/Log mutations
untouched** — during an active round the client additionally posts a
`battle_events` row referencing the just-saved log row id (fire-and-forget,
failure surfaces a toast, never blocks the save; same doctrine as the XP
grant in `useSaveSet`).

---

## 5. Realtime architecture

One channel per match: `battle:{match_id}`.

- **postgres_changes** on `battle_events`, `battle_rounds`,
  `battle_round_scores`, `battle_matches` filtered by `match_id` — the DB is
  the event log, so realtime is just push-notification of rows.
  **Reconnect = SELECT the tables again + resubscribe**; nothing is lost
  because nothing lives only in the socket (this is the whole reason the
  design is DB-event-sourced rather than broadcast-based).
- **presence** for "opponent is here / training now" and ready-up.
- Live progress bars derive from replayed + streamed `volume` events —
  both clients compute display % locally from the same event stream; the
  server recomputes authoritatively at settle (client math is cosmetic).
- Publication: 009 adds the four tables to `supabase_realtime`.
- Scale note: one channel per active match, subscriptions filtered by id —
  no fan-out concerns at any plausible user count; matchmaker moves to
  pg_cron + advisory locks before concurrent-queue volume matters.

---

## 6. State management

Same split the app already uses: **TanStack Query owns rows** (match,
rounds, scores, history, rating — invalidated by realtime callbacks),
**Zustand owns ephemera** (channel status, presence, optimistic tick of my
own progress bar), **local state owns forms**. New `battle-store` is added
to the sign-out clear list in `auth-context.tsx` — that list is a pinned
invariant; the PR that creates the store must touch auth-context in the
same commit or the cache-isolation guard is violated.

---

## 7. Scoring engine (server-authoritative, display-mirrored)

Single TypeScript source of truth in `contracts/battle/scoring.ts` (+
catalog + coefficients), **copied verbatim** into
`supabase/functions/_shared/battle/` and `client/src/domain/battle/` by
`scripts/verify-battle-parity.mjs`, which CI runs and which **fails on any
byte drift** — the verify-tokens pattern applied to logic. The client copy
renders previews; only the server copy writes rows. (No Python involvement:
battles are a v2 client-era feature; gen_fixtures is untouched.)

**Round 1 — Strength (1200)**
- Spec: object rolled from catalog (`{name, art, targetUnits, scale}`), e.g.
  Motorcycle 220 → Moon 7.35e22 kg; `scale` normalizes each to a target
  *effective volume* reachable in one honest session (e.g. 6,000–14,000
  effective kg by object tier) — the player never lifts fantasy numbers,
  the multiplier does (Game Weight = volume × scale).
- Effective volume per set = `weight × reps × exerciseCoefficient ×
  formMultiplier` (form = 1.0 today; wearable/video verification raises it
  later, manual-entry penalty lowers it — the multiplier slot IS the
  anti-cheat hook). Coefficient table v1 ships ~40 exercises from
  EXERCISE_LIBRARY (compound barbell 1.0 → cable/isolation 0.45–0.6),
  versioned in the round spec so old matches recompute identically.
- Components: Completion 700 (progress toward target, linear, capped) ·
  Speed 200 (first-to-finish 200/120 split; unfinished: pace percentile) ·
  Variety 180 (distinct exercises: 1→0, 2→60, 3→120, 4+→180) · Overload 120
  (sets within 75–95% of the athlete's own recorded e1RM band — rewards
  *appropriate* intensity, explicitly NOT max attempts; >100% e1RM earns
  zero overload and raises a flag, so the incentive gradient points at
  sustainable training).
- Then `× characterMultiplier(strengthScore)` where multiplier =
  `1 + 0.15 × (stat/100)` — a maxed stat adds exactly 15%, never more
  (pinned by a unit test at stat=0/50/100/overflow).

**Round 2 — Cardio (1050)**
- Spec: challenge from catalog (Escape Zombies = distance, Power A City =
  watt-minutes from machine+minutes conversion, Climb A Mountain =
  elevation/floors, Outrun A Wolf = pace-over-distance…). Energy Units =
  metric × activity coefficient; coefficients per modality (run 1.0/km,
  bike 0.4/km, stairs 12/floor, row 1.1/km, walk 0.55/km…) tuned so 30
  honest minutes ≈ 60–75% completion on any machine — no calorie reliance.
- Components: Performance 550 (units vs target) · Consistency 200 (spread
  across the window / negative-split detection from event timestamps) ·
  Completion 200 · Final Sprint 100 (last-10%-of-window contribution) —
  then × endurance multiplier (conditioningScore, same 15% cap).

**Round 3 — Physique (750)**
- Camera-only capture (`launchCameraAsync`, no gallery — enforced client-
  side AND the AI judges pose compliance server-side, so a gallery bypass
  still has to match the rolled pose in a fresh-looking frame).
- Server rolls pose from spec. AI judges Muscular Development /
  Conditioning / Symmetry / Proportion / Presentation (each /15) +
  `pose_compliant` bool + confidence. Weighted to 750. Low confidence →
  score withheld, one retry requested, still-low → round scores on
  compliance-only floor (never ranked on a low-confidence read — the
  ai-physique doctrine).
- × aesthetic/leanness blend multiplier, 15% cap.

**Winner** = highest total; tie → higher completion sum; still tied → draw
(both keep rating, half XP). XP payout: win 150 / loss 50 / draw 75
(≈ a solid workout's worth; ledger-granted, never client-asserted).

## 8. Rating (trophies)

Elo, K=32, seeded 1000, floored at 0: `delta = K × (outcome − expected)`,
expected from rating gap; margin-of-victory scales K by 0.75–1.25. Trophies
ARE the rating (one number, no second currency to reconcile). Leagues =
named rating bands (Iron <900, Bronze <1100, Silver <1300, Gold <1500,
Neon <1750, Mythic ≥1750) — display labels over the same number.
**Coins: not in v1** (D3) — no economy exists to spend them; a placeholder
currency would be a liability, not a feature.

## 9. Animation system

Reanimated + the existing `animations.ts` keyframes-as-data. All animated
nodes: **inline styles only** (the pinned NativeWind/web gotcha). Reduced
motion respected via `useReducedMotion` (ScanFrame precedent).
- Queue: radar sweep (rotating conic gradient) + ETA + cancel NeonButton.
- VS screen: two HeroStages slide in, aura bloom, power numbers count up.
- Object stage: object art `translateY` interpolated to combined progress;
  ParticleLayer intensity scales with % (already XP-reactive on Home).
- Dual progress: two glow bars (mine `accent`, theirs `epic`), floating
  +volume ticks (FloatingXP reuse).
- Results: level-up-overlay pattern — **ready-gated on the settled row**
  (celebrations fire from CONFIRMED server state only; the announced-XP-
  must-equal-landed-XP invariant applies verbatim to battle rewards).

## 10. Anti-cheat (architecture now, hardening later)

Layered; every layer is a `battle_events` `flag` or a form-multiplier input,
so new detectors never need schema changes:
1. **Now (009)**: events reference owned log rows in-window (trigger-
   enforced); duplicate source_id rejected (unique index); impossible-lift
   flag (> 1.35 × athlete's best recorded e1RM for that lift, or > 4×BW
   compound) — flagged sets score zero overload and cap completion credit;
   photo sha256 reuse across matches rejected; pHash near-duplicate flagged;
   timestamp sanity (log row ts within window, monotonic).
2. **Next**: manual-entry form multiplier < 1.0 vs device-observed entries;
   EXIF freshness on native capture; per-user anomaly baselines (volume
   z-score vs own history).
3. **Later**: wearable attestation (Apple Health / Google Fit / HR streams
   feed formMultiplier > 1.0), video verification hooks, on-device exercise
   detection, machine integrations. All land in the same
   `payload jsonb` + multiplier slots — placeholders cost nothing today.

## 11. Battle flow

```
FRIENDLY:  A invite → code → B join → snapshot both → both ready
QUICK:     enqueue → matchmaker pairs (±10% widening) → snapshot → ready
   ↓
VS screen (snapshots) → battle-ready rolls Round 1 spec
   ↓
ROUND LOOP (1..3):
  round open (window) → athletes train → log rows → battle_events
    → realtime → both screens tick live
  window ends OR both signal done → battle-settle-round → scores visible
   ↓
Round 3 verdicts in → battle-settle: totals, winner, Elo, XP grant
   ↓
Results overlay (count-up, celebration, rating delta) → history row
Abandon/timeout: no events by window end → forfeit that round's completion;
two empty rounds → abandoned, ranked counts as loss, friendly just closes.
```

## 12. Risks

| Risk | Mitigation |
|---|---|
| Nobody to match (2 users) | friendly + ghost first; queue suggests ghost at 90s |
| Fabricated sets (known gap #7) | §10 layer 1 now; economy caps XP at 150/battle |
| AI judging variance | confidence gate + one retry + compliance floor; never rank low confidence |
| Photo privacy | hash-only persistence (D2); verdicts not photos shown to opponent |
| Realtime quota (free tier) | one channel/match, DB-sourced state, presence only while battle screen focused |
| Scope explosion | phases below; each phase independently shippable + green |
| Cheating arms race | scoring engine versioned in spec → recompute old matches under old rules |

## 13. Performance

Event replay bounded (a battle produces < ~200 events); progress math is
O(events) folds memoized per round; object art preloaded at VS screen;
particle counts already capped by ParticleLayer; realtime unsubscribes on
blur (tab focus effect); no polling anywhere — push or fetch-on-focus.

## 14. Phases (small, reviewable, each leaves the app shippable)

- **P0** Sign-off (§15) → migration 009 + triggers + `[architect]` commit +
  RLS falsification tests (verify a stranger reads nothing, a participant
  reads exactly the opponent snapshot; positive controls per doctrine).
- **P1 Friendly BLITZ battle, Round 1 only, end-to-end.** Arena tab, invite/
  join, VS, 12-min blitz strength round vs coefficient table, settle,
  results, history. Ghost of your own last round included (it's free:
  replay events).
- **P2** Rounds 2+3 (cardio catalog + battle-physique with pose compliance).
- **P3** Quick Match queue + matchmaker + live pacing mode + ghost battles.
- **P4** Ranked + seasons + leaderboard + league badges.
- **P5** Anti-cheat layer 2, wearable multiplier slots, spectator polish.

## 15. Decisions — ANSWERED by Tyson, 2026-07-11

- **D1 Pacing**: BOTH formats — short mini-game **BLITZ** battles (quick
  match) AND a longer **FULL** format that is live-only. No async default.
  (§1 pacing rewritten to match.)
- **D2 Round-3 photos**: **store in a private bucket** so opponents can view
  them. The "photos never persisted" invariant is hereby amended to
  battles-only storage with participant-scoped access; solo Oracle scans
  unchanged. client/CLAUDE.md must be updated in the P2 commit that
  implements this.
- **D3 Coins**: deferred. XP + trophies only in v1.
- **D4 Identity**: reuse the `public_profile` opt-in display name; entering
  the Arena requires it.

## 16. ARENA MINI GAMES (Tyson's spec; D5–D9 answered. MG1 + MG2 BOTH SHIPPED 2026-07-12)

Two new single-round competitive formats beside FRIENDLY BLITZ. Both reuse
the battle spine end-to-end: invite-code flow, battle_matches/rounds/
events, the append-only volume guard, realtime dual bars, battle-settle,
engine scoring, results + history. Neither touches BLITZ.

### Game 1 — VOLUME DUEL (`format: 'volume_duel'`)
Compete during the same workout to move the most total weight.
- **Score** = Σ weight×reps over ALL sets logged in the window. Winner =
  higher total; tie = draw (winner_user_id null, like BLITZ).
- **The streak/stats contribution is FREE**: duel sets ride the NORMAL
  useSaveSet path (update-in-place, real 10 XP/set, PR detection) and then
  post battle_events 'volume' with the confirmed rowId — exactly the P1
  round-1 pattern. computeStreak and calculateAvatarStats read workout_log,
  so the duel workout counts automatically. No new grant paths.
- **Anti-cheat**: nothing new — the existing battle_events guard already
  rebuilds volume payloads from owned in-window workout_log rows.
- **UI**: a Today-screen twin with a competitive skin. Extract Today's
  ExerciseCard/SetRow into a shared ui/exercise-logger.tsx taking a tint
  (Today = standard cyan; duel = danger/mythic palette, "VOLUME DUEL"
  kicker, round clock in the header, opponent's live total + dual bars).
  Extraction must not regress Today (tap contract; keep the day:exercise
  key fix). The athlete logs their OWN day plan, any exercises count.
- **Server**: battle-settle becomes format-aware — totalRounds('blitz'|
  'full')=3, mini games=1 — finalizing after round 1. Engine v3 adds the
  volume-duel scorer (byte-copied ×3, CI pin unchanged).

### Game 2 — HEADS OR TAILS (`format: 'heads_or_tails'`, named by Tyson 2026-07-12)
A coin-flip gauntlet locks each athlete to one exercise in one muscle
group; most weight moved on YOUR assigned exercise wins.
- **Coin flips are SERVER-side** (crypto RNG in the edge function at
  ready-up; the client never flips, it only replays verdicts). Three
  flips, revealed one per pick step so later ones can't be predicted:
  1. Flip 1 winner picks the MUSCLE GROUP.
  2. Flip 2 winner picks PLAYER 1's exercise (within that group).
  3. Flip 3 winner picks PLAYER 2's exercise (within that group).
- **Pick state machine** lives in battle_rounds.spec:
  `awaiting_muscle(w1) → awaiting_ex_p1(w2) → awaiting_ex_p2(w3) → open`,
  with {muscleGroup, exerciseA, exerciseB} locked at open. A stalled
  picker times out (5 min) to an auto-random legal pick — no hostage
  matches.
- **New edge function `battle-pick`**: validates caller = current step's
  flip winner, validates the exercise's inferMuscleGroup matches the
  picked group (catalog-derived allowlist), writes the pick as a
  server-only battle_events 'pick' row, advances the state, opens the
  logging round after pick 3.
- **Pickable groups**: catalog groups with ≥3 exercises (Chest, Upper
  Chest, Back Width, Back Thickness, Side/Rear Delts, Biceps, Triceps,
  Quads, Hamstrings, Glutes, Abs — final list derived from the catalog).
- **UI**: coin-flip ceremony (ONE-SHOT animation per the animation rules,
  server verdict revealed), pick screens (group chips → exercise list),
  then the shared duel logger locked to the assigned exercise.
- Sets again ride the normal path → streak/stats/XP automatic.

### Shared work
- **Migration 015** (`[architect]`): widen the format check to
  ('blitz','full','volume_duel','heads_or_tails'); round kinds; battle_events
  kind 'pick' insertable by the service role only; STEP-9-style
  falsification checklist (stranger reads nothing; non-winner pick
  rejected; out-of-group exercise rejected; forged volume rejected;
  positive control green).
- battle-invite takes a `format` param (default 'blitz'); Arena hub grows
  a MINI GAMES section with two PressCards; battle screen routes on
  format. XP on settle: existing battleXp. Winner coins: see D8.

### Phases (each shippable, BLITZ untouched)
- **MG1**: migration 015 + engine v3 + format-aware invite/settle +
  VOLUME DUEL end-to-end + ExerciseLogger extraction + two-account tour.
- **MG2**: battle-pick + flip ceremony + HEADS OR TAILS end-to-end + tour.

### Decisions — D5–D9: ANSWERED by Tyson 2026-07-12, "all recommended"
D5 absolute kg · D6 75 min / 30 min + 5 min per pick · D7 assigned
exercise only · D8 coins deferred · D9 invite-code only at launch.

### The original decision framing (kept for the reasoning)
- **D5 Scoring basis**: absolute kg moved (RECOMMENDED — legible, it's
  the same bar) vs bodyweight-relative (fairer across sizes; could land
  later as a variant). Sex calibration does NOT apply here — duels are
  head-to-head absolute contests unless D5 says otherwise.
- **D6 Windows**: Volume Duel 75 min; Heads or Tails 30 min logging + 5 min
  per pick. Confirm or adjust.
- **D7 Heads or Tails counting**: assigned exercise ONLY (RECOMMENDED) vs
  every set in the picked muscle group.
- **D8 Winner coins**: defer (RECOMMENDED, consistent with D3) vs +50
  winner coin (needs a 013-style server guard migration).
- **D9 Reach at launch**: invite-code only (RECOMMENDED); P3's
  quick-match queue can offer duels once it exists.
