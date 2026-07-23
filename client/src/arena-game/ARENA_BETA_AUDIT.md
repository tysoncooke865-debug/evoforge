# Arena Beta Audit — overnight hardening run (2026-07-23)

Baseline: `adca6e3` (all gates green: tsc clean, lint 0 errors, 1,387 vitest
incl. 318 arena tests, tokens/engine/glicko/motion guards, web export).
Auditor context: this package was built and integrated by the same
engineering process now hardening it; findings below were re-verified
against the working tree, not recalled.

## Verification performed
- `git status` clean at baseline; branch `expo-rewrite`.
- Obsolete champion-name census: **73 "speedster" + 80 "hybrid" occurrences
  across 19 files** (content, engine types, synergies, provider, sprites,
  tests, theme).
- Battle verification is headless (117-match stability harness + replay
  digests) plus static web render — no phone/emulator on this machine, so
  "manual battles" run through the web build; on-device passes remain a
  standing gap (tracked since standalone M1).

## CRITICAL
1. ~~**Champion identity violates the official EvoForge roster.**~~
   **RESOLVED (P2, 2026-07-23).** Five champions keyed to the real BranchV2
   slugs (`champion-aesthetic|titan|mass|shredder|cardio`), display names
   pinned by content validation incl. "The Shredder"; Mass Monster is a NEW
   kit (Gravity Well slow field + Mass Uprising summons + Colossal Frame),
   Cardio Machine inherits the tempo kit with an energy-refund ultimate and
   a team-regen passive; every champion gained a data-driven passive. The
   provider maps Origins 5→5 (hybrid→aesthetic, null→titan); save v4→v5
   migrates `championId`/`avatarPath` non-destructively (tested incl.
   malformed + full v1→v5 chain). BALANCE_VERSION 0.6.0; zero obsolete
   names in player-facing strings (grep-verified; remap tables and
   explanatory comments only).

## HIGH
2. ~~**Avatar/evolution stage is not the real one.**~~
   **RESOLVED (P3, 2026-07-23), one documented approximation.** The
   provider now derives the REAL stage via the same pure domain functions
   the customiser renders (`currentStageFor`): The Shredder from the latest
   valid bodyfat_log bf_mid, level branches from the legacy level
   (profiles.base_level + public.xp_total() through the pinned curve).
   Every fallback UNDER-states progress (null ledger → base level; no bf
   reading → stage 1) — locked stages can never show unlocked. PARTIAL
   remainder: EvoForge's screens floor the ledger at the log-derived XP
   total (resolveXp), which a pure profile query cannot compute — a
   ledger-behind-derived athlete may see an earlier stage in the Arena
   until reconciliation (see KNOWN_ISSUES).
