# Origin test plan (2026-07-17)

Layers: **V** vitest (pure domain) · **F** SQL falsification against
production via the management API (the house method: forged JWT claims in
a rolled-back transaction where possible, staged smoke rows deleted after)
· **P** Playwright against the built web client · **G** existing guard
scripts (verify-motion, lint, tsc).

## C — Calibration (V, mirrored in F against the SQL engine)

- C-1 determinism: identical CalibrationInput (incl. version) → deep-equal
  result, 3 runs.
- C-2 exactly three DISTINCT candidates for: full-evidence user,
  self-report-only user, goal-only user, empty user.
- C-3 resonant reflects strengths: high-strength self-report → titan
  resonant with HIGH_RELATIVE_STRENGTH; conf-≥25 evidence pillar outranks
  contradictory self-report (tier E > tier S).
- C-4 destined reflects goals: each of the five primary_goal values maps
  to its origin; collision with resonant walks the adjacency row; missing
  goal → nutrition_phase fallback with PHASE_INFERRED_GOAL.
- C-5 anomaly distinct + plausible: secondary-pillar case; battle_style
  case per style; ladder fallback case; never equals resonant or destined.
- C-6 shredder auto-resonance: cutting + bf 24 male → shredder resonant
  with CUTTING_PHASE_HIGH_BF; bf 15 → not; bulking → not.
- C-7 missing/invalid inputs: empty profile → three cards, BALANCED_ATHLETE
  present, no throw; negative lifts / bf 90 / height 0 normalised to
  absent; cardio NEVER resonant without evidence.
- C-8 reason copy: every reason code has non-empty `reasonText`; candidate
  cards derive copy only from codes (component test by construction —
  the UI imports `reasonText`, no literals; enforced by review).
- C-9 recommended ∈ candidates; requires_choice always true; recommended
  is resonant iff tier E backed it, else destined.

## B — Binding (F)

- B-1 bind succeeds once for a staged originless smoke account; profile,
  user_paths, bond, firstbound, evo_assessments, audit row all present.
- B-2 repeat/double-tap: second call (same txn pattern, forged JWT) →
  `already_assigned`; row counts unchanged (stage-1 unlock exactly once,
  bond row exactly once, ONE evo_assessments v5 row).
- B-3 two-device: two rapid sequential calls under the advisory lock —
  loser gets already_assigned, exactly one origin.
- B-4 out-of-set origin → not_offered; invalid slug → error, no writes.
- B-5 firstbound permanence: after bind, direct UPDATE attempt on
  firstbound_origin (as owner via PostgREST-shaped SQL) is reverted by the
  guard trigger; reforge leaves it unchanged.
- B-6 monotonic guards: UPDATE lowering path_xp / current_stage / bond_xp
  is clamped or rejected by triggers.
- B-7 offline retry semantics: client treats already_assigned as success
  (V test on the mutation handler).

## O — Onboarding (P, new throwaway account; deleted after via admin API)

- O-1 cannot reach Home originless: after FORGE CHARACTER the app stays in
  Act II; deep-linking `/` redirects back to /onboarding.
- O-2 rating reveal appears before candidates; shows rating + 4 pillars.
- O-3 three cards render, all viewable; recommended chip present but NOT
  auto-selected (CONFIRM disabled until a tap).
- O-4 selecting the NON-recommended candidate binds it (free choice).
- O-5 kill/resume: reload mid-Act-II resumes at candidates with identical
  cards.
- O-6 Home after ceremony: podium shows the chosen origin champion,
  mission card shows a real workout (rotated seed), rating visible.
- O-7 reduced motion: with emulated `prefers-reduced-motion`, the
  ceremony completes statically (G: verify-motion stays green).
- O-8 binding failure path: intercept the RPC → error state with RETRY;
  retry succeeds.

## E — Existing users (F + P)

- E-1 an existing account (no onboarding_flow_version) is NEVER redirected
  to /onboarding; prompt/reveal surfaces still work.
- E-2 flag on: Forge reveal renders three candidate cards from live data
  (smoke account staged with a scan); flag off: v4 choice reveal renders.
- E-3 earned stages/purchases untouched by bind (row-level before/after
  diff on user_paths + user_skin_unlocks).
- E-4 missing-data account gets three fallback cards, not a dead end.

## R — Reforge (F)

- R-1 claim before 3 post-bind workout days → not_eligible (days counted
  strictly after origin_assigned_at; pre-bind workouts don't count).
- R-2 3 staged distinct valid-set days → grant ok; second claim →
  already_granted (write-once trigger holds even vs direct UPDATE).
- R-3 reforge to a candidate origin: origin swaps, firstbound unchanged,
  old path row keeps stage/xp/unlocked, new path stage-1 preserve-higher,
  bond row added, used_at set; second reforge → already_used.
- R-4 reforge to same origin → same_origin, credit NOT consumed.
- R-5 reforge cannot duplicate stage-1 rewards (row counts).

## G — Gates (every commit)

tsc --noEmit · expo lint · vitest full suite · node scripts/verify-motion.mjs ·
verify-tokens (untouched but runs in CI anyway).

Every NEW guard/test is falsified once (break it, watch red, restore)
per the house doctrine; the falsification is noted in the test file or
HANDOVER.
