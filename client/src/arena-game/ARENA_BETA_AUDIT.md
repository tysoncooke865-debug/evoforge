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
1. **Champion identity violates the official EvoForge roster.** Game has 4
   paths (`titan|speedster|shredder|hybrid`); official Champions are FIVE:
   Aesthetics, Titan, Mass Monster, The Shredder, Cardio Machine — exactly
   EvoForge's live `BranchV2` roster. The provider's 5→4 fold collapses
   `mass`→titan and `aesthetic`→hybrid: two athletes with different real
   Origins get the same in-game champion, and player-facing names
   ("Speedster", "Hybrid") don't exist in EvoForge. Fix: five champions
   keyed to the real branch ids, "The Shredder" display name, compatibility
   migration for saved `championId`s (speedster→cardio machine's champion,
   hybrid→aesthetics'), no destructive resets.

## HIGH
2. **Avatar/evolution stage is not the real one.** The Arena derives stage
   from a Forge-Level ladder (25/50/75/100). EvoForge's authoritative stages
   are branch-specific (`avatarStageRowsV2`; The Shredder's stage is
   BODY-FAT-driven). The Arena must display the real stage; locked stages
   stay locked (EvoForge rules authoritative).
3. **Dev fitness editor is misleading inside EvoForge.** It edits the LOCAL
   mock save's fitness, which the Supabase provider ignores — player-facing
   route that does nothing to battles. Remove from the integrated lobby
   (keep code behind the debug screen only, clearly labeled dev-mock).
4. **Gym member paths are synthesized** (deterministic hash of user id) and
   member pillars are flat `evo_rating` — `gym_detail` RPC exposes only
   display_name/forge_level/evo_rating (RLS: cannot read others' profiles).
   No schema change this run (protected); document the approximation
   in-UI ("estimated build") and map the synthesized path onto the FIVE
   official paths. A future `gym_detail` migration adding `origin_path` is
   the real fix (flagged, not executed — shared-schema protection).
5. **Speedster auto-cast ping-pong** (borrowed champion Lane Shift fires on
   cooldown because it is always-valid) — player-visible oddity in gym
   battles; needs a combat-nearby gate. (Ability itself is being reworked in
   the five-champion pass.)

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

## Execution plan (this run)
P2+P3 five-champion architecture + real progression (Fable xhigh) →
P4 engine-reliability review (ultracode) → P5 stability @5 champions
(Sonnet) → P6+P7 combat feel + readability (Sonnet) → P8 balance (Fable) →
P9 cards/synergies (Sonnet) → P10 AI tendencies (Fable xhigh) → P11 journey
(Fable) → P12 gym slice (Fable xhigh) → P13 reward safety (Opus xhigh) →
P14 final verification + report (Opus xhigh). Repo left runnable (gates
green) at every committed checkpoint.
