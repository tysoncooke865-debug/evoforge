# EvoForge Multiplayer & Social Roadmap

> Tyson, 2026-07-17 (autonomous): add a friends **rivalry system**, **ghost
> battles** vs a friend/rival's completed workout, a **Damage Assessment**
> photo mini-game, and **live matchmaking** PvP. This doc is the execution
> plan. Everything below the foundation is gated on the foundation shipping.
>
> Migration counter at time of writing: last applied migration on
> `expo-rewrite` was **034** (rpg_challenges). This plan claims **035–041**.
> Migrations are a protected path — commit with `[architect]`.

## The non-negotiable rules (these have cost real bugs — see memory)
1. **Never gate a SECURITY DEFINER trigger/guard on `current_user`** — inside a
   definer function it is always the table owner, so the bypass fires for every
   row. Use a transaction-local GUC (`set_config('evoforge.xxx', v, true)`) that
   only definer RPCs set, or gate on `service_role`. (Cost: the coin guard AND
   the xp_ledger 99999-mint exploit.)
2. **The client never charges coins or mints XP.** Server RPCs are the authority
   (advisory-locked, balance-checked, spend+grant in one txn), exactly like
   `purchase_character` / `forge_claim_weekly`.
3. **Every table is owner-RLS.** Cross-user reads go through SECURITY DEFINER
   RPCs that return only the columns the other player may see — never a raw
   cross-user SELECT. (Pattern: `get_rpg_challenge`, `leaderboard_top`.)
4. **Battle round photos are the ONE persistence exception** (BATTLE_ARENA
   D2): camera captures only, uploaded by an edge function (service role) into
   the private `battle-media` bucket, readable solely by the match's two
   participants via short-lived signed URLs, deleted with the match/on cancel.
   Damage Assessment reuses this posture — see Phase 3.
5. `gen_random_bytes` is NOT enabled — generate codes with
   `md5(random()::text || clock_timestamp()::text || try::text)`.
6. Verify loop before every push: `tsc --noEmit` · `eslint src` (0) ·
   `vitest run src` · guards · `expo export -p web` · WebKit iPhone tour.
   Falsify every migration across two accounts (ALPHA + BRAVO), then restore
   ALPHA to a clean state.

---

## Phase 0 — FOUNDATION: friends + rivalry (migration 035) ⭐ blocks all
Everything social needs a symmetric friend edge and a per-pair rivalry record.

### Data model
- `public.friendships` — the accepted edge. Store ONE row per pair with
  `user_a < user_b` (uuid order) so the pair is canonical and unique.
  Columns: `user_a uuid`, `user_b uuid`, `created_at`. PK `(user_a, user_b)`.
- `public.friend_requests` — pending invites: `from_id`, `to_id`, `code` (a
  shareable 6-char add-code, md5-derived), `status`
  (`pending|accepted|declined`), `created_at`. Unique `(from_id, to_id)`.
- `public.rivalries` — the head-to-head record per friend pair (created lazily
  on the first contest): `user_a`, `user_b` (canonical order), `a_wins`,
  `b_wins`, `draws`, `last_contest_at`, `rival_points_a`, `rival_points_b`.
  A "Rival Rank" is derived from rival_points (reuse the [[evoforge-progression-overhaul]]
  Rival Rank tiers if compatible).

### RPCs (SECURITY DEFINER, `to authenticated`, revoke from public)
- `send_friend_request(p_code text)` / `send_friend_request_to(p_to uuid)` —
  create a pending request; idempotent; blocks self + existing friends.
- `respond_friend_request(p_request uuid, p_accept bool)` — on accept, insert
  the canonical `friendships` row in one txn.
- `my_friends()` → each friend's `id, display_name, level, rival_record` (reads
  `public_profile` for the name — NEVER body data).
- `my_add_code()` — the caller's stable add-code (create on first call).
- `record_rivalry_result(p_opponent uuid, p_outcome text, p_points int)` — the
  single seam every contest (ghost battle, damage assessment, live match, champion
  battle vs a friend) calls to update `rivalries`. Definer; sets a GUC so only it
  can write `rivalries`.

### RLS
Owner-or-participant SELECT on `friendships`/`rivalries` (either side may read
their pair); all writes via the RPCs only (revoke direct insert/update).

### Client (`src/data/social.ts`)
`useFriends`, `useAddCode`, `useSendFriendRequest`, `useRespondRequest`,
`useRivalry(opponentId)`. Query keys per-user; invalidate on mutate.

