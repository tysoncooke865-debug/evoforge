# Existing-user Origin migration (2026-07-17)

## 0. The luckiest fact in this program [CONFIRMED]

On 2026-07-17 the v3/v4 global re-assessment ALREADY retired every assigned
origin: production is 18 profiles, `origin_path` null for all, 17
`needs_assessment` + 1 `pending`, earned `user_paths` stages 2–4 preserved,
full audit trail in `user_path_migration_log`. There is no populated legacy
origin state to migrate — the "existing-user migration" is an INTRODUCTION
flow, and the introduction machinery (daily prompt, Home podium button,
Forge reveal) is already deployed and live-verified.

## 1. Strategy

Existing users keep the EXISTING surfaces; the surfaces get the candidate
upgrade behind a flag. No forced onboarding, no resets, no data rewrite.

- `ORIGIN_FLAGS.candidateRevealEnabled` (new, compile-time per repo
  pattern): ON → the Forge reveal (`origin-panel.tsx`) fetches
  `origin_candidates()` and renders the three-card experience (same shared
  components as onboarding Act II); OFF → the deployed v4 choice reveal
  renders unchanged. The scan prompt and podium button routing are already
  correct (they route to the Forge reveal when classification is ready).
- Existing users never see `/onboarding` again: the new gate clause
  requires `onboarding_flow_version >= 2`, which only the new-flow profile
  insert writes. [Tested: E-1.]

## 2. The ten required account states → behaviour

| State | Behaviour |
|---|---|
| New user, no onboarding | Full new flow (Act I + II). Cannot reach Home originless. |
| Partially onboarded (profile inserted, killed mid-Act II) | Gate redirects to /onboarding; Act II resumes at rating/candidates; deterministic regeneration. |
| Evo Rating, no champion/origin (10 accounts) | Prompt/podium → Forge reveal → candidates (flag on) or v4 choices (flag off) → choose → bind. Rating untouched. |
| Champion progress, no origin (the stage 2–4 aesthetic rows) | Same as above; binding preserve-higher NEVER lowers their stages; non-origin lines stay collected (ORIGIN LOCK display rules as deployed). |
| Selected path / skill tree | Skill tree is derived client-side [CONFIRMED] — nothing to migrate; path rows keep stage/xp. |
| Evolved character skin owner | `user_skin_unlocks` untouched; skins keep working on the origin line; other lines' skins stay owned (roster preview). |
| Missing assessment data | Candidates v5 tier-S/goal fallbacks guarantee three cards; if profile itself lacks lifts (legacy minimal rows), BALANCED_ATHLETE fallbacks apply — never trapped [Tested: C-7]. Only genuinely absent inputs are asked for (the scan stays optional). |
| Inactive returning user | Same as "rating, no origin" — prompt re-arms daily; nothing expired. |
| High-level user | Tier E dominates; preserve-higher protects stages; Forge Level/xp untouched. |
| Purchased champion content (Gymerica/skins/palettes) | Never touched by any origin write path; Gymerica overlay stays equipable [decision recorded 046]. |

## 3. Mapping rules (all pre-documented, all already deployed or in 047)

- Earned stage ↔ new architecture: `user_paths.current_stage`
  preserve-higher upsert (deployed 039–046 behaviour, unchanged).
- Firstbound for existing users: their FIRST bind under any version writes
  `firstbound_origin` (047's COALESCE) — historically meaningful from the
  moment it exists; no retroactive fabrication of a value we never knew.
- Mastery: `path_xp` values carry as-is (they are the mastery).
- Bond: seeded at bind (0), like new users.
- migration_status: 'needs_assessment' → 'classified' on bind (deployed).

## 4. Reforge transfer rules (the seven required decisions)

| Question | Decision |
|---|---|
| Origin Mastery transfers? | NO — path_xp stays on its path (mastery is per-origin by definition); it is never reduced. |
| Champion Bond transfers? | NO — bond is per-champion by definition; old bond rows persist untouched. |
| Stage 1 auto-granted for the new origin? | YES — preserve-higher ≥1 on the new path's row. |
| Previous origin remains collected? | **NO — WIPED (migration 048, Tyson 2026-07-17):** "nobody should have any data on any character other than their origin." Binding (first or reforge) deletes every non-origin user_paths row and every non-origin-champion bond row. Reverses the 046 "keep progress, cannot render" rule and the original 047 "stays collected" rule below. Purchases (skins/palettes/Gymerica) are NOT progression data and are never touched; firstbound_origin is permanent history and is never touched. |
| Skill-tree selections reset? | N/A — the tree is derived, nothing is spendable yet; when user_skill_nodes ships, this doc must be revisited [OPEN]. |
| Cosmetics remain available? | YES — purchases are never touched; non-active-line skins stay owned. |
| Firstbound badge? | YES — `firstbound_origin` is permanent; surfacing it as a profile badge is UI-only and may ship later [OPEN, non-blocking]. |

## 5. Rollout

1. Apply migration 047 (additive; deployed surfaces unaffected).
2. Falsify on production (see ORIGIN_TEST_PLAN.md D/E series).
3. Ship client with `originOnboardingEnabled: true` (new users) and
   `candidateRevealEnabled: true` (existing users). Both flags can ship
   OFF-first if a slower stage is wanted; flipping requires a redeploy
   [CONFIRMED limitation — no remote config exists].
4. The 18 existing accounts need zero backfill SQL: their states already
   funnel into the reveal. `require_origin_reassessment_v3` remains the
   service-role tool if a future formula change warrants another global
   re-choice.
