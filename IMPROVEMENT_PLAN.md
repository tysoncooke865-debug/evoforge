# EvoForge Improvement Plan — 12 Requirements (Expo client, `expo-rewrite` branch)

## Context

EvoForge's Expo + Supabase rewrite (branch `expo-rewrite`, live at expo-rewrite.evoforge.pages.dev) is feature-complete through Migration Phase 6 and has a working Battle Arena (friendly BLITZ, 3 rounds). This plan addresses 13 improvement requirements: fixes for things that are wrong today (duplicated stats, truncated titles, wrong navigation, missing cancel) and new features (previous-performance prefill, lighting/pump confirmation, streak calendar, coins, AI routines, privacy settings). **Requirement 9 (skill tree) is skipped by user decision** — `SKILL_TREE.md` does not exist in the repo.

The plan targets the **Expo client** (`client/`) and its Supabase backend (`migrations/`, `supabase/functions/`). The Streamlit app on `main` must remain untouched — all schema changes must be additive, per the migration doctrine. This document is the work order for implementation. Before starting, read `HANDOFF.md`, then `client/CLAUDE.md`, then this file — they carry the invariants and the per-change verification workflow this plan assumes.

**Deliverable of this document:** the reviewed plan itself. No code changes have been made.

---

## A. Existing Architecture Assessment

| Area | Current state |
|---|---|
| Frontend | Expo SDK 57 · React Native 0.86 · React 19.2 · Expo Router (`client/src/app/`) · NativeWind 4 / Tailwind 3 · Reanimated 4. Deploys to web via Cloudflare Pages; native builds are Phase 7 (not yet shipped). |
| Backend | Supabase: Postgres + RLS, Deno Edge Functions (`supabase/functions/`: `battle-invite/join/ready/settle/physique`, `ai-physique`, `ai-bodyfat`). No other server. Authoritative battle tables have **no client write policies** — only edge functions (service role) write them. |
| Database | 13 legacy tables (owner-only RLS, `user_id uuid default auth.uid()`) + `xp_events` ledger (002/003/006) + `ai_scan_cache` (007) + profile v2 columns (008) + 9 battle tables (009). Migrations are hand-run numbered SQL in `migrations/`; next free number is **010**. |
| Auth | Supabase Auth (email+password), `client/src/data/auth-context.tsx`, LargeSecureStore session persistence. Sign-out must clear queryClient + every Zustand store. |
| State management | TanStack Query is the only server-state layer (`client/src/data/hooks.ts` — per-user query keys, invalidate-on-write in `mutations.ts`). Zustand only for ephemeral UI (`toast-store`, `settings-store`). |
| Real-time | Supabase Realtime `postgres_changes` on `battle_events/battle_rounds/battle_round_scores/battle_matches` (channel `battle:{matchId}`), client invalidates the `battle_bundle` query; 15 s poll fallback while a match is unresolved. |
| AI services | OpenAI Responses API (`gpt-5.1`) server-side only, via `_shared/ai.ts` (CORS, `callOpenAiJson`, sha256 result cache + 10/hr rate limit through `ai_scan_cache`, whose `kind` check already allows `'coach'`/`'plan'`). |
| Image storage | Solo Oracle photos are **never persisted** (in-memory → edge fn → discarded). Battle round-3 photos are the one sanctioned exception: private `battle-media` bucket, path `{match_id}/{user_id}/{round_no}-{attempt}.jpg`, participant-only SELECT via `is_battle_participant()`, service-role-only writes, deleted with the match. |
| Domain contract | `client/src/domain/` is a golden-fixture-pinned port of Python `domain/` (4,600+ parity cases). **Pinned functions must not change**; new game rules are additive v2 layers (pattern: `branches-v2.ts`). `catalogs.ts` (ROUTINE, achievements) is *generated* — never hand-edit. |
| Workout data | `workout_log` (one row per set; `estimated_1rm` computed on save; edit = update-in-place by id, never delete-and-insert — XP invariant), `cardio_log`, `bodyweight_log`, `measurements`, `bodyfat_log`, `physique_ratings`. PPPPLA routine = 6 named training days + Rest in `catalogs.ts`; **the user picks the day manually — no weekday schedule exists**. |
| Game data | `battle_matches` (status `inviting→matched→active→judging→settled/abandoned` — `abandoned` is declared but **never set by any code**), `battle_participants`, `battle_rounds`, `battle_events` (append-only, client-writable behind `battle_events_guard` trigger; kind `'forfeit'` allowed but never written), `battle_round_scores`, `battle_media`. Round titles are a **code catalog** in `client/src/domain/battle/engine.ts` (byte-copied to `supabase/functions/_shared/battle/engine.ts`), rendered as `LIFT THE {OBJECT}` etc. |

### Load-bearing invariants this plan must not break
1. A set edit never re-grants XP (`set-save.ts` verdicts; grant keyed to `workout_log.id`).
2. `useLedgerXp()` returns null on failure, never 0. Any new ledger hook copies this.
3. A failed ledger grant never fails the underlying save, and is never silent.
4. Sign-out clears every cache layer; every new Zustand store must be added to `auth-context.tsx` cleanup.
5. Solo physique photos are never persisted; only battle round-3 photos may live in `battle-media`.
6. Celebrations fire from confirmed state only; announced XP = XP that landed.
7. All migrations additive; Streamlit on `main` keeps working against the same DB.
8. A guard that cannot fail is not a guard — every new check gets falsified once.

---

## B. Dependency and Implementation Order

```
Phase 1 — quick correctness fixes (no schema):        #4 titles, #7 navigation
Phase 2 — logging & stats foundation (no schema):     #3 log split, #1 stat centralisation, #2 prefill
Phase 3 — battle features (migration 010):            #5 cancel  →  #8 opponent photos + live scores
Phase 4 — AI features (migration 011):                #6 lighting/pump, #10 AI custom routine
Phase 5 — progression systems (migrations 012, 013):  #11 schedule + streak calendar  →  #12 coins
Phase 6 — privacy (no schema):                        #13 public/private profile setting
```

Dependencies:
- **#5 before #8**: the opponent-photo view must handle the `cancelled` state and media cleanup that #5 introduces.
- **#11 before #12**: streak coin rewards need the persisted schedule/completion data #11 creates.
- **#12 uses #2/#1's surfaces** only for display (coin balance in header) — no hard dependency.
- **#10 after #11**: an AI routine "replaces the scheduled inbuilt workout for the day", so the schedule concept must exist first (#10 works without #11 as a Today-screen source toggle, but the "replace scheduled day" semantics come from #11).
- **#3 before #1's UI**: the Stats tab created by #3 is the natural home for #1's stat-editing surface.
- #4, #7, #6, #13 are independent.

---

## C. Requirement-by-Requirement Plan

### #1 · Centralise shared user measurements and statistics

