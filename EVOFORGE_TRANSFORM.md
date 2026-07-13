# EVOFORGE TRANSFORM — living implementation document

> Program: turn EvoForge into a premium fitness RPG around the core loop
> (plan → quest → train → log → feedback → complete → rewards → next unlock
> → confirm next session → weekly contracts/rivals/evolution). North-star
> metric: % of users completing another planned workout within 7 days.
> This file is the audit + phase tracker the brief requires. Update it in
> the same commit as each phase's work.

## 1. AUDIT FINDINGS (2026-07-13, grounded in direct code inspection)

### Current architecture
- **Stack**: Expo SDK 57 / RN 0.86 / React 19.2.3, expo-router 57 (Tabs,
  standard-navigation), NativeWind 4 + Tailwind 3.4, Reanimated 4.5 +
  worklets, react-native-screens 4.25, safe-area-context 5.7, supabase-js
  2.110, TanStack Query 5 (in-memory only), Zustand 5 (toast + settings
  stores only), AsyncStorage 2.2 (present; used by LargeSecureStore for
  auth), vitest 4 (208 tests incl. 3,323-case Python-parity goldens),
  TypeScript 6, eslint 9 (zero warnings enforced by convention).
- **Deploy**: web-first via `expo export -p web` → Cloudflare Pages
  (expo-rewrite.evoforge.pages.dev), auto-deploy per push through
  `.github/workflows/client.yml`. Installable PWA (manifest + icons).
  No native store builds yet (eas-cli installed on the dev machine).
- **Screens** (expo-router `(main)` Tabs): index(Home), today(Train-like:
  LIFT|CARDIO), log(Stats), ai(Oracle), avatar(Evolution+SkillTree),
  arena(+battle/[id]), more, and overflow: progress, goals, awards, rank,
  profile, data, schedule, streak, coins. Tabs keep screens mounted
  (`href:null` overflow entries); scroll-to-top-on-tab-press registry
  exists; scroll position is otherwise retained.
- **Data flow**: all reads via TanStack hooks (per-user keys, 2500-row
  wire caps mirroring Python); all writes via useMutation + invalidation.
  `useSaveSet` = decideSetSave (pure) → Supabase insert/update →
  `xp_events` grant (server trigger recomputes; append-only ledger).
  Battles: battle_events reference owned rows, payloads rebuilt by a
  server trigger; engine byte-pinned ×3 (CI). Coins: server-guarded
  claims. AI: edge functions; photos judge-and-discard except battles.
- **Design system**: theme/tokens.js is THE token source, byte-pinned
  against the Streamlit styles.css by scripts/verify-tokens.mjs (CI). 12
  keyframes as data in theme/animations.ts; ambient loops yield to perf
  mode + reduced motion; one-shots always play. Rendering contract for
  sprites (CSS steps on web / stacked frames native) documented in
  HANDOFF.md and paid for by live bugs — do not re-litigate.
- **Perf baseline** (measured, Lighthouse mobile, prod): perf 64, a11y
  67, best-practices 100; FCP 0.9s, LCP 5.5s (JS bundle), TBT 580ms,
  transfer 779KiB after the 42% asset diet. Assets 7.1MB on disk.

### Major UX problems (vs the brief)
1. **Log Set is network-blocking.** Button spins on `save.isPending`;
   verdict, XP float, battle event all wait for Supabase. No local-first
   layer, no sync queue, no idempotency beyond Postgres uniques.
2. **No rest timer exists.** Core loop element entirely missing.
3. **No active-set focus mode.** Today is a card list; good after the P2
   polish (active-card purple, prefill, steppers, keypad) but not a
   single-set console; no undo, no substitution, no warm-up toggle,
   no RPE, no per-set flow.
4. **No workout summary on Finish.** FINISH WORKOUT opens SummarySheet
   (exists, decent) but there is no PR/path/evolution/reward ceremony
   ordering, no next-session confirmation.
5. **Seven tabs + More** vs the five-tab target; account-ish screens
   scattered in More.
6. **Home** leads with identity + hero (good) but has no Today's Quest
   card, no rest-day/missed/completed dynamic states, no weekly
   contract; Start-of-loop lives one tab away.
7. **Streaks are daily-ish** (computeStreak on workout dates) — not
   schedule-aware weekly adherence; rest days look like gaps.
