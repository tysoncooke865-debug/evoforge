# PROGRESSION_OVERHAUL_PLAN — Evo Rating · Forge Level · Rival Rank

> Tyson's progression-system brief (2026-07-16, the ~55-section spec). This
> plan maps that spec onto what ACTUALLY exists. Status: **EXECUTED 2026-07-16
> (P1–P9 in one session; honest deferrals in HANDOVER §2).** When executing: read HANDOVER.md first; every phase ships behind the
> `new_progression_enabled` flag family and runs the full verification loop.
>
> The spec's own prime rule, kept verbatim:
> Physical evidence → Evo Rating · Training behaviour → Forge Level/XP ·
> Competitive outcomes → Rival Rank. Purchases can never touch any of them.

---

## 0. Audit (the spec's §2, answered from the live codebase)

| Spec asks about | What exists (reuse ✅ / refactor 🔧 / new 🆕) |
|---|---|
| Structure | `client/src`: app (expo-router, async routes) · data (TanStack Query hooks) · domain (pure, golden-pinned) · state (Zustand ×3) · theme · ui (core/character/train/arena/home/muscle-map) ✅ |
| Navigation | Tabs Home·Train·Progress·Forge·Arena + hidden pushed routes; idle tab preload ✅ |
| State mgmt | React Query (persisted, cleared on sign-out) + Zustand; pure derivations in domain/ ✅ — the spec's `useEvoRating()`-style hooks follow the existing `use-avatar-data` pattern |
| Workout logging | workout.tsx + durable set-queue/finish-queue (idempotent by server unique index, generation counters); `decideSetSave` (update-in-place, e1RM PR verdicts) ✅ **UNTOUCHABLE core** |
| XP/levels | `domain/xp.ts` — THE CONTRACT: 10 XP/set, 2/cardio-min, `500+(L-1)*25`, append-only `xp_events` w/ server anti-mint trigger (002/006/014), `xp_total()` RPC 🔧 see §3 conflict |
| Profile/avatar | profile (base_level, sex, nutrition_phase, deadlift_e1rm), 5-score `calculateAvatarStats` (STR/SIZE/LEAN/COND/AES, sex-calibrated), branchV2 six classes, stages/rarity, `nextEvolutionV2` + `evolutionReadiness` 🔧 the pillar seed |
| Physique assessment | `ai-physique` (photos→4 scores/15) + `ai-bodyfat` (bf low/mid/high RANGE — the spec's range requirement already the norm), `physique_ratings`, hash-cached, 10/hr limited 🔧 |
| Strength calc | `estimated1rm` (Epley), benchE1rm in stats, per-set PR pipeline 🔧 feeds `strength_evidence` |
| Cardio | `cardio_log` (type/minutes/distance_km), conditioningScore 🔧 — no standardised tests yet 🆕 |
| Achievements | achievements table + client sweep ✅ |
| Supabase | 20+ tables, owner-only RLS everywhere, security-definer readers only (`leaderboard_top`), coins (013 server-granted), scheduled_streak SQL mirror (012), edge functions ×11 w/ CI auto-deploy ✅ |
| Competitive | **BLITZ battles exist**: battle_matches/battle_events (server-confirmed rows, byte-pinned engine), private battle-media bucket + signed URLs, physique round w/ AI judge, mini-games ✅ the match substrate for Rival Rank 🆕 rating layer |
| Testing | vitest 561 + golden parity fixtures + 4 executable CI guards ✅ |
| Notifications | none (needs native builds) — spec §35 becomes in-app inbox now 🆕, push later |
| Analytics | none (Sentry/PostHog deliberately deferred) — spec §45 lands as a thin event table now 🆕 |

**Migration numbering:** applied through 021. **022 is RESERVED** for the
unmerged nutrition branch. **This overhaul starts at 023.**

**Free-tier constraints that shape the design:** Supabase FREE (edge
invocations fine; pg_cron available for weekly reviews), OpenAI per-scan cost
~1–3¢ (bigger regional-scoring prompts on gpt-5.1 judges; 10/hr cap + hash
cache already enforced). Scan images: reuse the battle-media pattern — a
private `physique-scans` bucket, signed URLs, service-role writes only (§38).

---

## 1. The four hard conflicts, resolved up front

**C1 — The XP contract vs Forge XP.** `xp_events` is append-only,
anti-minted, and the ledger the current level/leaderboard rides. The spec's
Forge XP (100/workout, weekly bonuses, event keys) is a DIFFERENT economy.
Resolution: **new `xp_ledger` + `user_progression` tables** (023) with
`unique(user_id, event_key)`; awards granted by a server function
(`forge-award` edge fn or DB trigger family, mirroring 013's coin pattern —
client-mintable kinds recomputed server-side, server-only kinds rejected from
clients). `xp_events` is untouched and keeps driving the legacy level until
the flag flips; the migration converts history → Forge XP ONCE under
`migration:v1:*` event keys (idempotent by construction). The old
level/rarity is preserved in `user_progression.legacy_level` (§43).

**C2 — avatarStats/branchV2 are golden-pinned parity code.** They move for
nobody (HANDOVER §3). The Evo pillar services are **new pure modules beside
them**, never edits to them. While the flag is off, nothing user-visible
changes; at cutover the UI reads Evo, and the old stats remain as the
avatar-art driver until art is rebased on Evo Class (a later, separate
decision).

**C3 — “services/” vs repo doctrine.** The repo rule is *the thinking is
pure and tested in `domain/`*. The spec's `src/services/**` tree lands as
`src/domain/progression/**` (pure, deterministic, zero React/network —
exactly what the spec demands of services) + `src/data/progression/**` (the
hooks/wiring). Same shape, repo-native home:

```
domain/progression/
  evo-rating.ts        (geometric mean, clamps, deriveEvoDisplay, tiers,
                        applyTierRequirementSoftCaps + smooth compression)
  size-score.ts        aesthetics-score.ts        strength-score.ts
  cardio-score.ts      confidence.ts              evidence.ts
  (recency windows, noise gates, two-of-three decline confirmation)
  forge-level.ts       (curve 250·(L−1)^1.65 + derivations)
  momentum.ts          (weekly targets, tiers, decay, recovery modes)
  glicko2.ts           rank-tiers.ts              matchmaking.ts
  player-stats.ts      evo-class.ts               traits.ts
  model-versions.ts    (every module stamps its version)
data/progression/
  use-evo-rating.ts    use-forge-progress.ts      use-momentum.ts
  use-rival-rank.ts    use-pending-evidence.ts    use-evo-forecast.ts
  award-xp.ts          (event-key builders; server does the minting)
```

**C4 — terminology collision.** “Rank” today = `rankName(level)` and the
`/rank` screen; “LEVEL” today = the XP level; RarityBadge tiers are
level-derived. Cutover renames (flag-gated): header LV. → **Forge Level**,
Home tier badge → **Evo Rating tier descriptor**, `/rank` becomes the Rival
Rank page. The spec's banned names get a one-commit sweep at Phase-5 cutover,
never before (two vocabularies visible at once is worse than the old one).

---

## 2. Schema (migrations 023+, all owner-only RLS, all [architect])

One migration per phase, in the spec's shapes (§37) with these repo-specific
adjustments:

- 023 `user_progression` + `xp_ledger` (+ server grant guard à la 006/013;
  `unique(user_id, event_key)`; weekly-cap checks in the grant function).
- 024 `evo_rating_current` + `evo_rating_snapshots` (immutable: RLS
  select+insert only, like xp_events) + `pending_evo_evidence`.
- 025 `strength_evidence` + `cardio_evidence` (backfilled from workout_log /
  cardio_log by the migration service, NOT by SQL — the movement-category
  mapping lives in domain code; the backfill is an idempotent edge fn).
- 026 `physique_assessments` + `physique-scans` private bucket + policies
  (battle-media pattern).
- 027 `evo_reviews` + `weekly_momentum` (+ pg_cron weekly review enqueue; the
  review itself is an edge fn so logic stays in TypeScript).
- 028 `competitive_ratings` + `competitive_matches` + `ghost_snapshots`
  (battle_matches gains a nullable `competitive_match_id` — additive only).
- 029 `player_stats` + `player_traits` + `evolution_chapters`.
- 030 `analytics_events` (thin, no PII, no images) + audit table for official
  rating changes (§46).

Every score row stores `model_version`; recalibrations create snapshots with
`trigger_type='model_recalibration'` (§39) — the same doctrine as the
append-only ledger: history is never silently rewritten.

---

## 3. What each spec system reuses

- **Evo Rating pillars** seed from what exists on day one: Strength ← the
  e1RM pipeline re-read through movement categories (central mapping in
  `domain/progression/strength-score.ts`, sourced from the EXISTING
  exercise-taxonomy — never a second mapping); Size/Aesthetics ← ai-physique
  + ai-bodyfat evolved into the guided Evo Scan (extended prompt returns
  regional scores; judges STAY on gpt-5.1 — consistency rule); Cardio ←
  provisional-from-cardio_log until standardised tests ship (never zero,
  exactly the spec's provisional rule).
- **Weekly Momentum** = `computeScheduledStreak`/`weeklyContract` evolved:
  same schedule rows, same trained-day predicate, new weekly-target framing +
  tiers + recovery modes. The streak page becomes the Momentum page.
- **Rival Rank** rides the EXISTING battle system as its first rated mode
  (battle-settle already server-confirms outcomes → it reports results to a
  new `rival-settle` function that applies Glicko-2 server-side). Ghost
  Matches freeze `player_snapshot` the way battle-media already freezes
  photos.
- **Post-workout flow** extends the existing finish ceremony (summary-sheet):
  it already shows sets/PRs; it gains Forge XP, Momentum, pending-Evo lines
  in the spec's §34 order.
- **Evo Core on Home** replaces the hero badges' data source; HeroStage,
  mission card, status grid all stay — the redesign this week was built for
  progressive activation, and this is that activation.

---

## 4. Phases (the spec's §52, repo-calibrated, each independently shippable)

Each phase = migrations + pure domain + tests + (UI behind flags) + full
loop + production tour + HANDOVER update. Rough scale-marks are relative to
this week's Home redesign (≈1 session).

- **P1 Foundations (~1 session):** flags (`progression-features.ts`, single
  source), 023, model-version constants, `domain/progression` skeleton,
  typed models, migration-version scheme. Nothing visible.
- **P2 Evo Rating core (~2 sessions):** all four pillar calculators +
  confidence + geometric core + tier soft-caps + snapshots + current/
  starting/peak. THE TEST WALL: every §49 Evo case (boundaries, weak-link,
  L100 gate incl. `manualEliteVerification`, decline protection). Backfill
  provisional ratings for the two real accounts; verify against their known
  data by hand.
- **P3 Recurring loop (~2 sessions):** pending evidence, post-workout
  projections, weekly review edge fn + pg_cron, forecast, staleness,
  increase/decrease flows (never from one bad session — the two-of-three
  confirmation service).
- **P4 Forge Level + Momentum (~1–2 sessions):** ledger, idempotent awards,
  curve, history migration (once, keyed), Momentum conversion from streak
  history, legacy-level preservation.
- **P5 UI cutover (~2 sessions):** Evo Core home, Evo detail page, Forge
  page, terminology sweep, post-workout order, flag flip after a full
  production tour on both smoke accounts. Legacy UI archived, not deleted.
- **P6 Monthly/quarterly (~1–2 sessions):** guided Evo Scan flow (bucket,
  large-change confirmation scans), 12-week Evolution Chapters + share cards.
- **P7 Rival Rank (~2 sessions):** Glicko-2 (pure + golden-tested against
  published Glicko-2 example values), placements, tiers, `rival-settle`
  server-side, matchmaking constraints, Ghost snapshots, `/rank` page.
- **P8 Gameplay (~1–2 sessions):** Player Stats, Classes, Traits (versioned
  rules), Equalised/Open/Handicap rulesets wired into the battle engine —
  WITHOUT touching the byte-pinned engine: rulesets compose AROUND it.
- **P9 Hardening (~1 session):** anti-cheat foundations (impossible-jump
  gates, audit rows), analytics events, staged rollout, docs.

Total honest estimate: **~13–15 focused sessions.** Cut lines exist after
P5 (a complete single-player overhaul) and after P7 (competitive).

---

## 5. Standing constraints (the spec's safety/honesty rules ∩ house rules)

- No fake data ever: missing evidence → provisional + low confidence + a
  clear action, never invented numbers (the Home-redesign rule, now doctrine).
- Purchases never touch Evo Rating, Player Stats, Rival Rank (spec) — and
  cosmetics stay out of rankings (existing BATTLE_ARENA rule; same rule).
- The XP append-only invariants, battle byte-pins, sign-out cache clearing,
  RLS-only isolation, `todayIso()` local-day rule, and the verification loop
  all apply to every phase. New guards get falsified before trust.
- Health rules (§47): ranges not diagnoses, no leanness rewards past the
  diminishing-returns knee, recovery modes adjust interpretation only.
- Server validates anything competitive/leaderboard/official (§41): the
  client projects, the server confirms — the exact split the XP ledger and
  battle engine already use.

## 6. Open questions for Tyson (defaults chosen, flag if wrong)

1. Female calibration reference for Size/Aesthetics ceilings — the spec only
   names the male anchor. Default: extend the existing FEMALE_CALIBRATION
   philosophy (equal relative development ⇒ equal score).
2. Cardio standardised tests need real-world data entry UI (times/distances)
   — default: manual entry with verification levels; wearables later.
3. `manualEliteVerification` for L100 — default: an admin-only DB flag, no
   UI this year.
4. Seasonal length for Rival Rank — default 12 weeks, aligned to Chapters.
