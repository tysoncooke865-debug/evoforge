# Origin onboarding — implementation plan (2026-07-17)

Phases ship in order; each is verifiable alone. Invariants that bind every
phase: Forge Level never decreases · Evo Rating may move (ratchets guard
peak/starting) · Origin Mastery (path_xp) never decreases · Champion Bond
never decreases · Evolution Stage never decreases (preserve-higher
everywhere) · purchases never touched · every unlock auditable ·
no new client-authoritative reward paths · origin writes touch nothing
unrelated.

## Phase 0 — audit ✅ (2026-07-17, 8-agent workflow; findings folded into
these docs as [CONFIRMED] facts)

## Phase 1 — these docs ✅

## Phase 2 — domain layer (client/src/domain/origin/)

- `types.ts`: OriginId, RecommendationType, OriginReasonCode,
  CalibrationInput, OriginCandidate, CandidateResult,
  CANDIDATE_MODEL_VERSION = 5.
- `candidates.ts`: the pure reference engine (spec §3–5): tiering,
  affinities, resonant/destined/anomaly selection, normalisation.
- `reasons.ts`: reasonText — the ONLY source of recommendation copy.
- `first-mission.ts`: ORIGIN_SPLITS map + rotateScheduleToToday.
- `__tests__/origin-candidates.test.ts`: plan C-series.
- Golden fixtures exported for the Phase 3 SQL parity falsification.

## Phase 3 — persistence (migrations/047_origin_onboarding.sql)

Data model doc §1–7: profile columns + guard trigger (firstbound/reforge
write-once), user_paths monotonic trigger, user_champion_bond + trigger,
`origin_candidates_for(uuid)` + `origin_candidates()` (SQL port of the
engine), `assign_origin_path` v5, `claim_free_reforge`, `reforge_origin`,
grants. Applied via management API; falsified per plan B/R/E-series plus
the C-series golden replay before any client ships.

## Phase 4 — new-user onboarding (client)

- `onboarding.tsx`: DRIVE section (goal + battle style chips); insert
  writes primary_goal/battle_style/onboarding_flow_version 2; Act II step
  machine replaces the auto-redirect; steps per spec §3.
- New UI under `client/src/ui/origin/`: rating-reveal, candidate-cards,
  candidate-preview, binding-confirm, awakening — all reusing
  GlowCard/NeonButton/HeroStage/avatarArtV2/pixel tokens; reduced-motion
  static paths; safe-area via ScreenShell.
- `data/origin.ts`: useOriginCandidates, useBindOrigin (already_assigned →
  success semantics), analytics wiring.
- `data/analytics.ts`: track().
- `(main)/_layout.tsx`: the one gate clause.
- Flag: `ORIGIN_FLAGS.originOnboardingEnabled`.

## Phase 5 — existing-user introduction

- `origin-panel.tsx` candidate mode behind
  `ORIGIN_FLAGS.candidateRevealEnabled` (shared components from Phase 4).
- Nothing else changes: prompt + podium already route correctly; no
  backfill needed (migration doc §0).

## Phase 6 — free Reforge

- Server RPCs land in Phase 3 (they're in 047); this phase is the CLIENT:
  Forge-page reforge entry (visible once granted), reforge candidate flow
  reusing the Phase 4 components, keep = dismiss.
- Ships only after Phases 4–5 are verified stable.

## Phase 7 — verification

- Gates: tsc, lint, vitest, verify-motion.
- Playwright O-series with a throwaway account; screenshots.
- Adversarial review workflow (specialised reviewers: progression
  invariants, migration safety, mobile UI, product integrity, QA) over
  the full diff; findings verified then fixed.
- Docs + HANDOVER updated; commit/push per repo protocol ([architect]
  tag — migrations/ and data/ are protected paths).

## Rejected alternatives (recorded)

- Six-origin vocabulary with hybrid (removed from game; five slugs are
  load-bearing).
- Client-authoritative candidate generation (server RPC is authority).
- A separate onboarding_state table (profile row + origin_path null +
  flow_version derive every resume state — fewer writes, no drift).
- Blocking Act I persistence (per-keystroke server drafts) — the existing
  lose-on-close semantics are unchanged for Act I; Act II is where the
  investment lives and it is fully resumable.
- A second mission system for the "first mission" (derivation over real
  seeded rows is the house rule).
- Deferring origin until after workouts (the product principle this
  program exists to deliver).

## Unresolved [OPEN]

- Firstbound profile badge UI (data lands now, badge later).
- user_skill_nodes interaction with Reforge (blocked on a spendable tree
  existing at all).
- Remote-config kill switch (repo has none; compile-time flags only).
- Female art beyond the aesthetic line (silhouette fallbacks deployed).
