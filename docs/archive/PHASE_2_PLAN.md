# PHASE 2 PLAN — client UI/UX improvement batch (11 items)

> **Execution work order.** Everything here targets the **Expo client** in `client/`
> on branch `expo-rewrite`. Before starting, read `HANDOFF.md` (state + invariants)
> and `client/CLAUDE.md` (commands + doctrine). Work in the listed commit order —
> each commit is self-contained, verifiable, and updates its docs in the same commit.
>
> Decisions below marked **[decided]** were made by the product owner; do not re-ask.

## Context

Tyson's improvement list: set-logging polish on Today, cardio merging into Today,
onboarding public-profile opt-in, homepage leaderboard teaser, tab-spring tuning,
scroll-to-top on tab press, avatar cleanup, join-code display, stepper/input styling.
Exploration confirmed most items are localized; two (BUILT-IN/AI PLAN toggle,
uppercase-at-submit join codes) already half-exist and only need relocation/completion.

Owner decisions:
- **[decided]** Log page becomes stats-only (bodyweight + measurements), retitled **Stats**; cardio lives only on Today.
- **[decided]** The standalone Rank screen stays; the homepage box is a teaser linking to it.
- **[decided]** Active set styling = purple border + soft glow (epic `#a855f7`), not full neon.
- **[decided]** Wobble rework (item 6) interpretation confirmed: less first overshoot, much higher damping, still sharp.

Guarded files — do NOT hand-edit: `client/src/domain/catalogs.ts` (generated; solve the
rep-scheme sentence in the UI layer) and `client/src/theme/tokens.js` (no token changes
needed; epic purple already exists as `tokens.colors.epic`).

## Pre-flight

- `cd client && npm ci` (if node_modules is absent), then run one expo command
  (`npx expo start`, then quit) so `expo-env.d.ts` exists for `npx tsc --noEmit`.
- During Commit 4, verify whether expo-router 57 (`standard-navigation` — there are no
  `@react-navigation/*` packages in the lockfile) supports `screenListeners`/`tabPress`.
  Fallbacks are specified there.

## Commit 1 — SegmentedTabs spring tune (item 6)

**File:** `client/src/ui/segmented-tabs.tsx` line ~28.

Change `withSpring((index * width) / 2, { damping: 20, stiffness: 260 })` →
`{ damping: 32, stiffness: 320 }`. Physics: ζ goes 0.62 → 0.89 (mass 1), i.e. one
barely-visible ~2% overshoot instead of a multi-cycle wobble, with a slightly faster
attack so it still feels sharp. Put the ζ math in a comment for the next tuner.
All five call sites inherit (log, avatar, today, arena, onboarding).

QA: flip tabs on Arena + Avatar, web and native: one crisp landing, no wobble.

## Commit 2 — Set-logging polish (items 1.1–1.7, 10, 11)

**Files:** `client/src/ui/exercise-logger.tsx`, `client/src/ui/number-field.tsx`,
new `client/src/ui/scheme-sentence.ts` + vitest test.

⚠ Both components are ALSO rendered by the Arena Volume Duel
(`client/src/app/(main)/arena/battle/[id].tsx`) — honor the `tint` prop everywhere and
QA the duel after every change here.

- **1.4 + 1.1 — scheme sentence, more vivid.** New pure helper `schemeSentence(scheme)`:
  `"8"` → `Aim for 8 reps`; `"8-12"` → `Aim for 8–12 reps`; `/amrap/i` → `As many reps
  as possible`; anything else (e.g. the long top-set string) returned verbatim.
  Replace `{scheme}` in the card sub-header (exercise-logger.tsx ~line 97) with the
  sentence and brighten `text-text-mute` → `text-text-dim`. Test: unit-case the four
  shapes AND iterate every scheme in `ROUTINE` from `@/domain/catalogs`, asserting
  non-empty output (pins against the generated catalog without touching it).
- **1.2 — active-set purple highlight.** Active set = the first unlogged set, computed
  only for the `isNext` card (exactly one purple row on screen). Give EVERY SetRow a
  constant-layout frame (borderWidth 1, transparent when inactive) so the highlight
  moving between rows never reflows. Active: border `` `${tokens.colors.epic}8c` ``,
  background `rgba(168,85,247,0.06)`, soft shadow (shadowColor epic, opacity 0.3,
  radius 10, elevation 3). In battles, follow `tint` instead of hardcoding epic.
  Comment the neon-policy exception (owner-approved).
