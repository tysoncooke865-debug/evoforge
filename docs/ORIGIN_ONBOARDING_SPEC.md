# Origin Onboarding — canonical spec (v1, 2026-07-17)

> The player finishes onboarding already knowing their Evo Rating, having
> CHOSEN their Origin from three personalised candidates, and owning that
> Origin's Stage 1 Champion. "Your Evo Rating shows where you stand. Your
> Origin reveals what you could become."

Status labels used throughout the docs/ set: **[CONFIRMED]** = verified
existing behaviour (audited 2026-07-17, file:line refs in the audit),
**[PROPOSED]** = new behaviour this program ships, **[CHANGED]** = existing
behaviour this program modifies, **[REJECTED]** = considered and not done,
**[OPEN]** = unresolved, must not block the current phase.

## 1. Confirmed current state (the ground truth)

- [CONFIRMED] Onboarding is ONE route (`client/src/app/onboarding.tsx`),
  six sections on one scroll view; nothing persists until FORGE CHARACTER
  inserts the `profile` row — which IS the onboarded flag (`data/hooks.ts:52`).
  The `(main)/_layout` gate redirects `profile.data === null → /onboarding`.
- [CONFIRMED] The redirect out of onboarding fires as soon as `profile.data`
  flips non-null (`onboarding.tsx:95-102`) — any step after the insert races it.
- [CONFIRMED] Origin today is post-onboarding: `OriginScanPrompt` (daily
  modal) + Home's blank podium FORGE YOUR ORIGIN button + the Forge reveal
  (`origin-panel.tsx`), all keyed on `profile.origin_path == null`.
- [CONFIRMED] The first `evo_rating_current` row is created by the FIRST
  `runDueEvoReview`, fired from the signed-in shell after a profile row
  exists — client-computed, DB-guarded (immutable snapshots, peak ratchet,
  starting write-once; migration 024).
- [CONFIRMED] `classify_evo_path` v4 (migration 046) is evidence-only
  (rating row with confidence ≥30, else a physique_assessments scan) — a
  brand-new onboarder has neither. `assign_origin_path` is write-once,
  audited, equips, and THE ORIGIN LOCK (customise roster, battle select,
  display, `set_active_champion`) is live.
- [CONFIRMED] Goals and playstyle are NOT collected anywhere in onboarding;
  `profile.nutrition_phase` is the only intent signal. `paths.fitness_category`
  maps the five slugs to `aesthetics/size/strength/cardio/fat_loss`.
- [CONFIRMED] Existing population (production, 2026-07-17): 18 profiles,
  origin null for all (post-reset), 17 `needs_assessment` + 1 `pending`,
  10 rating rows (all confidence ≤20), 3 scanned users, 0 users with ≥3
  finished-workout days.

## 2. Origin vs Champion vocabulary [CONFIRMED + decision]

**OriginId = the five deployed path slugs.** They are foreign keys into
`paths`, skin lines, sprite sets, and RLS-checked tables — display labels
are never identifiers.

| OriginId (stable) | Display name | Proposal alias | Battle champion (`championForBranch`) |
|---|---|---|---|
| `titan` | Titan | titan | `titan` |
| `mass` | Mass Monster | colossus | `titan` |
| `cardio` | Apex Engine | tempest | `apex` |
| `shredder` | Shredder | shredder | `shredded` |
| `aesthetic` | Elite Aesthetic | paragon | `aesthetic` |

- [REJECTED] `hybrid` as an Origin — removed from the game by Tyson
  2026-07-16 (`customise.ts:344`). "Balanced athlete" is expressed through
  the candidate mix + BALANCED_ATHLETE reason code, never a sixth origin.
- [REJECTED] Renaming slugs to the proposal's colossus/tempest/paragon —
  would orphan art keys, skin-line CHECK constraints, and battle sprites.
