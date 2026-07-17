# Origin onboarding — handoff audit (2026-07-17)

Audit of the previous agent's (Claude's) work-in-progress, per the takeover
brief. Repository and Git history treated as the source of truth.

## Git state

- **Repo:** `C:/Users/tyson/Downloads/Previous_Code/evoforge` (the only git
  working copy on this machine; remote `origin` =
  `github.com/tysoncooke865-debug/evoforge`).
- **Branch:** `expo-rewrite` — the product branch (Streamlit on `main` is
  retired per HANDOVER.md).
- **Handoff commit:** `8334489` "Battle polish: gym-culture move names…" —
  identical to remote HEAD. Nothing committed beyond the remote.
- **Uncommitted (the entire WIP):**
  - `M  client/src/app/(main)/_layout.tsx` — adds an "EVOFORGE" wordmark to
    the loading gate (LCP/first-paint improvement). **Unrelated to the Origin
    program**; complete, compiles, covered by the green baseline below.
  - `?? client/src/domain/origin/types.ts` — the v5 candidate-model types.
  - `?? docs/` — the seven `ORIGIN_*.md` program docs.

## What Claude completed

- **Phase 0 (audit) and Phase 1 (docs) of ORIGIN_IMPLEMENTATION_PLAN.md — done
  and high quality.** The docs' `[CONFIRMED]` claims were re-verified against
  the code during this audit and held up (gate behaviour, classifier gates,
  schema through 046, migration numbering quirks 022-absent/037-duplicated,
  flag pattern, analytics rail).
- **`client/src/domain/origin/types.ts`** — matches ORIGIN_CALIBRATION_SPEC.md:
  five deployed slugs, model version 5, closed reason-code vocabulary,
  `CalibrationInput`, `OriginCandidate`, `CandidateResult` with
  `requiresChoice: true`. Compiles clean.

## What Claude left unfinished (everything else)

Per the plan's own phase list:

- **Phase 2 (domain):** only `types.ts` exists. Missing: `candidates.ts`
  (pure reference engine), `reasons.ts` (`reasonText`), `first-mission.ts`
  (`ORIGIN_SPLITS` + rotation), `__tests__/origin-candidates.test.ts`
  (C-series), golden fixtures.
- **Phase 3 (persistence):** `migrations/047_origin_onboarding.sql` does not
  exist. None of: profile columns (`primary_goal`, `battle_style`,
  `onboarding_flow_version`, `firstbound_origin`, `reforge_granted_at`,
  `reforge_used_at`), `user_champion_bond`, monotonic guards,
  `origin_candidates_for/uuid` + `origin_candidates()`, `assign_origin_path`
  v5 (advisory lock + candidate revalidation), `claim_free_reforge`,
  `reforge_origin`. Verified by grep: zero of these identifiers exist in
  `migrations/` or `client/src`.
- **Phase 4 (new-user onboarding):** no DRIVE section in `onboarding.tsx`,
  no Act II step machine, no `client/src/ui/origin/`, no
  `data/analytics.ts :: track`, no gate clause, no
  `ORIGIN_FLAGS.originOnboardingEnabled`.
- **Phase 5 (existing-user reveal):** `origin-panel.tsx` has no candidate
  mode; `ORIGIN_FLAGS.candidateRevealEnabled` does not exist.
- **Phase 6 (Reforge client):** not started (server side also missing).
- **Phase 7 (verification):** not started.

## Changed-file inventory

| File | State | Verdict |
|---|---|---|
| `docs/ORIGIN_ONBOARDING_SPEC.md` | new, complete | retain |
| `docs/ORIGIN_CALIBRATION_SPEC.md` | new, complete | retain |
| `docs/ORIGIN_DATA_MODEL.md` | new, complete | retain |
| `docs/EXISTING_USER_ORIGIN_MIGRATION.md` | new, complete | retain |
| `docs/ORIGIN_ANALYTICS.md` | new, complete | retain |
| `docs/ORIGIN_TEST_PLAN.md` | new, complete | retain |
| `docs/ORIGIN_IMPLEMENTATION_PLAN.md` | new, complete | retain |
| `client/src/domain/origin/types.ts` | new, 103 lines | retain, one comment repair (below) |
| `client/src/app/(main)/_layout.tsx` | modified (wordmark) | retain — unrelated but complete & green |

## Current execution paths (verified, file:line)

### Onboarding (today)
Sign-up (`(auth)/sign-up.tsx`) → session → `(main)/_layout.tsx:195`
`profile.data === null → /onboarding` → `onboarding.tsx` single-scroll form
(WHO/LIFTS/FUEL/SCAN?/TRAINING/GO PUBLIC) → FORGE CHARACTER
(`onboarding.tsx:165-230`): insert `profile` (the onboarded flag) →
best-effort public identity + plan/schedule seed →
`invalidateQueries(['profile'])` → `onboarding.tsx:95-102` auto-redirects to
`/` (or `/routine`) **the moment the profile row exists**. No review is
triggered, no rating shown, no origin involvement.

