# TRAIN OVERHAUL — the hub becomes a mission briefing

> **Executable work order.** New to this repo? Read `HANDOVER.md` FIRST — it has
> the rules that cost real bugs, the verification loop (§5, run it for every
> commit), the smoke-test accounts for production tours, and the map of the
> training loop. Then come back here. Plan written 2026-07-15 against
> `expo-rewrite` @ `4e03335`; owner (Tyson) approved it as specced below.
> Spec source: "Train Page UI Overhaul.md" (8 items), restated here in full —
> you do not need the original.

## Context

The Train page today is a stack of utilitarian controls: source pills, links, an
empty-workout button, week bars. This overhaul turns it into a briefing: a dominant
TRAIN heading, a hero card for today's workout (name, muscle pills, sets/time/kcal,
a pixel-art muscle map, and an unmissable START/RESUME bar), three grey utility
buttons, and a cleaner THIS WEEK with status circles and a PARTIAL state. Pixel-art
iconography (dumbbell, heart, pencil, plus, swap) replaces text glyphs on the tab
bar and subtabs.

**Verified groundwork (explored before planning — trust these, they were read from
the code):**
- Hero data needs NO new hooks: `useDayPlan().resolveDay(day, source).entries`
  (`client/src/data/use-day-plan.ts`) gives `[exercise, sets, reps][]`; today.tsx's
  existing `setsFor(date, workout)` (~L87-106) already computes done/target; muscles
  come from the existing ladder `userMuscleFor ?? libraryMuscleFor ??
  inferMuscleGroup` bucketed into the six `LIBRARY_SECTIONS` labels
  (Chest/Back/Shoulders/Arms/Legs/Abs) — `client/src/domain/exercise-library.ts`.
- **No heat map, no pixel icons, no time/kcal estimation exist anywhere** — all
  three are new. `react-native-svg` is already a dependency (see `ui/stat-radar.tsx`
  for the SVG-primitive house pattern).
- Colors (`src/theme/tokens.js`): accent `#22d3ee` · accent-strong `#67e8f9` (the
  "bright light blue") · success `#34d399` · danger `#fb7185` · warn `#fbbf24` (the
  yellow) · text `#e8f2fb` · text-dim `#93a6c4` · surface-2/3 + border greys. Font
  scale caps at `text-3xl` (2.4rem) — the hero title uses `text-2xl`; TRAIN gets an
  inline size bump (do NOT add a font token: `scripts/verify-tokens.mjs` pins the
  token file against `assets/styles.css` both directions).
- `SegmentedTabs` (`ui/segmented-tabs.tsx`) takes strings only; `WeekBar`
  (`domain/week-status.ts`) carries no done/target (PARTIAL needs domain threading);
  tab-bar icons are `makeIcon('◎')` text glyphs colored by an injected `color` prop
  (`(main)/_layout.tsx` bottom).
- PLAN SCAN's door is `router.push('/routine?import=1')` — the destination already
  auto-opens the scan sheet.

**Assumption (spec line 7.1.3 was truncated mid-sentence):** the Change Workout
button's icon is a **swap-arrows** pixel icon (⇄ style). Confirm with Tyson if in
doubt; it's one component either way.

## New building blocks

### `client/src/ui/pixel-icons.tsx` — the icon set (NEW)
One file, one convention: each icon is a hand-authored **pixel grid** (array of
strings, `#` = filled) rendered as SVG `<Rect>` cells — genuinely pixel-art, crisp
at any size, tinted by a `color` prop (so the tab bar's active/inactive tint keeps
working). Exports: `PixelDumbbell`, `PixelHeart`, `PixelPencil`, `PixelPlusSquare`,
`PixelSwap`, `PixelCurvedArrow`, all `({ size = 18, color })`. A shared
`PixelGlyph({ rows, size, color })` renderer keeps each icon ~10 lines of data.

### `client/src/ui/muscle-pixel-map.tsx` — the heat map (NEW)
`MusclePixelMap({ targeted: ReadonlySet<string>, height })` — a pixel-grid **front
body silhouette** (same `PixelGlyph` cell renderer, ~14×26 grid) whose regions map
to the six section labels: Chest (upper torso front), Shoulders (deltoid caps), Arms
(upper limbs), Back (lats/trap outline cells), Legs (quads/hams/calves), Abs (mid
torso). Targeted regions fill `accent` with a soft glow cell-shade (`${accent}59`
halo cells); untargeted stay `surface-3`. Purely presentational over a set of
section labels — no data plumbing. The grid is art: iterate against screenshots;
the component API is stable regardless.

### `client/src/domain/workout-estimates.ts` — time & calories (NEW, pure, tested)
- `estimateMinutes(totalSets)` — sets × (45s work + 120s rest, matching the app's
  `DEFAULT_REST_SECONDS`) rounded to 5 min. 20 sets ≈ 55 min.
