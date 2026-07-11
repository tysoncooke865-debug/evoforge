# HANDOFF.md — continuing EvoForge (Expo client + Battle Arena era)

> For a future Claude session. Read this, then `client/CLAUDE.md`, then
> `IMPROVEMENT_PLAN.md` (the live work order — section H is the checklist),
> then `BATTLE_ARENA_DESIGN.md` for arena internals.
> Rewritten 2026-07-12 mid-autonomous-run; supersedes the 2026-07-11 handoff.

## What this is

EvoForge is a fitness RPG: real training data (Supabase) powers a levelling,
evolving character, and now 1v1 fitness battles. Two apps share one
production database:

- **Streamlit app** (`app.py`, Python) — LIVE at https://evoforge.streamlit.app
  from `main`. Two real users. Do not break it. Its `domain/` is still the
  pinned contract (goldens via `tools/gen_fixtures.py`).
- **Expo app** (`client/`) — branch **`expo-rewrite`**, auto-deploys to
  **https://expo-rewrite.evoforge.pages.dev** (~5 min per push; check the
  served bundle for a marker string before calling it live).

## State (2026-07-12, all deployed and green unless noted)

Everything in the 2026-07-11 handoff still stands (18 screens, 4,600+
goldens, six classes, onboarding v2, ai-physique/ai-bodyfat functions).
Since then:

- **Strength standards curve** (`strength_score_from_ratios`, both sides,
  golden-pinned): per-lift anchors novice 25 → elite 100; deadlift-aware
  (40/30/30 blend, two-lift 55/45 fallback). Tyson dropped 77 → 47 honestly.
- **BATTLE ARENA P0–P2 live**: friendly BLITZ battles, three rounds
  (strength object-lift / cardio energy units / camera-only AI physique
  judging), server-authoritative settle that advances rounds, ledger XP via
  the 006-pattern `kind='battle'`, realtime + 15 s poll. Real users have
  played. Engine is ONE file `contracts/battle/engine.ts`, byte-copied to
  client + functions, pinned by `client/scripts/verify-battle-engine.mjs`
  (in CI). Premium hub UI, cinematic FACE OFF scene (`ui/face-off.tsx`) with
  two official back-view battle sprites in `client/src/assets/avatars/`.
- **Avatar tab = EVOLUTION | SKILL TREE submenu** (`?view=` param). Skill
  tree (`ui/skill-tree.tsx`) shows five attribute paths on real data via the
  real branch engine. The old Avatar page is `EvolutionView`, unchanged.
- **Profile grew editors**: BODY STATS (bodyweight → appends to log; height
  → profile update; lifts read-only derived) and TRAINING NUMBERS (deadlift
  e1RM + nutrition phase; base_level immutable).
- **IMPROVEMENT_PLAN.md H1–H8 DONE** (of 17): #4 title wrapping (+ catalog
  vitest), #7 arena nav replace, #3 Log CARDIO|STATS tabs (SegmentedTabs
  extracted to `ui/segmented-tabs.tsx`), #1 `use-current-stats.ts` seam,
  #2 last-session prefill on Today, migration 010, #5 battle cancel
  (battle-cancel fn + CAS-hardened settle/physique + confirm overlay +
  AbandonedPhase + CANCELLED badge), #8 opponent photo reveal (signed URLs,
  both-final gate in `data/battle/physique-reveal.ts`, DuelPanel).
- **IMPROVEMENT_PLAN H9–H11 DONE**: migration 011 (physique_ratings.conditions
  jsonb); #6 lighting/pump estimate→confirm on BOTH AI scans (ScanFrame
  'confirm' state, corrected re-runs get their own cache key, confirmed
  conditions land in physique_ratings.conditions / bodyfat_log.notes —
  falsified live end-to-end); #10 ai-plan edge function (ported prompt,
  server-validated six-PPPPLA-day shape, 422 on malformed) + FORGE MY
  ROUTINE preview/accept/discard on the AI tab + BUILT-IN|AI PLAN source
  toggle on Today (same day names, same logging path).
