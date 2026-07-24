# HANDOVER — start here

> **You are picking up EvoForge. Read this file, then `client/CLAUDE.md`. Read
> nothing else until you need it.**
>
> `HANDOFF.md` is the layered history (long, chronological, still accurate). This
> file is the CURRENT state, the rules that cost real bugs, and how to work here.
> Last updated 2026-07-16 (the Home redesign + optimisation session).

---

## 1. What this is

A fitness RPG: real training data (Supabase) drives a levelling, evolving
character, plus 1v1 battles. **One app now:**

| | |
|---|---|
| **Expo client** (`client/`) | THE product. Branch **`expo-rewrite`**, auto-deploys to https://expo-rewrite.evoforge.pages.dev (~5 min per push). Everything below is about this. |
| **Streamlit** (`app.py`, Python) | **RETIRED (Tyson, 2026-07-16)** — no support, no optimising around it. The code stays on `main` as reference; its `domain/` goldens remain the pinned correctness contract for `client/src/domain/`. The pre-push hook now skips the Python suite for client/docs-only pushes. |

Owner: Tyson. He works through other Claude sessions too — **always
`git pull --rebase` before pushing**, and expect new plan docs to appear.

---

## 2. State (all shipped, CI-green, deployed)

- **SWAP TODAY'S DAY (2026-07-24, no migration, Tyson-reported): trade a
  split day for a different one from the same plan** — "meant to be Push 1,
  want Pull 1 instead." Surfaced as a new section inside the existing CHANGE
  WORKOUT modal (`today.tsx`, `swap-day-<name>` chips: every day in the
  currently-active source's list, minus whatever's already showing today),
  offering EVERY other day the CURRENT source knows (MY PLAN / AI PLAN /
  BUILT-IN, whichever the athlete is on) — picking one asks the same
  SAVE/JUST-TODAY question `workout.tsx` already asks for exercise edits:
  **JUST TODAY** writes `daySwap` (new field) into `session-store.ts`, the
  SAME self-expiring-at-midnight AsyncStorage store `adhoc` already lives in
  — no network call, and `dayInSource` checks it BEFORE the schedule, so it
  outranks everything and vanishes on its own tomorrow. **SAVE TO MY
  SCHEDULE** goes through the existing `useSaveSchedule`, replacing just
  today's weekday's PRIMARY in the latest row's `plan` (extras riding along
  untouched) — same shape schedule.tsx's own SAVE writes, effective today
  onward. Falsified live against ALPHA: the week-bar testID for today
  flipped from `weekbar-2026-07-24` (Rest) to
  `weekbar-2026-07-24-Pull 1 - Back Thickness` after JUST TODAY — no DB
  writes, confirmed via network trace. **Found, not fixed (pre-existing, out
  of scope): opening ANY Modal on Train — even the pre-existing CHANGE
  WORKOUT source picker, no swap involved — shifts the daily hero
  carousel's virtualized FlatList window left, dropping today's card out of
  the DOM until the athlete manually scrolls back. Reproduced with zero code
  changes; worth its own investigation (`ui/train/daily-workout-carousel.tsx`
  + RN-Web's `Modal`), not chased here.** Files: `today.tsx`,
  `state/session-store.ts`. Gates: tsc, 1,634 tests, cold lint (fixed two
  `react/no-unescaped-entities` on the new copy), tokens/motion/battle-engine,
  export, the live falsification above.
- **TWO BUG FIXES: the plan-source dropdown going inert, and false "COINS NOT
  BANKED" errors on PRs (2026-07-24, no migration, Tyson-reported).**
  (1) **Plan-source dropdown**: Today's "CHANGE WORKOUT" modal (MY PLAN / AI
  PLAN / EVOFORGE PLAN, `today.tsx`'s `plan-dropdown`) stopped changing what
  showed the moment the athlete had ever saved `/schedule` — `schedule.tsx`'s
  2026-07-20 redesign started writing a UNIFORM per-day `sources` map on every
  save (comment: "Train's per-date reader ... honours an explicit per-day
  source"), and `today.tsx`'s `sourceForDate` gives that map priority over the
  dropdown's own choice. Schedule's write kept `active_plan_source` (035) in
  sync with its own map, but the dropdown only ever wrote
  `active_plan_source` — never the map — so the FIRST schedule save froze
  `sources` at whatever it was then, and it outranked every dropdown tap
  forever after. Fix: the dropdown's `onPress` now re-stamps the latest
  schedule row's `sources` uniformly to the tapped choice too (same
  "trained day" test as `schedule.tsx`'s `onSave`), so the two writers stay
  symmetric — exactly like `workout.tsx`'s existing built-in→MY-PLAN fork
  write already does selectively. Falsified live against ALPHA: tapped MY
  PLAN, confirmed via SQL the new `workout_schedule` row landed with
  `sources` remapped and `profile.active_plan_source` updated; tapped back to
  EVOFORGE PLAN and confirmed it reverted. (2) **False COINS NOT BANKED**: the
  Today/Train exercise cards log every set through the `durable` (P2 offline)
  queue — `mutations.ts` mints the row id, hands it to `enqueueSet`, and
  returns immediately; the actual `workout_log` INSERT happens later in
  `set-queue.ts`'s background `flushQueue`. The PR coin claim fired
  EAGERLY, in the same tick as the (still-queued, not-yet-synced) row — the
  013/061 guard's `pr` branch couldn't find the row yet and raised
  `"coin_events: no matching owned set (...)"`, which `coin-claims.ts`
  didn't recognise and surfaced as a scary "COINS NOT BANKED" error toast on
  an ordinary PR. Fix: `enqueueSet`/`QueuedSet` now carry the verdict's
  `isPr`, and the PR claim moved into `flushQueue` right after ITS insert is
  confirmed (mirroring the XP grant, which already worked this way);
  `mutations.ts`'s immediate claim now skips entirely when `queued`. Also
  hardened `classifyClaimError` as a backstop: any `coin_events:`-prefixed
  guard message not already named falls into the silent `guard` bucket
  instead of `error` — only a message that ISN'T the guard's own voice
  (network, RLS, a dropped column) should ever toast. Falsified live against
  ALPHA: logged 220kg×10 Barbell Back Squat (prior best 200kg×9, e1RM
  260→293.3) on the durable path, confirmed via network trace NEW PR fires
  immediately, `workout_log`/`xp_events`/`coin_events` all POST 201 ~200-400ms
  later from the flush, "COINS BANKED +50" toast lands, no error toast at any
  point; seeded rows deleted after. Files: `today.tsx`, `mutations.ts`,
  `set-queue.ts`, `domain/coin-claims.ts` (+1 test). Gates: tsc, 1,634 tests
  (1 new), cold lint, tokens/motion/battle-engine, export, the two live
  Playwright/SQL falsifications above.
- **ARENA MARKSMAN MOB — first frame-animated combatant (2026-07-24, no
  migration)**: the `drone-archer` (Javelin Marksman) ranged unit now plays a
  full animation set sliced from a user-supplied external sheet
  (`client/assets/arena-madmog-src/madmog-streamavatars.png`) by the new
  committed slicer `client/scripts/arena-madmog-gen.mjs` (same 2px team-outline
  + pngquant as the PixelLab pipeline). `toward`/`away` run cycles (team
  selects direction — the vertical lane faces player units away, opponents
  toward), an `attack` firing loop while engaged, and a `death` collapse; the
  hit reaction reuses the existing white-flash + recoil. All frame-driven off
  the frame clock (no per-unit state / no Animated — the arena perf doctrine).
  Death identity is resolved by pairing the structured `death` log line with
  its adjacent `fx death` line in `combat-fx.ts` (NO engine change → no replay-
  hash risk). The character's red palette is a DOCUMENTED divergence from
  ART_BIBLE §2/§5 (external user-directed asset). See
  `client/src/arena-game/ASSETS.md` + `PROGRESS.md` (Marksman section). Gates:
  tsc, 1,599 tests (4 new), lint baseline, motion/tokens/arena-purity, export,
  real-battle Playwright zoom captures.
- **PERF PASS: BOOT CHUNK + SET-SAVE NETWORK BUDGET (2026-07-23, no
  migration)**: five independent hot-path fixes, no behavior change intended.
  (1) **Boot-chunk slimming**: set save, the set queue and the Home/Train
  cards resolve exercise→muscle through the new
  `client/src/domain/muscle-lookup.ts` seam, which carries only the compact
  GENERATED name→muscle projection (`muscle-by-name.generated.ts`, regenerate
  via `node scripts/gen-muscle-by-name.mjs`, pinned to `EXERCISE_LIBRARY` by
  `__tests__/muscle-by-name.test.ts`) — the full ~1,109-entry library now
  stays behind the picker/builder route chunks instead of riding the shared
  boot chunk. `exercise-library.ts`/`exercise-search.ts` re-export
  `libraryMuscleFor`/`userMuscleFor`/`UserExercise` so picker-side callers
  keep one import; precedence (user > library > inferMuscleGroup) unchanged.
  (2) **Achievement sweep network budget** (`data/achievement-sweep.ts`):
  was ~7 fresh round-trips PER SET; now `achievements` + `xp_total` stay
  always-fresh (they make the insert honest) while the other inputs read the
  Query cache when it can answer COMPLETELY (bodyweight's 180-row window only
  stands in when it holds the whole history) with byte-identical fresh-read
  fallbacks; concurrent saves COALESCE into one running + one trailing sweep.
  Cache-fed sweeps can only fire an unlock LATE, never wrongly (C8 rule).
  (3) **Leaderboard polling gated on focus** (`data/hooks.ts`): both
  leaderboard queries poll only while their screen `useIsFocused()` — the
  idle-tab preload kept Home mounted, so the old visibility-only gate polled
  the two most expensive RPCs forever from behind other tabs. Also
  `data/keys.ts`: a `public_profile` write no longer invalidates the two
  leaderboard keys (a name/privacy edit reorders nothing; /rank refetches on
  visit; order changes ride `user_progression`).
  (4) **Lift bests memoised** (`useLiftBests` in `data/hooks.ts`): the five
  `bestE1rmFor` scans over the 2,500-row log moved out of per-render
  `useCurrentStats` into a module-scope TanStack `select`; bench precedence
  order preserved. (5) **Picker filter count debounced** (`exercise-picker.tsx`,
  120ms) and the QUICK WORKOUT sheet extracted into its own component in
  `today.tsx` so name keystrokes stop re-rendering the whole Train hub.
  Guards: full suite 1,558 green (incl. new `muscle-by-name.test.ts`), tsc +
  lint clean, tokens/battle-engine/motion guards green, export clean.
- **EXERCISE LIBRARY + SPLITS EXPANSION (2026-07-23, no migration)**: added
  **88 new curated exercises** (variants of the staples — every triceps-pushdown
  grip/handle, overhead-extension, curl, lateral/front raise, upright row, cable
  fly, pulldown/row, squat/lunge, hip-thrust, calf and shrug variant) to
  `CORE_EXERCISES` in `client/src/domain/exercise-library.ts` (core 113→201,
  whole library ~1021→1109). Every name was collision-checked (case-insensitive)
  against the full library incl. the ~908 imported `free-exercise-db` entries —
  the 23 that already existed there were dropped, not duplicated (the
  NO-DUPLICATE test fails on any). New entries carry `popularity: 90` so the top
  staples (100) still surface first in search/substitution. Also added **10 new
  `DAY_PRESETS`** (Chest, Back, Shoulders, Chest & Triceps, Back & Biceps,
  Shoulders & Arms, Upper/Lower Power, Upper/Lower Hypertrophy) and **5 new
  `SPLITS`** (`bro5full` full-seed bro, `arnold6`, `phul4`, `ppul5`, `ubro4`;
  non-custom splits 6→11). All preset exercise names are byte-identical to
  library entries. **Hand-authored surface only — NOT the generated `catalogs.ts`
  EVOFORGE PLAN**, which stays contract-locked. Guards: `exercise-library.test.ts`
  35/35, full suite 1426 green, tsc + lint clean.
- **OVERNIGHT ARENA HARDENING RUN COMPLETE — P1–P14 (2026-07-23, no
  migration)**: the full 14-phase program executed in one autonomous run
  (audit → five-champion rebuild → engine reliability → stability → FX →
  readability → balance → cards → AI tendencies → journey → gym slice →
  reward safety → final verification). Final state: five official
  champions with passives/roles, 20 cards / 7 synergies, save v6,
  Arena suite 487 (full suite 1,558), deep harness 362 matches with 0
  defects and win rates [45%, 54%], P13 reward-safety audit CLEAN,
  every guard green. **Read
  `OVERNIGHT_ARENA_BUILD_REPORT.md` (repo root)** — phase table, final
  state, and the decisions that need Tyson (XP reward policy,
  `gym_detail origin_path` migration, on-device pass). Per-phase detail
  in the entries below + `client/src/arena-game/` docs.
  hardening P12)**: official-path squad ROLES, data-driven from champion
  content (`features/gyms/path-roles.ts` — Titan Anchor, Mass Bulwark,
  Shredder Finisher, Cardio Pacer, Aesthetics Coach; team-aura flags
  derived, not hand-written), shown on roster + squad picker. Borrowed
  passives verified functioning in auto-cast context by 6 probe tests
  (auras key on kind==='champion', not commandable). Squad picker now
  previews spawn-live synergies (`synergy-preview.ts`, pinned test-equal
  to `createBattle` aura output; deck potential deliberately
  under-stated). Honesty pass: Arena-local disclaimers on gym war
  stats/contribution, estimated-builds headers, "never their ultimate"
  copy. Stale squad ids pruned on load; no save bump (v3's
  gym.selectedSquad reused). No battle-affecting changes. Arena 487.
  P11)**: full first-run journey traced and repaired (8 defects). Arena
  onboarding no longer asks for a name (EvoForge identity wins —
  `applyProviderIdentity` at init; Origin champion adopted until
  onboarding completes); rebuilt as 2 steps (Origin-prefilled champion
  pick + 3-block core-loop primer). First battle now defaults to the
  training AI tier, harder tiers win-gated with 🔒 chips (save **v6**
  migration re-defaults difficulty ONLY for never-battled saves).
  Tutorial/ghost battles award zero rating (single delta source
  `ratingDeltaForOutcome`); results overlay shows the Arena Rating
  delta + explicit "no Forge XP, no Evo Rating change" line; "rank
  points"→"Arena Rating" everywhere (audit #6 resolved); profile shows
  REAL provider fitness; debug entries dev-gated; gym non-membership is
  a friendly state routing to /social, not an error. Arena suite 469.
  hardening P10)**: data-driven per-champion AI tendency profiles
  (`arena-game/features/arena/champion-tendencies.ts`, knobs in its
  TENDENCY table): Titan holds Quake Stomp for ≥2 targets or a
  stun→smash combo; Mass casts Gravity Well on clumps or defensively;
  Shredder holds Final Cut until it actually kills (shield-aware,
  mirrors engine targeting); Cardio Overclocks only into engaged
  fights; Aesthetics reads stances (Bulwark ≤55% hp/focused, Assault
  ≥70% + engaged) and rallies with ≥2 allies. Tier-scaled via
  `tendencyFollowChance` (0 / 0.75 / 1, range-validated); one
  deterministic RNG roll per decision; legality still goes through the
  validators — no illegal commands possible. Openings vary by seed
  (lane + style draw at AI-runtime creation, 20s window). Meta shifted
  → re-tuned: Titan HP 1470, Shredder ult charge/dealt 0.06 (tendency
  knobs measured and reverted — see ARENA_BALANCE P10 addendum). Final
  deep-harness spread: all five in [45%, 54%]. Arena suite 453; RNG
  stream shift re-pinned 3 seed-sensitive fixtures.
  hardening P9)**: card catalog brought to official fitness-forge
  terminology — six cyberpunk leftovers renamed (Neon Boxer→Cardio
  Boxer, Cyber Medic→Recovery Coach, Drone Archer→Javelin Marksman,
  Support Drone→Spotter, Shadow Striker→The Cutter, Blade Runner→Tempo
  Cutter, Neon Blades→Cutting Program; ids unchanged). Aesthetic and
  Shredder finally got path synergies (`aesthetic-poise` 2-count,
  `shredder-cut-deep` 3-count) — 7 synergies total, every official path
  covered (now a content-validation ERROR if not, plus a
  threshold-reachability validator; both falsified). 20 playable cards.
  Deep-harness win rates unchanged from P8 ([46%,53%]). Arena suite 433.
  hardening P8)**: tuned from the P5 deep harness (362 deterministic
  AI-vs-AI matches). Win-rate spread narrowed **18 → 7 points** (all
  five in [46%, 53%]): Aesthetics buffed (HP 1150, dmg 66, Stance Shift
  10s, Rally heal 150 — was the 39% laggard), Mass Monster's summon
  tempo trimmed (HP 1820 → baked 2002, taken-damage ult charge 0.06 →
  0.045 — the HP pool was charging Mass Uprising passively). Content
  numbers only; BALANCE_VERSION stays 0.6.0 (unreleased). Data +
  rationale in `arena-game/ARENA_BALANCE.md` P8 section; two Colossal
  Frame tests re-pinned to the new baked max.
  hardening P7)**: new-player readability audit + fixes, visual only.
  Real bug caught: `pathCardio` was `#22D3EE` — bit-identical to
  `colors.player` team cyan, so an ENEMY Cardio champion wore friendly
  colors → retinted `#818CF8` indigo. Added: per-unit direction chevrons
  (colorblind-safe team cue beyond hue), low-health amber on ALL health
  bars below 35% (deliberately matches Shredder Killer Instinct
  threshold so execute range is visible), lane-momentum edge glow,
  floater vertical stagger (no more overlapping numbers), energy pips,
  cooldown-fraction fill + ult charge fill under HUD buttons,
  unaffordable card cost highlighted. Pure helpers in
  `features/arena/components/readability.ts` (19 tests). No pulsing
  glow / radial sweep (reduced-motion + RN primitive constraints —
  KNOWN_ISSUES). Arena suite 428.
  P6)**: battle FX layer, zero engine/digest impact, all in the existing
  frame-driven floater pattern (no Animated values, no per-unit React
  state, `'use no memo'` untouched). New pure module
  `arena-game/features/arena/components/combat-fx.ts`
  (`deriveCombatSignals` — one log-delta scan per frame; 27-case test).
  Effects: hit flash (150ms, clipped to sprite, proximity-matched — fx
  log has no target id), death dissolve ring, ability/ultimate
  telegraphs (expanding ring + real ability name in path color; ults
  bigger/longer), summon-arrival poof, deploy landing ring, Forge Core
  shake+flash on damage (red under 25%, via optional CoreBar `hit`
  prop). Idle bob deliberately deferred (only looping candidate).
  verify-motion still 14/14. Arena suite 409.
  hardening P5)**: stability harness extended to **208 matches** default
  (413 with `ARENA_STABILITY_DEEP=1`): 5×5 matchup matrix × 3 AI tiers,
  squads with guaranteed borrowed Mass/Cardio, maxTicks outcome paths,
  ghost record→transform→replay per champion. **Zero defects**: no
  stalls/throws/invariant violations, zero borrowed ultimates, 100%
  digest-identical replays. Per-champion stats recorded in
  `arena-game/PROGRESS.md` (P5 section) for the P8 balance pass — headline
  spread: Mass 63% / Titan 56% / Shredder 48% / Cardio 48% / Aesthetics
  37% win rate. Suite runtime unaffected (~10s wall for the package).
- **ARENA ENGINE RELIABILITY PASS (2026-07-23, no migration — overnight
  hardening P4)**: adversarial review (4 finder + 8 verifier agents) of the
  Arena battle engine post five-champion rebuild; 8 confirmed defects, all
  fixed with 13 regression tests (suite 1,426→1,441). Notables: `play-card`
  with a null/malformed target THREW instead of rejecting (crashed live
  ghost battles — shape guards in `cards/effects.ts` + ghost-transform
  normalization); schedule entries with null `command` threw inside
  `runBattle`; untrusted `championScaling` in battle records was never
  validated (1e999 → Infinity-health unkillable ghost champions — new
  `isValidChampionScaling` [0.1,10] enforced at record-parse AND
  `createBattle`); `record.commands` now capped at 10,000; and the
  borrowed/AI Cardio **Lane Shift ping-pong** is gated
  (`autoCastValidate`: shift only to JOIN combat — own lane quiet, other
  lane has an in-range enemy; commanded player casts stay unconditional;
  deterministic, no RNG). No BALANCE_VERSION bump (0.6.0 unreleased same
  run). All under `client/src/arena-game/`. NOTE: committed alongside
  another session's in-flight work — this commit stages the arena package
  + HANDOVER only. **P4 addendum (same day)**: the passives dimension
  (finder died mid-review) was re-run — Iron Hide stacking, Killer
  Instinct threshold vs baked max, Colossal Frame across respawn,
  alive-only aura one-tick latency, summon shields/synergy tags all
  verified clean-or-documented by numeric probe; one real fix: tick-0
  spawn-active synergies now log `synergy-on` (createBattle seeds auras
  via the logging recompute — log-only, zero digest impact). +6 tests
  (arena 376).