8. **No notifications, no analytics, no Sentry.**
9. **Cold start blocks on network**: React Query cache is memory-only,
   so a fresh open renders defaults until Supabase answers.

### Major performance risks
- LCP 5.5s lab on mobile (single JS bundle ~2.5MB pre-gzip; Expo web has
  no route-level code splitting on this pipeline). Mitigations: cached
  shell paint, font/display, defer heavy screens; full fix = native
  builds later.
- All screens stay mounted → memory grows with visited tabs; acceptable
  today, watch with battle screens.
- 2500-row reads recomputed per render for summary/stats (memoised, but
  a 5,000-set account should move to aggregates).

### Major data-integrity risks
- **The XP contract is load-bearing**: flat 10 XP/set, edits must never
  re-grant, ledger append-only, drift detection everywhere. ANY
  offline-first design must queue INSERTS with client-generated UUID ids
  (Postgres PK dedupes retries) and NEVER queue deletes/re-inserts.
- decideSetSave decides insert-vs-update from prior rows; offline queue
  must snapshot that decision at enqueue time and reconcile on flush.
- Battle events must reference confirmed rowIds — battle sets stay
  online-required (they already are; battles are live-synchronous).

### Systems worth preserving (do not rebuild)
- The whole anti-cheat spine (006/009/013/015 triggers + guards).
- Golden-parity domain layer (untouchable; calibration seam exists).
- Sprite/animation rendering contract; tokens byte-pin; the loop
  (tsc/vitest/lint/tokens/engine/export/tour); NumberField (steppers +
  in-app keypad); podium HeroStage; PWA shell; sex calibration;
  ExerciseCard shared seam (tint/onLogged) used by the Volume Duel.

### Package changes (policy-compliant; all verified against SDK 57)
- Phase 1: `@tanstack/react-query-persist-client` +
  `@tanstack/query-async-storage-persister` (pure JS, tiny, no native
  impact) — Home-from-cache. Fallback: remove persister, app behaves as
  today.
- Phase 8 (deferred until native builds matter): sentry-expo, posthog-
  react-native. NOT installed now — web build ships no analytics; adding
  them purely for web is scope the release gates don't require yet.
- NOT adding: sqlite (AsyncStorage suffices for queue sizes here), Skia/
  Rive/Lottie (rendering contract + CSS/Reanimated already deliver;
  revisit for evolution cinematics), expo-notifications (needs native
  build to matter).

### Database changes
- None for Phases 1–3 (client-generated UUID ids are accepted by the
  existing `gen_random_uuid()` PK columns; retries dedupe on PK).
- Phase 5 (contracts/streak) can derive weekly adherence from
  workout_schedule (012) + workout_log — no migration required initially.
- Any future migration follows the numbered-SQL + falsification-checklist
  convention. Rollback: constraint-widening only, never destructive.

### Risks & rollback
- Every phase is a separate commit on `expo-rewrite` with the full local
  loop green before push; rollback = `git revert <commit>` (no phase
  makes a destructive DB change). The offline queue is feature-gated by
  its own module — deleting the module restores today's direct path.

## 2. PHASED PLAN & CHECKLIST

- [x] **P1 Foundation** — audit (this doc); five-tab nav (Home/Train/
  Progress/Forge/Arena) + profile menu (top-right) hosting Account/
  Awards/Coins-shop/Data/Schedule/Settings-ish screens; tab state
  preserved (already true); Query-cache persistence (Home from cache);
  44pt controls (already enforced by min-h-[44px] convention); tokens:
  game-layer tokens live in theme/animations.ts + tokens.js (pinned) —
  no new token file needed yet.
- [x] **P2 Workout reliability** — pending-set queue (AsyncStorage,
  client UUID ids, flush-on-reconnect/interval, sync states local/
  pending/synced/failed_retryable), crash-safe draft persistence for the
  active day's typed sets, REST TIMER (absolute end timestamp, survives
  remount/background, opt-in per set log).
- [x] **P3 (shipped as the onboarding/plan batch)** — first-run tutorial
  overlay, exercise library (100+ tagged), routine builder writing
  custom_workout_plan, same-muscle ⇄ substitution on Train cards. The
  originally-sketched focus-console items (single-set console, undo,
  warm-up toggle, collapse completed) are DEFERRED post-P8 — the P2
  active-card polish (purple row, prefill, steppers, keypad) covers the
  core of that need.
