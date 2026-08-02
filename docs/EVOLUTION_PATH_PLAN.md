# ORIGIN EVOLUTION PATH — implementation plan (beta)

> Written 2026-08-02 at the start of the build, from a repository audit.
> The architecture doc that describes the SHIPPED system is
> `docs/EVOLUTION_PATH.md`. This file is the plan and the audit that
> produced it — keep it for the reasoning, read the other one for the code.

## 1. What the audit found

The repo already owns most of the *identity* half of this feature. It owns
none of the *progression* half.

| Concern | Status before this build |
|---|---|
| Origin selection | **EXISTS** — `assign_origin_path` / `origin_candidates` RPCs (migrations 039–048, 082), candidate model v5, `OriginFlow` Act II in onboarding |
| Origin art | **EXISTS** — five slug-keyed sprite lines, stages 1–4, skins, `avatar-art.ts` + lazy `skins/*` manifests |
| Origin recommendation | **EXISTS** — server-side `origin_candidates`, three candidates, user picks |
| Workout completion | **EXISTS** — `workout_sessions` marker (017), optimistic + durable offline queue |
| Forge Level / Evo Rating | **EXISTS** — separate systems, must stay separate |
| Skill tree | **EXISTS** — `src/ui/character/skill-tree.tsx` (926 lines), reachable at `/avatar?view=paths` |
| Analytics | **EXISTS** — `track()` → `analytics_events` (029) |
| Feature flags | **EXISTS, TWO KINDS** — build constants (`progressionFeatures`, `ORIGIN_FLAGS`, `homeFeatures`) and a real remote framework (`command_flags` + `command_assign_variant`, granted to `authenticated`, migration 104) |
| **Long-term progression** | **MISSING** — nothing turns completed workouts into a multi-week journey |

So this build is **additive**. It does not re-implement origin selection,
recommendation, art or workout logging; it hangs a progression system off
the seams those already expose.

### The five Origins — naming assumption

The spec names Titan, Shredder, Speedster, Aesthetic, Hybrid. The database
has five **deployed slugs** that key `paths.slug`, every sprite line, every
skin table, `user_paths` rows and live RLS'd user data:

| Spec name | Deployed slug | Display name |
|---|---|---|
| Titan | `titan` | Titan |
| Shredder | `shredder` | Shredder |
| Speedster | `cardio` | Apex Engine |
| Aesthetic | `aesthetic` | Elite Aesthetic |
| Hybrid | `mass` | Mass Monster |

**Renaming the slugs is not on the table** — it would rewrite art
manifests, skin tables, a FK'd `paths` table and live user rows for zero
user-visible gain, which is exactly the "unnecessary rewrite" the brief
forbids. The config carries the deployed slug as its id and a display
name as data. `mass` (size/muscle) is the *closest* deployed origin to the
spec's Hybrid, not an exact match; adding a genuine balanced Hybrid origin
is a config + seed + art-package task, documented in the architecture doc.

## 2. Architecture decisions

1. **The DB is the authority; TypeScript is the author.** Week
   qualification and reward unlocking run in one `security definer`
   Postgres function so they are transaction-safe, idempotent and
   impossible to bypass from a UI component. The reward *table* is seeded
   config, and a vitest asserts the TypeScript config and the seeded SQL
   agree — a guard that can fail.
2. **Exactly-once by construction.** `origin_progress_events` carries
   `unique (user_id, workout_session_id)`. Duplicate application is a
   database error, not a code convention.
3. **Materialise weeks, never re-derive them.** `origin_path_weeks` stores
   `planned_sessions` as it was *that week*. If an athlete later changes
   their training days, history cannot silently re-qualify or
   de-qualify — "progress never expires" has to survive a schedule edit.
4. **Progression can never break finishing a workout.** The trigger that
   applies a finished workout swallows its own errors into
   `origin_path_errors`; a broken progression system degrades to "no
   progression", never to "cannot finish a workout".
5. **Origin Level is not avatar stage.** `user_origin_paths.current_level`
   (0–4) is the new progression. `profile.active_stage` / `user_paths.
   current_stage` stay exactly as they are — the new system never writes
   them. Art resolves `stage = max(1, level)`, so Dormant borrows stage-1
   art in a dormant treatment.
6. **One flag, the existing framework.** `evolution_path_beta` lives in
   `command_flags` (remote, bucketed, per-user) behind a build-constant
   kill switch in `progressionFeatures`. No second flag system.
7. **Complete asset packages only.** A level references one manifest
   (idle/portrait/transformation/…). Nothing is composed at runtime and
   nothing calls a generative API.

## 3. Build order

- **Phase 2** — migration `130_origin_evolution_path.sql`; typed config;
  domain engine; flag.
- **Phase 3** — data hooks; onboarding commitment screen + `BEGIN FIRST
  WORKOUT`; awakening; Home summary; Path page; post-workout result.
- **Phase 4** — loading/empty/error states, reduced motion, fallbacks.
- **Phase 5** — vitest over the pure engine + a Playwright pass.
- **Phase 6** — `docs/EVOLUTION_PATH.md` + rollout/rollback.

## 4. Explicit non-goals for the beta

PvE/PvP hooks, 48 authored weeks per origin, runtime sprite generation,
modular equipment, currencies, paid progression. Chapters II–IV exist in
the data model and render as locked previews.