1. **Current behaviour.** Bodyweight is writable in **four unlinked places**: `profile.bodyweight_kg` (onboarding, once), `bodyweight_log` (Log screen), `measurements.bodyweight` (Log screen's Measurements card — **dead data, nothing reads it back**), and `bodyfat_log.bodyweight` (AI scan). Height lives in `profile.height_cm` and `bodyfat_log.height_cm`. Edits do not propagate. The *read* layer already reconciles: `use-avatar-data.ts:57-61` prefers the latest positive `bodyweight_log` value; "current bench" is derived from `workout_log` e1RM, not `profile.bench_e1rm`. But screens read these ad-hoc (`ai.tsx` mixes `stats.bodyweight` with `profile.data?.height_cm`), and the Streamlit editable-profile surface (`views/profile.py`) was never ported — there is no way to correct height after onboarding.
2. **Proposed behaviour.** One read seam + one corrected write path:
   - **Read seam:** new `client/src/data/use-current-stats.ts` → `useCurrentStats()` composing *existing* hooks (no new queries): `heightCm` (profile), `bodyweightKg` (latest positive `bodyweight_log` → `profile.bodyweight_kg` → null), `benchE1rm/squatE1rm/deadliftE1rm` (derived max from `workout_log` → profile snapshot → null), `bfMid`, `sex` — plus a `sources` object naming where each value came from, for UI captions.
   - **Write path:** a BODY STATS card on `profile.tsx` (restoring the un-ported capability, corrected): bodyweight input **appends to `bodyweight_log`** via the existing `useLogBodyweight`; height input updates `profile.height_cm` via a new `useUpdateHeight` mutation (001's `for all` owner RLS policy already permits UPDATE — **no migration**); bench/squat/deadlift shown **read-only** with a "derived from your logs" caption — an editable value would recreate the second source of truth this requirement removes.
   - **Retire the dead input:** remove `bodyweight` from `MEASUREMENT_FIELDS` in `log.tsx`. Keep the column (append-only history; old rows stay exportable).
   - **`profile.bodyweight_kg` stays a frozen onboarding snapshot** — `base_level` was derived from it and must never shift. The seam prefers the log; the snapshot is only the last-resort fallback. Documented in the seam's header.
   - **Consumers through the seam:** `ai.tsx`, `goals.tsx` current-value reads, `use-avatar-data.ts` (its journey *series* charts rightly stay on the raw log hooks).
3. **Files.** New `client/src/data/use-current-stats.ts`; `client/src/data/mutations.ts` (`useUpdateHeight`, trim measurements payload); `profile.tsx`; `log.tsx`; `ai.tsx`; `goals.tsx`; `use-avatar-data.ts`.
4. **Data model.** None.
5. **API/server.** None.
6. **State management.** React Query's invalidate-on-write is the propagation mechanism: `useLogBodyweight` already invalidates `bodyweight_log`; `useUpdateHeight` invalidates `profile`. Every consumer of the seam re-renders with the new value — this is the "edit once, updates everywhere" guarantee, and it persists across sessions because the source is the DB.
7. **Edge cases / parity flag (critical).** The pinned `avatar-stats-calc.ts` defaults bodyweight to 77 internally when inputs are empty. `useCurrentStats()` must return **raw nullable values and never pre-default** — `use-avatar-data.ts` must keep feeding the pinned calc byte-identical inputs or golden fixtures break. `ai.tsx` keeps an explicit local `?? 77` only where the AI request previously received the defaulted value.
8. **Security/privacy.** Own data only; RLS unchanged.
9. **Testing.** Vitest for the seam's precedence order (log > profile snapshot > null, per field); the 4,600-case parity suite as the regression guard (positive control: it must stay green with `use-avatar-data.ts` refactored); tour: edit height on Profile, assert the AI screen's request payload reflects it.
10. **Acceptance.** Editing bodyweight or height in one place updates every displaying screen after refetch; the Measurements card no longer offers bodyweight; lifts display as derived values; parity suite green; values persist across sign-out/sign-in.

### #2 · Display previous sets and repetitions during workouts

1. **Current behaviour.** `client/src/app/(main)/today.tsx` renders one `SetRow` per target set; a row prefills **only from the same date's already-logged row** (`today.tsx:238`). There is no "last session" prefill for strength. Cardio already has a "REPEAT LAST" prefill on the Log screen.
2. **Proposed behaviour.** When an exercise card renders and set *N* has no row logged **today**, prefill its weight/reps inputs from the most recent prior session's set *N* for that exercise (fall back to that session's last set if it had fewer sets). Show a dim "LAST" affordance so prefilled ≠ logged is visually distinct. Values stay fully editable; nothing is saved until the user taps save. Never-logged exercises render empty as today.
3. **Files.** New pure helper `client/src/domain/last-performance.ts` (`lastPerformance(rows, exercise, todayIso)` → `{ date, sets: [{set, weight, reps}] } | null`); `today.tsx` `SetRow`/`ExerciseCard` (prefill + hint); no data-layer change — `useWorkoutLog()` already loads the rows the helper needs (client-side filter, same as `previousBest1rm`).
4. **Data model.** None.
5. **API/server.** None. (If a user ever nears the 2 500-row cap, a `latest_sets_per_exercise()` RPC is the follow-up — same escape hatch already documented for `activity_totals()`.)
6. **Frontend.** Prefill initial input state only when today's row is absent; today's logged row always wins over prefill; distinguish "prefilled" from "typed" so accidental one-tap saving of stale numbers is a deliberate act (save button stays explicit per set — unchanged).
7. **Edge cases.** Exercise appears in both built-in and AI plan (match on exercise string — the log is keyed by exercise name, not routine); previous session had fewer sets than today's target (fall back to its last set); previous session same day (excluded — "prior date" only); weight-less bodyweight movements (prefill reps only if weight was 0); cardio/time/distance metrics are the Log screen's cardio path and already have REPEAT LAST — no change needed, note it in the doc.
8. **Security/privacy.** None — own rows only, already RLS-scoped.
9. **Testing.** Vitest for `last-performance.ts`: empty history, single prior session, per-set differing values, fewer prior sets than target, same-day rows excluded, today's logged row wins. UI pass via the Playwright tour (log a set, revisit next simulated day is not tourable — assert prefill against seeded history instead).
10. **Acceptance.** Opening Today for an exercise trained before shows last session's weight/reps per set, editable; a brand-new exercise shows empty inputs; today's already-logged sets show today's values; saving behaves exactly as before (PR detection unchanged — it already excludes the row being saved).

### #3 · Divide the training log into Cardio and Stats sections

1. **Current behaviour.** `client/src/app/(main)/log.tsx` stacks three `GlowCard`s vertically: `CardioCard`, `BodyweightCard`, `MeasurementsCard`. No tabs.
2. **Proposed behaviour.** A two-segment control at the top of the Log screen — **CARDIO | STATS** — reusing the existing `SegmentedTabs` capsule from `client/src/ui/battle-arena.tsx` (already used by the Arena hub and, since `657e95f`, the Avatar tab). Cardio segment: the existing `CardioCard` unchanged. Stats segment: `BodyweightCard` + `MeasurementsCard` (and #1's stat-editing surface when it lands). All existing functionality, history, XP preview, and navigation are preserved.
3. **Files.** `log.tsx`, plus extracting `SegmentedTabs` from `battle-arena.tsx` into its own `client/src/ui/segmented-tabs.tsx` — it is now used by three screens, and #11's calendar will reuse it too.
4. **Data model.** None.
5. **API/server.** None.
6. **Frontend.** Keep both segments **mounted** and toggle visibility with style (`display: none`), not conditional rendering — RN conditional rendering would drop half-typed form state on a tab switch. Optional `?tab=` route param so future deep links can target a segment.
7. **Edge cases.** Toasts/XP announcements must still fire regardless of active segment; keyboard-avoiding behaviour on both segments; segment choice need not persist across sessions (default CARDIO).
8. **Security/privacy.** None.
9. **Testing.** Playwright tour: screenshot both segments; log a cardio entry and a bodyweight entry through the new tabs and assert the rows land (`cardio_log`, `bodyweight_log`). No domain tests needed (presentational).
10. **Acceptance.** Both segments reachable and functional; a cardio log and a measurement log both persist exactly as before; nothing on the old page is missing; no horizontal overflow at 320 px.

### #4 · Fix game titles on mobile screens

1. **Current behaviour.** Battle round titles ("LIFT THE FIRE ENGINE", "ESCAPE THE ZOMBIES") render through `ScreenHeader` (`client/src/ui/screen-header.tsx`), whose title `<Text>` is **`numberOfLines={1}`** at `text-3xl` inside a `flex-1` box, sharing the row with the countdown timer (`battle/[id].tsx:300-315`) — long titles tail-ellipsize ("LIFT THE RHIN…"). Also `numberOfLines={1}` on player name/class chips in `client/src/ui/face-off.tsx:407,416`.
2. **Proposed behaviour.** Complete titles always readable: wrap to two lines, step the font down one token (`text-3xl → text-2xl`) when the title exceeds a length threshold, never ellipsize. Timers stay visible and never overlap.
3. **Files.** `client/src/ui/screen-header.tsx` (accept `numberOfLines`/auto-size behaviour, default preserved for other screens), `client/src/app/(main)/arena/battle/[id].tsx` (round headers), `client/src/ui/face-off.tsx` (name/class rows).
4. **Data model / API.** None.
5. **Frontend approach.** Do **not** rely on `adjustsFontSizeToFit` — it is unsupported on react-native-web and this app ships to web first. Instead: (a) title `numberOfLines={2}`, (b) a pure length-based size step (e.g. > 14 chars → `text-2xl`; the six object and six cardio names are a closed catalog so the threshold is verifiable against all twelve), (c) `flex-1 min-w-0` on the title container so the timer keeps its intrinsic width, (d) `break-words` only as a last-resort style — the titles are multi-word, wrapping suffices.
6. **Edge cases.** All 12 catalog titles at 320 px; the FACE OFF vs screen where two names compete for width; long user display names (3–24 chars enforced) beside class chips.
7. **Security/privacy.** None.
8. **Testing.** Because the title catalog is closed, add a vitest that asserts every `BATTLE_OBJECTS`/`CARDIO_CHALLENGES` display title fits the chosen threshold rule (guards future catalog additions). Playwright tour at 320/360/390 px widths asserting no `…` in the rendered header (positive control: assert the full string is present).
9. **Acceptance.** "LIFT THE FIRE ENGINE" and "ESCAPE THE ZOMBIES" render complete at 320 px, no ellipsis, timer visible, no horizontal scroll.

### #5 · Add a cancel game option

1. **Current behaviour.** No cancel/forfeit/abandon path exists at all. `battle_matches.status` declares `abandoned` and `battle_events` allows kind `forfeit`, but **no UI, mutation, edge function, or SQL ever writes either**. The only mid-battle exit is the OS back gesture, which leaves the match running (15 s poll + countdown continue for the opponent).
2. **Proposed behaviour.** **Either participant** may cancel in status `inviting`, `matched`, or `active` (in `inviting` only the initiator exists, so "initiator-only" falls out naturally; friendly BLITZ has no ratings, and forcing a stuck opponent to wait out three round timers is worse than allowing cancel). Flow: cancel affordance → in-app confirmation overlay ("Are you sure you want to cancel this battle? This ends it for both players — no XP, no winner.") → new **`battle-cancel` edge function** (mandatory: authoritative tables are service-role-write-only) → status `abandoned`. **Reuse `abandoned`**, not a new status — it's already in the 009 check constraint, the client type union, and the poll-stop condition; add `cancelled_by`/`cancelled_at` columns so the UI can say who cancelled.
3. **Files.** New `supabase/functions/battle-cancel/index.ts`; modified `battle-settle` and `battle-physique` (race hardening below); `migrations/010_battle_cancel.sql`; `client/src/data/battle/mutations.ts` (`useCancelBattle`), `hooks.ts` (type fields), `battle/[id].tsx` (cancel buttons + `AbandonedPhase`), `arena/index.tsx` (CANCELLED badge).
4. **Data model — migration 010.** `alter table battle_matches add column cancelled_by uuid references auth.users(id), add column cancelled_at timestamptz;` No RLS or trigger changes: `battle_events_guard` already requires `active`/`matched` status, so an abandoned match rejects all client events by construction.
5. **API/server.**
   - `battle-cancel`: verify caller is a participant, then **compare-and-set**: `update battle_matches set status='abandoned', cancelled_by, cancelled_at where id = matchId and status in ('inviting','matched','active') returning id`. 1 row → cancelled, proceed to cleanup; 0 rows → re-read: `settled` → 409 "Already settled — result stands"; `abandoned` → 200 idempotent. Cleanup (best-effort, never fails the response): remove each participant's `battle-media` storage objects (`{matchId}/{uid}/…`) and delete the match's `battle_media` rows — "media deleted with the match" per the design doctrine.
   - `battle-settle` hardening (the cancel↔settle race): early-exit 409 if the loaded match is already `abandoned`; and make the final `settled` update conditional on `status='active'` — if 0 rows, return 409 **before the XP grant loop**. Whoever wins the CAS wins; the loser gets a truthful 409.
   - `battle-physique` hardening: reject unless match status is `active` (today it only checks the round window) — otherwise a photo could be judged (and OpenAI billed) against a cancelled match and `battle_media` re-inserted after cleanup.
   - **XP:** `battle-cancel` writes nothing to `xp_events`; an abandoned match has `xp_awarded` null so the 009 self-heal path also grants nothing. Cancelled battles are XP-inert by construction.
6. **Frontend.** Cancel per phase: InvitePhase "CANCEL INVITE" (no confirm — nothing is lost), VsPhase/ActivePhase "ABANDON BATTLE" behind a confirmation overlay. **Do not use `Alert.alert`** — it is unimplemented on react-native-web and this app ships web-first; build a small in-app confirm modal (the `level-up-overlay` pattern). New `AbandonedPhase` when `match.status === 'abandoned'`: "BATTLE CANCELLED" + who, no scores, BACK TO THE ARENA → `router.replace('/arena')` (#7). The phase switch unmounts `ActivePhase`, which kills its countdown `setInterval`; `useBattleBundle` already stops polling on `abandoned`; the realtime channel cleans up on unmount. **Opponent notification is already free**: the channel subscribes to `battle_matches` `id=eq.{matchId}` — the status UPDATE invalidates the bundle and flips the opponent's phase within seconds (15 s poll as fallback). Optional toast on the observed transition.
7. **Edge cases.** Cancel vs settle race (CAS both sides, above); cancel while a judge call is in flight (`battle-physique` status check rejects the late write; a row that slipped in pre-cancel is removed by cleanup); double-cancel (idempotent 200); media cleanup failure (non-fatal — an orphaned object behind a private bucket is unreadable garbage; a periodic sweep is a later task); opponent offline (sees CANCELLED badge on next arena focus refetch).
8. **Match history / rankings.** Abandoned matches stay in `battle_matches` (append-forever history), render a `CANCELLED` chip in the arena hub, show no winner and no XP, and are **excluded from any future win-rate/rating computation** (`battle_ratings` is currently dead; the exclusion rule is documented now for when it comes alive).
9. **Testing.** Falsify the CAS once (attempt settle after cancel on staging → 409, no XP rows). Two-account Playwright run: A cancels during round 1 → B's screen flips to CANCELLED without interaction; assert no `xp_events` rows for the match, `battle_media` rows gone, both clients stopped polling. Guard-trigger positive control: a `battle_events` insert after abandon is rejected.
10. **Acceptance.** Either participant can cancel from any pre-settled state after an explicit confirmation; both clients show the cancelled state promptly; all timers/polls/AI processing stop; no XP is granted; media is cleaned up; history shows CANCELLED; a cancel racing a settle produces exactly one truthful outcome.

### #6 · Estimate lighting and pump conditions from physique photos

1. **Current behaviour.** The plumbing half-exists: `supabase/functions/ai-bodyfat/index.ts` already reads `lighting`, `pump_status`, `time_of_day` from the request and injects them into the prompt (defaulting `'Unknown'`); `client/src/data/ai.ts::runAiBodyfat`'s context type already declares them — **but `ai.tsx` never sends them**, and `ai-physique` has no such fields at all. The old Streamlit `views/bodyfat.py:106-110` had manual select boxes (the feature being modernised). No AI *estimation* of conditions exists anywhere.
2. **Proposed behaviour.** Single-call estimate + confirm flow:
   - The scan call asks the model to also return `conditions: { lighting, pump }` alongside the (provisional) analysis.
   - The UI shows a **CONDITIONS card** — AI-estimated lighting and pump pre-selected — before revealing/saving the final result.
   - If the user confirms unchanged → the provisional result is saved as-is (no second model call).
   - If the user corrects either value → one re-run with `confirmed_conditions` in the body; the prompt instructs the model to trust the given values (e.g. discount a strong pump). The **sha256 cache key must include the confirmed conditions** for corrected runs, or the cache would return the uncorrected verdict.
   - Scales: **Lighting** = `flattering | neutral | unflattering` (advantage/neutral/disadvantage); **Pump** = `none | mild | moderate | strong`.
3. **Files.** `supabase/functions/ai-physique/index.ts` + `ai-bodyfat/index.ts` (prompt additions, `confirmed_conditions` param, deferred-save flag, cache-key change in `_shared/ai.ts`), `client/src/data/ai.ts` (types + params), `client/src/app/(main)/ai.tsx` (conditions confirm card between "analysing" and "complete" in the existing `ScanFrame` state machine).
4. **Data model.** Migration **011**: `alter table physique_ratings add column conditions jsonb;` (nullable, additive — invisible to Streamlit). Body-fat runs store confirmed conditions inside the existing `bodyfat_log.notes` (already free text) to avoid a second column; revisit if it ever needs querying.
5. **API/server.** `ai-physique` gains a `save` flag (pattern already exists in `ai-bodyfat`): estimate pass runs with `save:false`; the confirm pass persists. Rate limiting: a confirm-unchanged pass is a cache hit by design (same image hash, no conditions in key) so it does not double OpenAI spend; a corrected pass is a real second call and legitimately consumes one more slot of the 10/hr budget.
6. **Frontend.** Extend `ScanFrame` states: `idle → ready → analysing → confirm → complete/error`. The confirm card shows the two selects (chips, reuse `Chip`) plus "LOOKS RIGHT" / "RE-JUDGE WITH MY CORRECTIONS" actions. Solo photos still never persisted — the photo stays in memory until confirm completes, then is discarded as today.
7. **Edge cases.** User abandons at confirm (nothing saved, photo discarded on unmount — assert no write); rate limit hit on the correction call (surface the existing rate-limit error, keep provisional result visible but unsaved); model omits `conditions` (fall back to `neutral`/`none`, mark "estimate unavailable"); cached legacy results without conditions.
8. **Security/privacy.** No new photo persistence. Conditions are user-attested metadata, not body data — still owner-only via `physique_ratings` RLS.
9. **Testing.** Unit-test the cache-key derivation (conditions included iff corrected). Edge-function tests are thin here — instead falsify by hand once: correct "strong pump → none" and verify a different verdict row lands with `conditions` populated. Client: vitest for the confirm-state reducer; tour screenshot of the confirm card (mock the function response).
10. **Acceptance.** Every physique/body-fat scan shows estimated lighting+pump before anything is saved; confirming unchanged saves without a second model call; correcting re-judges with the confirmed values; `physique_ratings.conditions` records what was confirmed.

### #7 · Correct the "Back to Arena" navigation

1. **Current behaviour.** `ResultsPhase` in `client/src/app/(main)/arena/battle/[id].tsx:747` renders `<NeonButton title="BACK TO THE ARENA" … onPress={() => router.back()} />`. `router.back()` pops history — it happens to reach the hub only when the battle was pushed from the hub; from a deep link, refresh, or after cancel-navigation it can land on Home or exit the group.
2. **Proposed behaviour.** Always land on the Arena hub: `router.replace('/arena')` (replace, so the finished battle screen isn't back-reachable into a stale state).
3. **Files.** `battle/[id].tsx` (ResultsPhase; plus the exit paths #5 adds — cancel confirmation and cancelled-state results use the same destination). Audit `arena/index.tsx` entry points (they `router.push('/arena/battle/${id}')` — unchanged).
4. **Data model / API.** None.
5. **Frontend.** One-line change + consistency audit of every completion/exit state: `settled` → ResultsPhase button; `abandoned`/`cancelled` → same button (#5); no exit exists on `inviting`/`matched`/`active` today (#5 adds them; they too go to `/arena`).
6. **Edge cases.** Entering the battle via deep link with no history (replace still works — that's the point); double-tap (replace is idempotent).
7. **Security/privacy.** None.
8. **Testing.** Two-account Playwright battle run (the pattern already used for P1 validation): finish a battle, tap the button, assert URL is `/arena`; deep-link straight into a settled battle, tap, assert `/arena`.
9. **Acceptance.** From every match-completion state, BACK TO THE ARENA lands on the Arena hub, from any navigation history.

### #8 · Show "Run the Judge" photos and live scores to both opponents

1. **Current behaviour.** Round 3 ("FACE THE JUDGE") is code-complete: camera-only capture → `battle-physique` judges via OpenAI **then** uploads to the private `battle-media` bucket (`{match_id}/{user_id}/{round_no}-{attempt}.jpg`) and inserts a `battle_media` row + a server-only `photo_hash` event. The storage policy (`battle_media_participant_read`) **already grants both participants SELECT** on the match folder — but the UI never renders the opponent's photo; the opponent sees only status text and, at settle, verdict numbers. Scores land in `battle_round_scores` only when `battle-settle` runs.
2. **Proposed behaviour.**
   - **Photos:** each opponent sees the other's submitted round-3 photo, fetched via **`createSignedUrl` (300 s expiry)** — it yields an `https` URI RN `<Image>` consumes directly, and the short expiry is a natural access-revocation backstop after cancel/settle. (`download` would also pass RLS but costs a Blob→base64 round-trip.)
   - **Reveal timing: after BOTH sides are final** (same predicate settle uses: last media row `confidence !== 'low'` OR attempts ≥ 2), or the round is scored — whichever first. No first-mover disadvantage; nobody's photo shows while they may still retake; both clients compute the identical predicate from the same rows. Before reveal, a submitted opponent shows a locked/blurred placeholder ("PHOTO LOCKED — reveals when both have submitted").
   - **Live scoring — recommended model: DB-state + realtime invalidation, no token streaming.** Judging is synchronous inside `battle-physique`, and the `photo_hash` event it writes is already in the realtime publication and already subscribed — so per-submission **verdict states** (submitted → judged, with the five verdict axes from `battle_media.verdict`) arrive "live" through the existing invalidate-on-event machinery, followed by a visible "awaiting final scoring" state and the **official points at settle** from `battle_round_scores` (also already subscribed). This answers the requirement's clarification: category-by-category token streaming is rejected — it would need new infrastructure and can desync; progress-state-then-full-result is what the architecture already guarantees to keep synchronised (DB is the event log; reconnect/refetch rebuilds everything).
3. **Files.** `client/src/data/battle/hooks.ts` (add `storage_path` to the bundle's `battle_media` select; new `useBattleMediaUrl(storagePath, enabled)` query → signed URL, `staleTime` 240 s, null on any error); new `client/src/data/battle/physique-reveal.ts` (pure: `isFinal()`, `revealReady()`, per-side state machine `waiting | judging | submitted_locked | revealed | noncompliant | cancelled` — deliberately **not** in `client/src/domain/`, which is parity-pinned); `battle/[id].tsx` (new `PhysiqueDuel` two-panel YOU/OPPONENT section in round-3 ActivePhase and ResultsPhase).
4. **Data model.** **None.** Deliberately not adding `battle_media` to the realtime publication — the `photo_hash` event lands immediately after the media row and already triggers the refetch; the 15 s poll covers the residual window.
5. **API/server.** None beyond #5's `battle-physique` status check. The verdict is already stored in participant-readable `battle_media.verdict`.
6. **Frontend states.** waiting (pose prompt / "opponent hasn't submitted") · judging (own mutation pending) · submitted_locked (blurred placeholder) · revealed (`<Image>` + verdict axes as bars, labelled "JUDGE VERDICT — final points at settle") · noncompliant ("NON-COMPLIANT — attempt n/2") · cancelled (`status === 'abandoned'` unmounts the duel; signed URLs die ≤ 5 min; #5's cleanup deletes the objects) · settled (official `battle_round_scores` points replace the awaiting state).
7. **Edge cases.** Signed-URL failure (expired/deleted mid-render) → "PHOTO UNAVAILABLE" placeholder, never blocks scores; retake-after-reveal impossible by construction (reveal requires both final; final means no attempts left); socket down → poll fallback; the `isFinal` predicate mirrors `battle-settle`'s — both carry "move in lockstep" comments and share a fixture.
8. **Security/privacy.** Access is already correctly scoped: paths only come from RLS-scoped `battle_media` rows of the loaded bundle, and the storage policy's folder-1 `is_battle_participant` check makes cross-match path guessing a 403. Photos are viewable **only within the match context** (the only screen that ever holds a path is the battle screen), access ends with the match (#5 cleanup + URL expiry), and battle photos remain the one sanctioned exception to the never-persist rule — update `client/CLAUDE.md`'s photo invariant note in the same commit if wording needs the reveal added.
9. **Testing.** Vitest for `physique-reveal.ts` (every state transition, both-final predicate, fewer-attempts asymmetry). Two-account Playwright run: A submits (B sees LOCKED), B submits (both see photos + verdicts), settle (both see identical official points); cancel mid-round-3 (duel unmounts, URL fetch 403s after cleanup). Cross-match access falsification: signed-URL request for another match's path as a non-participant → 403 (positive control: own match path → 200).
10. **Acceptance.** Both opponents see each other's photo once both are final, verdict states update live on both clients without manual refresh, official scores appear at settle and match on both screens, all six UI states render correctly, and no photo is reachable outside the match's participants or after cancellation.

### #9 · Skill tree — SKIPPED (user decision, 2026-07-12)

`SKILL_TREE.md` does not exist on any branch or in git history, so this plan does not design a skill tree.

> **Update, same day:** commit `657e95f` (out-of-band, Tyson's own spec) added an Avatar **SKILL TREE subview** — an EVOLUTION | SKILL TREE segmented submenu with five stat-path panels driven by the real branch engine (`branchPathsV2` + `evolutionReadiness`), plus a new `useLatestMeasurements` hook. Requirement 9 stays out of this plan's scope, but implementers must treat that subview as the live skill-tree implementation: do **not** build a second one, and note that the old Avatar page content now lives inside its `EvolutionView`.

### #10 · Restore the AI custom routine feature

1. **Current behaviour.** The `custom_workout_plan` table exists (dormant: `id, timestamp, plan_name, workout, exercise, sets, reps, muscle, reason, day_goal` + `user_id`/RLS from 001) but the Expo client has no reader or writer. The Streamlit implementation (`domain/custom_plan.py`, `views/today.py`) — an AI JSON plan flattened row-per-exercise, a `workout_source` toggle on Today, per-exercise `reason` display — was not ported. HANDOFF.md lists the `ai-plan` edge function as "not yet built"; the old prompts live in `services/ai_physique.py::run_ai_custom_plan_*`. `ai_scan_cache.kind` already allows `'plan'`.
2. **Proposed behaviour.**
   - **Generation**: user-initiated from the Oracle (AI) screen — "FORGE MY ROUTINE". Inputs assembled client-side: latest `physique_ratings` weak points, recent muscle volume (from `useWorkoutLog`), goal. New edge function **`ai-plan`** calls OpenAI with the ported `run_ai_custom_plan_*` prompt, validates the JSON shape (`{plan_name, days:[{day, goal, exercises:[{exercise, sets, reps, reason}]}]}` — days must be exactly the six PPPPLA day names so scheduling and logging map 1:1), and returns it **without saving**.
   - **Accept/edit/reject**: the client shows the full plan preview (per-day cards, per-exercise `reason`). Accept → rows inserted into `custom_workout_plan` (owner RLS allows the client to write this table directly) tagged `plan_id = ai_plan_<iso>`; Reject → nothing persisted. Editing = regenerate (v1 keeps it simple; inline editing is a later enhancement).
   - **Use**: Today gets a **source toggle** (BUILT-IN | AI PLAN), mirroring Streamlit's `workout_source`. The AI plan's day list replaces the day chips' content; logging flows through the exact same `useSaveSet` path (plain `workout_log` rows → normal XP, PRs, achievements, prefill from #2). The base `ROUTINE` in `catalogs.ts` is generated/pinned and is **never modified**.
   - **Regenerate**: allowed; a new accept **replaces** the previous plan (delete rows of the old `plan_id`, insert new — plans are user-owned config, not history; the Streamlit delete-all-then-insert precedent applies and no XP is keyed to plan rows, so delete is safe here, unlike sets).
   - **Failure**: generation error or invalid JSON → error toast, nothing saved, built-in routine untouched. Rate-limited via the existing `ai_scan_cache` hourly budget under kind `'plan'` (keyed on a hash of the input payload instead of an image).
   - **Duplicates/conflicts**: one active plan per user (latest `plan_id` wins; the toggle reads only the newest). With #11: the scheduled day resolves through the active source, so a scheduled "Push 1" completes whether its sets came from built-in or AI plan — completion is judged by *logging on the scheduled day*, not by which exercise list was used.
3. **Files.** New `supabase/functions/ai-plan/index.ts` (+ `_shared/ai.ts` reuse); new `client/src/domain/custom-plan.ts` (pure: JSON validation, row flattening, plan grouping — port of `normalise_custom_plan_df`'s current-shape subset); `client/src/data/hooks.ts` (`useCustomPlan`), `mutations.ts` (`useAcceptPlan`, `useDiscardPlan`); `ai.tsx` (generation UI + preview); `today.tsx` (source toggle).
4. **Data model.** None — the table exists. (Do **not** add columns; Streamlit still reads this table.)
5. **API/server.** `ai-plan` edge function; JWT-verified caller, rate limit, JSON-schema validation server-side (never trust the model's shape).
6. **Frontend.** Preview before save (accept/reject is the confirmation); `reason` text rendered per exercise (escape-free — React escapes by default; `react/no-danger` is already an ESLint error).
7. **Edge cases.** Model invents exercise names (fine — `workout_log.exercise` is free text, `inferMuscleGroup()` cascades to a default); zero/absurd sets-reps (server-side clamp: sets 1–8, reps as text but non-empty); user with no physique rating yet (generate from goals + volume only); plan generated but user signs out before accept (nothing persisted — correct); two devices regenerating concurrently (last accept wins; delete-then-insert is scoped to the old plan_id).
8. **Security/privacy.** OpenAI key stays server-side; plan content is the user's own data under owner RLS; the AI output renders through React's default escaping.
9. **Testing.** Vitest: plan JSON validation (missing days, wrong day names, malformed exercises), flatten/group round-trip. Falsify the server validation once (send a bad shape, expect 422). Tour: generate (mocked function), accept, switch Today to AI PLAN, log a set, assert the `workout_log` row and XP grant land.
10. **Acceptance.** A user can generate, preview, accept or reject an AI routine; the accepted plan is selectable on Today and loggable exactly like the built-in one; regenerating replaces it; a failed generation changes nothing; the built-in PPPPLA routine is bit-identical before/after (parity suite green).

### #11 · Scheduled workout streak calendar

1. **Current behaviour.** There is **no schedule**: `today.tsx` lets the user pick any PPPPLA day chip manually. The existing streak (`client/src/domain/streak.ts::computeStreak`) is pure, frontend-only, counts consecutive calendar days with any valid set, and ignores rest days entirely (a rest day breaks it). No calendar UI exists; the streak is one number in the workout summary sheet.
2. **Proposed behaviour.**
   - **Explicit weekly schedule**, effective-dated: the user maps weekdays → PPPPLA days (or Rest) on a new Schedule screen; suggested default Mon–Sat = the six training days, Sun = Rest. Stored in a new `workout_schedule` table — **not** profile jsonb, because judging *past* days correctly requires knowing which schedule was in force *then* (effective-dating), and `profile` is a frozen snapshot by contract.
   - **Completion** = at least one valid set (`weight>0, reps>0`) on that local date — matches existing streak semantics, doesn't punish partial sessions or day-swaps. **Missed** = a past local day whose effective plan assigns a training day and which has zero valid sets; today stays `pending` until a set lands or the local day ends. **Rest days are skipped** — they neither extend nor reset.
   - **Rescheduling** is structural: a new schedule row with `effective_from = today` governs today onward; past days are judged against the row effective then. RLS forbids backdating (±1 day for tz skew), so a broken streak cannot be retroactively "rescheduled" into rest days.
   - **Timezones:** client-local dates, no stored tz, no timestamp math anywhere — `workout_log.date` is already the client-local date string; the schedule stores local dates; both the TS function and the SQL mirror compare date strings only. A user changing timezone mid-streak gets dates as-written (documented, accepted).
   - **Computation from persisted data, not a stored counter:** pure `computeScheduledStreak(scheduleRows, workoutRows, todayIso)` → `{ current, best, runStart, days: Map<iso, completed|missed|rest|pending|future> }` in a **new** `client/src/domain/scheduled-streak.ts` (the pinned `streak.ts` is untouched). A deliberately tiny SQL mirror `scheduled_streak(user, asof)` exists **only** so #12's coin guard can verify milestone claims server-side — see the #11↔#12 contract in #12.
   - **Calendar UI:** new `streak.tsx` screen + `ui/streak-calendar.tsx` month grid — completed (filled) / missed (hollow red) / rest (dim) / today (ring) / future (empty), header showing CURRENT and BEST. Reached from the Today streak chip and More. No-schedule state = setup CTA + the legacy streak number as fallback.
3. **Files.** `migrations/012_workout_schedule.sql`; new `client/src/domain/scheduled-streak.ts`, `client/src/data/schedule.ts` (`useWorkoutSchedule`, `useSaveSchedule`), `client/src/app/(main)/schedule.tsx`, `streak.tsx`, `client/src/ui/streak-calendar.tsx`; `today.tsx` (default the day chip to today's scheduled day when a schedule exists — manual override preserved; streak chip → calendar; milestone coin claim hook for #12); summary sheet (switches from legacy to scheduled streak once a schedule exists — display-level only).
4. **Data model — migration 012.** `workout_schedule(user_id default auth.uid(), effective_from date, plan jsonb /* {"0":"Rest","1":"Push 1 - Strength",...} keys = JS getDay() */, created_at, pk(user_id, effective_from))`; RLS: owner select; owner insert/update constrained to `effective_from >= current_date - 1` (no backdating). Plus `scheduled_streak(p_user, p_asof) returns (length int, run_start date)` — security definer, ~20-line walk backwards over schedule+log with a today/yesterday pending window; execute revoked from `authenticated` (only #12's guard trigger, itself security definer, calls it).
5. **API/server.** None beyond the migration — schedule rows are owner-writable directly.
6. **State management.** `useWorkoutSchedule` keyed on userId; the calendar derives everything from `workout_schedule` + `workout_log` queries — stale-but-consistent offline, rebuilt on refetch; nothing to clear beyond the existing global sign-out cache clear.
7. **Edge cases.** No schedule yet (streak 0 + CTA; nothing regresses); multiple day-chips trained on one date (one date = one completed day by construction); DST/odd clocks (date strings only); user edits today's schedule row after training (allowed; completion is judged against the final effective row for that date); the 1000-day walk cap.
8. **Security/privacy.** Own rows only; the SQL function is reachable only through the coin guard; no cross-user surface.
9. **Testing.** Vitest for `scheduled-streak.ts`: rest-day bridging, miss-resets, pending-today, reschedule mid-streak, backdating rejected (mirror via RLS test), best-vs-current, tz-skew ±1. **A shared fixture file drives both the vitest suite and the migration's staging-gate SQL checks** so the TS and SQL implementations cannot drift silently. Falsify once: break the SQL mirror's rest-day branch on staging, watch the fixture check go red, restore.
10. **Acceptance.** A user can set and change a weekly schedule; the calendar shows completed/missed/rest/future days and current+longest streak; completing the scheduled workout increments, missing one resets, rest days never reset; a reschedule affects only today onward; all of it derives from persisted rows and survives reinstall/sign-in.

### #12 · In-app coin currency system

1. **Current behaviour.** No currency/economy concept exists anywhere in code or docs (verified by full-snapshot search). The nearest mechanics: the `xp_events` append-only ledger (migrations 002/003/006) and the PR toast (`verdict.is_pr` in `useSaveSet.onSuccess` — transient, not persisted).
2. **Proposed behaviour.** A **separate `coin_events` ledger** cloning the xp_events pattern — not new kinds on `xp_events`, because `xp_total()` sums the whole table (mixing currencies would corrupt XP/levels/leaderboard unless every consumer grew filters), and coins will eventually need `spend` semantics XP never has. Transaction-ledger, no mutable balance.
   **Earning rules (server-verified in a BEFORE INSERT guard trigger — the client's `amount` is always ignored):**
   | kind | source_id (dedupe key) | fired when | trigger verifies | amount |
   |---|---|---|---|---|
   | `workout_complete` | local date `YYYY-MM-DD` | Today's `complete` flips true (all planned sets done — the same condition that opens the WORKOUT COMPLETE sheet; FINISH EARLY does **not** earn it) | ≥ 10 valid sets on that date | **25** |
   | `pr` | `workout_log.id` | `verdict.is_pr` on save | row owned+valid; its Epley e1RM strictly beats the max over **earlier** owned rows of that exercise; **a prior best must exist** (first-ever set of a new exercise never pays — blocks a ~40-exercise farm) | **50** |
   | `streak_milestone` | `{M}:{run_start}` | scheduled streak crosses M ∈ {3,7,14,30,60,100} | `scheduled_streak()` recomputed server-side (as-of today and today+1 for tz skew) proves `length ≥ M` and the matching `run_start` | **10 × M** |
   | `starting_bonus` | `onboarding` | first Home mount post-onboarding | a `profile` row exists | **100** |
   | `adjustment`, `spend` | — | never (service-role only) | rejected for authenticated | — |
   Streak rewards are **milestone-based, not daily** (daily would double-pay what `workout_complete` already pays); `run_start` in the dedupe key makes each milestone once-per-streak-run but re-earnable after a genuine reset. **Starting balance = the retroactive 100-coin `starting_bonus`** (existing users get it on next load — no backfill migration needed). **Spending is deferred**; `spend` is reserved server-only so the ledger is ready for it.
   **Edits/deletes/cancellations: no clawback.** The ledger is append-only (no UPDATE/DELETE policies) exactly like XP — editing a set down keeps the coin, mirroring how XP is never revoked on edit; revocation would require compensating rows keyed to mutable history, breaking the guard's "prove every row against data as it existed" property. Documented in the migration header. Cancelled *battles* interact with XP, not coins (no battle coin kind in v1).
   **Honesty note (same trust posture as 006):** `workout_log` is user-writable, so fabricated sets can earn coins just as they earn XP. The trigger stops free *minting* (amounts always recomputed server-side), not fabricated training. Workout-write plausibility validation remains the separate pre-PvP task already tracked in CLAUDE.md problem #7.
3. **Files.** `migrations/013_coin_events.sql` (**after 012** — the guard calls `scheduled_streak()`); new `client/src/data/coins.ts` (`useCoinTotal` — **null on any failure, never 0**, same rule and rationale as `useLedgerXp`; `useCoinHistory`; `claimCoin(kind, sourceId)` fire-and-forget, swallows unique/check violations, toasts only unexpected errors); wiring in `today.tsx` (complete → claim; `verdict.is_pr` → claim, surfacing the saved row id through the verdict if needed), `index.tsx` (starting-bonus sweep + header coin pill), `more.tsx` (pill), new `client/src/app/(main)/coins.tsx` (transaction history: kind label, amount, date); summary sheet "+25 COINS" line **only after the claim confirmed** (announced coins = coins that landed).
4. **Data model — migration 013.** `coin_events(id, user_id default auth.uid(), kind check(in 6 kinds), amount int check(<>0), source_table, source_id text /* text not uuid: dates and composite keys are sources */, created_at)`; partial unique index `(user_id, kind, source_id) where source_id is not null`; RLS SELECT+INSERT only (append-only by construction); `coin_total()` security definer RPC (sum in Postgres, no row-cap exposure); `coin_events_guard()` BEFORE INSERT trigger per the table above (service_role passes through). Ships with a 006-style staging-gate checklist: one poisoned insert per kind → rejected; one legitimate claim per kind → amount overwritten server-side.
5. **API/server.** No edge function — direct RLS-checked inserts behind the guard trigger, exactly like XP grants.
6. **State management.** Query keys carry userId (`coin_total`, `coin_events`); covered by the global sign-out cache clear; no new Zustand store. `data.tsx`'s deletable-tables list must **exclude `coin_events`** (same rule as `xp_events`).
7. **Edge cases.** Duplicate claims (unique index absorbs, including two devices racing); claim rejected by guard (stale client cache thought it was a PR — non-fatal, silent); balance read failure renders "—" never 0 (a failure shown as 0 reads as a wiped wallet); day-chip switching (one `workout_complete` per date regardless); server floor (10 sets) vs client gate (all planned sets) deliberately differ — the server must not encode the pinned ROUTINE catalog into a trigger (a second parity surface); milestone claim with server/client date skew (guard checks two as-of dates, residual mismatch retries next session).
8. **Security/privacy.** Amounts are never client-trusted; kinds `adjustment`/`spend` are unmintable by users; balances are own-eyes-only (future public-profile display gated on #13's matrix).
9. **Testing.** Vitest: `claimCoin` error swallowing, `useCoinTotal` null-not-0, milestone source-key derivation. Staging SQL gate: falsify each guard branch (fabricate a `pr` claim on a non-PR row → rejected; forged `amount: 999999` → overwritten to the server value). Integration: complete a workout on staging, assert exactly one 25-coin row; repeat the claim, assert no second row.
10. **Acceptance.** Completing a workout pays 25 once per day; a genuine PR pays 50 once per PR set; streak milestones pay 10×M once per run; every user has the 100 starting bonus; the balance shows in the Home header and More, with a full transaction history screen; the guard provably rejects forged kinds/amounts/claims; no reward is ever double-paid.

### #13 · Public and private profile settings

1. **Current behaviour.** `public_profile` (migration 004: `display_name` unique 3–24 chars, `is_public` default **false**) is the only privacy surface, edited via `useSavePublicIdentity()` from the Rank tab's `OptInCard`. The only cross-user read in the entire system is `leaderboard_top(n)` (security definer, 4 columns, hard-filtered on `is_public = true` and zero XP drift). There is **no** profile discovery, search, friends/followers, direct profile URLs, or cross-user stats/photos/history anywhere — RLS denies all of it by default. Battles: `battle-invite` requires a `display_name`; opponents see name + snapshot (level, class) by explicit invite-code consent.
2. **Proposed behaviour.** Surface the existing switch as a first-class **Profile Settings** control on `profile.tsx`: PUBLIC PROFILE / PRIVATE PROFILE, with copy explaining exactly what each exposes. Codify the privacy matrix (below) as the contract for all future features. Persisting across sessions is inherent (it's a DB row).
3. **The privacy matrix** (enforced at data-access level, not UI):
   | Surface | Public | Private |
   |---|---|---|
   | Leaderboard (`leaderboard_top`) | listed by display name | excluded (already enforced in SQL) |
   | Profile discovery / search / direct URLs | n/a — feature doesn't exist; any future implementation must filter `is_public` server-side | n/a |
   | Stats, workout history, measurements, photos | never cross-user readable regardless of setting (owner-only RLS) | same |
   | Achievements, streaks, avatar, coins | own-eyes only today; any future public profile page shows them only when public | hidden |
   | Battles (invite-code friendly) | can create/join | can still create/join — sharing an invite code is explicit consent; opponent sees display name, level, class, round scores, and (with #8) round-3 photos **within the match only** |
   | Future quick/ranked matchmaking | eligible | design decision deferred: recommend requiring public=true to enter matchmaking (documented in G) |
4. **Files.** `client/src/app/(main)/profile.tsx` (settings section; reuse `useSavePublicIdentity` and `usePublicIdentity`), `rank.tsx` (OptInCard stays; both write the same row — no duplicate state, one mutation hook), copy in both places states the battle-photos consent explicitly.
5. **Data model.** None — `public_profile.is_public` already exists and is already enforced in `leaderboard_top`. (If later features need finer grains — e.g. "public but hide streaks" — that's a new migration; out of scope now.)
6. **API/server.** None today. Rule recorded for reviewers: **every future cross-user read must be a security definer function that filters on `is_public` (or explicit match participation) — never a base-table policy.**
7. **Edge cases.** Toggling private while listed on the leaderboard (next `leaderboard_top` call excludes them — immediate, server-side); toggling private mid-battle (match participation was explicit consent; the match continues — document in copy); display-name-less user switching to public (existing guard: can't be public without a name).
8. **Security/privacy.** This requirement is mostly *already satisfied at the backend*; the work is the settings surface + the contract. The one real leak-vector to keep closed: never add a cross-user SELECT policy to a base table.
9. **Testing.** Vitest for the settings component logic; SQL falsification once: as user A (private), assert `leaderboard_top` omits A while A has XP (positive control: flip public, assert A appears). Sign-out cache-clear check (identity is React Query state — already cleared).
10. **Acceptance.** The toggle exists in Profile Settings, persists across sessions, and a private user is absent from the leaderboard (verified server-side); the privacy matrix is committed as documentation.

---

## D. Database Migrations

All migrations are **additive** — no column drops, no data rewrites, Streamlit on `main` keeps working. All are hand-run in the Supabase SQL editor (the established process), each with a 006-style staging-gate checklist, and each falsified once before trust.

| # | File | Contents | Existing-data impact |
|---|---|---|---|
| 010 | `migrations/010_battle_cancel.sql` | `battle_matches` + `cancelled_by uuid`, `cancelled_at timestamptz`. No RLS/trigger changes (the 009 guard already rejects events on non-active matches). | None — nullable columns; existing matches untouched. |
| 011 | `migrations/011_physique_conditions.sql` | `physique_ratings` + `conditions jsonb` (nullable). | None — old ratings read as "conditions unknown". |
| 012 | `migrations/012_workout_schedule.sql` | `workout_schedule` table (owner RLS, no-backdating insert/update checks) + `scheduled_streak(uuid, date)` security definer fn (execute revoked from `authenticated`). | New table; no existing data. Users without a schedule keep the legacy streak display. |
| 013 | `migrations/013_coin_events.sql` | `coin_events` ledger (append-only RLS), partial unique dedupe index, `coin_total()` RPC, `coin_events_guard()` BEFORE INSERT trigger. **Must run after 012** (guard calls `scheduled_streak()`). | New table. Starting balances arrive via the client's retroactive `starting_bonus` claim — no backfill SQL needed. |

Ordering: 010 → 011 are independent; 012 → 013 is a hard order. Deploy order vs. code is safe in both directions by the ledger conventions (`useCoinTotal` null-on-absent; schedule screens gate on table presence via normal query errors → CTA state).

## E. Shared Infrastructure (build once, reuse)

- **`useCurrentStats()` seam** (`client/src/data/use-current-stats.ts`) — the single read path for height/bodyweight/lifts/bf (#1), consumed by AI (#6 payloads), Goals, Avatar data.
- **`SegmentedTabs` UI component** — already exists inside `battle-arena.tsx`; #3 extracts it to its own file, reused by the streak calendar screen (#11) and any future tabbed screen.
- **The ledger pattern, second instantiation** (#12's `coin_events` cloning 002/003/006) — with the reusable client conventions: fire-and-forget `claim*`, null-never-0 totals, dedupe by source key. Any third currency/ledger copies the same four properties.
- **Dual TS/SQL pure function with shared fixtures** (#11's `scheduled-streak.ts` + `scheduled_streak()`) — the fixture-drives-both-sides technique generalises to any client-computed/server-verified value (it is the same philosophy as the Python↔TS parity goldens).
- **Battle realtime invalidation machinery** (already exists) — #5 and #8 deliberately add **zero** new realtime plumbing; both ride `useBattleChannel`'s postgres_changes → invalidate → refetch. Rule for future battle features: put state in the subscribed tables, don't open new channels.
- **`useBattleMediaUrl` signed-URL hook** (#8) — the pattern for any future secure media rendering (expiring URL, null-on-error, RLS-scoped path source).
- **`ScanFrame` confirm state** (#6) — the estimate→confirm→final state machine, shared by physique and body-fat flows, reusable for any future AI human-in-the-loop step.
- **In-app confirm overlay** (#5) — web-safe confirmation modal (Alert.alert is not available on react-native-web); reusable for every future destructive action.

## F. Testing Plan

- **Unit (vitest, `client/src`):** `last-performance.ts` (#2); title-length threshold over the closed catalog (#4); cache-key derivation + confirm-state reducer (#6); `physique-reveal.ts` state machine (#8); `scheduled-streak.ts` full matrix (#11); `claimCoin`/`useCoinTotal` conventions + milestone key derivation (#12); `useCurrentStats` precedence (#1). **The 4,600-case parity suite is the standing regression guard** — it must stay green after every phase (positive control that pinned domain code was not touched).
- **Integration (staging Supabase):** each migration's staging-gate checklist; guard-trigger falsification per kind (#12, #11's SQL mirror); CAS race falsification (#5: settle-after-cancel → 409, zero XP rows); storage-policy falsification (#8: cross-match signed-URL as non-participant → 403, own-match → 200); `leaderboard_top` privacy exclusion (#13).
- **End-to-end (Playwright `ui_tour.py` pattern + the existing two-account battle-run pattern):** full battle with cancel mid-round and with photo reveal (#5, #7, #8); log-through-tabs (#3); AI scan with conditions confirm, mocked function (#6); generate→accept→train an AI plan (#10); schedule→train→calendar states (#11); complete-workout coin flow (#12).
- **Mobile responsive:** tour runs at 320/360/390 px asserting full title strings present and no horizontal scroll (#4), calendar grid fits (#11). "Render it and look at it": read the screenshots — the tour has caught what the suites could not.
- **Real-time multiplayer:** two-account runs assert the *other* client's screen changed without interaction (cancel propagation #5, verdict/photo reveal #8), plus a socket-killed variant to prove the 15 s poll fallback.
- **AI failure states:** rate-limit hit on the correction call (#6), invalid/malformed plan JSON → 422 and nothing persisted (#10), model omitting `conditions` → neutral fallback (#6), judge call against a cancelled match → rejected (#5).
- **Data migration testing:** run 010–013 on the staging project first, checklists green, then production (the human runs production SQL, per the established `[human]` split).
- **Privacy/authorisation:** RLS denial spot-checks for every new table (`workout_schedule`, `coin_events` cross-user SELECT → zero rows *with a populated positive control* — "an error is not a denial; zero rows is not a denial when there are zero rows"); `coin_events` absent from data.tsx delete list; sign-out clears all new query keys (already global, verify once).
- **Verification workflow per change-set** (unchanged): `npx tsc --noEmit && npx vitest run src && npx expo lint && npx expo export -p web --clear`, then the tour; Python suite untouched but runs in the pre-push hook; CI green before every deploy; check the served bundle marker before calling it live.

## G. Risks and Open Questions

**Risks**
1. **TS/SQL duplication** (#11 streak walk, #12 Epley in the guard): contained by shared fixtures + lockstep comments, but it is real drift surface. The Epley re-implementation has precedent (battle-settle already does it).
2. **`workout_log` is user-writable** — coins inherit XP's trust-on-first-use posture. Fabricated sets earn coins as they earn XP. Acceptable now for the same reasons; the workout-write plausibility validation task (CLAUDE.md problem #7) becomes more valuable once coins are spendable.
3. **Timezone-by-local-date-string** (#11): honest and simple, but a user logging across a tz change can gain/lose a day. Documented, accepted; the guard's ±1-day tolerance absorbs the server-side skew.
4. **Cache-key change for AI conditions** (#6) touches `_shared/ai.ts`, shared by both AI functions — regression-test the unchanged bodyfat path.
5. **Parity exposure in #1's `use-avatar-data.ts` refactor** — mitigated by the raw-nullable seam rule and the parity suite.
6. **react-native-web gaps** (#4 `adjustsFontSizeToFit`, #5 `Alert.alert`) — both designed around; a standing rule for reviewers: check RN-web support for any RN API used on a web-shipped screen.

**Open questions (product decisions — defaults chosen, flag if wrong)**
1. **#5:** either participant may cancel an `active` battle (not just the initiator). Chosen because friendly-only + no ratings; revisit before ranked mode.
2. **#8:** photos reveal only when **both** sides are final. Alternative (reveal each photo immediately on submission) is more "live" but creates first-mover exposure.
3. **#12:** coin values (25 / 50 / 10×M / 100 start) are first-pass constants — confirm or tune; they live in one place (the guard) by design. Battle wins pay no coins in v1.
4. **#11:** suggested default schedule (Mon–Sat training, Sun rest) vs. forcing an explicit choice at first use.
5. **#13:** should future quick/ranked matchmaking require `is_public = true`? Recommended yes; decide when matchmaking ships.
6. **#10:** AI plan editing is regenerate-only in v1 (no inline exercise editing). Acceptable?
7. **#6:** conditions confirmed for body-fat scans ride in `bodyfat_log.notes` rather than a dedicated column — fine until something needs to query them.

## H. Implementation Checklist

Work on `expo-rewrite`. `migrations/` commits need `[architect]`. Per change-set: tsc + vitest + lint + export + tour, push, verify CI + live bundle marker, update the affected doc in the same commit.

- [x] 0. Plan committed as `IMPROVEMENT_PLAN.md` at the repo root on `expo-rewrite` (this commit).
- [x] 1. **#4** Title fixes: `screen-header.tsx` two-line + size-step, `face-off.tsx`, catalog-fit vitest, 320 px tour check.
- [x] 2. **#7** `router.replace('/arena')` in ResultsPhase; audit exit states; two-account nav test.
- [x] 3. **#3** Log screen CARDIO|STATS segments (extract `SegmentedTabs`), both mounted, tour screenshots.
- [x] 4. **#1** `use-current-stats.ts` seam + BODY STATS card on profile (`useLogBodyweight` append, `useUpdateHeight`), retire measurements bodyweight input, route ai/goals/avatar-data through the seam, parity suite green.
- [x] 5. **#2** `last-performance.ts` + Today prefill with LAST affordance; vitest matrix.
- [x] 6. **Migration 010** on staging → checklist → production `[human]`.
- [x] 7. **#5** `battle-cancel` fn + settle/physique CAS hardening + confirm overlay + `AbandonedPhase` + CANCELLED badge; two-account cancel test; falsify the race.
- [x] 8. **#8** bundle `storage_path` + `useBattleMediaUrl` + `physique-reveal.ts` + `PhysiqueDuel` panels; two-account reveal test; cross-match 403 falsification; update `client/CLAUDE.md` photo invariant wording.
- [x] 9. **Migration 011** staging → production `[human]`.
- [x] 10. **#6** conditions estimate+confirm in both AI functions + cache-key change + `ScanFrame` confirm state; falsify one correction end-to-end.
- [x] 11. **#10** `ai-plan` edge function (port `run_ai_custom_plan_*` prompts) + validation + preview/accept/reject + Today source toggle; bad-shape 422 falsification.
- [ ] 12. **Migration 012** staging (shared-fixture SQL checks green) → production `[human]`.
- [ ] 13. **#11** `scheduled-streak.ts` + schedule/streak screens + calendar + Today integration; fixture suite green both sides.
- [ ] 14. **Migration 013** staging (guard falsified per kind) → production `[human]`.
- [ ] 15. **#12** `coins.ts` + claims wiring (complete/PR/milestone/starting bonus) + pill + history screen + summary-sheet line; exclude `coin_events` from data.tsx deletes; duplicate-claim test.
- [ ] 16. **#13** Profile Settings privacy toggle + copy + privacy matrix committed as doc; leaderboard exclusion falsified.
- [ ] 17. Sweep: sign-out cache audit for all new query keys; HANDOFF.md/PARITY.md/TASKS.md updated; full CI + tour green; reboot/verify live.