### Evo Rating (today)
First review fires silently from the shell
(`(main)/_layout.tsx:90-114` → `runDueEvoReview`, due because no
`evo_rating_current` row). Writes `evo_rating_snapshots` +
`evo_rating_current` (024 guards: starting write-once, peak ratchet).
A self-report-only first review yields rating ≈38 "Novice",
**overall confidence 15** (provisional). No reveal ceremony exists anywhere.
Note: onboarding's self-reported 1RMs and scan scores land on `profile` but
the review never reads them (no `physique_ratings` row is written by
onboarding; only `bodyfat_log` persists).

### Origin (today)
Post-onboarding only: `OriginScanPrompt` daily modal + Home blank-podium
button → Forge reveal (`origin-panel.tsx`) → `classify_evo_path` (v4, 046) →
`assign_origin_path` (046:153-196). **A day-one user cannot pass it**: the
classifier needs `evo_rating_current.overall_confidence >= 30` or a
`physique_assessments` scan row; a fresh onboarder has neither →
`no_assessment`/`insufficient_data`. `assign_origin_path` has **no advisory
lock** (double-tap can double-write audit rows) and validates the pick only
against the v4 choice set.

## Database changes already made by this program

None. Applied migrations stop at 046 (deployed before this program started).
`client/.env.sbtoken.local` (management API token) and `client/.env.local`
exist locally, so 047 can be applied via the house curl method when written.

## Tests already created by this program

None. Baseline suite is the pre-existing 778 vitest tests (49 files).

## Validation results (baseline, pre-edit)

- `npx tsc --noEmit` → exit 0.
- `npm test` (vitest) → 778/778 pass (49 files).
- `npx expo lint` → exit 0. `node scripts/verify-motion.mjs` → exit 0.
  `node scripts/verify-tokens.mjs` → exit 0.
- Production build (`expo export`) not run at baseline; will run after
  client changes land (moves break asset requires; export is the check).

## Compile or runtime errors

None in the WIP as found. Pre-existing hazards (not this program's bugs,
but they shape the implementation):

1. `forge()` has no re-entrancy guard beyond the button; double-submit can
   duplicate profile rows (`onboarding.tsx:165-230`).
2. If the final `invalidateQueries` throws, the button spins forever
   (`onboarding.tsx:228-229`).
3. `(main)/_layout` gate: a failed profile read (`isError`) falls through to
   the Tabs with no profile.
4. `useAssignOrigin` surfaces `already_assigned` as an error toast — retries
   in the new flow must treat it as success-shaped (`origin.ts:90-113`).
5. `runDueEvoReview` due-check discards read errors; a failed select looks
   like "first review". Non-transactional writes; racing runs double-write
   snapshots. New callers must be non-forced and tolerate `not_due`.

## Product-rule contradictions found

1. **The core one the program exists to fix:** Origin today is gated behind
   evidence a new user cannot have (confidence ≥30 or a scan row). The
   canonical flow (rating reveal → origin choice during onboarding) is
   impossible against 046's RPCs — Phase 3's v5 candidate model is not an
   optimisation, it is a hard requirement.
2. **Onboarding scan is discarded for rating/classification purposes** —
   `runAiPhysique` without `save:true` writes no `physique_ratings`, and the
   review never reads `profile.physique_score`. The v5 tier-S self-report
   path covers unscanned users, but a scanned onboarding user's scan should
   still land as a `physique_assessments` row (`scan_type 'onboarding'` is
   already a valid enum) or the scan buys the calibration nothing.
3. `types.ts` comments `currentStrengthMatch: 1..100`; the calibration spec
   §6 says `0..100`. Comment-only mismatch — repair in Phase 2.