### UI (`src/app/(main)/friends.tsx`, linked from Arena + Profile)
Add-by-code + share-your-code, pending requests, friends list with each rival
record ("You 3 — 1 Rival"). This screen is the hub the next three phases plug
into (a friend row → "Ghost Battle" / "Damage Assessment" / "Challenge Live").

**Falsify:** ALPHA sends code → BRAVO accepts → both see the friendship;
non-friend cannot read the pair; RPCs reject self-add + double-accept; raw
cross-user SELECT on friendships returns []. Restore ALPHA.

---

## Phase 1 — RIVALRY polish (migration 036, small; after 035)
Rival Rank surfacing + a rivalry detail screen (head-to-head history, streak,
who leads). Mostly client; the data already lands via `record_rivalry_result`.
A `rivalry_events` append-only log (kind: ghost/damage/live/champion, winner,
delta) powers the history. Owner-or-participant RLS; written only by the definer
result RPCs.

---

## Phase 2 — GHOST BATTLES vs a completed workout (migration 037)
Async: fight the "ghost" of a friend/rival's *actual logged session*.

### Concept
When a workout is finished, snapshot its performance into a **ghost**: total
volume, top sets, sets completed, est. 1RMs, the derived combat stats at that
moment. A friend loads the ghost and fights an AI-driven opponent parameterised
by that snapshot (reuse the battle-rpg engine + `capStats` clamp so a stronger
ghost is bounded, exactly like the challenge joiner). Result posts to the
rivalry via `record_rivalry_result`.

### Data
- `public.workout_ghosts` — `id`, `owner_id`, `workout`, `date`, `snapshot jsonb`
  (the PlayerCombatInput + headline numbers), `plays`, `defeats`, `created_at`.
  Owner-RLS; a `get_ghost(p_id)`/`list_friend_ghosts()` definer RPC lets a FRIEND
  (verified via friendships) load it. Reuse the challenge-snapshot shape.
- Snapshot is written by a definer RPC `publish_ghost` called from the workout
  finish flow (opt-in "share this session as a ghost" toggle on the summary
  sheet). No body photos — numbers only.

### Client/UI
`src/data/ghosts.ts`; Arena → "Ghost Battles" lists friends' recent ghosts;
tapping one enters `/battle?mode=ghost&ghost=<id>` (extend `use-battle.ts`
BattleMode with `'ghost'`, `scalingFor('ghost')→training`, AI from the snapshot).
On settle → `record_rivalry_result` + `useGrantBattleReward` (daily-capped).

**Falsify:** BRAVO finishes a workout, publishes a ghost; ALPHA (friend) fights
it, result updates the rivalry; a NON-friend cannot load the ghost.

---

## Phase 3 — DAMAGE ASSESSMENT mini-game (migration 038 + edge function)
Between friends: both take a **pre-pump** photo and a **post-workout** photo;
AI judges who changed the most; winner takes the assessment + XP.

### Flow
1. ALPHA challenges a friend → `damage_assessments` row (`status=open`, code).
2. Each participant, at their own gym: capture PRE photo (camera only) → train →
   capture POST photo. Photos go straight to the **private `battle-media`
   bucket** via the edge function (service role), NEVER persisted in app state
   (reuse the round-3 photo posture — this is the sanctioned exception).
3. When both have submitted PRE+POST, an edge function
   `damage-assessment-judge` calls the OpenAI vision seam (like
   `services/ai_physique` / the existing `battle-physique`): for each athlete it
   scores the PRE→POST delta (pump/vascularity/definition change, 0–100), and
   returns a winner + per-athlete blurb. It writes the verdict; photos are then
   deleted (or expire) — only the scores + blurb remain.
4. Winner gets XP via a server grant (daily-capped, idempotent, GUC-guarded like
   migration 033); result posts to the rivalry.

### Data
- `public.damage_assessments` — `id`, `code`, `challenger_id`, `opponent_id`,
  `status` (`open|awaiting|judging|done|expired`), `challenger_pre/post_key`,
  `opponent_pre/post_key` (bucket object keys), `winner_id`, `verdict jsonb`,
  `created_at`. Owner-or-participant RLS; state transitions via definer RPCs.
- Edge functions: `damage-assessment-submit` (accept a camera capture, upload to
  bucket, service role), `damage-assessment-judge` (both-submitted → AI verdict
  → XP grant → schedule photo deletion). CI auto-deploys edge functions.

