# HANDOFF.md — continuing EvoForge (Expo client + Battle Arena era)

> For a future Claude session. Read this, then `client/CLAUDE.md`, then
> `IMPROVEMENT_PLAN.md` (the live work order — section H is the checklist),
> then `BATTLE_ARENA_DESIGN.md` for arena internals.
> Rewritten 2026-07-12 (supersedes 2026-07-11); sprite/tap saga appended same day.

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
- **IMPROVEMENT_PLAN H16–H17 DONE — SECTION H COMPLETE (17/17).**
  #13 privacy: PROFILE PRIVACY card (same public_profile row as Rank's
  opt-in; leaderboard exclusion falsified both directions). The
  falsification exposed and fixed a REAL regression: **migration 014** —
  005's leaderboard required ledger==derived exactly, so battle XP had
  silently banned every battle player (the board read EMPTY; Tyson and
  Jesse are back on it). The integrity check now reconciles only client-
  mintable kinds (set/cardio); server-granted kinds are legitimate
  surplus. Home's drift warning got the same battle-aware rule
  (useServerGrantedXp). Sweep: heavy avatar PNGs quantized 12.2MB→1.5MB
  (visually identical, screenshot-verified); sign-out cache audit clean
  (all new state is React Query under the global clear; no new Zustand
  stores). Note ai-scan flows hold photos in memory until CONFIRM.

## Database / functions

- Migrations applied through **010** (all via the management API `database/query`
  endpoint — see gotchas). 009 = battle tables (falsified checklist in-file);
  010 cancel · 011 conditions · 012 schedule+streak fn · 013 coin ledger · 014 leaderboard battle-XP fix. Next free number: **015**.
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

## Sprite companion (2026-07-12, hard-won — read before touching)