- **ARENA FIVE-CHAMPION ROSTER + REAL PROGRESSION (2026-07-23, no migration —
  overnight hardening P2+P3)**: the Arena now fields THE official five
  champions — **Aesthetics, Titan, Mass Monster, The Shredder, Cardio
  Machine** — keyed `champion-<slug>` to the live BranchV2 roster
  (`aesthetic|titan|mass|shredder|cardio`; retired `hybrid` folds to
  aesthetic). Speedster/Hybrid are GONE from player-facing surfaces; local
  save migration v4→v5 remaps old `championId`s non-destructively
  (`save.ts::migrateChampionId`). Mass Monster is a NEW kit (Gravity Well
  cross-lane slow field + Mass Uprising summons via the new deterministic
  `CardEffects.summon` handler), each champion has a data-driven passive
  (`ChampionPassiveDefinition`), display names are content-validation
  ERRORS, BALANCE_VERSION 0.6.0 (old replays gated stale, by design).
  Evolution stage is now the REAL one via
  `arena-game/integration/evoforge/progression-mapping.ts` reusing
  `src/domain` functions — Shredder's stage is body-fat-driven
  (`bodyfat_log`), others level-driven; fallbacks only ever under-state.
  Dev fitness editor demoted to the debug screen (labeled dev-mock); gym
  roster builds labeled "(EST.)". Sprite pipeline now lives IN this repo
  (`client/scripts/arena-sprite-tools.mjs` + `client/assets/
  arena-pixel-src/`, pngjs devDep); five champion sprites regenerated.
  `client/vitest.config.ts` added (only the `@`→`src` alias for tests —
  discovery untouched). Suite 1,387→1,426, all gates green. Remaining
  phases of the overnight run tracked in
  `client/src/arena-game/ARENA_BETA_AUDIT.md`.