- **1.5 — remove the LAST label.** Delete the `LAST MM-DD` sub-label block and the
  `showLast`/`lastDate` plumbing (SetRow props + ExerciseCard pass-through). **Keep the
  prefill seeding itself** (the useState initializers that copy last session's numbers).
- **1.3 — SET label alignment.** With LAST gone, vertically center `SET n` in its
  `w-s10` column (`justify-center`); check at normal and large font scale.
- **1.6 — column headers.** One header row above the first SetRow mirroring the row
  skeleton: spacer `w-s10`, `WEIGHT (KG)` centered over the input width, spacer for the
  stepper column, `REPS`. Style `text-2xs font-bold text-text-mute`. Match the row's
  actual gap classes so alignment is structural.
- **10 — fixed 4-char inputs.** `const FIELD_WIDTH = 64` in exercise-logger.tsx, passed
  to BOTH NumberFields (currently 54/44). Add `fontVariant: ['tabular-nums']` to the
  TextInput. Keep NumberField's own default width so duel call sites are untouched.
  QA by typing `137.5` and `8888`.
- **11 — fused steppers.** Replace the `gap: 4` stepper wrapper with ONE bordered pill
  (`borderColor `` `${tint}45` ``, `borderRadius 12`, `overflow: 'hidden'`, bg
  `` `${tint}12` ``) containing +, a hairline separator (`` `${tint}40` ``), and −.
  StepButton loses its own border/background. Hold-repeat and double-press logic
  untouched.
- **1.7 — grey prefill until touched.** `NumberField` gains `dim?: boolean` and sets the
  TextInput color explicitly: `dim ? tokens.colors['text-dim'] : tokens.colors.text`
  (use **text-dim**, NOT text-mute — text-mute is the placeholder color). `SetRow`
  tracks `weightDirty`/`repsDirty` (`useState(initial !== '')`) and wraps `onChange` to
  set dirty — steppers, keypad DONE and desktop typing all funnel through `onChange`.
  `dim = !logged && prefill !== null && !dirty`. In `onSave`, set both dirty so logging
  a prefill as-is turns white immediately (before the refetch flips `logged`).

QA: fresh rows show grey last-session numbers; one stepper tap whitens that field; LOG
whitens both; AMRAP reads as a sentence; duel set rows still coherent.

## Commit 3 — Cardio moves to Today; Log becomes Stats (items 3 + 4)

**Files:** new `client/src/ui/cardio-logger.tsx`, new `client/src/ui/field.tsx`,
`client/src/app/(main)/today.tsx`, `client/src/app/(main)/log.tsx`,
`client/src/app/(main)/_layout.tsx`.

- Extract the `Field` helper (log.tsx ~45–74) to `src/ui/field.tsx` — the remaining
  stats cards use it too. Move `CardioCard` + `CARDIO_FIELDS` + `CARDIO_ICONS`
  (log.tsx ~77–245) **verbatim** to `src/ui/cardio-logger.tsx`; keep every testID
  byte-identical (`cardio-minutes`, `cardio-save`, …). Export
  `cardioAnim(type): 'punch' | 'run'` (rounds-based types punch).
- `today.tsx`: add `mode` state (0 = Lift, 1 = Cardio) + hoisted `cardioType`
  (the header sprite needs it — same rationale as the old log.tsx comment). Top-level
  `SegmentedTabs LIFT / CARDIO` directly under the ScreenHeader. Wrap the current lift
  content and the new `<CardioCard type={cardioType} setType={setCardioType} />` in
  sibling `display: 'flex' | 'none'` Views — the keep-mounted pattern from log.tsx, so
  half-typed cardio forms AND SetRow state survive mode flips. Header sprite: cardio
  mode → `cardioAnim(cardioType)`, else the existing victory/idle logic.
- **Item 4:** the existing BUILT-IN / AI PLAN toggle (today.tsx ~153–155) moves inside
  the LIFT panel as its first child, condition (`aiPlan.data != null`) unchanged. Two
  stacked SegmentedTabs appear only for AI-plan owners — acceptable; if it tests
  confusing, demote the source toggle to Chips. Never make SegmentedTabs 3-way (its
  slider math is structurally two-segment).
- `log.tsx`: remove tabs + cardio + now-unused imports; body = ScreenHeader
  (kicker "TRACK THE BODY", title "STATS") + BodyweightCard + MeasurementsCard.
- `_layout.tsx`: `<Tabs.Screen name="log" options={{ title: 'Stats', tabBarIcon:
  makeIcon('▤') }} />` — the route name/file stays `log` (don't break links/history).

QA: half-type cardio → flip LIFT → flip back → intact; log a set → flip → pips intact;
Boxing animates `punch` in the Today header; Stats logs bodyweight + measurements;
cardio XP preview (`floor(min×2)`) unchanged.

## Commit 4 — Every tab press scrolls to top (item 7)

**Files:** new `client/src/ui/scroll-registry.ts`, `client/src/ui/shell.tsx`,
`client/src/app/(main)/_layout.tsx`.

- `scroll-registry.ts`: module-level `setActiveScroller(fn)` / `clearActiveScroller(fn)`
  / `scrollActiveToTop()`.
- `ScreenShell` (owns every screen's single ScrollView): add a ref and a
  `useFocusEffect` (import from `expo-router`) that registers
  `() => ref.current?.scrollTo({ y: 0, animated: true })` on focus and clears it on
  blur. Focus-scoped — do NOT key by pathname (unfocused mounted tabs would clobber
  the registration).
- `_layout.tsx`: `<Tabs screenListeners={{ tabPress: () => setTimeout(scrollActiveToTop, 0) }}>`
  — the deferred call lets a cross-tab press land focus first, so one code path covers
  both re-press of the current tab and navigating to a page. Fallback ladder if
  `screenListeners` is unsupported: per-screen `listeners={{ tabPress }}` → custom
  `tabBar` replicating the 7 buttons (last resort).

QA: on each of the 7 tabs, scroll down and re-press the same icon → smooth scroll to
top; scroll Today, go Home, press Today → lands at top; overflow screens unaffected.

## Commit 5 — Collapsible leaderboard on Home (item 8)

**Files:** new `client/src/ui/leaderboard-teaser.tsx`, new
`client/src/ui/leaderboard-row.tsx`, `client/src/app/(main)/rank.tsx` (row extraction
only), `client/src/app/(main)/index.tsx`.

- Extract the row renderer (rank.tsx ~76–95) into `LeaderboardRowView({ entry, self })`;
  rank.tsx uses it, visually identical.
- `leaderboard-teaser.tsx`, inserted directly after `<EvolutionTeaser>` in index.tsx:
  - Header: a pressable strip (EdgeLabel "LEADERBOARD" + "TOP ATHLETES" + rotating
    chevron), accent **cyan** framing to distinguish from the purple evolution strip.
    Collapsed by default.
  - Body: measured-height animation — content absolutely positioned inside an
    `overflow: hidden` Animated.View, `onLayout` → contentH, toggle runs
    `withTiming(open ? 0 : contentH, { duration: durations.panel /* 260ms, from
    src/theme/animations.ts */ })`. Measured height, NOT Reanimated layout animations
    (web safety). Re-sync height if content grows while open.
  - Mount the data body only after first expansion (`openedOnce` state): inside, use
    `useLeaderboardTop(10)` + `rankLeaderboard` + `usePublicIdentity`. Not opted in →
    compact one-liner + `<Link href="/rank">JOIN THE BOARD →</Link>` (drift gating
    stays the Rank screen's job — the teaser stays dumb). Opted in → top-10 rows, self
    highlighted, footer `VIEW FULL LEADERBOARD →`.
- Rank screen itself: unchanged **[decided]**.

QA: collapsed by default; 260 ms expand; opt-in state links to /rank; self row
highlighted; expanding while loading grows when data lands.

## Commit 6 — Remove BRANCH PATHS from Avatar (item 5)

**File:** `client/src/app/(main)/avatar.tsx` only.

Delete the BRANCH PATHS section (EdgeLabel + description text + `paths.map(...)`),
the `BranchPathCard` component below it, the `paths = branchPathsV2(...)` computation,
and the now-unused imports (`branchPathsV2`, `BranchPathV2`, `BranchV2`).
**Do NOT touch `src/domain/branches-v2.ts`** — `src/ui/skill-tree.tsx` and the domain
tests still consume it. The EVOLUTION LINE section becomes the new page bottom.

QA: Avatar EVOLUTION view ends at the evolution line; SKILL TREE still shows branch
destinations; `npx expo lint` shows zero unused-import warnings.

## Commit 7 — Onboarding public-profile opt-in (item 2)

**File:** `client/src/app/onboarding.tsx`.

Add an inline optional **Section 5 · GO PUBLIC (OPTIONAL)** after THE SCAN: privacy
copy borrowed from the Rank OptInCard ("only a display name, level and XP — never body
data"), a display-name input, the same Switch styling, and an inline warning from
`nameError` (`@/domain/leaderboard`) when the name is invalid. In `forge()`, AFTER the
profile insert succeeds and BEFORE the `['profile']` invalidation (which triggers the
redirect):

```ts
if (publicName.trim() && !nameError(publicName)) {
  try { await savePublic.mutateAsync({ displayName: publicName, isPublic: goPublic }); }
  catch { /* never block onboarding; user recovers via Profile/Rank */ }
}
```

with `savePublic = useSavePublicIdentity()` (`src/data/mutations.ts`) — reused as-is
(upserts `public_profile` on user_id, maps duplicate-name errors, forces
`is_public=false` without a name). Blank section = skip. The "profile row IS the
onboarded flag" invariant is untouched — never gate the redirect on this step.

QA: blank section → onboarded, Rank shows OptInCard; valid name + public → Rank shows
the board immediately; taken name → error toast but onboarding still completes.

## Commit 8 — Join code uppercase display (item 9)

**File:** `client/src/app/(main)/arena/index.tsx` (join TextInput, ~line 148).

`onChangeText={(t) => setCode(t.toUpperCase())}` — keep `autoCapitalize="characters"`,
`maxLength={6}`, and the submit-time `.trim().toUpperCase()`. **Do NOT touch the edge
functions**: `battle-join` already uppercases before its lookup and the mint alphabet
is uppercase-only, so matching is already case-insensitive end-to-end.

QA: type `abc123` on iOS/Android/desktop web → renders `ABC123`; join succeeds.

## Verification (per commit; full pass before push)

```bash
cd client
npm test                        # vitest goldens + the new scheme-sentence test
npx tsc --noEmit
npx expo lint                   # zero warnings
node scripts/verify-tokens.mjs  # must stay green — this plan edits no tokens
npx expo export -p web
```

Manual QA at web 390 px + 1280 px, plus one coarse-pointer/native pass (the NumberField
keypad path only exists there). Integrated flow: onboard a fresh account with a public
name → Today LIFT: grey prefill whitens on first tap, purple active row, fused
steppers, column headers, scheme sentence → CARDIO: Boxing → header sprite punches,
half-typed form survives flips → Home: expand leaderboard, see yourself → re-press the
Home icon (scrolls to top) → Arena: lowercase code renders uppercase and joins →
Arena Volume Duel set rows still coherent (tint honored).

Docs in the same commit as each change: `HANDOFF.md` (state; the neon-policy exception
for the active set row; the standard-navigation/tabPress finding), `PARITY.md`
(today/cardio/stats/home/avatar/onboarding rows), `TASKS.md` (this batch, per-commit
ticks). The root CLAUDE.md's 11 Python verifiers do NOT gate client-only commits —
client CI (`.github/workflows/client.yml`) is the authority on push.

## Risks, ranked

1. **Item 7 event support** — no `@react-navigation/*` in the lockfile; `tabPress`
   under expo-router 57 is unverified until node_modules exists. The registry design
   isolates the risk to one small handler with two fallbacks.
2. **Shared ExerciseCard/NumberField** — every Commit-2 change ships into the Arena
   Volume Duel; the `tint` seam must keep being honored.
3. **Cardio extraction regressions** — repeat-last, boxing rounds→minutes, testIDs,
   and keep-mounted form state must survive the move byte-for-byte.