- **IMPROVEMENT_PLAN H12–H15 DONE**: migrations 012 (workout_schedule,
  effective-dated, no backdating; scheduled_streak() SQL mirror — execute
  revoked from authenticated, called only by the coin guard) and 013
  (coin_events ledger: append-only, guard recomputes every amount,
  falsified per-kind against production). #11 streak: pure
  domain/scheduled-streak.ts (vitest matrix; SQL mirror verified against
  the same real data), Schedule + Streak screens, month calendar, Today
  defaults to the scheduled day. #12 coins: claims wired (workout complete
  25 / PR 50 / milestones 10×M / starting bonus 100), Home coin pill +
  streak chip link, Coins history screen, null-never-0 total. DATES: the
  streak deliberately uses the app-wide UTC toISOString convention (matches
  workout_log.date); the guard tolerates ±1 day.
  **NEXT UNCHECKED: H16** (#13 privacy toggle) then H17 sweep. Note
  ai-scan flows hold photos in memory until CONFIRM completes.

## Database / functions

- Migrations applied through **010** (all via the management API `database/query`
  endpoint — see gotchas). 009 = battle tables (falsified checklist in-file);
  010 cancel · 011 conditions · 012 schedule+streak fn · 013 coin ledger. Next free number: **014**.
- Edge functions deployed: ai-physique, ai-bodyfat, battle-invite, battle-join,
  battle-ready, battle-settle (round advancer + final), battle-physique,
  battle-cancel. Deploy: `supabase functions deploy <names> --project-ref
  rysbpwpvnqbngqncrfaa` with `SUPABASE_ACCESS_TOKEN` from
  `client/.env.sbtoken.local`, run from the REPO ROOT.
- Private storage bucket `battle-media` (participant-read via
  `is_battle_participant`, service-write, cleaned on cancel).

## Invariants added since the last handoff

- Battle scoring: the client only previews; every point comes from the
  engine copy inside battle-settle. Never break byte-parity (CI guard).
- Battle events must reference owned in-window log rows (009 trigger).
- Character stats influence battles through exactly one gate,
  `characterMultiplier`, hard-capped at +15%.
- Cancelled battles are XP-inert; settle vs cancel is a CAS race with one
  truthful winner.
- Round-3 photos: stored ONLY for battles, revealed ONLY when both sides'
  verdicts are final (`physique-reveal.ts` mirrors battle-settle's isFinal —
  keep them in lockstep). Solo Oracle photos stay never-persisted.
- `useCurrentStats()` is raw-nullable by contract; never pre-default its
  values before the pinned avatar calc (parity suite is the tripwire).
- `catalogs.ts` has NO overhead press — the skill tree's Military Press node
  is deliberately "Not tracked yet".

## New operational gotchas (join the 2026-07-11 list, all still valid)

13. Windows Python can't see Git Bash's `/tmp`; write scratch JSON to the
    session scratchpad path. curl `-d @file` needs that real path.
14. Local ESLint caches can HIDE compiler-lint errors; CI runs cold. Before
    trusting lint: `rm -rf .eslintcache node_modules/.cache`.
15. Tours must handle the Arena hub's open-invite state (code card instead
    of CREATE) and the JOIN tab (`arena-tab-1`) — scripts predating the hub
    redesign fail on both.
16. `page.get_by_test_id("battle-code")` resolves twice when the hub sits
    under the battle screen in the stack — use `.first`.
17. Smoke accounts: smoke-test-claude@evoforge.internal (SMOKE-ALPHA, pw in
    scratchpad ui_tour.py) and smoke-test-claude-2@evoforge.internal
    (SMOKE-BRAVO, `SmokeTest-2026-07!y`). Two-account battle tour:
    scratchpad `tour_battle3.py`. Clean smoke battles after tours (SQL
    delete via management API — see git history for the query).
18. `todayIso` app-wide is `toISOString().slice(0,10)` = UTC date. The
    planned streak calendar (#11) specifies LOCAL dates — reconcile when
    building it (a UTC "today" can differ from the athlete's wall clock).

## The loop (unchanged)

Per change-set: `npx tsc --noEmit && npx vitest run src && npx expo lint`
(cold cache) `&& npx expo export -p web --clear`, Playwright tour, READ the
screenshots, commit with reasoning (+ tick IMPROVEMENT_PLAN.md's checklist
and update the affected doc in the same commit), `git pull --rebase` (the
branch is active), push, verify CI + live marker. Python-side edits also
need the eleven verify tools and `[architect]` on protected paths
(`migrations/` included).