- [CONFIRMED] A Champion is a collectible; each Origin has a default
  champion via `championForBranch` (4 battle champions for 5 origins — a
  `mass` origin previews the `titan` champion's moves; see calibration
  spec §6 for the preview bridge). Premium characters (Gymerica) are
  overlays, owned in `user_character_unlocks`, orthogonal to Origin.

## 3. The new-user flow [PROPOSED]

One route (`/onboarding`), now a two-act step machine. Act I is the
existing form (unchanged sections + one new section). Act II is the origin
ceremony, entered after the profile insert, and the route holds the user
until binding completes.

```
Act I  (pre-insert, local state only — unchanged loss semantics)
  1 WHO        sex · height · bodyweight            [CONFIRMED, unchanged]
  2 LIFTS      bench/squat/deadlift 1RM · years     [CONFIRMED, unchanged]
  3 FUEL       nutrition phase                      [CONFIRMED, unchanged]
  4 DRIVE      primary goal + battle style          [PROPOSED, new section]
  5 SCAN       optional AI physique photo           [CONFIRMED, unchanged]
  6 TRAINING   optional split                       [CONFIRMED, unchanged]
  7 PROFILE    public identity                      [CONFIRMED, unchanged]
  → FORGE CHARACTER: profile insert now also writes primary_goal,
    battle_style, onboarding_flow_version = 2      [CHANGED]

Act II (post-insert, server-backed, resumable)
  8  RATING    run the first Evo Review inline (runDueEvoReview), then the
               EVO RATING REVEAL: displayed rating + four pillar bars
  9  CALIBRATION  origin_candidates() RPC → exactly 3 candidates
  10 REVEAL    three visually distinct candidate cards (resonant/destined/
               anomaly labels, reason copy, stage-1 art + stage-4 silhouette)
  11 PREVIEW   per-card: battle stats, signature moves, style, evolution
               ladder — free browsing, nothing auto-selected
  12 CONFIRM   explicit selection → permanence confirmation
  13 BINDING   assign_origin_path RPC (atomic, idempotent, server-validated)
  14 AWAKENING Stage 1 ceremony (sound + glow + count; static under
               reduced motion), Stage 2 preview, first-mission seed
  15 → router.replace('/') — Home shows champion, origin, rating, mission
```

### Gate + resume rules [CHANGED]

- `(main)/_layout` gate gains ONE clause, after the existing
  `profile === null → /onboarding`:
  `profile.onboarding_flow_version >= 2 && profile.origin_path == null &&
  ORIGIN_FLAGS.originOnboardingEnabled → Redirect /onboarding`.
  New-flow users therefore CANNOT reach Home without an origin; the 17
  existing origin-less users (no `onboarding_flow_version`) are untouched
  and keep the prompt/reveal path (Phase 5).
- `/onboarding` itself: `profile.data` non-null → skip Act I entirely and
  enter Act II at step 8 (or 9 if a rating row already exists). Killing
  the app anywhere in Act II resumes at the same step — candidates are
  regenerated deterministically from the same stored inputs; nothing is
  persisted between selection and binding BY DESIGN (binding is the only
  mutation, so no partial state can corrupt).
- The redirect race [CONFIRMED hazard]: the current auto-redirect on
  `profile.data` non-null is REPLACED by the Act II hold; redirect only
  fires when `origin_path` is set (or the flag is off).

### Interruption/error states [PROPOSED]

- Rating step failure (review throws): retry affordance; the review is
  idempotent per its own due-check; a second run when a row exists is a
  no-op skip.
- Candidates RPC failure/offline: full-screen retry card, never a dead end.
- Binding failure: error toast + the confirm screen stays; re-tap re-calls
  the RPC — server idempotency (`already_assigned`) makes any duplicate a
  success-shaped no-op that refetches status.
- Double-tap / two devices: the server advisory lock + write-once origin
  means exactly one binding ever lands; the loser sees `already_assigned`,
  treated as success.

## 4. Stage 1 awakening awards [PROPOSED]