- **PAGE-HELP HOME SLIDE-OFFSCREEN FIX (2026-07-23, no migration)**: opening the
  guided tour ("?" FAB) on Home slid the whole screen off to the left. Cause:
  `ui/help/page-help.tsx::useSpotlight` called `scrollIntoView({block:'center',
  inline:'center'})` whenever the target was off-screen on EITHER axis (the
  f8c2c0b Train-carousel change). Home's first target (`home-level-module`) is
  horizontally visible but below the fold, so the vertical scroll also forced a
  horizontal re-centre, scrolling the page sideways. Fix: scroll each axis only
  when it's actually off (`block: offV ? 'center' : 'nearest'`, `inline: offH ?
  'center' : 'nearest'`) — `'nearest'` is a no-op when the axis is in view, so
  the Train-carousel horizontal case is unchanged.
- **EVOFORGE ARENA CARD-BATTLER INTEGRATED (2026-07-22, no migration)**: the
  standalone Arena beta (built separately at `C:\Users\tyson\evoforge-arena` —
  deterministic tick engine, cards/champions/synergies/augments, three AI
  tiers, ghost battles + verifiable replays, gym squads, 318 tests) now lives
  at **`client/src/arena-game/`** (self-contained feature package; tests ride
  in `npm test`, total suite 1,387) and mounts as the hidden route group
  **`/(main)/forge-arena/`** (thin route files re-export `arena-game/screens`;
  route strings are `/forge-arena/...`-prefixed). Entry: the ♜ door on the
  Arena hub, behind `arena-game/features.ts::arenaGameEnabled`. Boot:
  `forge-arena/_layout.tsx` validates game content then `initArenaForUser` —
  **per-user namespaced AsyncStorage** (`u/<userId>/...`) + the
  **SupabaseEvoForgePlayerProvider** (`arena-game/integration/evoforge/
  supabase-provider.ts`): pillars from `evo_rating_current`
  (strength/cardio/size→muscularity/aesthetics) + `profiles.leanness_score`,
  Forge Level via the pinned `forgeProgressFor` curve, champion from the
  Origin lock (`origin_path`→ shredder→shredder, titan/mass→titan,
  cardio→speedster, aesthetic→hybrid), REAL gyms via `my_gyms`/`gym_detail`/
  `discover_gyms` RPCs (member builds approximated from evo_rating +
  forge_level). Fitness advantage is hard-capped ±12% in-game. **Battle
  results are COSMETIC** (local rank/stats only, gym-battle precedent): no
  server writes, NO XP minting — an Arena reward kind is a future migration +
  Tyson decision. Sign-out calls `resetArenaSession()` in auth-context
  (stops the battle loop, drops in-memory state; disk is per-user
  namespaced). The Arena package renders a mutable sim from refs on a
  version counter BY DESIGN: those three components carry `'use no memo'`
  (React Compiler opt-out) and eslint scopes `react-hooks/refs|purity|
  set-state-in-effect` off for `src/arena-game/**` only — every other rule
  (and react/no-danger) still applies. No tokens/engine/glicko/motion/goldens
  surface touched (all guards verified green). Sprites (52f4a4d): the Arena
  renders Kenney 1-Bit Pack (CC0) pixel sprites recolored to the palette —
  26 pre-tinted PNGs at `arena-game/features/arena/sprites/` (provenance:
  `arena-game/ASSETS.md`; the slicing/tinting pipeline lives in the upstream
  repo's `scripts/sprite-tools.js`). Standalone repo remains the
  upstream for engine work; `EVOFORGE_INTEGRATION.md` there documents the
  boundary this integration implements.
- **HOME v2 CLEANUP + COIN CLAIM HONESTY (2026-07-22, no migration)**: Home
  slimmed — header arena rank (`home-arena-rank`) gone; EVO RATING title is
  SectionLabel-lg with NO status suffix (PROVISIONAL is a quiet tag beside
  the descriptor); the STREAK is a hero badge under CURRENT FORM
  (`hero-streak`, → /streak; CURRENT FORM re-iconed 🔥→◈ so the flame means
  streak); `status-grid.tsx` and `weekly-schedule-card.tsx` DELETED (testIDs
  `status-*`, `weekly-schedule-card` gone; XP door lives on /profile, coins
  keep the hero CoinRow). **Coins diagnosed live**: guard/trigger/RPC all
  correct in prod (no amount=1 rows; ledger === coin_total) — the "not
  logging" symptom was the SILENT ≥10-set floor rejection. Fix:
  `domain/coin-claims.ts` classifies the guard's raise strings
  (`ClaimOutcome`), `claimCoin` returns it, `useClaimCoin` invalidates via
  `invalidateTable` (prefix — kills the userId-null race) and toasts ONE
  honest case: workout_complete under the floor → "NO COINS YET · Coins bank
  at 10+ counted sets". Duplicates/non-PRs/unproven milestones stay silent.

- **ANGLED FORK GLYPH (2026-07-21)**: `FORK` in `pixel-icons.tsx` redrawn —
  the fork leans up-right with a 7-row handle (was a 4-of-9 vertical stub).
  Sheared on the grid, never transform-rotated (anti-aliasing kills pixel
  art); a full 45° draft dissolved the head into slashes at tab size, the
  shipped shear keeps the crossbar solid. Used by the Fuel tab + meal slots.
- **FUEL PAGE v2 (2026-07-21, NUTRITION_PLAN_2)**: the summary card is the
  command centre — CUT/MAINTAIN/BULK switcher chips (inactive chips quote
  their stored kcal; tapping writes an effective-dated target upsert, ZERO AI;
  a manual/pre-081 target with no derivable triple toasts RECALCULATE FIRST
  and opens the intake) + the ✦RECALCULATE/EDIT actions moved up from the
  deleted `daily-target-card.tsx` (testIDs kept verbatim). `fuel-bonus-card`
  (protein goal box) deleted — protein renders with `emphasis` in the macro
  rows instead (weight/size, same colour). New `saved-meals-card.tsx` beneath
  the scanner: ☆ SAVE FOR LATER in the confirm sheet names a meal; the card
  one-tap logs it (slot picker + delete in the expander; renders null when
  empty). TODAY'S MEALS moved to the page bottom with a SectionLabel-lg
  title. The converter's "Maths works…" helper line is gone (feature stays).
- **SAVED MEALS + GOAL TRIPLE (2026-07-21, migration 081 APPLIED + falsified)**:
  `saved_meals` (name ≤60 unique per user case-insensitive, `items` jsonb 1..12
  in the nutrition_log.items MealItem shape, denormalised kcal/macro totals,
  owner select/insert/delete — no update, v1 has no rename) and three nullable
  `nutrition_targets` columns `kcal_lose/kcal_maintain/kcal_gain` (1000..6000)
  — the goal triple computed client-side at intake time so CUT/MAINTAIN/BULK
  switching is a plain effective-dated upsert, zero AI tokens. Falsified per
  the migration header (dup name 23505, item/kcal/macro CHECKs, BRAVO
  isolation, 999 reject, triple accept); seeds cleaned.
- **MEAL-SCAN QUALIFIER-AWARE MATCHING (2026-07-21, no migration)**: "500g raw
  10% beef mince" used to read 1250 kcal — the 'mince' alias hit the cooked
  ~17%-fat `ground beef` row and DISCARDED the AI's correct raw estimate. The
  curated table/matcher moved to `supabase/functions/meal-scan/food-match.ts`
  (import-free, pinned by `client/src/domain/__tests__/food-match.test.ts` via
  a cross-root import): `parseQualifiers` reads raw/cooked + fat% ("10%",
  "90/10", "95% lean"; plain ≥50% reads as lean), `BASE_META` declares what
  each base row assumes, `VARIANTS` carries USDA raw/cooked×fat% rows (ground
  beef, chicken, steak, rice, pasta, oats), and a qualified food the table
  can't model returns null → the AI's clamped per-100g (`source:'ai'`). Both
  prompts now demand qualifiers echoed verbatim into item names; for
  single-item results the user's own text/hint is a fallback qualifier source.
  Unqualified matches are byte-identical to before (doctrine unchanged).

- **ROUTINES AS SCHEDULE PRIMARY (2026-07-21, no migration)**: the EDIT
  SCHEDULE split dropdown now also lists saved routines (★-prefixed, after the
  plan's days) — "abs" can be a day's MAIN workout, not just an extra (multiple
  per day keep working via 065 extras). A routine-name primary is LITERAL:
  `chooseSource` never remaps it, the uniform `sources` write + Train's
  explicit-source short-circuit keep it verbatim, and the resolver's
  routine-by-name fallback opens it. A deleted routine left in the primary slot
  gets the ⚠ warning. Pinned: streak/weeklyContract count a routine primary as
  scheduled; `sourceDayFor` history keeps the literal name.
- **SAVE CHANGES AT FINISH (2026-07-21, no migration)**: finishing an edited
  day now asks "Save changes?" (skips ad-hoc — it has its own save-routine
  flow). `domain/plan-edits.ts` is the pure bridge: `diffDayEdits` (skip/order
  are NEVER template changes; a swap-then-remove is a removal of the slot;
  net-zero deltas are clean), `applyEditsToDay` (1..8 intent clamp, swapped
  slots lose their coaching `reason`), `mergeDayIntoCustomPlan`. SAVE routes by
  the day's source: MY/AI → whole-payload `user_plans` upsert; **BUILT-IN forks
  into MY PLAN** and points the schedule's matching weekdays at source 0 (066
  per-day sources) — `active_plan_source` untouched; routines → new
  `useUpdateRoutine` (016's owner UPDATE policy, first client use). Supersets
  persist: `PlanExercise.supersetWith` (optional, validatePlan partner-checks
  it), `RoutineExercise`, `ResolvedDay.supersets` (symmetric via
  `supersetsOf`), seeded into the session once per day by `seedSupersets` —
  `emptyDay()` deliberately does NOT define `superset` so undefined means
  "never touched" and an unlinked-to-empty map is never re-seeded. JUST TODAY
  keeps today's behaviour (overrides expire at midnight).
- **FINISH FLOW (2026-07-21, no migration)**: logging the last set no longer
  auto-opens the SummarySheet — the jingle/haptic celebration stays, and the
  coin claim stays IN the ceremony effect (the offline finish-queue flush never
  claims, so that effect is the only coin path for an offline finish; claims are
  idempotent per 013). FINISH WORKOUT is now the last thing on the page; pressing
  it with sets still owed opens a "You have N sets remaining" confirm
  (`finish-anyway` / `finish-cancel`) before the summary.
- **SUBSTITUTIONS PERSIST + HONEST COMPLETION MATH (2026-07-21, no migration)**:
  the ⇄ swap moved from `workout.tsx` component state into the session store —
  `DayOverrides.substituted` (ORIGINAL slot → substitute; every other override
  map keys by the DISPLAYED name, and `applySubstitution` migrates those keys so
  a −SET tweak / superset pairing survives the rename). Applied INSIDE
  `buildEffectivePlan`, so a mid-workout refresh keeps the swap and `planTotals`
  judges done/target against the substituted exercise. The Train hub's `setsFor`
  now runs TODAY through the same pipeline (`dayProgress`) with today's
  overrides — a swapped/edited day can no longer read PARTIAL on the hub while
  the workout page says complete (past dates keep the raw plan; overrides expire
  daily as ever). Drive-by: `toggleSuperset` now goes through the date-guarded
  `edit()` like every other store write.
- **FITNESS-DUEL MATCHMAKING + ONLINE COUNT (2026-07-20, migration 077 APPLIED +
  two-client verified).** The System-A real-workout duel (battle_matches) no
  longer uses an invite_code — Arena "FIND A DUEL / FIND A VOLUME DUEL / FIND A
  COIN DUEL" queue you by FORMAT and auto-pair you into a match; you drop into the
  EXISTING /arena/battle/[id] flow (VsPhase→ready→rounds→settle unchanged). 077:
  `battle_duel_queue` + `battle_matchmake(format,snapshot)` (advisory-locked,
  pairs by format, creates the match + 2 participants born at status='matched',
  invite_code NULL) + `_poll` + `_cancel`; `clean_battle_snapshot` (SQL port of
  the edge fn's cleanSnapshot — clamps stats, forces the public_profile name, so a
  client can't inflate/spoof). SECURITY DEFINER is safe: matches/participants have
  no guard triggers. Client: `useDuelMatchmaking` in data/matchmaking.ts; Arena
  removed the CREATE/JOIN tabs + code box + CodeCard + openInvite and added a
  SEARCHING modal; athlete "⚔ CHALLENGE" (the last code-minter) removed. Falsified
  (pair, format isolation, poll, cancel, clamp) + two-client Playwright (both hit
  FIND A DUEL → paired into the SAME match → FACE OFF with correct clamped
  identities). **battle-invite/battle-join edge fns are now dead (left in place,
  harmless). ALL join-by-code is GONE from the app.** A targeted "challenge a
  specific friend" (direct invite via notification) is a possible follow-up.
- **Players-online count:** `data/presence.ts` — a global Supabase Realtime
  Presence channel (joined once in (main)/_layout) counts unique players online;
  `OnlineBadge` (● N ONLINE) on the Arena masthead + Quick Match. Verified.
- **GYM CODES RETIRED → online discovery (2026-07-20, migration 076 APPLIED +
  falsified).** Gyms are no longer joined by a 6-char code — you BROWSE/SEARCH
  public gyms and join, or use a shareable gym LINK for private crews (same
  pattern as friends 073). 076: dropped `gyms.join_code`; added `is_public`
  (default TRUE) + `share_token`; `discover_gyms(q,limit)` (public gyms search),
  `join_gym_by_id(gym, token)` (public OR token-gated for private),
  `my_gym_share_token`, `set_gym_public` (owner toggle); `my_gyms`/`gym_detail`
  drop join_code; **`gym_battle_prepare` now takes the opponent gym id** (pick
  from discovery), not a code; dropped `join_gym(text)` + legacy `gym_battle
  (uuid,text)`. Client: `gyms-view.tsx` "JOIN BY CODE" → "FIND A GYM" browse; the
  gym screen shows SHARE GYM LINK + an owner PUBLIC/PRIVATE toggle + battle-a-gym
  by search; `gym/[id]` reads `?invite=` to join a private gym via link. Falsified
  (public discover+join; private hidden; token-gated join; owner toggle).
- **REAL-TIME LIVE PvP MATCHMAKING (roadmap Phase 4) — SHIPPED + two-client
  verified (2026-07-20, migrations 074 + 075 APPLIED).** Champion battles are now
  live turn-by-turn PvP vs a matched real opponent — replacing the RPG
  join-by-code. **Arena → QUICK MATCH** (`/pvp`): pick champion → `pvp_enqueue`
  → paired → fight over Supabase Realtime.
  - **Determinism:** `domain/battle-rpg/prng.ts` (`turnRng(seed,turn)`). Both
    clients resolve the CANONICAL battle (seat1=player) and seat 2 swaps only the
    VIEW — because `decideOrder` breaks speed ties on `rng()<0.5` favouring
    "player", local-perspective resolution would desync. `prng.test.ts` proves
    convergence.
  - **Backend 074:** `pvp_queue`/`pvp_matches`/`pvp_moves` + `pvp_enqueue`
    (advisory-locked matchmaker), `pvp_poll`, `pvp_submit_move` (own-seat,
    one-per-turn), `pvp_finish` (idempotent → `record_rivalry_result`),
    `pvp_forfeit`, `pvp_cancel_queue`. pvp_matches/pvp_moves in the realtime
    publication. Casual = nothing farmable → client-authoritative is safe.
  - **Client:** `data/matchmaking.ts` (enqueue/poll/realtime), `ui/battle/
    use-online-battle.ts` (canonical resolve + seat-2 view/event swap + Realtime
    move exchange, reuses `resolveTurn`), `ui/battle/online-battle-runner.tsx`
    (reuses BattleArena/MoveGrid), `app/(main)/pvp.tsx` (champion pick →
    searching → live match). Arena "COMING SOON quick match" placeholder → real.
  - **Verified with TWO live browser clients (ALPHA+BRAVO):** they paired over
    Realtime, both entered the match, exchanged a move, both advanced to the same
    turn; seat-2 view-swap correct (each sees their own champion). Backend also
    two-JWT falsified.
  - **075 removed the RPG challenge-by-code system** (dropped rpg_challenges +
    3 RPCs; deleted battle-rpg-challenge.ts + challenge-hub.tsx; stripped
    `challenge` mode from battle.tsx/use-battle.ts/types BattleMode; JOIN box is
    now fitness-duel-only). **System A `battle_matches` invite_code (real-WORKOUT
    fitness duel) is a SEPARATE feature and was KEPT** — it still uses a code; the
    Arena "CREATE BATTLE · GET CODE" / athlete "⚔ CHALLENGE" flows are System A.
    Convert those to matchmaking too only if Tyson asks.
- **FRIEND CODES RETIRED → fully online friending (2026-07-20, migration 073
  APPLIED + falsified).** Removed the 6-char friend code (dropped `friend_codes`
  table + `my_friend_code` + `send_friend_request`; deleted `useFriendCode` /
  `useSendFriendRequest`; removed the "YOUR ADD CODE" card). Friending is now:
  name search (071) + requests, OR a **shareable profile link**. Each athlete has
  a stable `public_profile.share_token` (backfilled); `my_share_token()` returns
  it; `friends.tsx` "SHARE MY PROFILE LINK" shares `…/athlete/<id>?invite=<token>`.
  **Privacy gap closed:** `request_friend(p_user, p_token)` now admits a request
  to a PRIVATE athlete IFF the caller presents their share token (they shared
  their link) — so private users stay cold-addable without a manual code, and
  cold spam is still impossible (no token + not public → not_addressable). The
  old 1-arg `request_friend(uuid)` was dropped; the client always sends p_user
  (+ optional p_token from `athlete/[id]`'s `?invite=`). Falsified: private target
  refused w/o token, added with the right token, my_share_token correct.
  **NOTE: battle/challenge codes (034) + gym join codes (068) are SEPARATE and
  untouched here** — the live-matchmaking task removes battle codes.
- **RIVALRY "PR BEATEN" NOTIFICATIONS + AVATAR SHADOW + GHOST AUDIT (2026-07-20,
  migration 072 APPLIED + falsified)**:
  - **PR-beaten notifications.** Log a set whose e1RM passes a FRIEND's best for
    that lift and they get "USERNAME just destroyed your <lift> PR — reclaim your
    status" (in-app bell + push twin). 072 widens the `social_notifications` type
    CHECK to add `pr_beaten` (FIRST — the 054/058 rollback rule), adds a `detail`
    jsonb column, re-creates `my_notifications` to return it, and adds
    `report_pr_crossings(exercise,new_e1rm,prev_e1rm)`. **Detection is a client-
    called RPC, NOT a workout_log trigger** — fires only on an actual PR (is_pr),
    and a bad insert can't roll back the set save. Fires once per friend per lift
    (crossing guard `friend_best in [prev,new)` + 12h dedup). Wired from
    `mutations.ts` is_pr branch → `reportPrCrossings` → in-app rows + `pushNotify`
    per crossed friend. `send-push` gained a friend-verified `pr_beaten` branch.
    Client learned `pr_beaten` (+ the two 058 comment types that were missing):
    `social-notifications.ts` union/detail, `notifications.tsx` VERB + ⚔ red row
    deep-linking to Friends&Rivals. Falsified via simulated JWT (crosses both of
    a user's friends, inbox shows the lift, dedup + already-beaten guard both []);
    test rows purged. **A NEW notification type = widen the CHECK in the same
    migration, add to send-push VERB + a recipient branch, add to the client
    union + the VERB Record (compile-forcing).**
  - **Avatar contact shadow** (`avatar-stage.tsx`). Replaced the flat dark
    rounded-rect under the champion with a soft radial SVG ellipse — dark core +
    a faint rim in the champion's OWN aura colour, footprint scaled by the stage
    growth. It's DRIVEN by the float (no separate groundPulse loop): tightens and
    lightens as the champion rises. Layout footprint pinned to ~14px (the taller
    SVG overflows via absolute centring) so it never lifts the champion off the
    podium.
  - **Ghost audit.** Confirmed **Workout Ghost Battles (037) are FULLY WIRED** end
    to end (publish from summary → Arena GHOST BATTLES → `/battle?mode=ghost` →
    rivalry); all 4 RPCs + `workout_ghosts` present in prod. RPG Challenges (034)
    also complete. The ONLY unbuilt ghost is the **deferred real-time arena ghost
    race** (`ghost_snapshots`, migrations 009/028) — an orphan table with no
    writer/reader/edge fn/UI; still deferred (a real Phase-3 build if wanted).
- **FIND-A-FRIEND-BY-NAME + WHOLE-WEEK SCHEDULE (2026-07-20, migration 071
  APPLIED + falsified)** — two UX fixes Tyson asked for:
  - **Add a friend by display name.** The 060 search + friends typeahead existed
    but its gate was `is_public AND discoverable`; `discoverable` defaults OFF
    (055) — production had **only 1 of 14 public athletes discoverable**, so
    search found nobody and read as broken. **071** drops `discoverable` from BOTH
    `search_athletes` and the `request_friend` add gate — `is_public` (the
    leaderboard/profile-view opt-in) is now the "findable + addable" gate;
    `discoverable` means only "also show me in passive Discover/Suggested". Also
    modernised search's forge_level/rank off the retired `avatar_progression`
    onto `user_progression`/`evo_rating_current` (matches 067). Falsified with a
    simulated JWT: a public non-discoverable athlete now hits search AND is
    addable; a private athlete still returns [] / not_addressable; 1-char → [];
    caller excluded. `friends.tsx` reworked so name-search is the PRIMARY card
    (code demoted to "ADD BY CODE" for private adds).
  - **Whole-week schedule source.** `schedule.tsx` replaced the per-day SOURCE
    dropdown (066) with ONE picker at the top — MY PLAN / AI PLAN / EVOFORGE PLAN
    for the whole week. Save writes `active_plan_source` (035) AND a UNIFORM
    `sources` map (every trained day → the chosen source), so Train's existing
    per-date reader renders each day from that plan with no remap and no
    today.tsx change. Per-day cards keep REST/TRAIN + a SPLIT dropdown from the
    one chosen plan. No migration needed (sources column already exists).
- **FULL GYM BATTLES + more Supabase hardening (2026-07-19, migration 070)** —
  gym battles now run the REAL RPG combat engine member-vs-member, not an Evo
  sum. `gym_battle_prepare()` hands the client both rosters' combat inputs
  (champion path + the four pillars, show_evo-gated → neutral 40s when hidden)
  + a server seed; `domain/battle-rpg/gym-battle.ts::runGymBattle` pairs seats
  by rating and runs each duel through `createBattle`/`resolveTurn`/
  `chooseAiMove` DETERMINISTICALLY from the seed (deeper roster gets byes);
  `record_gym_battle()` stores the tally + per-duel HP log in
  `gym_battles.detail`. Both RPCs membership-gated + rate-limited. Gym battles
  grant NOTHING farmable, so the client-run engine has no exploit surface — the
  deliberate trade for not mirroring the client-only RPG engine into Deno. The
  gym screen shows a VICTORY/DEFEAT/DRAW modal with the duel breakdown.
  Security also: **M1 fixed** — the `social-media` bucket read is now gated by
  post visibility via the definer `can_read_social_object()` helper (images
  still render — they're caller-signed and the predicate mirrors `social_feed`);
  and **Auth config hardened** via the management API (password_min_length 6→10,
  require-reauth-on-password-change ON; HIBP leaked-password needs a Pro plan —
  not settable on the current plan; OTP expiry/MFA-TOTP/refresh-rotation already
  good). All falsified with a simulated session; test data purged.
- **SECURITY OVERHAUL (2026-07-19, migration 069 APPLIED + 2 edge fns)** — the
  audit found the data-security posture already STRONG (no secrets, full RLS,
  correct definer revokes); the gaps were App-Store *compliance features*:
  - **Account deletion** (Apple 5.1.1(v)): new `delete-account` edge fn
    (JWT-derived uid → `admin.deleteUser`, cascades everything), + a type-DELETE
    DANGER ZONE in `profile.tsx`. `useDeleteAccount` in `data/moderation.ts`.
  - **Block users** (1.2): `blocked_users` + `block_user`/`unblock_user`/
    `my_blocks` RPCs + an internal `is_blocked()` (revoked); a `friend_requests`
    BEFORE-INSERT trigger rejects requests across a block; blocking severs the
    friendship. Client hides blocked users (`useBlockedSet`) in friends
    search/suggested + gym chat; BLOCK/UNBLOCK on the athlete profile.
  - **Report coverage** (1.2): generic `content_reports` + `report_content`
    RPC for comments / gym messages / profiles (posts keep `social_reports`);
    ⚑ report on the athlete profile + each gym-chat message.
  - **M2**: `send-push` no longer trusts `body.to_user` — friend_request/mention
    pushes require a real pending request / actor-authored post, and never push
    across a block.
  - **M3**: rate-limit triggers on `friend_requests` (30/hr) + `gym_messages`
    (8/10s); `report_content` capped 30/hr.
  All RPCs falsified with a simulated session (block registers, friend-request
  trigger raises, unblock clears). NOT done (documented, low-risk): M1 storage
  bucket read gated by post visibility; L2/L3 are Supabase-dashboard/store-listing
  config, not code. Edge fns deploy via `client.yml` on push.
- **GYMS (2026-07-19, migration 068 APPLIED)** — player groups on the Social
  page (a 4th non-feed scope, branched like RIVALS): create/join-by-code, a
  private group chat (`gym_messages`, 5s poll), and GYM-vs-GYM battles decided
  by aggregate roster Evo Rating (`gym_battle` → `gym_battles`). Tables
  (`gyms`/`gym_members`/`gym_messages`/`gym_battles`) are RLS-locked with NO
  client policies — ALL access is through security-definer RPCs, each
  membership-gated via internal `is_gym_member()` (revoked from clients). Owner
  leaving hands off to the earliest member, or disbands if empty. Hooks in
  `data/gyms.ts`; UI in `ui/social/gyms-view.tsx` + `app/(main)/gym/[id].tsx`.
  NOTE unrelated to 032's PvE `gym_progress` / mode 'gym' (single-player boss
  clear). Verified on web (create → roster → chat → battle DRAW); test data purged.
- **PROFILE AVATAR + CHALLENGE + SUGGESTED FRIENDS (2026-07-19, migration 067)**
  — `public_athlete_profile` returns `active_stage`+`sex` (show_evo-gated) so
  `athlete/[id]` draws the champion via `avatarArtV2`; a "⚔ CHALLENGE" button
  mints a code-based invite; `recommended_athletes()` ranks suggested friends by
  mutual-friend count; friends search is debounced (150ms) + tappable. The
  QUICK WORKOUT sheet regained a "PREFILL WITH RECOMMENDED EXERCISES" button
  (corpus/ranking engine). Radar projection recut to realistic gains. Schedule
  uses SOURCE/SPLIT dropdown boxes.
- **PER-DAY SCHEDULE SOURCE (2026-07-19, migration 066 APPLIED)** — the weekly
  schedule can pin a SOURCE (my plan / AI plan / EvoForge) to each day and a
  SPLIT from that source, so a week can mix AI push / my-plan legs / built-in
  pull. Storage is a PARALLEL `workout_schedule.sources` jsonb ('0'..'6' →
  SourceIndex) next to the unchanged string `plan` — so `scheduled_streak()`
  and every string-reading twin stay byte-identical (a day absent from
  `sources`, or a null column, follows the global source exactly as before —
  zero change for any pre-existing schedule). EDIT SCHEDULE gained a per-day
  source selector (filtered to sources that have days) + a split picker from
  that source; `today.tsx` resolves each day via `sourceForDate(date)` (past
  days keep the global source; the explicit-source path skips `sourceDayFor`'s
  positional remap since the stored name is already right for its source).
  `week-status.ts`/`scheduled-streak.ts` untouched (they take callbacks).
  Verified on web: editor renders/switches sources+splits (injected plans),
  and a pinned MY-PLAN day resolves its own exercises on the Train card. Also:
  the "CHANGE WORKOUT" utility on Today is now "CHOOSE/UPLOAD MY WORKOUT".
- **MULTI-METRIC LEADERBOARD (2026-07-19, migration 065 APPLIED)** —
  `leaderboard_by_metric(p_metric, n)` (additive; `leaderboard_top` untouched)
  ranks by EVO RATING / FORGE LEVEL / CONSISTENCY / TOTAL XP, server-ordered +
  numbered, returning every metric per row. It reuses 014's exact
  mintable-drift integrity gate for ALL metrics, and the honest live sources:
  `forge_level_for_xp(lifetime_xp)` (never the ratcheted column),
  `evo_rating_current.displayed_rating` (only when `show_evo`, null otherwise —
  Evo is a DISPLAY metric here, not yet defended competitive authority),
  `current_momentum_weeks`. Client: `useLeaderboardByMetric` + `rankByMetric`;
  `/rank` gained a metric chip row (default EVO); the Home teaser now shows the
  Evo board; `LeaderboardRowView` renders the active metric's tail. Falsified
  in prod (all four orderings, null-evo sorts last) + verified on web via the
  teaser (both smoke accounts are drift-gated out of `/rank` itself — a
  pre-existing self-gate, unrelated).
- **HOME RADAR = EVO PILLARS + PROJECTION (2026-07-19)** —
  `client/src/ui/home/evo-radar.tsx` now sources Home's stat wheel from the
  SAME four scores that build the Evo Rating
  (`evo_rating_current.{size,aesthetics,strength,cardio}_score`, floored to
  match the EVO CORE card), so the wheel finally lines up with the rating
  beside it (it used to draw five legacy `calculateAvatarStats()` axes — a
  different scoring system). It overlays a dashed PROJECTION of where those
  pillars head after a chosen block (8/12/16 wk) of consistent training —
  `domain/progression/projection.ts`, a diminishing-returns headroom model
  scaled by momentum (`consistencyFromMomentum`), never past 100. Before the
  first Evo review (no row) it falls back to the legacy live 5-axis radar.
  `StatRadar` gained an optional `overlay` (dashed polygon) + legend.
- **DRAG-TO-REORDER (2026-07-19)** — `client/src/ui/train/reorderable-list.tsx`
  (fixed-row-height, grip-handle pan on gesture-handler+Reanimated; `_layout.tsx`
  now wraps the app in `GestureHandlerRootView`). Used in the Routine Builder
  (reorders `plan[day]`, which SAVE persists) and DURING a workout via a
  "⇅ REORDER EXERCISES" toggle (persists to a new today-scoped `order` override
  in the session store; applied by `applyOrder()` in `session-plan.ts` AFTER
  `buildEffectivePlan`, so add/remove/skip/substitute are untouched). The
  Routine Builder's full exercise library is now COLLAPSED by default behind a
  "BROWSE THE FULL LIBRARY" toggle so SAVE MY PLAN is no longer buried; the
  search bar stays the always-visible fast path. Today's "CHOOSE WORKOUT"
  utility is now "CHOOSE/UPLOAD MY WORKOUT" (testID `change-workout` unchanged).
  Verified end-to-end on web (Playwright, ALPHA).
- The 8-phase product transform (`EVOFORGE_TRANSFORM.md`) — P1–P8 complete.
- `PHASE_3_PLAN.md` (Stage 1: flexible workout logging) — complete.
- `TRAIN_IMPROVEMENTS.md` (finish marker + week bars) — complete.
- `TRAIN_PAGE_V2.md` (the workout as its own page) — complete.
- The Add Exercise redesign (960-exercise library, ranking engine) — complete.
- KG⇄LB per-exercise toggle (`domain/units.ts`; DB stays kg forever) — complete;
  migration `020` **applied 2026-07-15**, column read back (`weight_unit`, default kg).
- The inline `ExerciseSearchBar` on every add surface (`data/exercise-corpus.ts`
  is the shared recipe) — complete.
- PLAN SCAN (photo/typed workout → `ai-plan-scan` → corpus-mapped draft →
  builder → MY PLAN; `domain/workout-import.ts`) — complete; `ai-plan-scan`
  **deployed 2026-07-15** and falsified end-to-end (real OpenAI call, shorthand
  normalized, repeat call cache-hit). En route found+fixed: 007's `kind` check
  rejected `'plan-scan'`, so the cache AND the hourly rate limit were both dead
  for scans (storeCache swallows errors) → migration `021` extends the check.
- SUPABASE_SETUP.md steps all done; `SUPABASE_ACCESS_TOKEN` repo secret set and
  the parked CI step wired into `client.yml` — edge functions now deploy on push.
- FUEL (nutrition) is ON MAINLINE — the old `origin/nutrition` branch is
  superseded; its SQL landed as `037_nutrition.sql` (+ `043_meal_scan.sql`
  macros), both applied. See §875ff for the numbering note.

- **SOCIAL FEED — FOUNDATION + FLAGGED SLICE 2026-07-18** (Tyson's spec):
  built on the existing friends/rivalry backend (036 — friend_codes/requests/
  friendships/rivalries + definer RPCs, already live). NEW this pass:
  `migrations/049_social_feed.sql` (social_posts[typed envelope + payload
  jsonb], social_reactions[1/user/post], social_comments; owner RLS; the
  `social_feed(scope,before,limit)` definer RPC enforcing own+friends-visible+
  public; `toggle_reaction`; `are_friends` helper revoked from clients) —
  **WRITTEN, NOT YET APPLIED**. Client: `domain/social-feed.ts` (the 7-type
  discriminated union + `toPost` validator + `applyReaction` + `relativeTime`,
  12 tests), `data/social-feed.ts` (useSocialFeed infinite query + optimistic
  useToggleReaction, degrade-to-empty), `ui/social/*` (post-cards for all 7
  types + shared shell + reaction-bar + the Social screen: FOLLOWING/RIVALS/
  DISCOVER tabs, friends activity row, empty/loading states). **049 APPLIED to
  production + `feedEnabled` FLIPPED ON 2026-07-18 (Tyson).** Migrations applied
  through **049**; next free **050**. Verified LIVE vs prod as ALPHA:
  social_feed→200, cards render, toggle_reaction→200. Apply-time fix:
  avatar_progression has NO stage column → the RPC returns `null::int as
  author_stage` (cards use the author initial, never a faked sprite). **THE
  GAP: nothing writes social_posts yet → real feeds are EMPTY (the polished
  YOUR-FORGE-IS-QUIET state).** Two demo posts seeded on ALPHA (friends-only,
  invisible to real users), removable. **POST CREATION + COMMENTS SHIPPED
  (050 applied):** the feed is now a full loop — CreatePostModal (`＋` in the
  header) shares an UPDATE (text `status` post), the latest WORKOUT (real
  sets/volume via `workoutPostPayload` from workout_log), or the latest PR
  (recentPr) with a visibility choice; CommentsModal reads via the 050
  `post_comments` definer RPC + inserts under RLS; own posts delete via the
  `⋯` (soft delete). All verified LIVE vs prod as ALPHA: create→201,
  post_comments→200, comment→201, delete→204. `status` is the 8th post type
  (migration 050 widened the CHECK). STILL DEFERRED: photo upload, privacy
  granularity beyond visibility, notifications, event-driven share prompts,
  contextual-action deep links, discover/public infra. + photo
  upload); comments UI; privacy composer; notifications; pagination polish;
  contextual-action deep links. The nav list in Tyson's spec (Home/Train/
  Social/Forge/Arena) is STALE — it would drop Fuel + re-add Forge; kept the
  current bar. Home avatar now shows a "TAP YOUR CHAMPION TO ENTER THE FORGE"
  hint (avatar-hero.tsx).

- **TABS — Forge → Social 2026-07-18** (Tyson's call): the bottom bar dropped
  Forge and gained **Social** (`app/(main)/social.tsx` — an HONEST "COMING SOON"
  placeholder, not a mocked feature; awaits Tyson's spec). The Forge/avatar
  screen is unchanged and now opens by tapping the champion on Home
  (`AvatarHero.openCharacter → /avatar`, already wired); `avatar` is `href:null`
  (routable, off the bar). Idle prefetch swapped `/avatar`→`/social`. New
  `PixelPeople` tab icon. Bar is now Home·Train·Oracle·Social·Arena·Fuel.

- **FUEL BATCH — EXECUTED 2026-07-18** (Tyson's follow-up asks): (1) the
  QuickLog label input moved to its own full-width row so it fits at 320px;
  (2) **calories BURNED** (cardio_log.calories, `useCaloriesBurned`) fold into
  the day's ceiling — `effectiveTarget = daily_kcal + burned`, meter + macros
  computed against it, summary shows a "1,994 +320 burned" line (real data,
  invalidated when cardio logs); (3) **food SEARCH** — `searchFoods` via OFF
  **v2 `/api/v2/search`** (the legacy cgi/search.pl is throttled → HTML error
  page; v2 returns clean JSON), a debounced `FoodSearchModal` that appends
  MealItems; (4) **DESCRIBE / RECIPE** — a text modal (`describe-meal.tsx`) →
  `describeMeal` → the meal-scan edge fn's NEW **text mode** ({text} OR
  {image}; recipe with a serving count → ONE serving; the deterministic food
  table still prices, the AI only names foods+grams — the photo doctrine).
  All four doors (scan/search/barcode/describe) on the meal card land in the
  SAME confirm sheet and save via useLogMeal (which refuses over-CHECK totals).
  Also: `useLogCardio` now writes cardio_log.date as the LOCAL day (localIso).
  **The edge fn change deploys on push** (supabase/** in client.yml). Toured
  live: burned math (remaining 1,894 = 1994+320−420), search 13 live hits →
  confirm 159 kcal, 320px label fit, no overflow. Tabs-removal ask deferred to
  Tyson (which of the 6 is ambiguous + destructive).

- **CARDIO_REDESIGN — EXECUTED 2026-07-18** (Tyson's brief + reference mock):
  the CARDIO mode of Train (today.tsx mode===1) is now `CardioDashboard`
  (`ui/train/cardio/*`), replacing the old `CardioCard` (cardio-logger.tsx
  DELETED; `cardioAnim` moved to `ui/train/cardio/activities.ts`). Composition:
  DailyCardioSummary (today's minutes vs a DEFAULT goal, mission bar, streak,
  week sessions) · CONDITIONING SESSION card = ActivityTypeSelector (7
  pixel-iconed activity cards, no emoji) + CardioSessionForm (adaptive fields
  per activity — the cardio-logger field map verbatim — duration presets,
  optional INTENSITY, expandable notes, LOG SESSION) · CardioRewardPreview ·
  WeeklyCardioProgress (Mon→Sun strip) · RecentCardioSessions (empty state).
  **THE HONESTY LINE:** cardio-score.ts's rule is that logging sessions earns
  Forge XP, NEVER Cardio Score — the Conditioning pillar is measured from
  fitness TESTS at the scheduled Evo Review. So the reward preview shows ONLY
  the real +Forge XP (floor(minutes×2) = cardioEventAmount, the migration-002
  literal the save actually grants) and a truthful "Conditioning pillar is
  measured from fitness tests at your next Evo Review" — NO fabricated
  +conditioning/+cardio-rating/+recovery numbers (the reference mock's chips
  have no backend). `DEFAULT_CARDIO_TARGETS` (daily 30 min / weekly 4 sessions
  / 120 min) is a labelled suggested goal, not stored user data (the Fuel
  DEFAULT_MACRO_TARGETS precedent). Save contract + every testID preserved
  (cardio-minutes/distance/incline/speed/calories/rounds/notes/save/speed-unit;
  boxing minutes=rounds×len, mph→km/h on save, mins≤0 refused, XP grant
  unchanged). New pure `domain/cardio-stats.ts` (todayMinutes/weekStart/
  weekStrip/weekTotals/cardioStreak/dailyMission, 16 tests, all take todayIso —
  the no-wall-clock rule). Intensity + boxing rounds ride in `notes` (no schema
  column). Toured (ALPHA): empty + rich (READ-intercepted) states, boxing↔run
  field adapt, presets/intensity, XP preview +60 @30min; 320/390 clean.

- **ORACLE_REDESIGN — EXECUTED 2026-07-18** (Tyson's brief + reference mock):
  ai.tsx (THE ORACLE) rebuilt as a composition over `ui/oracle/*` — OracleHeader
  (hero title over ScanBackdrop — one useAmbient-gated sweep + static motes —
  framed champion + Forge LV) · PhysiqueScanCard (premium BodyScanner FRONT/
  SIDE/BACK slots that glow when filled, RUN ANALYSIS, animated reveal
  SCANNING→✓→tiered /100 face + count-up + three filling AttributeBars +
  Top-Strength/Main-Weakness/Recommended-Priority) · EvolutionImpactCard
  (**HONEST** — reads REAL `evo_rating_current`; shows the rating + the
  Aesthetics/Size pillars the verdict feeds + WHEN it applies at the next
  scheduled review; renders a "run first review" pointer, NEVER invented
  numbers, when no rating exists) · BodyfatScanCard (FRONT/BACK, count-up %,
  four-band BodyfatScale marker, lean/fat MassTiles only when a real
  bodyweight is known) · RoutineForgeCard (six goal CARDS — free goal strings
  to the same ai-plan fn — with a REAL Oracle Summary naming the weakest
  attribute) · OracleHistoryCard (timeline of STORED VERDICTS, never photos;
  PROGRESS-SINCE-FIRST-SCAN deltas + score sparkline + tap-to-expand
  sub-scores). THE REAL FLOW IS UNCHANGED: estimate save:false → confirm
  conditions → finalize save:true; photos live in state only and DROP on save
  (the house privacy rule). Pure domain `domain/oracle.ts` (tier/scoreOutOf100/
  attributeLines/top+weakness/bodyfatScale/massSplit/scanProgress, 16 tests);
  history hooks `data/oracle-history.ts` (usePhysiqueHistory/useBodyfatHistory,
  invalidated on save). Reveal hooks `ui/oracle/oracle-anim.ts` derive the
  non-animating case in render (no setState-in-effect) and reduced-motion →
  final immediately; light success haptic on save (native only). Toured
  (ALPHA): empty states, goal selection, and rich history/impact via READ
  interception; 320/390 clean, no overflow. NOTE: the photo before/after
  SLIDER from the brief is deliberately NOT built — solo photos are never
  persisted, so the honest substitute is the ratings-based
  PROGRESS-SINCE-FIRST-SCAN comparison.

- **FUEL_REDESIGN — EXECUTED 2026-07-18** (Tyson's reference mock): fuel.tsx
  is now a composition over `ui/fuel/*` — FuelHeader (framed champion + Forge
  LV, the Train pattern) · NutritionSummaryCard (remaining kcal loud + three
  macro rows; two-col ≥380px, stacked below; meter colour rules unchanged) ·
  AIMealScanCard (epic treatment; photo scan AND the new **barcode scan**
  share ONE confirm sheet + useLogMeal) · MealsSection (slots wear
  BREAKFAST/LUNCH/DINNER/SNACKS via `mealSlotName` — position IS meaning,
  meal_no stays the contract; 5..8 stay numbered; ＋/− MEAL kept) ·
  FuelBonusCard (protein goal; **deliberately NO "+Recovery XP" promise —
  no such backend exists**, hidden-never-mocked) · QuickLogCard (+100/200/
  300/500 chips ADD to the field; LOG IT is the only write) ·
  DailyTargetCard · converter + quick-adds kept. Domain adds (all tested):
  `mealSlotName/macroProgress/macroTargetsFor` (2g/kg when intake knows
  weight, else 30/40/30 split; `DEFAULT_MACRO_TARGETS` fallback)
  /`mealMacroTotals`/`streakDays` (unlogged TODAY doesn't break the run).
  Data adds: day query now selects `protein_g/carbs_g/fat_g`;
  `useNutritionDates` (streak window, invalidated by every log/delete).
  **Barcode:** `@zxing/browser` lazy-imported over getUserMedia
  (`ui/fuel/barcode-video.web.tsx`; native twin stubs unavailable → photo
  decode → manual digits), product lookup = direct Open Food Facts v2 fetch
  (`data/food-lookup.ts` — keyless+CORS-open, per-100g normalised, serving
  default). NeonButton grew the `epic` variant; pixel-icons grew the fuel
  set (sun/bloom/moon/apple/muscle/bolt/drop/camera/barcode/target/shield).
  Toured against production (ALPHA): real OFF lookup via the modal
  (Coca-Cola 139 kcal/330ml), quick-log write→delete self-cleaned, rich
  state via READ interception. **Tour gotcha: the origin-v5 DISCOVER YOUR
  ORIGIN sheet floats over every page for accounts without an origin — click
  its LATER before driving anything.**

- **`TRAIN_OVERHAUL.md` — EXECUTED IN FULL 2026-07-15** (4 commits): hero
  briefing card (title/sub split, muscle pills, ≈SETS/MIN/KCAL, hero
  START/RESUME), pixel icon kit + tab dumbbell, three grey utilities +
  CHANGE WORKOUT sheet (the one source switcher; scan rows in both sheets),
  THIS WEEK status circles + PARTIAL (marker && done<target; derivation never
  invents it; still locked). Toured against production incl. seeded
  RESUME/PARTIAL; seeds deleted.
- **Neon MuscleMap (Tyson's spec, same day; refined ×2 on his feedback)**
  replaced the first-pass pixel body: two permanent black 16-bit base
  characters (`client/assets/muscle-map/`) under translucent 3-layer cyan
  SVG overlays (`ui/muscle-map/`, stepped 6px staircase paths in the images'
  887×1774 grid), FRONT|BACK toggle w/ smart default, zone zoom (all-upper →
  torso, all-lower → legs, mixed → full; `focusFor`), pulse gated on reduced
  motion, `domain/muscle-map.ts` = the pure 15-MuscleId contract + label
  normaliser + `pillLabelsFor` (the hero chips speak the same fine
  vocabulary — Triceps, never "Arms"). Regenerate paths: scratchpad
  `gen_muscle_paths.py` — pec plates are cv2-contour-EXTRACTED from the art
  itself (bright regions only; the shadowed delt/arm regions fragment under
  thresholding and stay hand-authored over gridded 2× crops).
- **Krita hand-drawn masks (Tyson, 2026-07-15) now drive the FRONT overlays**
  for ALL 12 front regions (chest/shoulders/biceps/triceps/forearms/traps/
  abs/obliques/quads/abductors/adductors/calves — the last five landed the
  same evening; abductors+adductors became their own MuscleIds) — the .kra is the
  source of truth, extracted by `tools/extract_muscle_masks.py` (decodes
  Krita's LZF-planar tiles; refuses to export unless its recomposite is
  pixel-identical to the file's own mergedimage.png). Exact masks +
  pre-tinted `-lit` variants (white fill → #18D9FF, black linework kept —
  RN tintColor would recolour the lines) in `client/assets/muscle-masks/`.
  BACK view: 9 Krita-masked regions (`silhouette - back.kra` — rear delts,
  triceps, traps, calves, hamstrings, glutes, erectors→lowerBack, lats,
  upperback); only back forearms/biceps still ride SVG paths. Lit fills bake
  ~51% alpha (FILL_ALPHA in the tool) so the base model's definition shows
  through; linework stays full-strength. The tool's proof ladder: mergedimage recomposite (opacity-aware —
  Tyson dims the base while tracing) → prior-export equivalence →
  --base-proof vs the source PNG. Dev workbench:
  `/muscle-lab` (renders nothing in production; enable locally via __DEV__
  or EXPO_PUBLIC_MUSCLE_LAB=1 at export).

- **2026-07-15 LATE SESSION (one Claude, ~15 commits) — the Train hub in its
  current form.** Read this block before touching `(main)/today.tsx`:
  - **Daily carousel**: the hero card swipes one calendar day at a time
    (`ui/train/daily-workout-carousel.tsx` — paged FlatList, today ±7 via
    `datesAround`, `CAROUSEL_REACH` to widen). Every card derives from ITS
    date (`cardDataFor(date)` in today.tsx): progress via `setsFor(date,…)`
    (isolation is structural), states START / CONTINUE (sets, no marker) /
    VIEW WORKOUT (marker) / REST DAY / NO WORKOUT PLANNED. This Week rows
    FOCUS the carousel (`carouselRef.scrollToDate`); the card button is the
    door. The figure is tap-to-flip (horizontal swipes = day).
  - **EQUAL CARDS**: `CARD_HEIGHT` 396 on wrapper+list+items; GlowCard
    `fill`; footer `marginTop:'auto'`; figure in a fixed 40%×196 box; chips
    in a fixed 56px area capped 3+`+N`; everything numberOfLines-clamped.
    Content must NEVER size a card.
  - **16-bit type**: Silkscreen Reg+Bold (`assets/fonts/`, `theme/fonts.ts`,
    loaded in root `_layout`, no splash gate). `pixelFont(bold)` helper;
    NeonButton `pixel`, SegmentedTabs `pixelLabels`. DISPLAY text only —
    subtitles/helper copy stay sans. Real Bold face, never fontWeight.
  - **Source switching**: `sourceDayFor` (week-status.ts) renames today +
    future onto the chosen plan — keep-rule is per-WEEK ownership (per-day
    froze on name collisions: all of Tyson's plans have a "Legs"); past
    dates never rewrite. The card sub-line names WHOSE version renders
    (plan_name / 'Built-in Routine').
  - **Copy (2026-07-16)**: CHOOSE WORKOUT / QUICK WORKOUT / EDIT SCHEDULE
    (+subtitles); sheet options MY PLAN / AI PLAN / EVOFORGE PLAN
    (`SOURCE_LABEL[2]` renamed); SCAN WORKOUT, EDIT/CREATE PLAN, CREATE AI
    PLAN, CANCEL; schedule page heading EDIT SCHEDULE. testIDs unchanged.
  - **Taxonomy is 19 tags**: Erectors + Abductors (retagged exercises ride
    the same commits; conventional deadlifts are erector-primary; RDL/GM/
    Rack Pull carry Erectors as secondary). Avatar heat map untouched by
    design — it recomputes via parity-pinned inferMuscleGroup(name).
  - **Pending / loose threads**: back-view forearm+biceps masks (draw →
    `tools/extract_muscle_masks.py <kra> back` → add ids to BACK_MASKED_IDS
    + requires in back-masks.ts); verify the CI deploy of `0cd1769` went
    green; old TASKS.md `[human]` items. Tour screenshots for Tyson land in
    `Downloads/evoforge-screenshots/` (he cannot see Claude-context images).

- **`HOME_REDESIGN_PLAN.md` — EXECUTED IN FULL 2026-07-16**: Home is the
  RPG character hub (Tyson's mock): HomeHeader (wordmark + LV/XP module →
  /profile), AvatarHero (HeroStage with tier/form/evolution badges +
  CUSTOMISE overlaid ≥380px, row below under that), TODAY'S MISSION (all
  states via `domain/home-mission.ts`; reward = activityXp over the plan's
  sets, coins never implied), status grid (streak/coins/XP/tier doors),
  TRAINING OVERVIEW (contract + periodTotals, no fabricated goals), RECENT
  PR (`domain/recent-pr.ts` — set-save's e1RM rule replayed for display),
  EvolutionTeaser, schedule door, the build bars (kept). Flags in
  `ui/home/home-features.ts` — LOADOUT hidden (no cosmetic backend), and
  that is the rule: A SYSTEM WITHOUT A BACKEND IS HIDDEN, NEVER MOCKED.
  Home computes the mission EXACTLY like the Train hub (same sourceDayFor /
  resolveDay / setsFor / estimates) so the two screens cannot disagree.
- **The pixel face is now Jersey 25 (display) + Jersey 10 (small labels),
  2026-07-16** — Silkscreen's W and ~ were unreadable (Tyson), Pixelify
  Sans's bold 5 reads as S (side-by-side proof in the session log). Single
  weights: `pixelFont()` still maps bold→Jersey25/regular→Jersey10; never
  synthesize bold. `~` estimate prefixes became explicit `EST. MIN` labels.

- **`OPTIMISE_PLAN.md` — EXECUTED 2026-07-16 (same session as the Home
  redesign):**
  - **Route-level code splitting IS possible on this pipeline** — expo-router
    `asyncRoutes: {web: true}` (app.json). The 3.5MB single entry became a
    1.1MB entry + 1.8MB shared chunk + ~25 per-route chunks (Home 55KB,
    Train 38KB…). §7's old "no splitting" claim is dead.
  - Platform twins keep native-only weight off web: `data/url-polyfill.*`
    (whatwg-url/punycode) and `data/session-storage.*` (aes-js/buffer —
    supabase falls back to localStorage on web, which is safe here).
  - **`src/ui` is grouped by feature now**: `core/` (shell, hud, buttons,
    icons, fields) · `character/` (avatar, stage, sprites, XP, evolution) ·
    `train/` (logger, picker, carousel, cardio) · `arena/` (battle,
    leaderboard) · `home/` · `muscle-map/`. No barrels (they fight
    splitting). Dead components deleted (quest-card, stat-meter,
    avatar-card — unreachable after the Home redesign).
  - **Motion**: root boot cross-fade (M3) + ScreenShell one-shot focus
    fade/rise (M1), both reduced-motion gated; verify-motion still green.
  - **Idle tab preload** ((main)/_layout): once signed in + idle,
    `router.prefetch` background-mounts the four sibling tabs, so every
    tab switch is 60–80ms with ZERO network (falsified with a
    request-counting tour). Safe by audit: no tab screen has mount-time
    subscriptions; focus-scoped effects stay focus-scoped. The workout
    page is NOT preloaded (params-dependent). If a future tab screen
    gains a mount effect, re-audit this list.
  - Moving a ui file one level deeper breaks its `../assets/` imports —
    the codemod missed them once; tsc alone does NOT catch broken asset
    requires (only `expo export` does). Export before trusting a move.

- **AI cost/latency routing (2026-07-16, falsified live):** `ai-plan` and
  `ai-plan-scan` ride `FAST_MODEL` (gpt-5-mini) with `reasoning: low` —
  generation/transcription with large outputs, ~5× cheaper and faster;
  validatePlan/validateScan stay the quality gate. **The three judges
  (bodyfat, physique, battle-physique) stay on gpt-5.1 ON PURPOSE** —
  verdict consistency across an athlete's history and battle fairness
  outrank pennies; don't downgrade them for cost. All calls request
  `json_object` (a malformed response was a wasted paid call). Real-money
  facts: every paid action is one `callOpenAiJson` round trip; per-user cap
  is `HOURLY_LIMIT` 10/hr across kinds; the content-hash cache makes
  repeats free; Supabase is the FREE plan (14MB / 500MB used).
  **`supabase/**` is now in client.yml's trigger paths** — before this, a
  functions-only push triggered NO workflow and deployed nothing (the
  committed-but-undeployed trap, structural edition).

- **PROGRESSION_OVERHAUL (2026-07-16, executing): P1+P2 SHIPPED.**
  `domain/progression/` carries the Evo Rating core: 30/25/30/15 geometric
  mean, tier gates with SMOOTH soft caps (raw 92 failing a 90-gate reads
  89.x, explained), L100 manual-only, four pillar calculators (size FFMI/
  frame/regional · aesthetics w/ definition PLATEAU below healthy bf ·
  strength best-2-of-last-4 w/ the ONE movement mapping + versioned
  reference curves · cardio provisional-never-zero), confidence-before-
  score staleness, evo-state peak-ratchet reducer. 49 new tests. Forge
  curve TS+SQL twins pinned by machine-verified fixture. Migrations
  023/024 APPLIED + falsified (guard clamps forged XP to server values;
  snapshots immutable; peak/starting trigger-enforced). Flags OFF in
  `data/progression/features.ts` — nothing user-visible yet.
- **P3 SHIPPED (same session): the recurring Evo loop.** Pure:
  `evidence.ts` (staleness windows; the DECLINE RULE — 2-of-last-3 below
  noise, no protective marker, or nothing moves) + `evo-review.ts` (the
  weekly review as ONE pure function: strength/cardio recompute,
  Size/Aesthetics preserved between scans, forecast generated). IO:
  `data/progression/evo-review-io.ts` + `use-evo-rating.ts` hooks.
  Migration 025 (cardio_evidence; strength_evidence DEFERRED — derivation
  from workout_log beats duplication until P9 anti-cheat needs the audit).
  **TRUST BOUNDARY: the review computes client-side; DB triggers enforce
  peak-ratchet/starting-write-once/immutability. Competitive surfaces and
  any Evo leaderboard must NOT read evo_rating_current as authority —
  server recomputation first (the xp_drift-refusal doctrine).** Falsified
  against production with ALPHA's real data (rating 46 Trained, honest
  provisional confidence, due-gating idempotent); smoke rows deleted.
- **P4 SHIPPED (same session): Forge Level + Weekly Momentum.**
  `momentum.ts` (weeks vs target; misses DECAY by 2, protective modes and
  recovery weeks BRIDGE, the current week is never judged early);
  migration 026 APPLIED: weekly_momentum + `forge_claim_weekly` (server
  re-proves the week: 100%→250 XP, 80%→150) + `forge_migrate_history`
  (the §43 one-shot: ALPHA's real history → 5 sessions → Forge Level 2,
  legacy 1020 XP frozen; rerun = 0 new). The 023 guard now recognises
  SECURITY DEFINER grants by current_user — a distinction PostgREST
  clients cannot forge. Client: `award-xp.ts` (event-key builders, send 0
  and let the server decide) + `use-forge.ts` hooks. ALPHA's Forge rows
  are REAL migrated data and stay (permanent smoke fixture).
- **P5 SHIPPED — THE FLAG IS ON (`newProgressionEnabled` +
  `evoReviewsEnabled`).** Home carries the EVO CORE (spec §30 hierarchy:
  rating/descriptor, four pillars w/ limiting highlighted, Evolution bar,
  review countdown; no data → DISCOVER runs the first review). New routes
  `/evo` (spec §31: current/starting/peak, pillars+confidence, forecast,
  pending evidence, review history, manual review) and `/forge-level`
  (spec §32: level, ledger, Momentum, weekly claim, the legacy record
  line). The (main) layout runs the idempotent history migration + the
  due review on launch (invalidates the reads after). finish-queue
  awards workout_completed XP on every confirmed flush (fire-and-forget;
  awardForFinish looks the marker id up itself — do NOT chain .select on
  the queue's insert, the tests pin the plain shape). Toured against
  production: ALPHA reads 46 TRAINED w/ real pillars; zero console noise.
  REMAINING for the full terminology sweep: the header LV. module and
  rarity badges still speak the LEGACY level — swap their source when
  the old level retires (deliberate: two vocabularies never at once,
  and the legacy level remains the app-wide `summary.level` consumer
  contract until then).
- **P6 SHIPPED: guided Evo Scans + Evolution Chapters.** Migration 027
  (physique_assessments + evolution_chapters + the ai_scan_cache kind
  extension — the 021 lesson, applied BEFORE it bit). `evo-scan` edge fn:
  2-3 photos + bodyweight/waist → sub-scores + 14 regional scores on the
  gpt-5.1 judge; 28-day eligibility; >6-point swings come back
  pending_confirmation (7-day confirmation window). **Solo photos are
  STILL never persisted — hashes only; the house privacy rule outranks
  the spec's bucket design** (battle round-3 stays the lone exception).
  /evo-scan guided screen; a confirmed scan postdating the last review
  feeds Size/Aesthetics THROUGH the pillar calculators at the next
  review. Chapters: first review opens chapter 1; reviews roll chapters
  every 84 days with before/after summaries (maintainChapters in
  evo-review-io).
- **P7 SHIPPED: Rival Rank.** Glicko-2 lives as a FOURTH byte-pinned
  contract: `contracts/rival/glicko2.ts` master → client domain copy +
  functions copy, `scripts/verify-glicko.mjs` (in CI) — and the maths is
  pinned to Glickman's published worked example (1500/200/0.06 →
  1464.06/151.52/0.05999). Migration 028: competitive_ratings (NO client
  write policy — `rival-settle` service-role only), competitive_matches
  (unique(battle_id) = the settle idempotency lock), ghost_snapshots.
  rival-settle verifies the settled battle + participants server-side and
  rates BOTH players. `/rival` page reconciles unrated settled battles on
  visit (idempotent). Tiers Iron→Apex ×III/II/I, 5 placements, RD-based
  confidence; matchmaking constraints (never rank-only, never Evo-only,
  farming cap) in rank-tiers.ts. `/rank` remains the XP leaderboard —
  its drift gates are load-bearing; do not rename it into Rival Rank.
- **P8+P9 SHIPPED — THE OVERHAUL IS COMPLETE.** player-stats.ts (the §25
  mapping; Technique from history alone, log-plateaued), versioned Evo
  Class rules (first match wins, Specialist fallback, always explained),
  confidence-GATED traits (a 75 strength at confidence 20 earns nothing),
  Equalised/Handicap ruleset transforms. Migration 029: player_stats,
  player_traits, analytics_events (thin, no PII), evo_rating_audit
  (immutable trail of every official movement). The review pipeline now
  ALSO: clamps impossible jumps (±8/review, NAMED in changes + flagged in
  audit), refreshes stats/class/traits, writes audit + analytics — all
  best-effort riders that can never fail a review. Falsified live as
  ALPHA end-to-end. PLAYER STATS panel on /evo.
  DEFERRED HONESTLY: ghost-match UI (table + snapshots exist), seasonal
  events, notifications (needs native push), Evo leaderboards (need the
  server-recomputation gate first — the audit table is its foundation),
  battle-engine stat integration (rulesets are pure transforms awaiting a
  battle-format decision; the engine stays byte-pinned).

- **Mass Monster sprite set (Tyson, 2026-07-16):** WAS five GIFs in
  `client/src/assets/sprites/mass-monster/` (rotations-8dir · walk · run ·
  jab · cross, 92×92 @200ms) — ALL RETIRED by the redesign pack below. The ROTATION is the main avatar now:
  `animatedAvatar(branch)` in avatar-art.ts (one shared idle until
  per-class gifs land — extend ANIMATED_AVATARS), rendered by AvatarStage
  behind the SAME reduced-motion/perf gate as every ambient loop (static
  art fallback), `imageRendering: pixelated` for crispness. The PATHS
  page previews it on active/eligible mass-line destination cards.
  Falsified: gif in DOM + two captures 700ms apart DIFFER (it really
  rotates). The walk/run/punch gifs await the battle layer.
  **Correction (Tyson, same day): the rotation is MASS-LINE ONLY** — a
  shared default had replaced his Aesthetic stage-3 art with the wrong
  body. Never substitute one class's art for another's. The sprite
  renders 1.35× on the stage (92px frames carry more padding than the
  painted art), and the PATHS mass-line cards preview it in EVERY state
  (dimmed 0.55 while gates are closing). TOUR GOTCHA: tabs stay mounted —
  a querySelectorAll('img') "found it on PATHS" can be HOME's copy;
  assert on the right page's own state.
  **Aesthetic rotations, stages 1–4 (Tyson, same day):** `assets/sprites/
  aesthetic/rotations-stage{1..4}.gif` (124×124). `animatedAvatar(branch,
  stage, sex)` is now STAGE- and SEX-aware — male only until female sets
  land (no body substitution, ever). Sprites draw at 1.35× and translate
  DOWN by their MEASURED ~24% bottom padding (PIL-measured, constants in
  avatar-stage.tsx) or the character floats above the podium — re-measure
  when new sets land. PATHS previews any line with a rotation, dimmed
  until eligible.
  **Companion replaced with the Cyber Athlete pack (l4_aesthetic.zip,
  Tyson, 2026-07-16):** all four MALE stage sprite sets (idle = the
  8-frame rotation · run 8 · punch 3 · victory 3 from rotation poses)
  rebuilt from the pack's frame folders — strips + singles regenerated
  with PIL union-bbox trims, ASPECT re-measured, COUNT is now PER SEX
  (countFor — female sets keep their original counts/art untouched).
  Stale lvN_run_9/punch_4-6 removed. The old male companion character no
  longer exists anywhere. Regeneration recipe: the unpack + build script
  in the session scratchpad (frames land in assets/avatars/sprites).
- **Victory = the FRONT DOUBLE BICEP (Tyson, 2026-07-16):** 9-frame flex
  for stages 2-4 (stage 1 keeps the rotation sway until its art lands) —
  frame counts now DERIVE from the FRAMES arrays (the COUNT tables are
  gone; per-stage counts made a flat table a lie). Plays in the MISSION
  COMPLETE ceremony and the Home header companion (anim="victory").
- **THE LEVEL CUTOVER (Tyson, same day): the game level is the FORGE
  LEVEL — earned XP only, from zero.** Header LV. module (Home + Train),
  the level-up detector and the ceremony's LEVEL PATH read
  user_progression via forgeProgressFromRow. A one-shot service-role
  conversion granted migration:v1 events for ALL 8 users with history
  (idempotent keys), froze each legacy xp_events total into
  user_progression.legacy_xp, and set every evo_rating_current
  next_review_at = now() so EVERY current user re-reviews with the
  current formula at next open (users without ratings get their initial
  then — the launch effect covers both). STILL LEGACY-KEYED ON PURPOSE:
  avatar stages/evolution gates + the /rank leaderboard ride
  summary.level so no character regresses; rekeying evolution to
  Evo-gates is the next seam. summary.level no longer displays anywhere.
- **Retro SFX (Tyson, 2026-07-16):** synthesized square-wave blips
  (`assets/sfx/press.wav` 700→1050Hz chirp · `select.wav` 1500Hz tick —
  ORIGINAL, generated with python wave/struct; recipe in the commit).
  `ui/core/sound.ts`: HTML5 Audio on WEB only (native silent until
  expo-audio arrives with native builds), resolved via expo-asset like
  the sprite strips, always gesture-triggered so autoplay never blocks,
  gated on settings `soundEnabled` (default on; profile toggle beside
  perf mode; reset on sign-out like every store). Wired: NeonButton →
  press, Chip + SegmentedTabs → select. Falsified with an
  HTMLAudioElement.play spy: exactly ['press'] on a NeonButton click,
  ['select'] on a tab switch. NOTE: the sign-in button is a plain
  Pressable, not a NeonButton — silent by design.
- **THE AMBIENT GATE (Tyson: "everything lags", 2026-07-16):**
  `ui/core/use-ambient.ts` — ambient = FOCUSED + motion allowed. The idle
  tab preload keeps five screens mounted, and on web every Reanimated
  loop runs on the MAIN JS THREAD whether visible or not: five screens
  of auras/motes/floats/sprites ticking at once was the lag (presses
  queue behind animation frames on phones). Now gated: AvatarStage's
  four loops + the gif (static art when unfocused), ParticleLayer
  (renders nothing), muscle-map pulse, SpriteCompanion (frozen).
  Measured: ONE running animation app-wide at idle (was 5 tabs' worth),
  60fps at 6x CPU throttle. verify-motion now accepts useAmbient as a
  compliant gate (it embeds useReducedMotion) — extension FALSIFIED
  (broke a gate, guard went red, restored). Screen entrance trimmed to
  140ms/6px for snappier tab feel. RULE: new ambient loops use
  useAmbient, and it must only be called INSIDE navigator screens
  (useIsFocused throws elsewhere — root overlays keep useReducedMotion).
- **Sprite STILLS (Tyson: "the old PNG flashes on hero taps"):** gating
  the gif on focus swapped to the FALLBACK — the old painted art — for
  the transition frame. Every rotation set now has a frozen SOUTH pose
  (`stillAvatar()`, same canvas as the gif so the layout math aligns and
  nothing jumps): ambient → gif, gated → still, painted art ONLY where
  no sprite set exists. Falsified: 60ms after a hero press the Home
  stage serves still-stage3; the old PNG never appears. Stills for new
  sets: aesthetic = rotations/south.png; mass = gif frame 0 (recipe in
  the commit).

- **MASS MONSTER REDESIGN, stages 1–4 (Have_his_face_be_ful.zip, Tyson,
  2026-07-16):** the whole mass line re-drawn at 148×148 with per-stage
  sets, replacing the single 92×92 gif. Hero: `mass-monster/
  rotations-stage{1..4}.gif` + `still-stage{1..4}.png` — animatedAvatar/
  stillAvatar mass/titan branches are now STAGE-keyed like aesthetic
  (bottom padding measured 23.6–24.3%, the existing 0.24 constant holds —
  no layout change). Companion: the male sets now split by LINE —
  `companionLine(branchV2)` in domain/branches-v2.ts (PURE, unit-pinned:
  mass/titan → 'mass', all else → 'aesthetic'; a Mass Monster never wears
  another line's body) selects STRIPS_M/FRAMES_M/ASPECT_M (lvNm_* strips
  + singles, idle 8 = rotation · run 8 · jab 3 · victory 9 = most-
  muscular flex at L1, double bicep L2-3, flame-aura double bicep L4);
  female sets stay sex-keyed and untouched. Old walk/run/cross-punch/
  lead-jab east gifs deleted (referenced nowhere). Falsified in-browser:
  PATHS' mass+titan cards serve the dist asset whose MD5 equals
  mass-monster/rotations-stage2.gif (hash-matched — both packs name
  files rotations-stageN, so match by CONTENT hash, not filename) and
  two clipped screenshots 500ms apart DIFFER; Home hero still serves
  aesthetic stage 3. TOUR LESSON: canvas drawImage() samples only a
  GIF's FIRST frame per spec — a drawImage frame-diff is ALWAYS static;
  diff SCREENSHOTS instead.

- **CUSTOMISE — the champion select (Tyson, 2026-07-16):** Home's
  CUSTOMISE button now opens `/customise` (hidden Tabs.Screen pushed over
  Home — tab bar stays, Home keeps its scroll). Structure: roster grid
  (real classes; locks are the LIVE branch gates via branchPathsV2 +
  honest ??? COMING SOON slots) → HeroStage preview with live gates for
  locked champions → evolution-stage carousel (real ladders; locked
  stages previewable) → OUTFIT/AURA/EFFECTS/EMOTES tabs → EQUIP.
  PREVIEW ≠ EQUIPPED: the screen edits a local Selection; EQUIP writes
  the persisted loadout-store (AsyncStorage `evoforge-loadout`, cleared
  on sign-out in auth-context WITH its persisted copy — the every-cache
  doctrine). `domain/customise.ts` is the pure model (26 vitest pins):
  buildRoster/stageOptions/equipState/resolveDisplay — resolveDisplay
  re-validates the loadout against live state ON EVERY READ, so a gate
  that closes after equip silently falls back to the derived identity.
  Home renders through `data/use-display-identity.ts`; the header
  companion plays the equipped EMOTE (the real companion anims, forge-
  level gated). NOTHING here invents progression: roster locks = branch
  gates, stage locks = ladders, cosmetic gates = real Forge Level.
- **SKINS (Tyson: "red, green, yellow, orange, white, black recolours of
  all skins", 2026-07-16):** 120 generated palette swaps (luminance
  duotone, scratchpad gen_skins.py — regenerate in place when base art
  changes): both male lines' rotations+stills × 4 stages × 6 colours
  (assets/sprites/skins/) + female aesthetic painted × 6
  (assets/avatars/skins/). `ui/character/avatar-skins.ts` is a GENERATED
  require map; `skinned*` resolvers return undefined for 'standard'/
  missing sets and every caller falls back to base art — a skin can
  recolour a body, never substitute one. Applied on Home hero, customise
  preview, roster/stage/outfit cards. Companion strips are NOT skinned
  (v1 scope). Falsified in-browser: select red → equip → Home hero
  serves aesthetic-red-stage3.gif → SURVIVES A FULL RELOAD → standard
  re-equipped (cleanup).

- **FIX BATCH (Tyson's live reports, 2026-07-16 evening):**
  1. *"Mass Monster is missing stage 4; stages 1 and 2 are the same"* —
     the pinned core ladder spreads five rows over the THREE painted
     stages (1,1,2,3,3). `massArtStage()` in branches-v2 remaps the mass
     LINE to the aesthetic spread (25/50/75 → stages 1,2,3,4,4); wired in
     avatarStageRowsV2 (mass rows + the titan stageFor), customise
     currentStageFor, SpriteCompanion, PATHS destinations, the evolution
     teaser. Core goldens untouched. ALSO fixed: avatarImage() fell back
     to AESTHETIC STAGE 1 for any out-of-range stage (a stage-4 Mass
     Monster in the wrong body) — it now clamps to the line's own top.
  2. *"Epic Bloom is blocked despite me having it unlocked"* — his Forge
     Level is 3 (checked in prod), but his TIER is EPIC: tier-NAMED
     cosmetics now carry a `tier` unlock kind evaluated against the
     legacy display level's rarity (epic→Epic Bloom, legendary→Gilded
     Field); forge gates remain for the colour auras (crimson 5,
     emerald 10). cosmeticUnlocked takes an UnlockContext{forgeLevel,
     legacyLevel} now.
  3. *"Customising doesn't change the Forge avatar screen"* — avatar.tsx
     EvolutionView renders the DISPLAY identity (useDisplayIdentity):
     equipped branch/stage/skin/aura on the hero, the evolution line
     follows the displayed champion in the equipped skin.
  4. *"Each avatar grows 5% per stage"* — AvatarStage scales the body
     (sprite AND painted) by 1 + 0.05·(stage−1); the bottom-pad translate
     rides the grown size so feet stay on the podium. Measured in-tour:
     stage 3 = 360px vs 324 base.
  5. *"Music stops when EvoForge plays sound"* — HTMLAudioElement claims
     the platform MEDIA SESSION (iOS pauses Spotify for a 90ms blip).
     sound.ts now synthesizes the same square-wave chirps with WEB AUDIO
     oscillators (no media element, mixes with background audio); the
     WAV assets are deleted. Falsified: a Chip press constructs ZERO
     Audio elements and exactly one AudioContext. RULE: SFX must never
     create an HTMLMediaElement; a future native build must use the
     ambient/mixWithOthers audio category.

- **TITAN LINE + TRUE ADAM + LADDER FIXES (Tyson, 2026-07-16 late):**
  1. *Titan_L4.zip*: Titan stands on its OWN body now — cyberpunk Viking,
     rotations-stage{1..4}.gif + stills (136×136, pad 22.8–24.3% — the
     0.24 constant holds) in assets/sprites/titan/, plus all 7 skin
     recolours. avatarArtV2 male titan returns hasArt:true (the still
     stands in as painted). ROTATIONS ONLY: companionLine(titan) stays
     'mass' until Titan's move set lands; avatar-skins now resolves
     tables per-line explicitly (skinTables — skins must NOT follow the
     companion borrow). The stray "Viking warrior" folder in the zip is
     an L1 duplicate, ignored.
  2. *"Only 4 stages per skin; level 100 True Adam unlocks the Adam
     skin"*: avatarStageRowsV2 folds duplicate-art rows (uniqueStages —
     one row per BODY, current recomputed onto the kept ladder). Folded
     forms (True Adam, Titan Prime, Perpetual…) remain FORM NAMES via
     evolutionNameV2. NEW SKIN 'adam' (violet-shadowed white-gold,
     distinct from Volt): gated {kind:'tier', slug:'mythic'} = level 100
     exactly, label "REACH LEVEL 100 — TRUE ADAM". SkinItem carries
     unlock now; resolveDisplay/equipState validate skins like auras.
  3. *"Stages of locked champions show unlocked"*: stageOptions takes
     characterUnlocked — a locked champion's ladder is all-locked
     ("UNLOCK THIS CHAMPION FIRST"), previews only; your level lights
     stages only on champions whose gates you met.
  4. *"Equipping a lower-level avatar doesn't work"*: own-champion
     loadouts store branch:null (follow evolutions), but resolveDisplay
     compared null===branch and dropped every own-champion stage pick.
     Now (loadout.branch ?? derived.branch). Proven in-browser: stage 1
     + red equips, Home serves aesthetic-red-stage1 at base size (no
     growth at stage 1), form badge CYBER RECRUIT.

- **CARDIO MACHINE LINE (Enduro_L4.zip, Tyson, 2026-07-16):** the last
  silhouette falls — cardio has its own 4-stage blue-flame runner
  (120×120) in assets/sprites/cardio/ + all 7 skin recolours. BUILD
  NOTE: L4's frames carried only 15% bottom padding (vs the ~24% every
  other set measures); the build shifted its content UP 11px in-canvas
  (23px top clearance absorbed it) so the global SPRITE_BOTTOM_PAD
  constant holds — NORMALISE PADDING AT BUILD TIME when a pack deviates,
  never fork the layout constant. Cardio joins the 4-stage body spread
  (stageFor = massArtStage for both new classes; currentStageFor +
  PATHS special-case it — its shape DONOR stays 'hybrid' for
  silhouettes only). avatarArtV2: every male branch returns real art
  now. Companion remains the Cyber Athlete move set.

- **HYBRID REMOVED FROM THE GAME (Tyson, 2026-07-16):** at the V2 layer
  only — the pinned core resolver (golden-fixtured) still knows the
  branch, but resolveBranchV2 folds core-hybrid athletes into the
  AESTHETIC default line, branchPathsV2 offers no path to it, the
  customise roster lists five classes, and the PATHS destinations no
  longer feed it. Old persisted loadouts with branch:'hybrid' fall back
  to derived automatically (resolveDisplay's roster validation). The
  hybrid PAINTED ASSETS remain as the cardio/female SILHOUETTE shape
  donor only (displayDonor/shapeDonor keep returning 'hybrid' — that is
  internal geometry, not a class). The v2 sweep test now pins the fold
  WITH a hybridsSeen>0 positive control.

- **SHREDDER LINE (Shredder_L4.zip, Tyson, 2026-07-16):** the redemption
  arc gets its own body — hooded start → dual-blade blue-flame shredded
  (108×108, pad 25-27%). Replaces the old baked-background painted set
  (which could never silhouette); avatarArtV2 male shredder now returns
  the pack still as real art. Stages still ride BODY FAT (shredderStage).
  All 7 skin recolours; skinTables resolves shredder to its own set.
- **THE SKIN SHOP (Tyson: "colours locked by forge coins, price
  ascending, cheaper on aesthetics", migration 030):** colour skins
  (red→black) are BOUGHT with forge coins, PER LINE. Server is the
  authority: skin_price() holds prices, purchase_skin() (security
  definer, advisory-locked, balance-checked) writes the spend +
  user_skin_unlocks row in one txn. Prices — aesthetic 50/75/100/150/
  200/250, every other line double (100/150/200/300/400/500); ascending,
  aesthetic cheapest. 'standard' free, 'adam' stays the level-100 (mythic
  tier) reward — neither is priced.
  SECURITY LESSON (caught in falsification): my first 030 guard reused
  the `current_user not in (authenticated,anon)` bypass from the xp
  ledger — but inside a SECURITY DEFINER trigger current_user is ALWAYS
  the owner, so a raw client `spend` insert returned 201. Fix: a
  transaction-local GUC (evoforge.spend_authorized) that ONLY
  purchase_skin sets; the guard admits a spend only when it matches the
  row's source_id. A client POST is its own single-statement txn and can
  never set it. Re-verified: raw spend + raw unlock BOTH rejected, buy
  deducts exactly the price, duplicate/insufficient/unknown all rejected,
  cross-user reads empty. NEVER use current_user to gate a definer
  trigger — use a txn-local GUC or service_role.
  Client: data/skins.ts (useSkinUnlocks + usePurchaseSkin, invalidates
  wallet+unlocks), domain skinPrice/skinUnlocked/skinKey (display twins,
  pinned), equipState gains a 'buy-skin' state (the primary button
  becomes BUY · N COINS / NEED N COINS), the CUSTOMISE header shows the
  wallet, resolveDisplay/useDisplayIdentity take ownedSkins so a bought
  colour renders on Home/Forge and an unowned one falls back to standard.

- **CAPTAIN GYMERICA — the first PREMIUM CHARACTER (Captain_Gymerica.zip,
  Tyson, 2026-07-16):** a purchasable hero (10000 forge coins, one buy
  unlocks both stages) equipped as an avatar OVERLAY — his art shows on
  Home/Forge while the player's real training branch + stats stay
  untouched underneath. Two stages (armoured → 20kg-plate shield) + two
  looks: navy/cyan Forge Standard and the red/white/blue "United States
  of Aesthetics" (assets/sprites/gymerica/, 168×168). Renders at the
  STAGE-4 size everywhere (Tyson: "same size as a stage 4 character") —
  use-display-identity forces display.stage=4 for the overlay and
  GymericaPanel's HeroStage uses stage={4}; the ART still uses the real
  1/2 stage via source props.
  MODEL: additive overlay, NOT a BranchV2 — Loadout/Selection gain
  character/characterStage/characterSkin (branch system fully intact).
  domain/customise: SpecialCharacterId, GYMERICA/PREMIUM_CHARACTERS,
  characterStageOptions, resolveDisplay sets a `character` overlay field
  ONLY when owned (else falls back to the branch), equipState adds a
  'buy-character' state. UI: RosterSection premium cards, a dedicated
  GymericaPanel (preview + 2 stages + 2 looks), use-display-identity
  overlay branch. NO colour-skin set for Gymerica (his 2 looks are the
  whole wardrobe).
- **MIGRATION 031 — the character shop:** user_character_unlocks
  (select-only RLS) + character_price() + purchase_character() (security
  definer, advisory-locked, atomic spend+unlock), same secure pattern as
  030's skin shop incl. the evoforge.spend_authorized txn-GUC (source_id
  'character:gymerica'). Applied to prod + FULLY FALSIFIED as the smoke
  user: raw unlock insert + raw spend forge both rejected, insufficient/
  unknown/duplicate rejected, a funded buy deducts exactly 10000 and
  writes the unlock, cross-user reads empty. client: data/characters.ts
  (useCharacterUnlocks + usePurchaseCharacter). TEST-FUNDING NOTE: the
  coin guard runs even for direct management-API SQL (not service_role),
  so fund a test wallet by DISABLING coin_events_guard_bi around an
  adjustment insert, then re-enable; clean up the spend+unlock+topup
  after (ALPHA restored to 225 each time).

- **CRASH HOTFIX (Tyson: "app crashes every time I click Customise",
  2026-07-16):** a loadout persisted BEFORE the Gymerica overlay fields
  existed rehydrated them as `undefined`, not null — and `undefined !==
  null` is TRUE, so selection.character tripped gymericaMode into
  GymericaPanel with characterSkin=undefined → art lookup crash. Fixed at
  THREE layers: (1) loadout-store persist `merge` spreads DEFAULT_LOADOUT
  under the saved values so every rehydrated wallet is complete; (2)
  selectionFromLoadout defaults each field with `?? `; (3) the overlay
  checks use loose `!= null`. RULE: when you add a field to a PERSISTED
  zustand store, add a persist `merge` (or migrate) — a fresh account
  (my tours) never has the stale shape, so only real users hit it.

- **TURN-BASED BATTLE RPG BETA (Tyson, 2026-07-16):** a Pokémon-style 1v1
  system ADDED ALONGSIDE the byte-pinned BLITZ engine (never touched it).
  domain/battle-rpg/ is a pure, deterministic engine (RNG threaded → 17
  vitest pins: damage floor/defence/crit, stamina gating, priority+speed
  order, bleed tick, status expiry, regen, defeated-can't-act, victory,
  battle-over no-op, AI always-legal, gym anti-farm, stat-scaler band).
  4 champions (Elite Aesthetic/Titan/Apex/Shredded → aesthetic/titan/
  cardio/shredder sprites), 4 moves each + shared Recover, 5 statuses,
  createBattleStats maps real SIZE/AES/STR/CND at a controlled 0-20% and
  NORMALISES opponents toward the player's combat power (competitive
  across Evo Ratings). Modes: Gym (Iron Foundry / Brax, defensive AI),
  Rival (simulated Vex from Forge Level), Training (no stakes). UI:
  ui/battle/* (animated sprites via transforms — idle bob, lunge, hit
  shake+flash, victory glow, floating damage numbers; reduced-motion
  gated), MoveGrid (2×2 + Recover, unaffordable disabled), result modal,
  DEV-ONLY debug panel. Route app/(main)/battle.tsx (?mode=&gym=), 3
  cards on the Arena hub. Persistence LOCAL-FIRST (state/battle-rpg-store,
  cleared on signout) with migration 032 (battle_results/gym_progress/
  rivalry_records, applied) as the documented Supabase seam. Rewards are
  recorded locally, NOT minted into the guarded coin ledger (needs a
  server grant RPC — next step). CRASH LESSON: setting a Reanimated
  shared value INSIDE a withTiming completion callback stack-overflowed
  on web — use withSequence (the app idiom), never a callback that writes
  a value. Verified in-browser: full loop Arena→Training→pick→10-turn
  fight→VICTORY→+5 Forge XP; gym preview shows Brax.

- **BATTLE RPG — POKÉMON POV + real rewards (Tyson: "make it better, POV
  facing each other", 2026-07-16):** the turn-based beta got its visual
  transformation and a secure economy.
  * POV: ui/battle/battle-pov-art.ts extracts BACK (north-east frame) and
    FRONT (south-west frame) stills from each line's rotation GIF (no new
    art) — the PLAYER shows their back (near, lower-left, 148px), the
    OPPONENT their front (far, upper-right, 104px). BattleArena
    (ui/battle/battle-arena.tsx) fakes depth with two platforms + a
    perspective floor + a MODE-TINTED haze (gym=orange, rival=pink,
    training=cyan), SCREEN-SHAKES on impact and WHITE-BLINKS on crits/
    ultimates. Sprites lunge on the DIAGONAL toward the foe (art already
    faces correctly — no mirror). Typewriter message box with TAP-TO-
    ADVANCE (useBattle.advance skips the event dwell) + a speed order hint.
  * Audio: playHit/playCrit/playHeal/playVictory/playDefeat added to
    ui/core/sound.ts (Web Audio oscillators, web-only, settings-gated,
    mixes with music), fired per battle event.
  * 3 gyms now (config): Iron Foundry/Brax, Velocity Lab/Rhea, Mirror
    Hall/Cass + a badge case on the Arena hub. All reduced-motion gated
    (verify-motion: 11 components).
- **CRITICAL SECURITY FIX — xp_ledger exploit (migration 033, found while
  building battle rewards):** xp_ledger_guard used `current_user not in
  ('authenticated','anon')` to detect a definer grant, but inside a
  SECURITY DEFINER trigger current_user is ALWAYS the owner → the bypass
  fired for EVERY insert. A raw client POST of {event_type:'anything',
  xp_awarded:99999} LANDED VERBATIM — any user could mint arbitrary Forge
  XP (also a latent correctness bug: client rows stored xp_awarded 0).
  FIX: the txn-local GUC pattern (evoforge.xp_authorized='server') only
  definer grant functions set — forge_claim_weekly + forge_migrate_history
  updated to set it; client inserts fall to the allowlist (forces amount,
  rejects unknown kinds). SAME LESSON as the coin guard (030): NEVER gate
  a definer trigger on current_user — use a txn GUC or service_role.
  Falsified: the exploit + bogus workout + raw battle_win/battle_reward
  ALL rejected; legit paths intact.
- **grant_battle_reward RPC (033):** server-authoritative battle coins +
  Forge XP — idempotent per result key, DAILY-CAPPED (200 XP / 120 coins)
  so it can't be farmed; coin guard learns a 'battle_reward' kind admitted
  only via the spend GUC. Client: data/battle-rpg.ts (useGrantBattleReward
  → invalidates wallet + Forge Level). Battle HISTORY stays local (032
  seam) for the beta. Verified in-browser: gym POV battle shows Brax
  front-facing vs your back-view champion on a tinted stage; grant is
  live + capped.

- **BATTLE RPG — champion locking + VERSUS + UI polish (Tyson: "lock
  unlocked champions, improve UI/animation, add vs friends", 2026-07-16):**
  * LOCKING: domain/battle-rpg/unlock.ts (unlockedChampionSet /
    championRequirement) reuses the CUSTOMISE roster's live branch gates —
    a battle champion is playable iff its branch is unlocked. The picker
    (ui/battle/champion-picker.tsx) dims locked champions, shows a padlock
    + the nearest gate ("STRENGTH 55+"), and can't select them. A picked-
    but-now-locked champion falls back to the derived class.
  * VERSUS (pass-and-play, mode 'versus'): two humans on one device. The
    hook (use-battle) collects P1's move then P2's before resolving (no AI,
    reuses resolveTurn). A "PASS TO PLAYER 2" gate hides P1's pick until P2
    taps (derived from turnNumber — no setState-in-effect). P2 may pick ANY
    champion (guest); P1 is unlock-gated. Versus pays NOTHING (rewardsFor
    'versus' → 0/0), no rival/gym markers, result modal says PLAYER 1/2
    WINS. Scaling maps versus→training. Arena hub gains a VERSUS card.
  * UI/animation: a VS intro splash (ui/battle/vs-intro.tsx — champions
    slide in, VS flashes, reduced-motion gated); champion cards show HP/PWR/
    SPD mini-bars; the HP bar gained a classic "ghost" damage trail + a red
    low-HP state. verify-motion: 11 components.
  Verified in-browser: Aesthetic unlocked, the other 3 locked with gates;
  VS preview (P1 vs P2 pickers), the pass-device gate, and a resolved
  versus turn — zero page errors.

- **VERSUS BY CODE — async friend battles (Tyson: "it was meant to be VS
  join by code", migration 034, 2026-07-16):** create a challenge from your
  champion → get a 6-char code → a friend JOINS by code from their OWN
  device and battles YOUR champion (AI-driven from your real saved stats).
  Wins/losses post back (record_rpg_challenge_result) so you see how your
  champion fares. rpg_challenges (owner-RLS) + 3 definer RPCs
  (create/get/record — cross-user join goes through get_rpg_challenge, not
  the table). Code gen = md5 hex (pgcrypto gen_random_bytes is NOT enabled
  — use md5(random()||clock_timestamp())). FALSIFIED across two accounts:
  create → cross-user join → RAW table read blocked by RLS → record →
  owner sees plays/defeats → unknown code safe → owner self-play not
  counted. Client: data/battle-rpg-challenge.ts, ui/battle/challenge-hub
  (CREATE/JOIN tabs + a code display + a same-device pass-and-play link).
  Battle: mode 'challenge' builds the opponent from the CHALLENGER's real
  input (capStats clamps power ≤1.35× the joiner so it's tough not
  impossible); no reward (bragging rights); result posts back. The Arena
  "VERSUS · BY CODE" card opens the hub (pass-and-play kept as a
  same-device option). Verified in-browser 2-account: ALPHA created a
  code, BRAVO joined + fought ALPHA's champion to a result. LIVE
  move-by-move PvP remains the documented next step.

- **THE PALETTE SHOP (Tyson: "sell reskins of the entire website — colour
  palettes bought with forge coins, own for life, equip or remove whenever",
  migration 044, 2026-07-17):** whole-app recolours, per athlete. Six
  palettes — emerald 500 / crimson 750 / synthwave 1000 / solar 1250 /
  arctic 1500 / void 2000 (ascending) — sold by `purchase_palette()` +
  `palette_price()` on the exact 030/031 secure pattern (advisory lock,
  balance check, the `evoforge.spend_authorized` txn-GUC; ZERO coin-guard
  changes) into select-only-RLS `user_palette_unlocks`.
  THE THEMING LAYER: tailwind colour utilities now resolve through
  `var(--c-<key>, <standard>)` (generated in tailwind.config.js from
  tokens.js, which is UNTOUCHED — verify-tokens holds); `ui/core/theme-root`
  applies the active palette as NativeWind `vars()` + web
  `document.documentElement` properties (RN-web Modals portal outside the
  tree), so ~850 className usages restyle with zero per-file work. Every
  inline `tokens.colors` read (785 across 90 files) was AST-codemodded to
  `useThemeColors()` (`theme/use-theme`, fed by `state/theme-store`).
  `theme/palettes.ts` carries the colour records — rarity + success/warn/
  danger are PINNED IDENTICAL in every palette (rarity is a cross-app
  vocabulary; semantic colours encode meaning). CUSTOMISE gains a THEMES
  tab: tapping a card previews the palette APP-WIDE while the screen is
  focused (ownership-free try-before-you-buy; blur/unmount restores), BUY
  rides the coin ledger (invalidates wallet + unlocks + history), EQUIP
  persists `loadout.paletteId`, and `resolveActivePalette`
  (domain/customise) re-validates ownership on EVERY read — an unowned
  equipped palette silently renders standard. RULE THE WRAPPER CREATES:
  Tailwind cannot alpha-transform a var() colour, so a colour class with an
  opacity modifier (`/40`) silently generates NOTHING — verify-tokens now
  walks src and fails on any; use inline hex-alpha suffixes. NOT themed in
  v1 (deliberate): glow/shadow tokens (`--glow-*` vars are the v2 seam),
  +html.tsx boot colours (pre-hydration), sprite art, AURAS/GYMERICA
  literals. Falsified: the full 044 checklist as ALPHA/BRAVO (raw inserts
  rejected, exact deduction, duplicate/unfunded/unknown refused, cross-user
  empty) + a 15-check Playwright tour (preview cycling recolours the live
  page, wallet 1225→475 on a 750 buy, /coins agrees, reload survival,
  standard revert, sign-out teardown; screenshots in
  Downloads/evoforge-screenshots/palette-*). Artifacts deleted, ALPHA
  restored to 225.

- **ORIGIN CLASSIFICATION v3 + THE GLOBAL RE-ASSESSMENT (Tyson: "most
  characters' origin having to be aesthetics… more variety… every current
  player is required to get a new evo rating and origin character",
  migration 045, 2026-07-17):** v1/v2 compared the four pillar scores RAW,
  and the pillars live on different effective scales (production 2026-07-17:
  aesthetics averaged 60.6 and beat size on 10/10 rating rows; strength/
  cardio bottom out at provisional floors) — so 3/3 assigned origins were
  aesthetic. v3 ranks CALIBRATED AFFINITIES (score − per-pillar baseline:
  aesthetic 60 · mass 52 · titan 50 · cardio 48, versioned in the function
  like the strength reference curves), gates recommendation on per-pillar
  confidence ≥ 25 (no Apex Engine without a single logged run — the pillar
  still SHOWS in the breakdown), and adds Tyson's Shredder rule: cutting
  phase + fresh (≤90d) bf_mid ≥ 20% male / 28% female → THE SHREDDER,
  outright; cutters below the threshold keep shredder_eligible as before.
  Choice margins (≤8 spread / top-two ≤5) now ride the affinities.
  `classify_evo_path_for(uuid)` is the core (service-role only);
  `classify_evo_path()` keeps its exact client signature and returns new
  `affinities`/`ranking`/`shredder_auto` fields (origin-panel sorts the
  score chips by ranking, not raw score — raw-desc order would contradict
  the recommendation). `require_origin_reassessment_v3(dry_run)` EXECUTED
  LIVE 2026-07-17: all 3 assigned origins (all aesthetic) retired to
  needs_assessment with previous state archived to user_path_migration_log
  (migration_version 3), is_origin cleared, EARNED user_paths
  stages/unlocks untouched (verified: stages 2–4 all survived), re-run = 0
  (idempotent). Every account now re-discovers its origin through the
  existing machinery: sign-in scan prompt + Home podium button → new Evo
  scan (origin-unset cooldown exception reopens it) → v3 reveal → claim
  equips. Falsified on production: the 3 scan accounts now classify
  titan/titan/mass (was aesthetic ×3); smoke-account shredder positive
  (cutting + bf 24 → shredder outright) and both negatives (bf 15 →
  choice, bulking → ineligible); staged rows deleted after. plpgsql trap
  for the next reader: a bare `CASE … THEN` inside an `IF` condition eats
  the IF's THEN — parenthesise the CASE.

- **ORIGIN CHOICE (raw ±5) + THE ORIGIN LOCK (Tyson live feedback,
  migration 046, 2026-07-17):** "I somehow got given Titan… if the top stat
  is within ±5 of another, let the player decide; the only equipable
  character from then on is the origin character." classify_evo_path v4:
  the choice set = every evidenced pillar within 5 RAW points of the
  evidenced raw max (affinity top always included; >1 member → the player
  decides); recommendation/ranking still ride the 045 affinities; Tyson's
  own row now offers titan+mass+aesthetic (verified live) and his v3 titan
  claim was reset to re-choose. THE ORIGIN LOCK: server-side,
  set_active_champion refuses any non-origin path ('origin_locked' —
  falsified with forged JWT claims both directions); client-side, ONE seam
  (buildRoster's originPath param + originAsBranch) locks customise equip,
  stage ladders, and battle champion select (unlockedChampionSet), while
  resolveDisplay pins the displayed branch, ghost publishes + versus
  snapshots carry the origin branch, and path-sync mirrors the ORIGIN
  line's derived stage as the active champion. DECISION: premium
  characters (Gymerica) remain equipable — purchased overlays, not path
  champions; non-origin lines keep progress/purchases, they just cannot
  render. Verified: 778 vitest (new origin-lock describe), tsc, lint, and
  a Playwright tour with a titan-origin smoke account (Home podium =
  titan champion; customise roster 1/9 unlocked, others LOCKED; battle
  select ORIGIN LOCKED; smoke restored after).

- **THE 09:34 INCIDENT — scan auto-claim vs the choice rule (2026-07-17,
  same evening):** Tyson reported "still stuck as Titan, the origin scan
  has not come up". Root cause in the AUDIT TRAIL (user_path_migration_log
  + evo_assessments raw snapshots): evo-scan.tsx's 042-era auto-claim
  assigned the RECOMMENDED path ~300ms after every scan, ignoring
  requires_choice — his scan at 09:34 classified as a three-way choice and
  the client claimed Titan anyway; and the once-per-day prompt key had
  already burned for the day, so no nudge either. FIXES (client-only, the
  server was correct): (1) the scan auto-claims ONLY when requires_choice
  is false (shredder_auto included) — a close call toasts "YOUR SCORES ARE
  CLOSE" and routes to the Forge reveal where the choice buttons live;
  (2) the prompt's day-key now stores date|origin:migration_status, so an
  origin RESET re-prompts the same day; (3) when classification is already
  open, the prompt modal AND the Home gold button read CHOOSE YOUR ORIGIN
  and route to /avatar (the Forge reveal) instead of another scan. His
  titan claim was reset a third time — next launch he lands in the choice.

- **THE 047 PROGRAM — ORIGIN IN ONBOARDING (candidate model v5, 2026-07-17,
  takeover of an interrupted session):** the full program docs live in  `docs/ORIGIN_*.md` (7 specs + `ORIGIN_HANDOFF_AUDIT.md`, the takeover
  audit). SHIPPED: migration 047 (profile: primary_goal/battle_style/
  onboarding_flow_version/firstbound_origin/reforge_granted_at/reforge_used_at
  + write-once guard; user_paths + user_champion_bond monotonic guards;
  bond table owner-SELECT-only; `origin_candidates_compute(jsonb)` — the
  PURE SQL twin of `client/src/domain/origin/candidates.ts`, pinned by 21
  goldens in `contracts/fixtures/origin_candidates.json`
  (`tools/replay_origin_goldens.py`: 21/21 EXACT); `origin_candidates_for/
  origin_candidates`; `assign_origin_path` v5 — advisory-locked now,
  already_assigned success-shaped, validates against a FRESH candidate
  generation or the v4 choice set; `claim_free_reforge`/`reforge_origin`).
  Falsified live (`tools/falsify_origin_047.py`: 32/32, throwaway account
  deleted after). Client: onboarding is now TWO ACTS — Act I form gains the
  DRIVE section (goal + battle style), insert stamps
  onboarding_flow_version=2; Act II is `ui/origin/origin-flow.tsx`
  (rating reveal → 3 candidate cards → confirm → bind → awakening → Home);
  the (main) gate bounces flow-v2 origin-less users back (legacy users
  untouched — flow version NULL). Existing users get the candidate reveal
  on the Forge page behind ORIGIN_FLAGS.candidateRevealEnabled; ReforgeCard
  ships the free reforge (claim on visit, KEEP = dismiss). First mission:
  binding seeds the origin split rotated so today = training day 1 (only
  when the user skipped the split step). Analytics: `data/analytics.ts`
  track() + the ORIGIN_ANALYTICS vocabulary.
  **GOTCHAS:** (1) `useBindOrigin` must NOT invalidate ['profile'] on
  success — onboarding's legacy redirect reads profile.data and an early
  refetch yanks the athlete out of the awakening mid-ceremony (the O-series
  tour caught it); OriginFlow.onComplete invalidates + navigates. (2) The
  plpgsql CASE-in-IF trap (045's note) bit again in 047 — parenthesise.
  (3) JS Math.round = floor(x+0.5), NOT Postgres round() — the SQL twin
  uses floor(x+0.5) everywhere or .5 boundaries drift. (4) O-series tour:
  `tools/tour_origin_onboarding.py` (throwaway account, screenshots to
  Downloads/evoforge-screenshots).

- **048 — ORIGIN DATA IS EXCLUSIVE (Tyson, 2026-07-17, same evening):**
  "nobody should have any data on any character other than their origin."
  Reverses 046's "non-origin lines keep progress" AND 047's "old origin
  stays collected": `assign_origin_path` v5 and `reforge_origin` now DELETE
  every non-origin user_paths row and every non-origin-champion bond row
  at bind. Purchases (skins/palettes/Gymerica) and firstbound_origin are
  never touched. One-off cleanup applied for existing origin-havers
  (Tyson: aesthetic 3 + titan 3 wiped; shredder kept — he had just used
  the free Reforge titan→shredder, the FIRST real reforge, and asked why
  shredder was stage 3: the reforge grants stage 1, then path-sync mirrors
  the DERIVED stage from real stats, preserve-higher, by 046 design).
  Origin-LESS users' legacy rows are UNTOUCHED — they have no origin yet;
  their rows wipe when they bind (048's assign delete). Falsified 5/5
  (legacy row wiped on bind, old origin wiped not collected on reforge,
  bond follows the new champion). FOLLOW-UP (same evening): the wipe
  resurrected — `path-sync.ts` still recorded the DERIVED (non-origin)
  branch "as roster truth" on every Forge visit (046-era comment). Now,
  with an origin set, it mirrors ONLY the origin line; the legacy mirror
  stays for origin-less users. Grep before declaring any wipe durable:
  `record_path_progress` had exactly one call site. Docs updated:
  EXISTING_USER_ORIGIN_MIGRATION §4, ORIGIN_DATA_MODEL §5.

- **ROUTE ERROR BOUNDARY (2026-07-19, Tyson: "screen is all background
  colour" entering a workout / edit week):** with web asyncRoutes every
  route is a lazy chunk and NOTHING caught a failed load or a render throw
  — the screen stayed bare background. Now `ui/core/route-error-boundary`
  is exported as `ErrorBoundary` from BOTH `app/_layout.tsx` and
  `app/(main)/_layout.tsx` (the (main) copy recovers without unmounting
  query/auth/theme providers). `domain/chunk-error.ts` recognises chunk
  failures — Metro's REAL message is `AsyncRequireError: Loading module …
  failed` (captured live by deleting a route chunk from a served dist; the
  webpack shapes are kept for other surfaces) — and `ui/core/error-screen`
  auto-reloads ONCE for those (localStorage `evoforge-chunk-reload-at`,
  5-min cap, its own key — NOT version-guard's), renders UPDATING…; any
  other error renders SOMETHING BROKE + RETRY (no animation on purpose).
  Falsified: chunk deleted → boundary caught it, reload fired once and
  the cap held; ordinary messages do NOT match (reload loops on real
  bugs would be worse than the blank screen).

- **HOME REWORK (Tyson's improvement doc §1, 2026-07-19):** CUSTOMISE is the
  hero action now — `QuickAction size='hero'` (~112px, icon 32, pixel-16
  label; the overlay action column widened 100→140, and on <380px it owns a
  full wrap-row) with the FORGE-COIN balance riding beneath it
  (`hero-coins`): CoinIcon + `formatCompact()` from NEW `domain/format.ts`
  (13120→13.1K, ≤3 significant digits, display-only, vitest-pinned; null
  wallet renders NOTHING, never 0). The hero TIER badge is GONE (form/next-
  evolution moved up) and so is the status-grid TIER fallback (with Rival
  Rank off the grid is 3 cards). The build section always shows the RADAR
  (BARS view + toggle deleted; StatBar itself lives on — evo.tsx and the
  customise preview still use it) and the "Weak point focus" line is gone
  (`weakPointFocus` still computed in avatar-stats-calc for the Oracle).
  Toured at 390+320 via origin READ-interception (ALPHA's origin is reset;
  the FORGE YOUR ORIGIN state hides hero actions — intercept
  `profile*origin_path*` to tour the real hero).

- **CUSTOM MEAL TYPES (improvement doc §8.5, migration 056, 2026-07-19):**
  `nutrition_prefs` (one row/athlete, owner-only RLS, jsonb `meal_names`
  CHECKed by `nutrition_meal_names_ok` — array ≤12, strings 1..24 chars or
  null) carries the athlete's own slot names; `mealSlotName(slot, names)`
  consults them first (uppercased, clamped, garbage-safe — vitest-pinned).
  `useMealNames`/`useSaveMealNames` in data/nutrition.ts; ✎ RENAME lives in
  the expanded slot (empty = restore default), and the ASSIGN picker offers
  every named slot even when the device's local meal count lags (count =
  max(4, local, names.length) — names are server truth, count is local).
  Applied + falsified 6/6 (13 names / 25 chars / non-string / cross-user /
  forged user_id all rejected); toured live: rename → reload survival →
  picker chip → default restored.

- **CARDIO CALORIES (improvement doc §4, migration 057, 2026-07-19):**
  `cardio_log.count_toward_budget boolean default true` — after LOG with
  calories > 0 the form asks "add ~N kcal back to today's fuel budget?";
  NO stores the burn with the flag false (writing calories=0 would have
  destroyed the record), YES/no-dialog keep today's behaviour.
  `useCaloriesBurned` filters on the flag client-side. NEW pure
  `domain/cardio-estimate.ts::estimateCardioKcal` (Compendium METs keyed on
  the activity catalogue types, kcal = MET×3.5×bw/200×min, vitest-pinned)
  drives an EST. pill beside the CALORIES field — REAL bodyweight only
  (profile → latest log; without one the pill is disabled with the reason,
  never a fake number); the fill stays editable. Falsified live: two 1-min
  sessions landed flags [false,true], read back as ALPHA, deleted after.

- **SOCIAL ROUND 2 (improvement doc §6, migrations 058/059/060, 2026-07-19):**
  * **058 comment interactions** — comments carry the SAME four reactions as
    posts (`social_comment_reactions`, 049's exact posture; definer
    `toggle_comment_reaction` re-checks PARENT-POST visibility) and take
    ONE-level replies (`social_comments.parent_id`, depth guard rejects
    reply-to-reply). The notifications type CHECK was widened FIRST (the 054
    rollback lesson) with `comment_reaction`/`comment_reply`; a reply
    notifies the parent comment's author (052 already tells the post
    author). `post_comments` returns parent_id + reaction_count +
    my_reaction. Client: `groupCommentThreads` (orphaned replies surface
    top-level, never vanish; pinned), optimistic `useToggleCommentReaction`,
    `CommentReactionRow` + reply-targeting composer in the comments modal.
  * **059 reports** — `social_reports` (reason CHECK, ≤300 note,
    unique(reporter,post)), INSERT-only RLS, **NO client select** (service-
    role review only). Record-only v1 ON PURPOSE: auto-hide without review
    tooling would be a mocked moderation system. The ⋯ on OTHERS' posts
    opens the report sheet; duplicates read "already reported".
  * **060 username search** — `search_athletes(q)` mirrors
    discover_athletes' exposure (is_public AND discoverable, the
    request_friend gate — search can never surface an athlete ADD then
    refuses), prefix-ranked. ADD BY USERNAME card on the friends screen.
  * **Username mandatory (Tyson's call):** onboarding's name field is
    always-on + required and saves BEFORE the profile insert — a taken name
    (004's case-insensitive unique index, falsified) blocks with an inline
    re-prompt instead of the old silent catch. GO PUBLIC stays visibility-
    only. Legacy no-name accounts get a CLAIM YOUR NAME card on Social
    (browse open, posting waits; claims save PRIVATE).
  * The 🔔 emoji became `PixelBell` (the PixelGlyph set).
  All falsified live (18/18 server checks + duplicate-name clash + a full
  post→comment→hype→reply tour as ALPHA; every seed deleted/purged).

- **BODYWEIGHT SETS — 0 kg IS A SET (improvement doc §3.1, migration 061,
  2026-07-19):** THE RULE, everywhere at once — a COUNTED set is
  `weight >= 0 (non-null) AND reps > 0`; PR/e1RM/lift-chart paths keep
  `weight > 0` (a 0 kg set earns its flat 10 XP but can never be a PR, and
  battle_events_guard is UNCHANGED on purpose — 0 kg moves no weight in a
  lift battle). 061 recreated SIX live functions with only the predicate
  edited (xp_events_guard set-branch, coin_events_guard workout_complete
  [PR sites untouched], leaderboard_top's derived oracle, forge_claim_weekly,
  scheduled_streak, claim_free_reforge) — guard and oracle move in ONE
  transaction or honest accounts read as drift. NO BACKFILL: zero historic
  weight=0 rows existed (both sides refused them until now). Client:
  `isCountedSet(weight, reps)` in domain/workouts.ts is THE predicate
  (null/garbage weight is NOT zero — pyFloat semantics; vitest-pinned) and
  every counting surface routes through it (summary, setsFor, validRowsFor,
  week-status, session-plan via the screens, scheduled-streak,
  workout-estimates, exercise-history, digestHistory, progress
  periodTotals, muscleHeatMap, workoutPostPayload, decideSetSave, the
  logger guards). Charts and recent-pr deliberately keep weight>0. History
  labels read "Last: BW × 12" for 0 kg. The retired Python reference
  (domain/workouts.py) swept to match. Falsified: server suite (0kg mint
  lands at amount 10; 0-rep refused; PR refused; ALPHA's drift UNCHANGED
  by the set+mint pair — oracle moved with the guard) + a real UI log on
  production (1/3 SETS, +10 XP, rest timer fired); seeds deleted (each
  deleted granted set leaves its append-only mint — ALPHA's permanent
  smoke drift grew by design, the drift gate is its own falsification).

- **AUDIT FIX BATCH — PHASE 1: the six bugs (migrations 062+063, 2026-07-19):**
  * **A2** the ONLINE finish path now awards the Forge workout_completed XP
    (sessions.ts onSuccess → the idempotent awardForFinish; only the offline
    queue flush did before — lifetime XP depended on wifi).
  * **A3/C2 (062)** ONE HOME FOR PLANS: user_plans is the only plan store.
    062 one-shot-copied every surviving legacy custom_workout_plan into the
    slot the client would have resolved (groupPlanRows + looksLikeAiPlan
    ported to SQL; idempotent; falsified — canonical 6-day → 'ai' in week
    order, personal splits → 'custom'). Client: resolvePlanSources lost its
    legacyPlan input, useCustomPlan deleted, DISCARD deletes the real home
    (the audit's half-delete bug), the blitz page reads user_plans.ai.
    custom_workout_plan is RETIRED — never write it again.
  * **A4** origin first-mission seeding invalidates user_plans +
    workout_schedule (Train updates immediately, no reload).
  * **A5/C3/C4** NEW data/keys.ts — TABLE_READERS + invalidateTable(): the
    map of every query key reading a table, so a mutation can't miss a
    reader (register new hooks' keys there!). Wired: identity+privacy saves
    refresh ALL five public_profile readers; the PR coin claim refreshes
    /coins history; the Evo review refreshes player_stats; a damage verdict
    refreshes XP readers. profile keeps its documented bind-ceremony
    exception.
  * **A6** NEW domain/bodyweight-current.ts::currentBodyweightKg — THE one
    chain (latest log → profile → null; callers own defaults), wired into
    Home, Train, cardio EST, current-stats, avatar-data. Home/Train
    previously trusted the ONBOARDING snapshot over fresher logged
    readings. En route: Home's mission counter got the missed 061
    counted-set predicate (it disagreed with Train about 0 kg sets).
  * **A1 (063)** LIVE LEVELS: public_athlete_profile / discover_athletes /
    search_athletes now serve forge_level_for_xp(user_progression
    .lifetime_xp) computed AT READ TIME, and the profile evo block reads
    evo_rating_current (4 live pillars). avatar_progression (written by
    nothing, frozen) is out of every social read. FALSIFICATION CATCH: the
    forge_level COLUMN is a greatest()-ratcheted cache still holding
    pre-033-exploit inflation (ALPHA: column 38, honest level 2) — NEVER
    serve that column; compute from lifetime_xp.

- **AUDIT FIX BATCH — PHASE 2: Supabase efficiency (064, 2026-07-19):**
  * **B7** latest-value reads bounded: measurements (newest-first 120-row
    window, per-column-latest preserved), physique ratings (desc limit 1),
    bodyfat series (newest 90, reversed — ascending contract holds; note:
    the Shredder STARTING reading is now earliest-in-window), bodyweight
    (newest 180, reversed). No more 2500-row pulls for one number.
  * **C8** the achievement sweep reuses the workout_log CACHE — the
    just-saved row rides along explicitly (the fresh-row rule its header
    demands survives); the Evo review accepts cachedWorkoutRows from its
    two callers instead of an unbounded refetch.
  * **C6** rival-settle accepts battleIds[] (≤10, single-id compat kept) —
    reconciliation is ONE call, not one per battle. **commit_evo_review()
    (064):** the review persists in ONE definer RPC — core (snapshot +
    current + evidence) unguarded, riders (chapters/stats/traits/audit/
    analytics) exception-guarded server-side, evo_class written once in
    the txn (C1's drift window closed), maintainChapters ported verbatim
    into plpgsql. ALL RULE MATH stays in the pinned client domain fns —
    the RPC is pure persistence. Falsified: clean commit, malformed rider
    never loses the core, peak-ratchet fires inside the RPC.

- **AUDIT FIX BATCH — PHASE 3: performance (2026-07-19):**
  * **B2** global `staleTime: 45s` (QueryClient defaults) — the six mounted
    tabs no longer refetch everything on every window refocus; mutations
    still repaint instantly via keys.ts invalidation. Per-hook overrides
    survive.
  * **B1/B3/B11** NEW `domain/workout-index.ts` (buildWorkoutIndex —
    rows/byDate/byDateWorkout/countedByDateWorkout, vitest-pinned) exposed
    as `useWorkoutIndex()` via TanStack `select` on the SAME
    ['workout_log'] cache entry: Train's carousel cards + week bars and
    Home's mission counter are O(1) lookups now (was ~12 full 2500-row
    scans per Train render, ~5 re-normalisations per Home render). The
    061 counted-set rule lives in the index, so Home and Train literally
    share one source.
  * **B4** the 308-entry skin require tables split into per-line LAZY
    modules (`ui/character/skins/*`, dynamic import + module cache;
    resolvers stay synchronous and fall back to base art for in-flight
    frames — the seam the skin system already had). `useSkinsReady()`
    repaints Home/Forge/customise when a chunk lands. __common: 2.72MB →
    2.65MB (−68KB) + six on-demand chunks; the skins' asset registrations
    left the boot path entirely.
  * **B5** the scene janitor is EVENT-DRIVEN (MutationObserver on
    aria-hidden + 5s safety sweep — was a 250ms forever-poll of
    querySelectorAll+getComputedStyle); the nav-freeze beacon stops after
    its 3 reports or 10 minutes.
  * **B6** the social feed is a virtualised FlatList (`FlatListShell` in
    ui/core/shell — ScreenShell's exact frame around a FlatList; header
    content rides ListHeaderComponent; LOAD MORE became infinite scroll).
  * **B8** hand-written useMemos removed from progress/goals/streak/
    create-post (the compiler rule); line-chart's geometry memo and
    shell's useFocusEffect callback stay deliberately. En route:
    progress.tsx's exercise list got the missed 061 predicate (bodyweight
    exercises now appear).
  * **B9** ONE rest-timer tick (module interval, acquire/release on live
    clocks) — the inline bar and floating pill are subscribers, not
    timers.
  * **DEFERRED to the battle session:** B10 (battle select('*') +
    interval gates), battle-file memos, battle-pov lazy-loading.

- **AUDIT FIX BATCH — PHASE 4: repo leaning (2026-07-19, Tyson's D1 call):**
  * **THE STREAMLIT APP IS DELETED from this branch** (history lives on
    main): verify.yml + its 13 verify_*.py + shot.py, app.py, views/,
    services/, .streamlit/, sprite_test/ (5.4M), avatar_assets/ (4.8M),
    sprites.png (1.8M), requirements.txt — ~12.7MB and eleven CI checks
    per push gone. **KEPT, load-bearing:** domain/*.py + config/
    constants.py + contracts/ + tools/gen_fixtures.py (the goldens
    contract — verified 4,832 cases green after the deletion), root
    data/ + auth/ + ui/ (gen_fixtures' import chain; auth is a lazy
    function-scope import), assets/styles.css (verify-tokens parity),
    requirements-dev.txt (the fixtures job installs it), tools/hooks/
    (protected-path list rewritten for the new world). CLAUDE.md
    rewritten around the surviving contracts.
  * Executed plan docs (15 files, ~250KB incl. HANDOFF.md and the 68K
    IMPROVEMENT_PLAN) → docs/archive/. Six one-shot tools →
    tools/archive/. reset-project.js + Expo/React template images gone.
  * Six unused npm deps removed (@expo/ui, expo-blur, expo-device,
    expo-glass-effect, expo-symbols, expo-web-browser).
  * Dead flags deleted: ghostMatchesEnabled/playerStatsGameplayEnabled
    (zero refs) and showLoadout + the LOADOUT branch. ORIGIN_FLAGS stay
    (all-true but their conditions guard live ceremony logic — collapsing
    them is riskier than the win; deliberate deviation from D4).
  * The 4 orphaned aesthetic_stage_N.png removed (zero refs incl.
    dynamic); helpers consolidated — ONE addDaysIso (domain/today) and
    ONE Epley (e1rmFor delegates to estimated1rm, keeping its reps≤10
    evidence guard).
  * **Two post-push corrections the deletion forced:** tools/hooks/
    pre-push's Python gate is now `gen_fixtures.py --check` (it still
    enumerated the 11 deleted verify scripts and blocked its own push),
    and **requirements.txt is back as a SLIM file** — the goldens
    import-chain pins only. Two things need the FILE to exist:
    requirements-dev.txt `-r`-includes it, and the fixtures job's
    setup-python `cache: pip` HARD-FAILS the job when its default glob
    (**/requirements.txt|pyproject.toml) matches nothing — that skipped
    a deploy once (run 29677670014). Don't delete it again; a workflow
    fix was not pushable (git/gh tokens here lack `workflow` scope —
    remember that before editing .github/workflows/*).

- **MULTI-WORKOUT SCHEDULE — MIGRATION 065 (applied 2026-07-20):**
  * **The wire shape**: `workout_schedule.plan` values widen from a single
    string to `string | string[]` — `[primary, ...extras]`, slot 0 may be
    `'Rest'`, extras never are (built-in day names or `routines` names). A
    day with NO extras still serializes as a plain string, byte-identical
    to every pre-065 row: no backfill, no table DDL, no RLS change.
  * **Semantics (TS lockstep: `client/src/domain/scheduled-streak.ts`)**:
    a date is SCHEDULED iff it has ≥1 non-Rest entry ('Rest'+extra IS a
    training day — stricter streak, the schedule page says so); TRAINED
    stays day-granular (any counted set that date preserves the streak).
    `scheduled_streak()` redefined on **061's** body (`weight >= 0` — NOT
    012's, which would revert the bodyweight fix): array values yield
    their first non-Rest entry, scalars read as before.
  * **En-route find: 012's revoke never worked.** `revoke ... from
    authenticated, anon` left the default PUBLIC execute grant
    (`=X/postgres`) — clients could call scheduled_streak since 012. 065
    revokes from `public` too; falsified live (has_function_privilege
    true→false; postgres/service_role keep execute, the 013 coin guard is
    definer-owned and unaffected).
  * Falsified as ALPHA: streak before/after identical on scalar rows
    (0/null); seeded backdated array row over ALPHA's real 07-11..13
    history → extra-only trained days extend, primary+extra counts ONCE,
    extra-only untrained breaks (probe: length 3, run_start 07-11),
    scalar 'Rest' inside a mixed plan bridges; seed deleted, ALPHA
    restored (2 rows, 0/null). Client (editor add/remove, week extra
    bars, quick-workout save prompt) lands in the following commits.
  * **Client (same program, later commits):** `dayWorkouts()` in
    `domain/scheduled-streak.ts` is THE normalizer — every plan reader
    goes through it. `scheduledDayFor` PROMOTES the first non-Rest entry
    (a ['Rest','Core'] Sunday is a Core day on every primary surface);
    `scheduledExtrasFor`/`extraScheduledBars` carry the rest as bars
    beneath the day's primary (today's extras are `in_progress` — that
    status alone is the blue highlight, `week-bar.tsx` unchanged).
    `extraBarsForToday` now takes an exclusion LIST (primary + extras) so
    a trained scheduled extra never doubles as an ad-hoc bar; a
    swapped-AWAY stored name deliberately stays eligible. `resolveDayIn`
    falls back to SAVED ROUTINES last (case-insensitive; plan sources WIN
    over a same-named routine — equal names are one workout_log grouping
    key); the workout page labels that case FROM MY ROUTINES.
    `serializePlan` (data/schedule.ts) keeps extra-less days as plain
    strings on the wire. Editor (`schedule.tsx`): chips = primary slot;
    extras listed with ✕ remove + "+ ADD WORKOUT" bottom-sheet picker
    (BUILT-IN DAYS + MY ROUTINES, day's names excluded, deleted-routine
    refs flagged ⚠ but removable); `?add=<name>` appends to TODAY's
    weekday unsaved and glows the card — the athlete still presses SAVE.
    Streak strictness note added to the page copy. Extras never inflate
    weeklyContract (one pip per day, deliberate).
  * **Quick-workout save prompt:** finishing an AD-HOC workout offers to
    keep it — `state/save-routine-prompt-store.ts` (ephemeral, reset on
    sign-out) + `ui/train/save-routine-prompt.tsx` (three steps: save? →
    name it [defaults to the ad-hoc name; duplicate keeps the step open]
    → add to schedule? → `/schedule?add=<name>`), mounted in
    `(main)/_layout`. Offered from `workout.tsx finish()` only when
    something was performed, the ceremony's own SAVE AS ROUTINE didn't
    already fire (`savedInCeremonyRef`), and no routine already owns the
    name (strip a `" (today)"` suffix first — restarted routines never
    re-prompt). NOTE: the SHARE prompt's modal mounts after ours (its
    offer lands async from the finish mutation) so it stacks ON TOP —
    dismissing it reveals the save prompt beneath; accepted, not a bug.
  * **The `?add=` seed race (fixed during the tour):** schedule.tsx's
    seed effect and the add-append MUST be one effect — as two, the
    deferred seed overwrote the appended extra. Toured LIVE vs prod as
    ALPHA (quick workout → prompt → save → pre-added on /schedule → SAVE
    → extra bar beneath Monday's, FROM MY ROUTINES on open → remove →
    SAVE → scalar wire shape restored). Every seeded row deleted; ALPHA
    restored (2 schedule rows, streak 0/null). Tour gotchas for next
    time: the ORIGIN sheet re-prompts EVERY sign-in and eats clicks
    (dismiss `origin-scan-later` before interacting); `todayIso()` is the
    LOCAL calendar date — Playwright must use `getDay()`, not
    `getUTCDay()`, when computing the app's weekday.

- **FUEL CONVERTER CALCULATOR (2026-07-20):** both sides of the KJ⇄KCAL
  converter take label arithmetic — "435*5" converts the five-serving
  total; + − × ÷ with normal precedence, decimals, unary minus.
  `evalEnergyExpression` (`domain/nutrition.ts`, pure, tested) is the ONE
  evaluator: keypad glyphs (× ÷ −) and x/X normalize to * and /; a
  TRAILING operator evaluates the complete prefix (no mid-typing flicker
  on the other side); malformed input / division-by-zero → null, never
  NaN. `NumberField`/`KeyPad` gained an opt-in `calculator` prop: the
  touch keypad grows a + − × ÷ row and a live `= total` line, the
  first-keystroke-replaces rule is suspended for operators ("×5" over a
  seeded 435 means 435×5), and the steppers act on the EVALUATED result
  (collapsing the expression — calculator convention). Toured on desktop
  (typed) and touch (keypad) against the real build.
  **Second pass (same day): the QUICK LOG amount field opted in too**, and
  entry now COLLAPSES to the result — keypad DONE and desktop blur both
  replace "435×5" with "2175" (`collapseExpression` in number-field), so
  the box, the logged row, and the day's history all carry the NUMBER
  (falsified live: the seeded nutrition_log row read kcal=520 from a kJ
  expression, then deleted). `enteredKcal`/`bump` evaluate expressions, so
  +N chips and LOG IT work mid-equation. The quick-log card was reordered
  around prominence: the energy field is first, centered and `big` (62px,
  24px face, "maths ok" hint); label + meal slot sit quieter beneath.
  Calculator fields now: the two converter fields + fuel-amount; every
  other NumberField is unchanged.

- **THE LOCKOUT POSTMORTEM (2026-07-20):** devices were PERMANENTLY stuck
  on "SOMETHING BROKE / RETRY" after deploys — hard refresh useless,
  device-scoped, socials implicated. Root cause, reproduced live before
  fixing: the persisted query cache (`evoforge-query-cache-v1`,
  localStorage) had a STATIC buster ('v1'), so a deploy never invalidated
  it; the feed persists `toPost`-NORMALIZED objects, and a new build's
  cards dereferenced fields an old build never wrote (`post.tagged.length`
  — `tagged` postdates 96a48a8) → render throw → boundary. RETRY re-read
  the same bytes; hard refresh clears HTTP caches, NOT localStorage; other
  tabs' successful queries kept re-persisting the poisoned entry so maxAge
  never expired; and the +html.tsx nuclear reset never showed because the
  app HAD booted before the route threw. Sign-out clears the key — why
  other devices worked. THE FIXES:
  * **Per-build buster** (`domain/build-id.ts` → `app/_layout.tsx`): the
    buster is the running `entry-<hash>.js` hash (the version-guard's own
    regex; fallback 'v1' on native/dev/static render). A deploy discards
    the persisted cache exactly once; same-build reloads keep it warm.
    Already-stuck devices heal on their next launch of the new bundle.
    INVARIANT: any future cache that stores NORMALIZED domain objects
    rides this buster — never assume a persisted shape survives a deploy.
  * **`data/cache-keys.ts`** — the localStorage keys (query cache + both
    reload guards), zero imports, ONE source of truth for the persister,
    sign-out, version-guard and the error screen.
  * **Error-screen escape hatch** (`ui/core/error-screen.tsx`): web-only
    ghost button CLEAR CACHE & RELOAD — removes the query cache + both
    reload-guard keys (re-arming the auto-heals) and reloads. NEVER
    touches auth (no forced sign-out) or the zustand stores/queues holding
    unsynced work; `localStorage.clear()` stays exclusive to the +html
    boot overlay.
  * **`isRenderablePost`** (`domain/social-feed.ts`, vitest-pinned):
    restored feed pages are filtered at the two `pages.flat()` choke
    points (social.tsx, athlete/[id].tsx) — a post missing fields the
    cards dereference is DROPPED, never thrown on. Plus `display_name?.[0]`
    at the five avatar-initial sites.
  * Falsified end-to-end vs the built dist: poisoned blob (tagged deleted
    from the REAL persisted feed) locked the pre-fix build through RETRY
    AND reload; the fix build discards it (new buster = entry hash),
    renders clean, keeps warm cache within a build, and the real button
    (forced via a deleted chunk) clears the guards while `sb-*` auth
    survives.
  * **Nutrition was suspected and EXONERATED**: fuel persists raw rows and
    every render coerces (`Number()`, `?? []`); no conflict markers; the
    evalEnergyExpression chain is a clean DAG. Timing coincidence.
  * **A second, bounded lockout exists and is NOT code-fixable:** an OLD
    cached bundle reading NEW 065 array plan values crashes at
    `workout.trim()` (pre-065 plan-sources). Only the new bundle heals it
    (version-guard + the SW's stale-while-revalidate do this next launch);
    exposure = mixed-build devices whose account saved an extras day.
    Watch iOS standalone PWAs — the surface where stale shells linger.

**Migrations applied through `070`. Next free number: `071`.**
(`065` is a SHARED number, like `037`: `065_leaderboard_metrics.sql` and
`065_schedule_extra_workouts.sql` were written by parallel sessions the same
weekend — both applied.)
(The line above previously said 048/049 — stale: the social program took
049–055. See the social blocks above.)
(Historical: `022` was reserved for the nutrition branch and never used —
nutrition landed as `037_nutrition.sql`, which COLLIDES with
`037_workout_ghosts.sql`; both are applied, the number is just shared.)

<!-- superseded: **Migrations applied through `021`. Next free number: `022`.** -->
`016` user_exercises+routines · `017` workout_sessions · `018` user_plans ·
`019` user_exercise_prefs · `020` weight_unit · `021` ai_scan_cache +plan-scan.

**496 tests. Four executable guards** (all in CI):
`verify-tokens` · `verify-battle-engine` (byte-pin ×3) · `verify-motion` ·
`lighthouse` (budgets in `client/lighthouserc.json`).

- **2026-07-23 — Arena polish pass, Phase 1 (visual audit) done.** A new
  multi-session program to turn the working-but-plain Arena into a polished
  vertical slice (real pixel art, combat feel, full-bleed premium UI). The
  three living docs are in `client/src/arena-game/`:
  `ARENA_VISUAL_AUDIT.md` (evidence from a real played battle — screenshots
  via the new `client/scripts/arena-visual-tour.mjs`),
  `VERTICAL_SLICE_PLAN.md` (phase map + model schedule + constraints),
  `KNOWN_POLISH_ISSUES.md` (living checklist, presentation-only —
  engineering issues stay in the package `KNOWN_ISSUES.md`). Code unchanged
  this phase. NOTE for the asset phase: `client/.env.local` carries an
  unused `PIXELLAB_AI_KEY` (pixel-art sprite generation API) — validate
  before building on it.

- **2026-07-23 — Arena polish Phases 2+3 done: the 1-bit look is gone.**
  PixelLab (that key, now validated) generated the full battle asset set —
  5 champions / 10 units / 2 cores with cracked damage variants / lane
  floor — via the new idempotent `client/scripts/arena-pixellab-gen.mjs`
  (generate = API with pinned seeds, build = team-outline post-process,
  raws in `client/assets/arena-pixellab-src/`). Renderer: floor + deploy
  boundary + team base plates + walk-bob (reduced-motion gated via new
  `use-reduced-motion.ts`) + white-silhouette hit-flash + pixelated
  rendering; sim untouched, arena suite 487 green, Playwright tour
  re-verified on the export. Known limits (documented in
  KNOWN_POLISH_ISSUES.md): PixelLab walk-cycle/rotate animation unusable —
  the walk-bob carries motion; direction is still chevron-carried.

- **2026-07-23 — Arena polish Phase 4 done: combat-feel system + character
  animations.** One escalation ladder in `arena-game/features/arena/
  components/impact.ts` (TIER_FX): tier-scaled damage numbers, screen
  shake, hit-stop/slow-mo via a new store-level time dilation (ticks
  delayed never skipped — replay digests untouched, fake-timer tested),
  ranged projectiles, defender recoil, spawn drop-in, and a 1.1s
  core-destruction climax before the result overlay. Engine's `fx hit`
  log entries now carry target id + shield flag (digest-inert; legacy
  fallback kept). CHAMPION WALK CYCLES ARE REAL now — the PixelLab
  turn-around failure was cracked with a frame-0 inpainting anchor +
  image_guidance 3.0 (`arena-pixellab-gen.mjs animate`); 4 frames × 5
  champions × 2 team outlines, cycled while moving, reduced-motion gated.
  Audio stayed out deliberately (public-gym context — Tyson's call,
  see KNOWN_POLISH_ISSUES A3). Arena suite 504 (+17), full 1,575, all
  guards green, export + tour verified the climax flow on screen.

- **2026-07-23 — Arena polish Phases 5–7 done: champion identity,
  readability, premium UI.** Per-path telegraph shape language (Titan
  shockwave+cracks / Mass pressure dust / Shredder slash arcs / Cardio
  pulses / Aesthetics gold ring+sparks) + Cardio speed afterimage +
  Shredder strike ghost; unit-pile lateral fan-out
  (`computeStackOffsets`, id-stable, tested) + champions draw on top +
  crimson core-danger edges; **the tab bar now hides for the whole
  /forge-arena group** ((main)/_layout.tsx — the game is full-bleed);
  pixel display faces (Jersey family names pinned as strings in the arena
  theme — do NOT import src/theme/fonts.ts there, its .ttf requires break
  vitest) on timer/energy/wordmark/result banner; card chips are
  mini-cards with sprite thumbnails + category edges (two-line names —
  truncation fixed); champion select + lobby carry real sprite portraits;
  ResultOverlay is a staged ceremony (banner slam → facts → rating →
  actions, outcome-colored, reduced-motion instant), verified mid-stage
  by a dedicated Playwright check. Arena suite 510, full 1,581, all
  guards green.

- **2026-07-23 — Arena polish Phases 8+9 done: roster identity + match
  flow.** P8: starter-deck COMPOSITION deliberately unchanged (the AI
  fields DEFAULT_DECK_CARD_IDS — the deck is coupled to the tuned
  45–54% balance band; role audit in PROGRESS.md confirms full
  coverage); three sprite identity fixes instead (human sprinter,
  javelin thrower, gym spotter — art now matches the fitness-renamed
  cards). P9: every non-tutorial battle (and every Rematch) opens with
  `battle-intro.tsx` — opponent line, team-framed champion portraits,
  VS, 3-2-1-FIGHT pixel countdown — over a sim FROZEN by the store's new
  `holdForIntro` (delay-only, 3.5s cap, fake-timer tested; players can
  pre-select a card during the count). Timer turns amber <30s, red in
  sudden death. Tooling gotcha recorded in PROGRESS: PS `Select-Object
  -First N` kills upstream native commands — never filter the pixellab
  generator through it. Arena suite 511, full 1,582, all guards green,
  tour-verified.

- **2026-07-23 — Arena polish COMPLETE (Phases 11+12): hardening +
  independent review.** Deep harness on the final build: 362/362, zero
  defects, champion win rates IDENTICAL to pre-polish (zero sim drift
  across ten phases of visual work). Timer/leak audit clean; measured
  render-derivation cost 0.014% of frame budget; repeated-rematch leak
  test added. **The program report is `VERTICAL_SLICE_BUILD_REPORT.md`
  at the repo root** — verdict: presentable vertical slice, ready for
  testers/recording on web. Its open findings (also in
  KNOWN_POLISH_ISSUES): R1 HIGH — Training AI may be too punishing for
  the entry tier (five scripted players lost five straight; needs one
  HUMAN playtest before any tuning, TENDENCY-only); R2 — add testIDs
  (audit C6, highest-value follow-up); G2 gym-war on-screen check;
  the standing on-device pass. Arena suite 514, full 1,585.

- **2026-07-23 — Arena PREMIUM program, Session 1 (Phases 1-3): audit +
  render architecture + stress lab.** New 19-phase program (premium
  mobile quality; Clash Royale as a quality bar only). Docs live in
  `client/src/arena-game/`: ARENA_PREMIUM_AUDIT (two corrections: the
  wider app HAS a full avatar/cosmetic system the arena ignores —
  path-only sprites, no stage/sex/skin; and an app-level synth SFX
  system exists), ARENA_RENDER_ARCHITECTURE (as-is pipeline + ranked
  evidence-gated optimizations, deliberately unapplied),
  ARENA_PERFORMANCE_BASELINE / ARENA_QUALITY_GATES /
  ARENA_GOLDEN_SLICE_PLAN / AVATAR_VISUAL_SOURCE_MAP /
  KNOWN_ARENA_ISSUES / **ARENA_STRESS_TEST_REPORT** (+ raw JSON).
  New instrument: Render Stress Lab (`/forge-arena/dev-stress`, linked
  from debug) — battle mode `'dev-stress'` (never recorded/persisted/
  rated), density driver, alloc-free frame profiler
  (`window.__ARENA_PROFILE`), headless bench (ARENA_STRESS_BENCH=1),
  browser sweep `scripts/arena-stress-measure.mjs` (CDP script/layout
  split + CPU throttle + heap trend). THE FINDING: sim is never the
  bottleneck (tickHz holds 20 everywhere); desktop 60fps through
  30/team; **4× CPU throttle (mid-phone proxy) → 9fps, script-bound
  (78% core) while layout stays <5%** — the whole-tree un-memoized
  20Hz re-render is the cost. Heap flat over 10 matches. New CI guard
  `verify-arena-purity.mjs` (engine imports no UI; falsified).
  GOTCHA: React 19 does NOT flush zustand subscribers synchronously in
  set() — publish timing measures scheduling only; trust the rAF
  sampler. **Session stopped by design: Phase 4 (renderer decision) is
  scheduled for Opus 4.8 at xhigh, independent, on this evidence.**

- **2026-07-23 — Arena PREMIUM Session 2 (Phase 4): renderer decision
  (Opus 4.8 xhigh, independent).** Doc: `client/src/arena-game/
  ARENA_RENDERER_DECISION.md`. **DECISION: stay on React Native views; do
  NOT migrate the battlefield to Skia now.** The prompt's migration gate is
  unmet (it needs "multiple optimisation attempts have failed" — zero
  exist), and Skia on the static-web PWA means CanvasKit WASM (~1.5MB+
  gzip) on the critical path with no native build to amortize it (Reanimated
  4.5 + worklets 0.10 are already installed as the lighter off-thread
  alternative). Independently re-verified in source and corrected the Phase 3
  framing: the render is **20Hz** (browser idles 60fps between ticks; rAF
  avgFrameMs floors at 16.67ms on 60Hz — use CDP script% + drop counts, not
  rAF, for headroom). Cost decomposes as a **~12% fixed chrome floor
  (memoizable) + ~0.5-0.7%/core per actively-fighting unit that changes
  EVERY tick (NOT memoizable — memoizing UnitMarker, the Phase 3 top lever,
  does not help the stress case)**. Ordered, measurement-gated plan: **Step 0
  BLOCKING = real-device baseline via the lab (NEEDS-TYSON — recent+old
  iPhone + ordinary Android, PWA + Expo Go, 30/team; may show the renderer is
  already fine)** → Step 1 memoize chrome → Step 2 cheaper-per-unit →
  Step 3 Reanimated off-thread motion (no new dep) → Step 4 Skia only if
  1-3 fail on real hardware. Execution folds into Phase 7/16, not its own
  phase. **Next: Session 3 (Phases 5-7, avatar source of truth) on Fable 5
  Ultracode; run Step 0 before any Phase 7 renderer change.**

- **2026-07-23 — Arena PREMIUM Session 3 (Phases 5-7): avatar source of
  truth + art bible + performance-safe cosmetics.** P5: the Arena now
  renders the athlete's REAL champion identity — `ArenaAvatarProfile`
  pushed by an app-side bridge in the arena layout from
  `useDisplayIdentity()` (the exact resolver Home/Customise use; the arena
  keeps zero cosmetic state), battle-asset fidelity chain
  (variant→canonical→glyph, layer-drift rule, pure+tested), lobby shows
  the app's own skinned/staged still + "Stage N — form" line, intro
  carries stage identity. Doctrine kept: a finished player's arena pick is
  never overridden (own-path guard); display path refines the FIRST-RUN
  prefill only — verified fix: originless smoke ALPHA used to prefill
  Titan while Home showed an aesthetic "Elite Aesthetic"; it now fields
  Aesthetics everywhere. P6: `ARENA_ART_BIBLE.md` (mandatory generation
  spec: pipeline law, per-champion continuity with real seeds, variant
  naming `--s<stage>[--k-<skin>]`). P7: precomposed single-sprite
  cosmetics adopted, runtime layering rejected (recolour-class cosmetics
  only), cached per profile key, zero draw-cost change — verified by a
  same-machine A/B after the re-sweep's absolutes came out 3× worse than
  the P3 baseline and production showed the SAME degradation. **STANDING
  MEASUREMENT RULE (PR-8): perf claims only from same-machine same-session
  A/B (TOUR_BASE_URL vs local dist) — never cross-session absolute
  tables.** Variant ART still pending (Phase 8 golden pipeline contract in
  `ARENA_COSMETIC_COMPATIBILITY.md` §5). Next: Session 4 = Phase 8 on
  Sonnet 5 high (golden champion), reviewed by Fable 5.

---

## 3. The rules that cost real bugs

Every one of these was a live bug. Do not relearn them.

### Process
- **Warm lint caches HIDE what CI catches.** Always
  `rm -rf .eslintcache node_modules/.cache` before trusting lint. A whole phase
  once sat undeployed because CI (cold) refused what passed locally (warm).
- **A green local build is not a deploy.** After pushing, grep the LIVE bundle
  for a marker string from your change.
- **A guard that cannot fail is not a guard.** The motion guard's first version
  matched a bare identifier, so `const reducedMotion = false` passed it. **Break
  every guard, watch it go red, restore it.** Do this before you trust it.
- **Falsify persistence bugs against production.** "It works" means: seed it,
  tour it in a browser, restart the app, read the row back from the database —
  then delete what you seeded.

### Dates and time
- **`domain/today.ts::todayIso()` is the ONLY source of "today"** — the athlete's
  LOCAL calendar day. `toISOString()` is the UTC date: east of Greenwich it is
  wrong for part of every day, and it filed early-morning workouts under
  yesterday.
- **Timestamps stay UTC.** `xp_events.created_at` is a `timestamptz` and Postgres
  reads a naive string as UTC — a local wall clock would file every XP grant hours
  in the future. A calendar date is what an athlete means by "today"; a timestamp
  is an instant. Only one of them was ever wrong.

### The XP contract (load-bearing)
- Flat 10 XP/set, 2/cardio-minute; curve `500 + (L-1)*25`. `domain/xp.ts` is the
  only place XP is minted. The ledger is **append-only** — an edit must never
  re-grant, and a granted set can never be un-granted.
- **Never invalidate `workout_log` for a QUEUED verdict** — it drops the optimistic
  row.
- **Battle sets must use the direct path**, never the durable queue:
  `battle_events` need a server-confirmed row id.

### Status vs locking (`domain/week-status.ts`)
- **Status derives WITHOUT a marker** (past + sets = COMPLETED) — or a year of
  history reads as MISSED.
- **Locking keys ONLY on the marker** — or you lock history nobody agreed to lock.
- Conflate them and you lie about the past in one direction or the other.

### Exercises
- **`libraryMuscleFor()` beats `inferMuscleGroup()`** on every set-save path.
  Inference is a heuristic tuned on names it has seen; it has never seen the 848
  imported ones. `inferMuscleGroup` itself is parity-pinned — it moves for nobody.
- **Ranking: the CLASS of match dominates** (exact > alias > word > substring);
  popularity only orders WITHIN a class. Rank by position instead and "Bench
  Sprint" beats "Barbell Bench Press".

### React
- **The React Compiler is on.** A hand-written `useMemo` it cannot prove stable
  makes it **bail out of the whole component** — worse than no memo. Prefer plain
  derivations. (`Compilation Skipped: Existing memoization could not be preserved`
  is the lint error that tells you.)
- **`router.back()` pops the previously focused TAB**, not the screen you came
  from. Navigate explicitly.
- A tab screen with `href: null` **stays mounted**. Per-mount refs are NOT
  per-workout — reset them on the params.

### Storage / caches
- **Sign-out must clear EVERY cache layer** (auth-context): React Query, the
  persisted query cache, every Zustand store, the set queue, the finish queue.
  Add a store → clear it there. A missed one hands the last athlete's character to
  the next visitor.
- **A read that swallows every failure as an empty success is a bug.** It cached
  `[]`, deleted the optimistic finish marker, and unlocked the whole week. Only
  "the table does not exist" degrades to empty; everything else throws.
- **Never add columns to `custom_workout_plan`** — Streamlit reads it.

---

## 4. The map

**Screens** (`client/src/app/(main)/`): `index` Home · `today` **Train (hub)** ·
`workout` **the workout page** (pushed, `href: null`) · `progress` · `avatar`
(Forge) · `arena` · overflow (routine, schedule, streak, profile, …).

**The training loop:**
- `today.tsx` — the HUB. Week bars, plan source tabs (MY PLAN · AI PLAN ·
  BUILT-IN), cardio, start-an-empty-workout. **No logging UI.**
- `workout.tsx` — the workout. Params `date` + `workout` + `source`.
  **Editable only when `date === today` and not finished** (the cards write to the
  date in the URL). FINISH is not gated on the clock.
- Bars → `domain/week-status.ts` (`buildWeekBars`, `extraBarsForToday`).
- Plans → `domain/plan-sources.ts` (`resolveDayIn` — **the selected source is asked
  FIRST**) wired by `data/use-day-plan.ts`.
- Deviations (skip / remove / ±sets / ad-hoc) → `domain/session-plan.ts` +
  `state/session-store.ts` (persisted, self-expiring, cleared on sign-out).
- Durability → `data/set-queue.ts` and `data/finish-queue.ts` (both idempotent by
  a server unique index; both cleared on sign-out; both have a **generation
  counter** so an in-flight flush cannot resurrect a cleared queue).

**Add Exercise** (`ui/train/exercise-picker.tsx`, ~960 exercises): personalised sections
before any keystroke → `domain/exercise-sections.ts`; search + ranking →
`domain/exercise-rank.ts`; taxonomy/aliases → `domain/exercise-taxonomy.ts`;
favourites → `data/exercise-prefs.ts`.

**Rule of thumb: the thinking is pure and tested in `domain/`; the screens are
surface.** If you are about to put a rule in a component, put it in `domain/` and
test it instead.

---

## 5. The loop (run this for every change)

```bash
cd client
rm -rf .eslintcache node_modules/.cache      # WARM CACHES LIE
npx tsc --noEmit
npx expo lint                                # must be 0 problems
npx vitest run src                           # 427 tests
node scripts/verify-tokens.mjs
node scripts/verify-battle-engine.mjs
node scripts/verify-motion.mjs
npx expo export -p web --clear               # the build CI will do
```

Then **tour it in a browser** (Playwright, scripts in the session scratchpad):
serve `client/dist` on a local port, sign in as a smoke account, drive the real
flow, screenshot, assert. Seed what you need in production, **and delete it
afterwards**.

**Smoke accounts** (RLS-isolated, safe):
- ALPHA `smoke-test-claude@evoforge.internal` / `SmokeTest-2026-07!x` (male)
- BRAVO `smoke-test-claude-2@evoforge.internal` / `SmokeTest-2026-07!y` (female)

**SQL against production** — management API via `curl` (urllib is Cloudflare-
blocked); token in `client/.env.sbtoken.local`:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query" \
  -H "Authorization: Bearer $SBTOKEN" -H "Content-Type: application/json" \
  -d @query.json     # {"query": "..."}
```

**Commits:** one coherent change per commit, the full loop green before pushing.
`migrations/`, `data/`, `auth/`, `domain/xp*`, `.github/` and friends are
**protected paths** — the commit-msg hook demands `[architect]` in the message.

---

## 6. Environment gotchas

- Node 24 at `C:\Users\tyson\AppData\Local\nodejs` (add to PATH in Git Bash).
- Windows console is cp1252 → `PYTHONIOENCODING=utf-8` for anything with emoji.
- `expo export` does **not** generate `expo-env.d.ts` (only `expo start` does); CI
  writes the shim itself.
- Metro **caches inlined `EXPO_PUBLIC_` values** — always `--clear` after an env
  change, or you ship the old values.
- Lighthouse runs fine in CI (Ubuntu) but flakes locally on Windows (Chrome
  temp/permissions). Don't chase it.

---

## 7. Known weaknesses / what's next

- **LCP**: async routes (2026-07-16) cut the entry 3.5MB → 1.1MB (+1.8MB
  shared chunk); re-measure LCP in CI's Lighthouse before touching budgets.
  Budgets are **ratchets** under the measured build: raise them when the
  build clears them, **never lower one to make a red run green**. The next
  big step remains native builds.
- **Deferred deliberately:** Sentry/PostHog (they earn their weight on native, and
  the bundle is already the problem), push notifications (need a native build).
- **Asked for, not built:** a strength percentile vs population ("top x% of
  lifters").
- The picker's muscle subgroups are exactly the 17 tags that EXIST. Obliques /
  rotator cuff / lower abs were requested; no exercise carries those tags, so the
  chips would always return nothing. Adding them means re-tagging ~960 exercises
  and migrating history the append-only ledger cannot survive — a **data** change,
  not a UI one.

---

## 8. Working with Tyson

He gives short, direct briefs and expects autonomous execution: read the plan,
ship it in coherent commits, verify against production, tell him what broke.

He values, in order: **the thing actually works** (falsified, not asserted) →
**honest reporting** (say what you didn't do) → speed. He will accept "I found
three bugs you didn't ask about and fixed them". He will not accept a green test
suite over a working app.

When you find a bug in code you just wrote, **say so plainly and fix it**. Several
of the best fixes in this repo came from a tour catching what a test could not.
