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
- Parallel `nutrition` branch (FUEL tab, unmerged): its `020_nutrition.sql` must
  be **renumbered to 022** at merge — mainline claimed 020 and 021.

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

**Migrations applied through `033`. Next free number: `034`**
(022 stays RESERVED for the nutrition branch — it renumbers to 025+ at merge
if 025 is taken by then; check `ls migrations/` first).

<!-- superseded: **Migrations applied through `021`. Next free number: `022`.** -->
`016` user_exercises+routines · `017` workout_sessions · `018` user_plans ·
`019` user_exercise_prefs · `020` weight_unit · `021` ai_scan_cache +plan-scan.

**496 tests. Four executable guards** (all in CI):
`verify-tokens` · `verify-battle-engine` (byte-pin ×3) · `verify-motion` ·
`lighthouse` (budgets in `client/lighthouserc.json`).

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