- `estimateKcal(totalSets, bodyweightKg)` — MET 5.0 resistance training:
  `5 × 3.5 × kg / 200 × minutes`, rounded to 10. Bodyweight from
  `useProfile().bodyweight_kg ?? latest bodyweight_log ?? sex default (77/62)` —
  the `avatar-stats-calc.ts` fallback pattern.
- `splitWorkoutName('Push 2 - Hypertrophy')` → `{ title: 'Push 2', sub:
  'Hypertrophy' }` (split on the first ` - `; no ` - ` → no sub).
- `musclePillsFor(entries, userExercises)` → ordered deduped section labels via the
  muscle ladder.
Vitest pins all four (incl. no-sub names, single-word 'Legs', empty entries → no
pills). Falsify one guard per the doctrine.

## The page, top to bottom (`client/src/app/(main)/today.tsx` rebuild)

1. **TRAIN heading more prominent** — `ScreenHeader` (`ui/screen-header.tsx`) gains
   optional `hero?: boolean`: inline `fontSize: 44, letterSpacing: 1` + stronger
   cyan bloom (inline style, no token churn). Train passes `hero`.
2. **Tab bar** (`(main)/_layout.tsx`) — Train's `makeIcon('◎')` becomes
   `PixelDumbbell` (receives the injected `color`; other tabs keep their glyphs).
3. **LIFT | CARDIO subtabs** — `SegmentedTabs` gains optional
   `leftIcon?/rightIcon?: ReactNode` rendered before the label (arena call sites
   unaffected). Train passes `PixelDumbbell` (lift) and `PixelHeart` (cardio),
   tinted to match each tab's active/dim state.
4. **REMOVED:** the MY PLAN·AI PLAN·BUILT-IN pill row, the `＋ START AN EMPTY
   WORKOUT` pressable, the `⚒ CREATE/EDIT MY PLAN` / `✦ FORGE AN AI PLAN` inline
   links, and the bottom `◫ EDIT MY WEEK →` link. Their functions all move into
   the hero + the three-button row — nothing is lost.
5. **THE HERO CARD** (new GlowCard, directly under the subtabs). Left two-thirds is
   the text block (text centred within its pills/stat cells); right third =
   `MusclePixelMap`:
   - Hero day = today's scheduled workout, else the active ad-hoc, else the next
     scheduled session (labelled `REST DAY · NEXT UP`), else the first day of the
     current source.
   - `splitWorkoutName` → **title** `text-2xl font-bold text-text` (second only to
     TRAIN) with **sub** beneath in `text-sm text-text-dim` (skip when none).
   - **Muscle pills** — `musclePillsFor(entries)` as small centred-text pills
     (border, `text-2xs`, surface-2).
   - **Stat row** — three side-by-side cells: `18 SETS · ≈55 MIN · ≈320 KCAL`
     (value bold, label `text-2xs` text-mute; ≈ marks estimates).
   - **START/RESUME bar — the most visually prominent element on the page**:
     full-width `NeonButton` primary (the `accent-strong → accent → accent-deep`
     gradient IS the bright light blue), with a new `size="hero"` prop
     (paddingVertical 20, `text-lg` centred label, stronger glow). Label
     `RESUME WORKOUT` when `setsFor(today, heroDay).done > 0`, else
     `START WORKOUT`. Press = the existing `open(todayIso, heroDay)`.
6. **THREE-BUTTON ROW** (between hero and THIS WEEK): one `flex-row gap-s2`, each
   button `flex-1` (equal thirds with margins), same grey styling (`surface-2` bg,
   `border` outline, `text-dim` icon + centred label, 56px min-height):
   - **`PixelSwap` CHANGE WORKOUT** → opens a NEW bottom sheet containing: the
     three source options (MY PLAN / AI PLAN / BUILT-IN, with their empty-state
     hints), the CREATE/EDIT MY PLAN and FORGE AN AI PLAN links, **and a prominent
     `📷 SCAN A WRITTEN WORKOUT` row** → `/routine?import=1`. On the page beneath
     the button: small `accent`-blue text `Switch between My Plan, AI Plan or
     Built-in` with a `PixelCurvedArrow` in the same blue pointing up at the button.
   - **`PixelPlusSquare` EMPTY WORKOUT** → the existing empty-workout sheet, which
     gains a **clearly visible `📷 SCAN A WRITTEN WORKOUT` row**
     (→ `/routine?import=1`) alongside the name input / search / MY ROUTINES
     (spec item 8: scan must be reachable from here).
   - **`PixelPencil` EDIT MY WEEK** → `/schedule` (replaces the old bottom link).