- [x] **P4 Completion payoff** — ordered MISSION COMPLETE ceremony
  (summary → PR reveal → level path → evolution progress → next-session
  confirmation; skippable at every phase).
- [x] **P5 Home & return loop** — Today's Quest card + dynamic states +
  weekly contract + Forge streak (schedule-aware).
- [x] **P6 Forge & Progress restructure** (Avatar→Forge naming, Paths
  tabs; Progress: This Week summary + metric/timeframe pickers +
  aggregates).
- [x] **P7 Arena** — active battle first (open invites already were;
  now live matches lead the hub), async default (already true).
  Notifications remain deferred — they need a native build to mean
  anything, and the web PWA cannot deliver them on iOS.
- [ ] **P8 Polish/release gates** — Lighthouse CI wiring, Sentry/PostHog
  (native builds), reduce-motion audit (largely done), large-account
  test fixture.

## 3. STATE DIAGRAMS (sync)

set save: typed → LOG → [queue row {id: uuid, payload, state: pending}]
→ (online) insert w/ explicit id → synced (grant fires server-side)
→ (offline/timeout) stays pending, retry w/ backoff; PK collision on
retry = already-synced → mark synced. failed_permanent only on 4xx
validation → surface toast + keep row for manual retry.

rest timer: LOG success → restEndAt = now + duration (persisted) →
UI derives remaining from Date.now() every second → survives remount/
background because only restEndAt is stored.

## 4. PHASE LOG

**P1 (2026-07-13, `016d40d`)**: five-tab bar (Home/Train/Progress/Forge/
Arena), companion-as-profile-menu (44pt, testID profile-menu), menu gains
Oracle + Stats Entry; React Query persisted to AsyncStorage (24h, purged
on sign-out). Packages: +react-query-persist-client, +query-async-storage-
persister. DB: none. Verified: 208 tests, lint 0/0, tours.

**P2 (2026-07-13)**: offline-first set logging + rest timer.
- data/set-queue.ts: AsyncStorage queue, client-minted UUID row ids (PK =
  idempotency; duplicate sets via retry impossible), XP grant after
  confirmed insert (unique index dedupes), flush on boot/online/enqueue/
  30s, states pending|failed_permanent; purged on sign-out.
- useSaveSet({durable}) — Today/Train inserts are queued + optimistic
  cache append (no invalidation flicker); battles keep the direct path
  (battle_events need server-confirmed rows).
- ui/rest-timer.tsx: absolute restEndAt in storage; remaining DERIVED per
  tick — remount/background/lock-proof by construction; haptic on done;
  SKIP; lingers 8s. Starts on every confirmed NEW set.
- MEASURED: offline-logged set flipped UI instantly, survived reconnect,
  landed on the server EXACTLY ONCE (SQL-verified); online log shows
  timer + UPDATE flip. Known limitation: typed-but-unlogged drafts are
  not yet persisted (P3, with the focus console).

**P3 batch (2026-07-13, `6848ab6` + hotfix `9a2e4bc`)**: first-run
tutorial overlay (once-per-device), domain/exercise-library.ts, routine
builder ((main)/routine.tsx → custom_workout_plan; custom plans drive
their own day chips), ⇄ same-muscle substitution. LESSON RELEARNED: the
push went out on a warm local lint cache and CI (cold) refused it —
react-hooks/set-state-in-effect on the day-clamp effect. The hotfix
derives the effective day at render (dayChoice raw, day clamped); the
deploy gap meant P3 was invisible on the live URL until 9a2e4bc.

**P4 (2026-07-13)**: MISSION COMPLETE ceremony.
- ui/summary-sheet.tsx: phased sequence summary → PR reveal → LEVEL path
  (XpBar) → evolution progress (per-requirement bars via
  requirementProgress) → NEXT MISSION confirm ("I'LL BE THERE"). Phases
  are data-gated: PR phase only when a PR landed, next-session only when
  a schedule exists. SKIP (ghost) on every non-final phase keeps testID
  summary-close, so pre-ceremony tours still dismiss in one click;
  advance = summary-next, final = summary-done. Phase dots in the
  header. All confirmed state — nothing projected.
- domain/scheduled-streak.ts: nextScheduledSession() (effective-dated,
  14-day horizon, skips Rest) + extracted planInForce; 5 new vitest
  cases (213 total).