On successful binding, atomically (one definer RPC, §migration 047):
- `profile.origin_path/active_path/active_stage` set + equipped (equip
  semantics confirmed from 042/046).
- `user_paths` row for the origin: `is_origin`, unlocked, stage ≥1
  (preserve-higher), `unlock_source 'evo_assessment'`.
- `profile.firstbound_origin` written ONCE (never overwritten, §data model).
- Origin Mastery initial state = `user_paths.path_xp` (existing column,
  now trigger-guarded monotonic).
- Champion Bond initial state = `user_champion_bond` row for the origin's
  default champion (bond_xp 0, monotonic).
- `evo_assessments` row records the full candidate set + selection.
- `user_path_migration_log` audit row.
- CLIENT-side non-blocking riders (the onboarding.tsx "never block" pattern):
  first-mission schedule seed (§6), analytics events, toast + sound.

## 5. Home landing [CONFIRMED + small additions]

Home already renders champion podium (display identity pins to origin —
THE ORIGIN LOCK), Evo core (rating + pillars), TODAY'S MISSION, and the
EvolutionTeaser (Stage 2 preview). [PROPOSED] the mission seed below makes
the mission card show a real origin-flavoured workout on day one. No other
Home changes; deeper systems stay progressively disclosed.

## 6. First mission [PROPOSED]

No mission tables exist and Home's card derives purely from real schedule/
plan/log rows ("systems without backends are hidden, never mocked"). The
first origin mission is therefore REAL DATA: if the athlete skipped the
TRAINING split step, binding seeds the origin's recommended split
(titan/mass → ppl3, cardio → fb3, shredder → fb3, aesthetic → ppl3, per
`ORIGIN_SPLITS` in domain) with the schedule ROTATED so that TODAY is
training day 1 (fixes the confirmed fixed-weekday Rest-day collision). If
they chose a split, theirs wins and is left alone. Rider, never blocking.

## 7. Existing users — see EXISTING_USER_ORIGIN_MIGRATION.md

No resets, no forced flows, flag-gated candidate upgrade of the EXISTING
reveal surfaces. [CONFIRMED] all current users are already origin-less
with reveal machinery live, so "introduction flow" = the upgraded reveal.

## 8. Free Reforge — see ORIGIN_CALIBRATION_SPEC.md §8 + data model

Granted after 3 valid post-binding workout days (server-proved), exactly
once, never during onboarding.

## 9. UX requirements checklist (mapped to implementation)

- Unforged state: Act II entry card before the rating reveal.
- Three distinct cards: path palette accents + stage-1 art + stage-4
  silhouette (`avatarArtV2`/`stillAvatar`, silhouette tint per
  `avatar-stage`); recommendation-type chips (RESONANT/DESTINED/ANOMALY).
- Reason copy derives from reason codes ONLY (`reasonText()` in domain) —
  no scattered strings in components.
- Ceremony: `durations.major` (1200ms) count-up + `playPowerUp` +
  HeroStage bloom; `useReducedMotion` → static final frame (the
  LevelUpOverlay contract); verify-motion gate applies (any `withRepeat`
  must be `useAmbient`/`useReducedMotion` gated).
- Safe area via ScreenShell padding; accessibility labels on every card
  and CTA; loading/error/offline/interrupted states per §3.
- Visual identity: existing tokens/components only (GlowCard, NeonButton,
  HeroStage, pixel fonts) — no new design system.

## 10. Out of scope for this release [OPEN → later]

- Playable combat trial (lightweight preview ships instead — allowed by
  the product spec when architecture makes full trials heavy).
- Server-computed Evo Rating (the client-computes/DB-guards trust model is
  the deployed architecture; moving authority is a separate program).
- `user_skill_nodes` spendable tree (still deferred per ORIGIN_PATH_PLAN).
- Remote-config kill switches (flags remain compile-time constants —
  confirmed repo-wide limitation, documented in ORIGIN_ANALYTICS.md).
- Multiple champions per origin beyond the default + Gymerica overlay.