### Security/privacy (critical)
Photos are the round-3 exception ONLY: camera captures, private bucket, readable
solely by the two participants via short-lived signed URLs, deleted with the
assessment. The Oracle's "solo physique photos are never persisted" rule is NOT
widened — this is a bounded, consented, deleted-after-judging flow.

**Falsify:** two accounts submit; judge produces a winner + grants XP once
(idempotent); a third account cannot read either photo or the verdict; photos
are gone after judging; XP grant is daily-capped and cannot be replayed.

---

## Phase 4 — LIVE MATCHMAKING PvP (migrations 039–041 + realtime)
Real-time move-by-move champion battles vs a friend OR a matched stranger.

### Transport
Supabase **Realtime** (Postgres changes + broadcast on a per-match channel).
Both clients subscribe to `match_moves` inserts for their `match_id`; the server
(definer RPC) validates and applies each move against the shared, deterministic
battle-rpg engine (the engine is already pure + RNG-threaded, so both clients
and the server compute identical states from the same seed + move log).

### Data
- `public.match_queue` — `user_id`, `champion`, `player_input`, `mode`
  (`ranked|friendly`), `enqueued_at`. A `matchmake()` definer RPC pairs two
  compatible waiting players (or friend-invite by code) into a `matches` row and
  clears them from the queue (advisory-locked to avoid double-match).
- `public.matches` — `id`, `a_id`, `b_id`, `seed`, `champion_a/b`,
  `input_a/b`, `turn`, `status` (`active|done`), `winner_id`, `created_at`.
- `public.match_moves` — append-only `match_id`, `turn`, `actor_id`, `move_id`,
  `created_at`. A `submit_move(p_match, p_turn, p_move)` definer RPC enforces
  turn order, legality (stamina/cooldown from the recomputed state), and writes
  the move; both clients react to the Realtime insert and animate.
- Server is the referee: the FINAL state + winner is recomputed server-side from
  seed + move log in `finalize_match`, so a tampered client cannot fake a win.
  Result → `record_rivalry_result` (+ ranked rating via the Glicko seam already
  in the repo).

### Client/UI
`src/data/matchmaking.ts` (enqueue, subscribe, submit move); a matchmaking
screen (searching… → matched → the existing `BattleArena`/`MoveGrid` driven by
the live move stream instead of local AI). Reconnect + timeout handling
(a disconnected player forfeits after N seconds — server-timed).

### Security
Move legality + win are SERVER-authoritative (recomputed from the log). RLS:
participants-only on `matches`/`match_moves`; queue rows owner-only; all writes
via definer RPCs. Rate-limit `submit_move`. Ranked rating updates are
server-only (GUC-guarded), never client-sent.

**Falsify:** two accounts match and play a full game move-by-move over Realtime;
an out-of-turn or illegal move is rejected; a forged "I won" write is impossible
(finalize recomputes); disconnect forfeits; ranked rating moves once per match.

---

## Execution order & why
`035 friends/rivalry` → unblocks all. Then the async, lower-risk features first
(`037 ghost`, `038 damage assessment`) to validate the social loop, then the
hardest (`039–041 live matchmaking`) which needs Realtime + server-referee. Each
phase is independently shippable and falsifiable; none touches the retired
Streamlit app.

## Status
- [x] Champion-battle animation + move-selection upgrade (shipped 2026-07-17,
      commit `9928429`).
- [x] Phase 0 foundation — shipped as migration 036 (035 was taken), falsified;
      Friends & Rivals screen live. Found+fixed: Supabase default-grants EXECUTE
      to authenticated on new public functions — cheat seams must be revoked
      from anon+authenticated EXPLICITLY.
- [x] Phase 2 ghost battles — migration 037 + client, playable end-to-end
      (publish from summary sheet → Arena list → /battle?mode=ghost → rivalry).
- [x] Phase 3 damage assessment — migration 038 + damage-assessment edge fn +
      /damage screen. Deployed judge exercised E2E in production: pre-before-
      post enforced, 4th photo triggers the 4-image AI verdict, draw within 3
      points, finalize grants XP + rivalry, photos deleted in-invocation.
- [ ] Phase 1 rivalry polish (history log) — optional, data already flows.
- [ ] Phase 4 live matchmaking (migrations 039–041 + Realtime) — NEXT.