4. `origin-panel.tsx:23` comment ("claiming never swaps the equipped
   champion") is stale since 042 (assign equips unconditionally). Cosmetic;
   fix when the panel gains candidate mode.
5. The task brief's "candidate preview or lightweight trial" — docs
   explicitly ship the lightweight preview and defer playable trials
   (ONBOARDING_SPEC §10). Recorded as a documented scope decision, not a
   contradiction.

## Security concerns

- `assign_origin_path` v4 lacks the advisory lock the shop RPCs
  (030/031/044) set the pattern for; 047 must add
  `pg_advisory_xact_lock(hashtext(auth.uid()::text))`.
- All new RPCs must be `security definer`, `set search_path = public`,
  revoke from public/anon, grant to `authenticated` only — house pattern.
- `user_champion_bond`: owner SELECT, zero client write policies (030/031
  pattern).
- `firstbound_origin` / `reforge_*_at`: BEFORE UPDATE write-once guard
  trigger, because profile is client-writable.
- Never use `current_user` to gate a definer trigger (the 030 lesson) — use
  a txn-local GUC or the advisory-lock pattern.
- Candidates are server-generated and binding re-validates server-side, so a
  tampered client cannot widen its own set (spec §1 — correct design; keep).
- Analytics must carry no measurements/lift numbers/display names; error
  props are categories only (ORIGIN_ANALYTICS.md — correct; enforce).

## Existing-user migration concerns

- The luckiest fact holds: production is 18 origin-less profiles with reveal
  machinery live; "migration" is an introduction flow, no backfill SQL.
- The gate clause MUST key on `onboarding_flow_version >= 2` so the 17
  legacy origin-less users are never trapped into /onboarding (E-1 test).
- `require_origin_reassessment_v3` (admin global reset) clears
  `origin_assignment_version`/`migration_status` — 047's reforge is a new,
  separate, per-user mechanism; do not conflate.
- Binding must preserve-higher on `user_paths.current_stage` (users hold
  earned stages 2–4) and never touch skins/palettes/character unlocks.

## Recommended completion sequence

Follow ORIGIN_IMPLEMENTATION_PLAN.md phases, in order, smallest safe
increments:

1. Phase 2: repair the types comment; build `candidates.ts`, `reasons.ts`,
   `first-mission.ts` + C-series vitest + golden fixtures.
2. Phase 3: write `047_origin_onboarding.sql`; apply via management API;
   falsify (B/R/E-series + golden replay of the C-series against SQL).
3. Phase 4: analytics emitter → gate clause → DRIVE section + Act II step
   machine → rating reveal → candidate cards/preview → confirm/bind →
   awakening → Home landing + first-mission seed.
4. Phase 5: origin-panel candidate mode behind `candidateRevealEnabled`.
5. Phase 6: Reforge client (only after 4–5 verified).
6. Phase 7: O-series Playwright tour, adversarial review, docs/HANDOVER,
   `[architect]` commit(s).

## Retain / repair / revert

- **Retain:** all seven docs; `types.ts`; the `_layout.tsx` wordmark change.
- **Repair:** `types.ts` `currentStrengthMatch` range comment (1..100 →
  0..100); stale comment in `origin-panel.tsx:23` when that file is next
  touched; onboarding scan → persist a `physique_assessments` row so the
  scan feeds calibration (contradiction 2).
- **Revert:** nothing. No conflicting or unsafe WIP exists.

---

## Completion log (the takeover, 2026-07-17)

- **Phase 2 ✅** (`6937da9`): `candidates.ts` + `reasons.ts` +
  `first-mission.ts` + 42 C-series/mission tests + 21 goldens; three
  mutations falsified red, restored. types comment repaired.
- **Phase 3 ✅** (`44641f5`): `migrations/047_origin_onboarding.sql` APPLIED
  to production. 21/21 goldens replay exactly against the SQL twin
  (`tools/replay_origin_goldens.py`). 32/32 adversarial B/R checks
  (`tools/falsify_origin_047.py`, throwaway account): atomic bind,
  idempotent retries, advisory lock, not_offered/invalid slug, write-once
  firstbound/reforge, monotonic clamps, reforge rules, cross-user RLS.
- **Phase 4 ✅** (`c75cb9c`): DRIVE section, Act II step machine, gate
  clause, analytics emitter, first-mission seed.
- **Phase 5+6 ✅** (`e9cb56d`): Forge-page candidate reveal for existing
  users behind `candidateRevealEnabled`; ReforgeCard. Stale origin-panel
  comment repaired.
- **Phase 7 (verification) ✅:** O-series Playwright tour
  (`tools/tour_origin_onboarding.py`) — final result **19/19**: signup →
  Act I (DRIVE) → rating reveal BEFORE candidates (O-2) → gate bounce
  (O-1) → 3 distinct cards, CONFIRM gated, recommended never auto-selected
  (O-3) → preview → reload resumes with the IDENTICAL candidate set (O-5)
  → non-recommended pick binds (O-4) → Stage 1 awakening → Home with
  champion, seeded PUSH mission, EVO core (O-6) → reduced-motion leg
  (O-7) → zero page errors → tour account deleted.
  The tour caught two REAL races, both fixed: the bind hook invalidating
  `['profile']` mid-ceremony (awakening yank) and onComplete navigating
  before the refetch (gate bounce back to /onboarding).
- **#418 hydration flake (documented, not gating):** Minified React error
  #418 fired at /sign-up in ~40% of full-tour runs. Not reproducible in
  isolation (4/4 clean probes of the identical sequence on the same build),
  not seen in 3 probes of the live deploy, and the program's diff touches
  nothing in the (auth) render tree. React recovers hydration mismatches
  by client-rendering; every functional check passed in every run.
  Re-probe after the next deploy; if it ever reproduces on live, treat as
  a root-layout hydration bug independent of this program.
- **Wordmark WIP — REVERTED after all:** the retained `_layout.tsx`
  loading-wordmark change from the interrupted session was reverted during
  #418 isolation (it was not the cause). It stays out: unverified WIP,
  unrelated to this program, its LCP claims untested. Re-propose it as its
  own change with measurements if wanted.
- **Deferred honestly:** persisting the onboarding SCAN as a
  `physique_assessments` row (contradiction 2 — the v5 tier-S fallbacks
  cover unscanned users; scanned users currently get no calibration benefit
  from their scan); Firstbound badge UI; O-8 (RPC-intercept retry path —
  the mutation-handler semantics are unit-covered, not browser-tested);
  playable combat trial (spec §10).