- (main)/today.tsx: prNamesRef captures WHICH lifts PR'd (deduped into
  prExercises); buildSummary passes nextSession.
- DB: none. Packages: none.

**P5 (2026-07-13)**: Home leads the return loop.
- ui/quest-card.tsx: TODAY'S QUEST as the first card under identity, four
  honest states off the persisted schedule — none (⚒ FORGE MY WEEK →
  /schedule), rest (recovery + next mission), pending (START MISSION →
  /today), completed (✓ MISSION COMPLETE + next mission). Weekly-contract
  row: seven Monday-start pips (completed ✓ / missed / pending / rest /
  future) + done/target.
- domain/scheduled-streak.ts: weeklyContract() — Monday-start (UTC, the
  app's date convention), effective-dated per day, and a set trained on a
  Rest day is a completed pip but NEVER quota (bonus, not target). 4 new
  vitest cases (217 total).
- Home's streak chip is now SCHEDULE-AWARE when a schedule exists
  (computeScheduledStreak — rest days bridge instead of reading as gaps)
  and reads FORGE STREAK; with no schedule the old daily computeStreak
  and DAY STREAK label stand, so nothing regresses for scheduleless
  accounts.
- FALSIFIED in-browser, all four states (schedule + set seeded and then
  removed server-side for BRAVO): none → pending → completed → rest, plus
  START MISSION navigating to Train.
- DB: none. Packages: none.

**P6 (2026-07-13)**: Forge + Progress restructure.
- FORGE: avatar.tsx gains a ScreenHeader (THE FORGE · EVOLUTION|PATHS) and
  the SKILL TREE tab is renamed PATHS — the label, not the engine
  (skill-tree.tsx's branch/gate logic is untouched; its inner heading is
  now ATTRIBUTE PATHS). ?view=paths is the name; ?view=skill-tree still
  resolves (old links/tours) and testIDs avatar-tab-0/1 are unchanged.
- PROGRESS: THIS WEEK aggregate card leads (sessions — done/target when a
  schedule exists — sets, volume, cardio minutes, XP), over the SAME
  Monday-start window Home's contract uses. Then the lift chart with
  METRIC (E1RM | VOLUME | SETS) × TIMEFRAME (4W | 12W | 1Y | ALL) pills
  and the exercise pills; bodyweight keeps its own scale and honours the
  timeframe.
- domain/progress-aggregates.ts (new, pure): weekStart, periodTotals
  (XP via activityXp — never a private formula), timeframeStart,
  exerciseSeries. 12 vitest cases (229 total).
- BUG FOUND + FIXED en route (visible in the volume tour): LineChart's 10%
  y-padding printed a NEGATIVE axis tick (-1831kg) on strictly non-negative
  series — the domain now floors at 0 when yMin >= 0. Volume's axis also
  mixed units per tick (23.1t beside 6493kg); the formatter is now chosen
  once from the series peak.

**P7 (2026-07-13)**: the Arena leads with the battle you're already in.
- domain/battle/format.ts (new, pure — structural MatchLike, NO import
  from data/, so the domain layering holds): formatLabel/formatGlyph and
  splitBattles() → {live, invites, history}. live = matched|active|
  judging; an UNKNOWN status falls to history rather than vanishing (a
  dropped match is a battle the athlete can never reach again). 9 vitest
  cases (238 total).
- arena/index.tsx: ACTIVE BATTLE(S) section above the CREATE/JOIN capsule,
  one ActiveBattleCard per live match — format name, state (LIVE NOW /
  BOTH READY TO START / JUDGING · REVEAL WAITING), round n/N from the
  engine's totalRoundsFor (a duel has ONE round; the old UI would have
  said 3), RESUME BATTLE (testID arena-resume-<id>). History now holds
  only finished matches.
- BUG FIXED: every history row said "Friendly Blitz" — a Volume Duel and a
  Heads or Tails both lied about what they were. Format decides its name
  and glyph now.
- FALSIFIED on production: two-account tour (BRAVO creates a volume duel,
  ALPHA joins by code) — both hubs then led with ACTIVE BATTLE / Volume
  Duel / RESUME, and RESUME navigated back into the match. Smoke match
  deleted afterwards.
- DB: none. Packages: none. Engine byte-parity re-verified (18026 × 3).
