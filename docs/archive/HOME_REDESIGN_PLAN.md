# HOME_REDESIGN_PLAN — the RPG/avatar-first Home page

> Brief: Tyson's full Home redesign spec (2026-07-16) + a reference mock-up
> (`EVOFORGE / LV.57` image). This plan maps that spec onto what ACTUALLY
> exists in the Expo client. The mock's numbers (LV 57, 250 coins, 27,710 XP,
> Elite tier, 80%, +25 coins) are VISUAL EXAMPLES — every rendered value below
> is real or the element is hidden/flagged. **No fake progression, ever.**
>
> Read `HANDOVER.md` first. The verification loop and the rules that cost
> real bugs all apply. Status: **EXECUTED IN FULL 2026-07-16** (same session), plus two live
> additions from Tyson mid-run: match the reference image iteratively, and
> replace Silkscreen — Jersey 25/10 shipped after a four-font side-by-side
> (Pixelify Sans's bold 5 reads as S; PS2P too wide; VT323 too thin).

---

## 0. What the audit found (current architecture)

- Home (`app/(main)/index.tsx`, 250 lines) is already RPG-shaped but
  hierarchy-inverted vs the brief: identity text → QuestCard → HeroStage →
  XP bar → HUD chips → stat bars → EvolutionTeaser → LeaderboardTeaser.
- **Everything the mock shows already has a real system EXCEPT cosmetics:**
  - Level/XP/rank: `useAvatarData().summary` (ledger-aware, drift-checked).
  - Tier: `RarityBadge` / `raritySlug(level)` (COMMON<25 · RARE<50 · EPIC<75 ·
    LEGENDARY<100 · MYTHIC). "ELITE AESTHETIC TIER" in the mock maps to this
    real rarity system.
  - Form: `evolutionNameV2(branchV2, level)` / `shredderName(bfMid)` +
    `branchDisplayNameV2` — the character's real current form.
  - Evolution %: `evolutionReadiness(nextEvolutionV2(...).requirements)` —
    real requirements the athlete can influence (level, bench e1RM, sets,
    cardio, bf%).
  - Avatar art: `avatarArtV2(branchV2, stage, sex)` on the `HeroStage`
    podium (pixel art, aura, particles, XP-reactive bloom).
  - Streak: `computeScheduledStreak` (schedule-aware) / `computeStreak`,
    with `best` already computed. `/streak` screen exists.
  - Coins: `useCoinTotal()` (RPC, null ≠ 0), `/coins` screen exists.
  - Today's workout: Train's own resolution stack — `sourceDayFor` +
    `useDayPlan().resolveDay` + `defaultSource` — plus `estimateMinutes`,
    `estimateNetKcal`, `lastSessionWork`, `splitWorkoutName`, and the
    muscle-pill vocabulary (`muscleIdsFor`/`pillLabelsFor`).
  - Session state: `useWorkoutSessions()` markers (completed),
    `useSessionStore` ad-hoc, done/target sets per the hub's `setsFor` rule.
  - Weekly totals: `periodTotals` + `weekStart` (domain/progress-aggregates).
  - PRs: the e1RM rule lives in `domain/set-save.ts::prVerdict`
    (current1rm > previousBest > 0) — no "most recent PR" digest yet (new,
    pure, derived from `workout_log` rows the app already holds).
- **What does NOT exist:** loadout/cosmetics/inventory, chests, per-workout
  coin rewards, calorie *logging* (only per-session estimates), weekly
  calorie/cardio goals. These get flags, honest hiding, or real substitutes.
- The workout entry path is ONE door:
  `/workout?date=…&workout=…&source=…` (source travels or the wrong plan
  answers). Home must use the same door with `defaultSource(sources)`.
- The tab bar (Home · Train · Progress · Forge · Arena) is untouched.
- Design system: `tokens.js` is the only colour source (verify-tokens pins
  it against styles.css — the brief's suggested palette is NOT adopted;
  existing tokens already carry the navy/cyan/purple/gold language).
  Pixel display face = Silkscreen via `pixelFont()`; body = system sans.
  Glow policy per tokens.js: CTA, aura, rarity, unlock moments only.

## 1. Mock → real data map (the honesty contract)

| Mock element | Real source | If unavailable |
|---|---|---|
| LV. 57 + 895/1900 XP | `summary.level`, `xpIntoLevel/xpNeeded` | always real |
| Header portrait | companion sprite (CompanionMenuButton) | always real |
| ELITE / AESTHETIC TIER | rarity: `raritySlug(summary.level)` | always real |
| EPIC FORM / CURRENT FORM | `evolutionNameV2` / `shredderName` | always real |
| 80% NEXT EVOLUTION | `evolutionReadiness(...).percent` | always real |
| LOADOUT (+dot) | **no system** — flag `showLoadout: false`, hidden | hidden |
| CUSTOMIZE | routes to `/avatar` (Forge — the character screen) | flag |
| TODAY'S QUEST card | mission VM from schedule+plans+sessions+adhoc | states below |
| 16 SETS · 45 MIN · 100 CAL | plan sets, `estimateMinutes`, `estimateNetKcal` | real |
| REWARDS +150 XP | `activityXp(sets, 0)` — 10 XP/set IS the real grant | real |
| +25 COINS | **no per-workout coin grant** — never shown | hidden |
| Chest art | no chest system — reward strip shows XP only | hidden |
| FORGE STREAK 0 / Best 12 | `streak.current` / `streak.best` | real |
| COINS 250 | `useCoinTotal()`; null renders `—` | real |
| TOTAL XP 27,710 | `summary.xp` (resolved ledger/derived) | real |
| TIER Elite | rarity name from level | real |
| TRAINING OVERVIEW | `weeklyContract` (workouts done/target) + `periodTotals` (sets, cardio min, XP this week) | real; no fabricated goals — calorie goal row is NOT built |
| M–S mini bars | per-day series from this week's rows | real |
| NEXT EVOLUTION card | existing `EvolutionTeaser` (requirements door → Forge) | real |
| RECENT PR Bench 87.5kg×3 | new pure `recentPr(rows)` using the set-save e1RM rule, unit-aware via `weight_unit` prefs | "NO PR YET" empty state |
| WEEKLY SCHEDULE card | door to `/schedule` | always real |
| Bottom nav | unchanged | — |

## 2. Feature flags — one source

`src/ui/home/home-features.ts` (dev constants for now; remote config later):

```ts
export const homeFeatures = {
  showLoadout: false,      // no cosmetic system yet — module hidden
  showCustomise: true,     // routes to /avatar (Forge) until a real customiser exists
  showCoins: true,         // real (RPC coin_total)
  showMissionRewards: true // XP only — the one real per-workout reward
} as const;
```

No conditional scatter: components take the flag object, collapse cleanly.

## 3. New pure domain (tested; the thinking stays in domain/)

- `domain/home-mission.ts` — `deriveMission(input)`:
  `{ status: 'scheduled'|'in_progress'|'completed'|'rest_day'|'no_plan',
     workout?, title?, sub?, doneSets, targetSets, xpReward }` from
  (scheduledToday | adhoc name, finished marker, done/target, hasSchedule).
  Rules: marker (or finishedToday) ⇒ completed; else done>0 or active adhoc
  ⇒ in_progress; else assigned ⇒ scheduled; else hasSchedule ⇒ rest_day;
  else no_plan. XP reward = `activityXp(targetSets, 0)` — never a literal.
- `domain/recent-pr.ts` — `recentPr(rows)`: walk `normaliseWorkoutLog`
  chronologically, per-exercise best e1RM; a valid set with
  `e1rm > previousBest > 0` is a PR; return the latest
  `{ exercise, weightKg, reps, date }`, else null. Same predicate family as
  `set-save.ts::prVerdict` — display only, never re-granting anything.
- Tests: `domain/__tests__/home-mission.test.ts`, `recent-pr.test.ts`
  (each state, boundary: first-ever set is never a PR — previousBest 0).

## 4. New UI (`src/ui/home/`, matching muscle-map's subfolder precedent)

- `home-header.tsx` — left `EVOFORGE` (Silkscreen, cyan bloom) +
  `RISE · TRANSFORM · CONQUER`; right: companion portrait in the Train-style
  outlined box + `LV. n` + mini XP bar + "N XP TO LEVEL n+1" → `/profile`.
- `avatar-hero.tsx` — HeroStage centred; LEFT badges: TIER (rarity),
  CURRENT FORM, NEXT EVOLUTION % (→ Forge); RIGHT actions: LOADOUT (flag,
  hidden) and CUSTOMISE (→ `/avatar`). ≥400px: columns flank the stage;
  narrower: compact row below (useWindowDimensions). Avatar tap → `/avatar`
  (scale spring + light haptic on native; reduced-motion respected — the
  motion guard is executable, don't fight it).
- `mission-card.tsx` — GlowCard: `TODAY'S MISSION` kicker; states:
  scheduled (title/sub, muscle pills, SETS·MIN·EST.CAL pixel row, reward
  strip `+N XP`, hero `START MISSION` NeonButton), in_progress
  (`RESUME MISSION` + progress bar done/target), completed
  (`✓ MISSION COMPLETE`, sets done, XP banked = done×10, next session,
  ghost VIEW SUMMARY), rest_day (RECOVERY DAY + next mission + ghost doors:
  Train/cardio), no_plan (CREATE PLAN `/routine` · AI PLAN `/ai` ·
  QUICK WORKOUT `/today` · SCAN `/routine?import=1`), loading skeleton,
  error + RETRY (refetch). CTA opens the ONE door with source.
- `status-grid.tsx` — 2×2: FORGE STREAK (+best) → `/streak`; COINS →
  `/coins`; TOTAL XP (all-time) → `/profile`; TIER (rarity, aesthetic) →
  `/rank`. Coins hidden ⇒ grid reflows to 3 naturally.
- `training-overview.tsx` — `THIS WEEK`: WORKOUTS done/target (contract),
  SETS, CARDIO MIN, XP EARNED (periodTotals over weekStart..today) with thin
  progress bars only where a real target exists (workouts); plain values
  otherwise. Compact 7-pip M–S day dots reuse contract pips. `—` when empty.
  Plain RN views — no chart lib.
- `recent-pr-card.tsx` + `weekly-schedule-card.tsx` — as mapped above.
- `home-skeleton.tsx` — one cohesive skeleton matching the final layout.

## 5. The screen (`app/(main)/index.tsx`) — new order

1 HomeHeader · 2 AvatarHero · 3 MissionCard · 4 StatusGrid ·
5 TrainingOverview · 6 RecentPrCard + EvolutionTeaser (side-by-side wide,
stacked narrow) · 7 WeeklyScheduleCard · 8 CHARACTER BUILD (existing
StatBar/StatRadar section — KEPT; it exists nowhere else in bar form) ·
9 LeaderboardTeaser · DriftWarning. The starting-bonus claim effect and
every existing route survive. ScreenShell keeps safe areas + tab-bar
clearance. No DB changes, no migrations, no renamed routes/keys.

## 6. Explicitly NOT built (and why)

- Loadout/cosmetic inventory, chests, entrance effects: no backend; UI entry
  point exists behind `showLoadout` only. AvatarLoadout typing deferred until
  a first cosmetic exists — a speculative interface over one PNG helps nobody.
- Per-workout coin rewards: coins are minted server-side for PRs/streaks/
  onboarding only (migration 013 family). Mission card never implies coins.
- Weekly calorie goal / calorie tracking: only per-session net-kcal estimates
  exist; a "1,890 / 5,000" row would be fiction twice over.
- Date-range selector beyond THIS WEEK: current-week only (matches the
  aggregates the page already loads; Progress owns deeper ranges).

## 7. Verification (the loop, per HANDOVER §5)

Cold caches → tsc → lint → vitest (496 + new) → 3 guards → export → serve
dist → Playwright tour as ALPHA/BRAVO against production: scheduled, rest
day, no-plan, in-progress (seed a set), completed (seed marker), narrow
(375/320px) — screenshots each; DELETE seeded rows. Push, then grep the live
bundle for a marker string. Commits tagged `[architect]` only if a protected
path is touched (none planned — the hook lives in ui/home, not data/).