3. ~~**Dev fitness editor is misleading inside EvoForge.**~~
   **RESOLVED (P3, 2026-07-23).** Lobby button removed; the editor is
   reachable only from the Developer Debug screen and opens under an
   explicit "DEV MOCK — has no effect on integrated battles" banner. The
   champion detail screen now COMMUNICATES the real scaling instead: it
   lists the five fitness-derived multipliers from the athlete's live
   provider profile (UI copy uses EvoForge's "Size" pillar name).
4. **Gym member paths are synthesized** (deterministic hash of user id) and
   member pillars are flat `evo_rating` — `gym_detail` RPC exposes only
   display_name/forge_level/evo_rating (RLS: cannot read others' profiles).
   No schema change this run (protected). P2/P3 progress: the synthesized
   path now hashes over the FIVE official paths, member stages estimate
   from forge_level, and the roster chips are labeled "(EST.)". A future
   `gym_detail` migration adding `origin_path` is the real fix (flagged,
   not executed — shared-schema protection).
5. ~~**Cardio Machine auto-cast ping-pong** (borrowed champion Lane Shift
   fires on cooldown because it is always-valid) — player-visible oddity in
   gym battles; needs a combat-nearby gate. The five-champion pass kept the
   kit (reflavored); the gate belongs to the P4 engine-reliability review.~~
   **RESOLVED (P4, 2026-07-23).** Auto-casts (borrowed champions AND the
   opponent AI's queue-time tactics) now route through
   `validateChampionAutoCast`; Lane Shift's auto-cast-only gate
   (`laneShiftJoinsCombat`) fires solely to JOIN combat: current lane must
   hold no living enemy within aggro range AND the other lane must hold one
   within aggro range of the champion's x. Ping-pong is structurally
   impossible (the destination lane always has an in-range enemy right
   after a shift). Commanded captain shifts stay unconditional (a human's
   tactical choice). Deterministic, replay-identical; tested in
   gym-champions.test.ts + opponent-ai.test.ts.

## MEDIUM
6. Arena-local "rank points" ladder can be confused with EvoForge's Rival
   Rank (Glicko). Keep local (approved battle-track semantics; no server
   writes) but present as **Arena Rating** in UI copy to avoid collision.
7. Corpse accumulation perf (2.4–3.7× late-battle tick cost; ~2.6% of frame
   budget worst case) — measured, deferred with fix sketch.
8. Replay-open re-simulates the battle behind a spinner (~1.5s phone est.).
9. Arena onboarding's name step duplicates EvoForge's display name (the
   provider overrides it) — trim step or prefill from provider.

## COSMETIC
10. 1-bit sprites are static (no animation/FX beyond floaters) — Phase 6.
11. Feedback export no-ops on browsers without Share API (fail-soft).

## FUTURE WORK (explicitly out of scope this run)
- Real-time PvP + same-tick mirror-order fairness; digest identity-binding
  for networked attestation; `gym_detail` origin_path migration; XP reward
  migration (results stay cosmetic pending Tyson's reward policy).

## What genuinely works vs. mock (verified)
- **Real EvoForge data**: pillar ratings (`evo_rating_current` +
  `profiles.leanness_score`), Forge Level (pinned curve from
  `user_progression.lifetime_xp`), Origin→champion, display name, real gyms
  (`my_gyms`/`gym_detail`/`discover_gyms`).
- **Local/simulated (by design, no server writes)**: Arena rating + battle
  stats, gym contribution stats, battle records/replays (device-local,
  per-user namespaced), AI opponent identity.
- **Engine**: deterministic, replay-verified, invariant-checked every test
  tick; 117-match harness at 0 stalls/violations/errors. Reliability list
  from the master prompt is covered by tests (see PROGRESS.md history).
- **Isolation**: Arena touches no shared tables (read-only + RPCs); sign-out
  teardown registered; per-user storage namespacing; no XP minting.

## P13 — reward safety audit (2026-07-23)

Highest-priority PROTECTION audit. Every verdict below was verified by
reading the actual source in the working tree, not summaries. **No
violations found — no code changes required.** Verdict per scope item:

1. **Zero server writes from the package — CLEAN.** The ONLY supabase
   handle in the whole package is `@/data/supabase` imported once, in
   `integration/evoforge/supabase-provider.ts:36`. Every call is a READ:
   `.from('public_profile'/'profiles'/'evo_rating_current'/'user_progression'/'bodyfat_log').select(...)`
   (lines 103-104, 131-133, 182-186) and RPC reads `xp_total` (169),
   `my_gyms` (196, 245), `gym_detail` (207), `discover_gyms` (246). No
   `.insert/.update/.upsert/.delete` and no mutating `.rpc` anywhere.
   `recordBattleResult` (261-265) delegates to the local mock only. The
   other `.update(`/`.delete(` grep hits are Zustand store `update()` and
   `Map.delete()` — not Supabase.

2. **No XP minting — CLEAN.** No `xp_ledger`/`xp_events`/`xp_awarded`
   write anywhere; `xp_total` RPC is read-only and summed server-side into
   a level derivation (`supabase-provider.ts:167-176`). Package imports
   NOTHING from `@/data/mutations` or `@/data/hooks` (grep empty); the only
   out-of-package imports are `@/data/supabase` (read) and
   `@/domain/progression/forge-level` (pure `forgeProgressFor`). All three
   completion paths write local-only: `battle-store.recordResult`
   (battle-store.ts:165-213 → provider), `LocalMockPlayerProvider.recordBattleResult`
   (local-mock-provider.ts:89-114, Zustand save update),
   `applyGymWarResult` (contribution.ts:15-38, pure over `save.gym`).

3. **No fabricated fitness data — CLEAN.** Nothing in the package writes to
   any EvoForge fitness surface. `evo_rating_current`/`profiles`/
   `bodyfat_log`/`user_progression` are read-only. The dev-mock fitness
   editor (`screens/dev-fitness-editor.tsx:94-100`) mutates only
   `save.fitness` (local Arena save); the integrated provider's
   `getFitnessProfile` (supabase-provider.ts:122-163) reads live Supabase
   data and never consults `save.fitness`, so the editor is inert in the
   integrated app (banner at dev-fitness-editor.tsx:120-123). Reachable
   only from the Debug screen (debug.tsx:132-136).

4. **No duplicate progression systems — CLEAN.** Arena Rating is named
   Arena-local and cosmetic throughout (`services/progression/rank.ts:1-42`
   docstring + `ratingLineFor`); it never grants Forge XP. `avatarStage`
   comes from the real derivation `deriveRealStage`/`estimateMemberStage`
   in the provider (supabase-provider.ts:158, 231), not a parallel ladder.
   Forge Level is only ever read (derived via `forgeProgressFor`, line 141).

5. **Farm-proofing — CLEAN.** Arena Rating, battle stats and gym
   contribution all live in the per-user save; farming affects only the
   farmer's local device. Gym contribution is never sent to any RPC/
   leaderboard (contribution.ts is pure; provider only READS gyms). Ghost
   battles move zero rank and never reach the provider (battle-store.ts:170;
   rank.ts:27). Feedback export ships nothing silently — user-initiated
   `Share.share` only (feedback.tsx:72-78; feedback-log.ts is device-local).

6. **Sign-out teardown — CLEAN.** `resetArenaSession`
   (app-services.ts:112-119) drops the provider/storage back to non-
   namespaced defaults, resets the battle loop FIRST (stops the setInterval
   via `battleStore.reset()`), then idles the player store. Wired into
   auth-context sign-out (`data/auth-context.tsx:110-112`) which also runs
   `supabase.auth.signOut()` + `queryClient.clear()` (48-49) and every
   Zustand store. Per-user namespacing `u/<userId>/` (app-services.ts:89)
   means a second athlete's boot (`initArenaForUser` → `initialize` loads
   the new namespace, player-store.ts:39-53) overwrites in-memory save and
   reads only their own storage — no cross-account leakage of saves/records.

7. **Photos/PII — CLEAN.** Zero camera/photo/media/image-picker references
   in the package (grep empty). Feedback export contains only user-typed
   notes + category + balance version (feedback-log.ts:80-97, 160-176).

8. **Untrusted data paths — CLEAN.** Battle records and ghosts parse
   fail-safe: `validateBattleRecordValue` (replay.ts:148) rejects bad
   scaling via `isValidChampionScaling` (fitness-scaling.ts:78-89, bounds
   `MIN_SCALING_MULT..MAX_SCALING_MULT`) and caps command padding.
   Envelopes are corrupt-safe and refuse newer-build data
   (battle-records.ts, feedback-log.ts). Records only ever drive offline
   replays/ghosts (zero rank, no server write), so even a smuggled record
   cannot reach anything real — validation is defense-in-depth.

**Integration edges (read-only):** boot `_layout.tsx:38` calls
`initArenaForUser` per signed-in athlete under the (main) session gate;
sign-out teardown wired at `auth-context.tsx:110-112`; eslint scoping
(`eslint.config.js:26-31`) only relaxes React-Compiler rules for the
mutable sim — `react/no-danger`, `exhaustive-deps`, `rules-of-hooks` remain.

**Isolation summary:** the package's total external surface is one
read-only Supabase client + one pure domain function. No mutation reaches
EvoForge; all Arena progress (rating, stats, contribution, records) is
device-local and per-user namespaced. No fixes, no CRITICAL flags. Docs
gates only (no code change): `tsc`/`vitest`/`lint` unaffected.

## Execution plan (this run)
P2+P3 five-champion architecture + real progression (Fable xhigh) →
P4 engine-reliability review (ultracode) → P5 stability @5 champions
(Sonnet) → P6+P7 combat feel + readability (Sonnet) → P8 balance (Fable) →
P9 cards/synergies (Sonnet) → P10 AI tendencies (Fable xhigh) → P11 journey
(Fable) → P12 gym slice (Fable xhigh) → P13 reward safety (Opus xhigh) →
P14 final verification + report (Opus xhigh). Repo left runnable (gates
green) at every committed checkpoint.