7. **THIS WEEK v2** (`ui/week-bar.tsx` + `domain/week-status.ts`):
   - **Status circle** left of the name: empty grey ring (upcoming) · **accent
     ring** for today's in-progress bar · **success fill + pixel tick** for
     completed · **danger fill + pixel ✕** for missed · **warn fill + tick** for
     partial. Small `StatusCircle` component inside week-bar.tsx.
   - **`🔒` removed** from the completed label.
   - **PARTIAL**: `buildWeekBars`/`extraBarsForToday` swap their `hasValidSets`
     boolean callback for `setsFor(date, workout) → {done, target}` (the function
     today.tsx already owns — it moves into the call); `WeekBar` gains
     `done/target`; `WorkoutStatus` gains `'partial'` = **finish marker present &&
     done < target**, labelled `PARTIAL` in `warn` yellow. Locking/back-compat
     rules unchanged (partial is still locked — it was explicitly finished; and
     "past + sets, no marker = completed" stays, see HANDOVER §3 status-vs-locking).
     `STATUS_LABEL` + `statusColour` extended; extend
     `domain/__tests__/week-status.test.ts` with a partial matrix + falsify once.

## Files

| File | Change |
|---|---|
| `client/src/ui/pixel-icons.tsx` | NEW — PixelGlyph + 6 icons |
| `client/src/ui/muscle-pixel-map.tsx` | NEW — pixel body, section highlighting |
| `client/src/domain/workout-estimates.ts` (+tests) | NEW — minutes/kcal/name-split/pills |
| `client/src/app/(main)/today.tsx` | the rebuild: hero card, button row, sheets, removals |
| `client/src/ui/week-bar.tsx` | StatusCircle, PARTIAL, no lock emoji |
| `client/src/domain/week-status.ts` (+tests) | setsFor threading, `partial`, done/target |
| `client/src/ui/segmented-tabs.tsx` | optional leftIcon/rightIcon |
| `client/src/ui/screen-header.tsx` | `hero` title size |
| `client/src/ui/neon-button.tsx` | `size="hero"` |
| `client/src/app/(main)/_layout.tsx` | Train tab icon → PixelDumbbell |

## Commits (each one green through HANDOVER §5's loop before pushing)

1. **`train: the pure parts — estimates, name split, muscle pills, PARTIAL status`**
   — workout-estimates.ts + tests; week-status.ts threading + `partial` + tests
   (falsify: break the partial threshold → watch red → restore).
2. **`train: the pixel kit — icons, muscle map, hero-size header/button/tabs`** —
   pixel-icons, muscle-pixel-map, ScreenHeader/NeonButton/SegmentedTabs extensions,
   tab-bar dumbbell, week-bar StatusCircle + PARTIAL rendering + lock removal.
3. **`train: the hub becomes a briefing`** — today.tsx rebuild (hero card, three
   buttons + blue hint, change-workout sheet, scan rows in both sheets, removals).

## Verification

- Per commit: HANDOVER §5 loop (cold-cache lint, tsc, `vitest run src`, the three
  guards, `expo export -p web --clear`). Push → CI green → **grep the LIVE bundle**
  (https://expo-rewrite.evoforge.pages.dev) for marker strings (a pixel-icon
  testID, `PARTIAL`, the hero button testID) — a green local build is not a deploy.
- Production tour (smoke account ALPHA — credentials in HANDOVER §5; Playwright;
  seed then DELETE what you seed): Train shows the hero card with today's day name
  split into title/sub, muscle pills, the SETS/MIN/KCAL row, START WORKOUT → lands
  on /workout; log one set → back to Train → button reads RESUME WORKOUT;
  CHANGE WORKOUT sheet switches source and shows the scan row; EMPTY WORKOUT sheet
  shows the scan row; week-bar circles render per status — a finished-early day
  reads PARTIAL in yellow, a full day COMPLETED with green tick, a missed day red ✕.
- Visual: screenshot at 390px and 320px widths — on compact screens the muscle map
  stacks beneath the stats instead of squeezing the left column.

## Risks / notes

- The muscle map is hand-authored pixel data — iterate the grid against
  screenshots; don't chase pixel perfection in the first commit.
- PARTIAL changes `buildWeekBars`'s signature — the only other consumers are the
  workout page's `todayBar` use and the tests (update in commit 1).
- Removing the source pills makes the CHANGE WORKOUT sheet the only source
  switcher — keep the underlying `sourceChoice`/`defaultSource` logic untouched.
- Estimates are labelled `≈` and live in one pure file — tuning constants later is
  a one-line change with tests.
- The React Compiler is on (HANDOVER §3): prefer plain derivations over useMemo in
  the today.tsx rebuild.