Tyson's Cyber Athlete sheets LV.1–LV.4 (sources in `~/Downloads/
aesthetic_avatar_spritesheet_l{1-4}.png`) are sliced into per-stage frame
sets + CSS strips in `client/src/assets/avatars/sprites/` (`lv{stage}_
{anim}_{n}.png` + `lv{stage}_{anim}_strip.png`; uniform 4 idle / 9 run /
6 punch / 3 victory). Slicer: scratchpad `slice_stage_sheets.py` (auto
row detection, label-zone trim, alpha-density segmentation, connected-
component dust removal, shared baselines, torso-anchored run frames,
label-fragment post-pass); component generator: `gen_sprite_component.py`
regenerates `ui/sprite-avatar.tsx`'s require tables. Jesse's standalone
`sprite_test/` at the repo root is a browser mini-game for eyeballing
sheets — nothing imports it.

**The COIN SPRITE (2026-07-12):** Tyson's EvoForge emblem coin renders via
`ui/coin-icon.tsx` (`assets/coin.png`, trimmed+256px from his 1024 original)
in every coin placement: Home HUD chip (18px), Vault header (40px) + each
history row (16px), More-page Coins row (22px). One component, one require.

**FEMALE SPRITES (2026-07-12):** the full female Cyber Athlete set is live.
Front poses `aesthetic_front_female_stage_{1-4}.png` render as the female
aesthetic line's REAL art in avatar-art.ts (hasArt true; female shredder +
aesthetic-donor silhouettes use the female outline). Animation frames +
strips `lv{n}f_{anim}_*` (same uniform 4/9/6/3 counts) sit beside the male
set; sprite-avatar.tsx selects tables by sex (SpriteCompanion reads it from
useAvatarData). Slicer: scratchpad slice_female.py (adds a below-figure
label guard the male cropper didn't need). SMOKE-BRAVO's profile is now
PERMANENTLY sex='female' — tour female paths with it; SMOKE-ALPHA stays
male. Sources: ~/Downloads/'sprite sheet* l{1-4} f*.png' (front + anims).

**The MAIN AVATAR (2026-07-12) is the same character:** the aesthetic
branch's stage art in `ui/avatar-images.ts` is the FRONT pose cropped from
each sheet (`aesthetic_front_stage_{1-4}.png`, white-keyed to transparent;
crop script: scratchpad `crop_front.py`, sources `~/Downloads/level {n}
sprite aesthetic.png`). The old `aesthetic_stage_{1-4}.png` stay on disk
unreferenced (Streamlit-parity copies; Metro doesn't bundle them).
mass/hybrid/shredder art unchanged.

`SpriteCompanion` derives the athlete's CURRENT stage itself (shredder →
shredderStage(bfMid), else getBranchStage, clamped 1–4) so the sprite
matures with the character. Placements: Home (idle, HUD chips row),
Today header (idle → victory on completion), Log HEADER top-right (run;
punch when Boxing — cardio type state lifted to LogScreen for this),
AI header (idle), Arena hub (punch). REMOVAL:
`SPRITE_COMPANION_ENABLED = false` in `ui/sprite-avatar.tsx` — one flag,
every placement vanishes cleanly.

**THE RENDERING CONTRACT (three live bugs paid for it):**
1. Never swap one Image's `source` per frame — async reload blanks the
   sprite between frames on web (flicker).
2. Never drive frames with JS timers + React state — 14 re-renders/sec
   broke FIRST-TAP presses on iOS phones app-wide.
3. Reanimated worklets are NOT a fix on web — a browser has no separate
   UI thread; the same tap breakage returned.
   → WEB uses pure CSS `steps()` over the strip (compositor-only, zero
   JS per frame). NATIVE uses the Reanimated clock over stacked frames.
4. `Image.resolveAssetSource` does not exist on react-native-web — use
   expo-asset's `Asset.fromModule(mod).uri`.
5. Run frames must keep the SHEET's baseline (bottom-anchoring grounds
   the airborne stride) and be torso-anchored (bbox-centering makes the
   body wobble as limbs extend).
6. The strip sweep is `steps(n, jump-none)` for n frames — jump-none
   holds BOTH endpoints, so n treads land at k/(n-1), exactly the tile
   grid. `steps(n-1, ...)` puts treads BETWEEN tiles: two half-frames
   with a marching seam that reads as the strip scrolling sideways
   (live bug, fixed 2026-07-12; falsify by sampling
   getComputedStyle().backgroundPositionX — only k/(n-1)*100% values
   may appear).

## Mobile tap gotcha (2026-07-12, cost a live bug)
Expo's default web shell ships a viewport WITHOUT maximum-scale, leaving
iOS double-tap-to-zoom armed — every first tap gets held, so all buttons
need a double tap. `src/app/+html.tsx` pins the viewport
(maximum-scale=1, user-scalable=no, viewport-fit=cover) and sets
touch-action: manipulation. NEVER delete that file; if taps break again
on device, check the served viewport meta first, then look for anything
re-rendering per animation frame (rendering contract above).

## Arena mini games (design §16; D5–D9 answered "all recommended")
**MG1 VOLUME DUEL SHIPPED (2026-07-12):** migration 015 applied to prod
(format/kind constraint widening only — the 009 volume guard needed ZERO
changes, it is round-kind agnostic). Engine v3 (scoreVolumeDuel /
scoreHeadsOrTails / totalRoundsFor; points = effective kg, no stat
multiplier). battle-invite takes format; battle-ready opens a 75-min
'volume_duel' round; battle-settle scores it (window-over only, no early
finish) and finalizes single-round formats. Client: hub MINI GAMES section
(arena-create-duel), VolumeDuelRound = Today-twin via the SHARED
ui/exercise-logger ExerciseCard (tint + onLogged seams; Today imports from
there now), leader-relative dual bars. Sets are REAL Today sets (streak/
stats/XP bank; duel banks a set AS FIRST LOGGED — edits can't inflate).
Two-account prod tour: tour_duel.py (500 vs 300 effective kg verified,
winner correct, smoke match cleaned).
**MG2 HEADS OR TAILS SHIPPED (2026-07-12):** engine v4 adds PICK_GROUPS
(six catalog-derived groups — the allowlist battle-pick validates
against). battle-ready rolls FLIP 1 (live crypto RNG, seat 1 = heads);
NEW battle-pick advances the state machine (awaiting_muscle →
awaiting_ex_p1 → awaiting_ex_p2 → live), rolls flips 2/3 as their steps
open (no spoilers), CAS-guards on spec->>state, writes server-only
'pick' events, resets the window per step (5 min picks, 30 min live) and
stamps spec.liveAt — settle counts ONLY volume with server_ts >= liveAt
on YOUR assigned exercise. Stalled picker: after the deadline EITHER
player claims a random legal pick ({auto:true}). Client: CoinFlip
(ui/coin-flip.tsx — Tyson's gold coin, strip spin via the sprite
contract, static face on verdict), pick ceremony + chips, locked
BattleLogger (exercises prop), gold skin; ScoreCard shows EFFECTIVE KG
for duels (no /1200). Prod tour: tour_hot.py — three flips, picks, live,
400 vs 250 on Barbell Back Squat, verdict + assigned recorded, cleaned.
GOTCHA: ActivePhase already renders AbandonControl — round components
must NOT add their own (double control shipped briefly in the tour).

**NUMBER ENTRY (2026-07-12, Tyson):** ui/number-field.tsx replaces raw
TextInputs for weight/reps (Today set rows + duel twin + battle logger).
Weight: −/+ steppers (2.5 kg, hold-to-repeat) + tap-value → in-app KEYPAD
on native (showSoftInputOnFocus=false — the iOS system keyboard never
appears). Reps: keypad-only (steppers were traded for row width — double
steppers clipped the LOG button at 390px). WEB stays typeable: tours
.fill() the same testIDs; steppers add `-inc`/`-dec` suffixed testIDs.
KeyPad must stay conditionally MOUNTED (remount per open seeds the draft).
Keypad is native-only — verify on a device, web tours can't reach it.

## Sex calibration (2026-07-12, Tyson-requested)
Female athletes no longer grade against male standards. `SexCalibration`
in avatar-stats-calc.ts parameterises the pinned algorithm's CONSTANTS
only — default = male values verbatim, so all 3,323 goldens run unchanged;
`use-avatar-data` passes FEMALE_CALIBRATION when profile.sex = 'female'.
Female anchors ~0.65–0.72× male; leanness 100 from 16% bf; bodyweight
window 50–75 kg; frames 72/64/58. PARITY.md records the deviation;
sex-calibration.test.ts pins male-path identity + a positive control.

## Autonomous bug/perf sweep (2026-07-12, three review agents + falsification)

Fixed, all verified against the export (details in the commit):
1. Today's ExerciseCard is keyed `day:exercise` — ROUTINE reuses exercise
   names across days and SetRow seeds typed state once on mount, so a
   same-key day switch kept the old day's numbers AND saved them under the
   new day (falsified in-browser: type 99 on Push 1 → switch → empty).
2. useSaveSet: an ABSENT workout_log cache now falls back to a fresh read
   (fetchWorkoutLog) — deciding against [] classified an existing set as
   new: duplicate row + double XP grant on cold-cache saves.
3. useLogMeasurements invalidated ['measurements'] but the reader key is
   ['measurements_latest'] — tape readings never refreshed on screen.
4. bodyfat latest/earliest now share ONE query (['bodyfat_series'] +
   select) — was two byte-identical fetches per avatar screen, and the
   first-ever reading left the earliest (Shredder entry) stale because
   nothing invalidated ['bodyfat_first']. ai.tsx invalidation updated.
5. battle-settle (server, REDEPLOYED): losing the finalize CAS now re-reads
   status and returns already-settled instead of a false 409 "cancelled" —
   both athletes tapping the final reveal together hit this routinely.
6. Round-3 capture: `capturing` guard covers the camera window before
   judge.isPending (double-tap burned BOTH attempts — two sha256s, nothing
   dedupes); camera-pipeline throws now toast instead of vanishing.
7. "Still open" settle 409 (client clock ahead) toasts an info nudge, not
   SETTLE FAILED. useBattleMediaUrl refetches at 240s so signed URLs
   (300s TTL) self-renew on long-mounted reveals. postBattleVolume takes
   round.round_no instead of hardcoded 1. Ledger-0 conflation fixed in
   achievement-sweep + coins (0 is a value; null is a failure).
Lint is ZERO problems (was 12 warnings). Deliberately NOT done: pausing
ambient loops on unfocused tabs and virtualising coin history — regression
risk over speculative wins; revisit only with evidence.

## UI tooling + PWA (2026-07-12)
Installed on Tyson's machine (npm -g): **pngquant** (asset quantization —
drove the 12.2MB→7.1MB asset diet in `e7ec10c`; when re-running, keep the
side-by-side git-original-vs-compressed visual falsification at display
size), **lighthouse** (audit the live app), **react-devtools**, **eas-cli**
(future native build). The app is an **installable PWA**: client/public/
carries manifest.webmanifest + maskable 192/512 emblem icons +
apple-touch-icon (generated from Tyson's EvoForge emblem, dark #04070e);
+html.tsx links them — its tap-latency viewport contract is untouched.
public/ rides `expo export` into dist automatically.

## PHASE 2 UI/UX batch — EXECUTED (2026-07-13, all 8 commits + extras)
PHASE_2_PLAN.md executed end-to-end: C1 spring tune (zeta 0.89); C2
set-logging polish (schemeSentence in the UI layer + test, purple active
row — owner-approved neon exception, battles follow tint — LAST label
gone, structural column headers, 64px tabular-nums fields, fused stepper
pills, dim-until-touched prefill); C3 cardio moved to Today behind a
LIFT|CARDIO keep-mounted toggle (ui/cardio-logger.tsx, testIDs
byte-identical) and Log became STATS (route name unchanged); C4
scroll-to-top on every tab press (ui/scroll-registry + ScreenShell
useFocusEffect; FINDING: expo-router 57 standard-navigation DOES support
Tabs screenListeners.tabPress — no fallback needed); C5 Home leaderboard
teaser (measured-height collapse, body mounts on first open,
LeaderboardRowView shared with Rank); C6 BRANCH PATHS removed from Avatar
(branches-v2 domain untouched — skill-tree still consumes it); C7
onboarding Section 5 GO PUBLIC (never gates the redirect; savePublic
failure swallowed); C8 join-code uppercase-as-you-type. EXTRAS shipped
mid-batch on Tyson's live requests: the PODIUM under the Home/Avatar
character (hero-stage.tsx renders assets/podium.png — procedurally
rendered to his reference's design language, the reference file never
reached disk; swap the PNG to upgrade), and the PWA safe-area fix
(html/body/#root painted #04070e — the installed app's white bottom
strip). Sprite placement change: Today header sprite follows the mode
(cardioAnim(type) when CARDIO is active); STATS keeps an idle companion.

## TRANSFORM PROGRAM (2026-07-13 — READ EVOFORGE_TRANSFORM.md)
Tyson commissioned a full product transform (brief in the 2026-07-13
session; EVOFORGE_TRANSFORM.md at repo root is the living audit + phase
tracker — UPDATE IT WITH EACH PHASE). Executed so far, each its own
commit, all CI-green:
- **P1** `016d40d`: FIVE-TAB NAV (Home/Train/Progress/Forge/Arena; today
  =Train, avatar=Forge, log/ai/more hidden). THE COMPANION SPRITE IS THE
  PROFILE MENU (ui/companion-menu.tsx, testID profile-menu → /more =
  "MENU"). React Query PERSISTED to AsyncStorage (key
  evoforge-query-cache-v1, purged on sign-out in auth-context — cache
  hygiene invariant).
- **P2** `087d0d6`: OFFLINE-FIRST SET LOGGING — data/set-queue.ts queues
  durable inserts with CLIENT-MINTED UUID row ids (PK = idempotency;
  retries can't duplicate), optimistic cache append (invalidations
  SKIPPED for queued verdicts — refetch would drop the row), XP grant on
  flush (unique index dedupes), flush on boot/online/enqueue/30s.
  useSaveSet takes {durable}; Today passes durable, BATTLES MUST NOT
  (battle_events need server-confirmed rows). ui/rest-timer.tsx stores
  ONLY restEndAt (absolute) — timer survives everything by construction;
  starts on each confirmed new set; RestTimerBar lives in Train's LIFT
  panel. FALSIFIED: offline-logged set synced exactly once (SQL).
- **P3 batch** `6848ab6`: ui/tutorial-overlay.tsx (once-per-device flag
  evoforge-tutorial-done-v1); domain/exercise-library.ts (100+ tagged
  exercises, LIBRARY_SECTIONS, SPLITS, substitutesFor); (main)/routine.tsx
  builder writing custom_workout_plan (SAME storage as the AI plan —
  Train source toggle now says MY PLAN and custom plans drive their OWN
  day chips; scheduled-day default only applies to built-in days);
  ⇄ substitution on Train cards (session-level subs map in today.tsx,
  logged sets record the REAL exercise).
- **P3 hotfix** `9a2e4bc`: CI (cold cache) had REFUSED 6848ab6 —
  react-hooks/set-state-in-effect on Today's day-clamp effect + duplicate
  react-native imports — so P3 never deployed (gotcha 14 strikes again;
  the live-bundle marker-string check found it). Day now clamps at
  RENDER (dayChoice raw, day effective).
- **P4** MISSION COMPLETE ceremony: summary-sheet.tsx is a phased
  sequence — summary → PR reveal (only when a PR landed; today.tsx
  captures WHICH lifts via prNamesRef) → LEVEL path → evolution progress
  (per-requirement bars) → NEXT MISSION confirm from the persisted
  schedule (domain nextScheduledSession(), effective-dated, skips Rest,
  14-day horizon; 5 vitest cases). SKIP keeps testID summary-close on
  every non-final phase (old tours still pass); advance=summary-next,
  final=summary-done. Verified: 3-phase and 5-phase walks in-browser
  (PR + schedule seeded for BRAVO, then cleaned server-side).
- **P5** Home = the return loop: ui/quest-card.tsx (TODAY'S QUEST, four
  states — no-schedule / rest / pending / completed — + the weekly
  contract's seven Monday-start pips and done/target) sits directly under
  identity. domain weeklyContract() is effective-dated and counts ONLY
  scheduled sessions (a rest-day set is a bonus pip, never quota). The
  Home streak chip goes SCHEDULE-AWARE when a schedule exists (rest days
  bridge; label FORGE STREAK) and falls back to the daily streak + DAY
  STREAK otherwise. All four states falsified in-browser.
NEXT PHASES (per EVOFORGE_TRANSFORM.md): P6 Forge/Progress
restructure, P7 Arena active-battle-first, P8 polish/Lighthouse
CI/Sentry. Perf targets + release gates are in the brief inside
EVOFORGE_TRANSFORM.md §audit.

## The loop (unchanged)

Per change-set: `npx tsc --noEmit && npx vitest run src && npx expo lint`
(cold cache) `&& npx expo export -p web --clear`, Playwright tour, READ the
screenshots, commit with reasoning (+ tick IMPROVEMENT_PLAN.md's checklist
and update the affected doc in the same commit), `git pull --rebase` (the
branch is active), push, verify CI + live marker. Python-side edits also
need the eleven verify tools and `[architect]` on protected paths
(`migrations/` included).
