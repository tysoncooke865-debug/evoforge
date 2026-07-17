# Origin Path system — execution plan (Tyson's spec, 2026-07-17)

> Core rule: **the Evo Assessment chooses the player's Origin Path; that path's
> skill tree still unlocks Stages 2–4 exactly as today. EARNED progress is
> never reduced — but the old un-earned Elite Aesthetic default is NOT kept
> when the formula assigns a different Origin (Tyson's amendment, below).**

This file is the repo-adapted version of Tyson's full spec (delivered in-chat
2026-07-17). Where the generic spec and this codebase disagree, THIS file wins.

## Repo adaptations (deviations from the generic spec)
1. **Path IDs are slugs, not uuids** — they must equal the existing `SkinLine`
   vocabulary (`aesthetic · mass · titan · cardio · shredder`) that art,
   customise gates and battle sprites already key on.
2. **Hybrid does not exist** (removed by Tyson 2026-07-16). "Broadly balanced"
   → `requires_choice` among the top-scoring paths instead of auto-Hybrid.
3. **The assessment source is `evo_rating_current`** (migrations 023–029):
   size/aesthetics/strength/cardio scores + per-score and overall confidence.
   `evo_assessments` records each CLASSIFIED result (with raw snapshot) so the
   formula can be re-run later; `evo_rating_snapshots` remains the rating
   history.
4. **Shredder is goal-driven eligibility only** (profile.nutrition_phase =
   'cutting' at classification time) — reported as `shredder_eligible`, never
   auto-assigned.
5. **`user_skill_nodes` is deferred to Release 2** — today's skill tree derives
   client-side from scores; the dual-write starts when tree actions gain a
   server seam. `user_paths` ships now with stage/xp columns ready.
6. Fitness-category → path mapping (classification v1):
   strength→titan · cardio→cardio (Apex Engine) · aesthetics→aesthetic
   (Elite Aesthetic) · size→mass (Mass Monster).

## Classification v4 + THE ORIGIN LOCK (migration 046, 2026-07-17)
Tyson's live feedback on v3 ("I somehow got given Titan… 57/58/56/44"):
- **The raw ±5 choice rule**: the CHOICE test rides the RAW scores the player
  sees — every evidenced pillar within 5 raw points of the evidenced raw
  maximum joins the choice set (the affinity top always included); more than
  one member is ALWAYS the player's decision. Recommendation + ranking still
  ride v3's affinities. classification_version 4.
- **THE ORIGIN LOCK**: once an origin is claimed, the origin champion is the
  ONLY equipable champion. Server: set_active_champion refuses any other
  path ('origin_locked'). Client: buildRoster(originPath) locks the roster
  (customise equip, stage ladders via entry.unlocked, battle champion
  select through unlockedChampionSet), resolveDisplay pins the displayed
  branch, ghosts + versus snapshots carry the origin branch, path-sync
  mirrors the ORIGIN line's derived stage as the active champion (the
  origin champion keeps growing with training). Premium characters
  (Gymerica) stay equipable — they are purchased overlays, not path
  champions. Non-origin lines keep progress/purchases; they just cannot
  render.
- The lone v3 claim (titan) was reset to re-choose under the raw rule.
- Verified: domain vitest (origin-lock describe), forged-JWT SQL check
  (origin_locked / ok), and a Playwright tour with a titan-origin smoke
  account — Home podium renders the titan champion, customise roster shows
  1/9 unlocked with the rest LOCKED, battle select shows ORIGIN LOCKED.

## Classification v3 (migration 045, 2026-07-17) — margins superseded by v4
Tyson: "most characters' origin having to be aesthetics" — v1/v2 compared the
four pillar scores RAW and the pillars sit on different effective scales
(measured on production: aesthetics beat size 10/10; strength/cardio floor at
30/35–45 without evidence), so every assigned origin was aesthetic. v3:
- **Affinities, not raw scores**: `affinity = score − BASELINE(pillar)` with
  versioned CALIBRATION_V3 baselines (aesthetic 60 · mass 52 · titan 50 ·
  cardio 48 — fit to the 2026-07-17 production distribution). You are
  classified by the pillar you are most above YOUR PEERS on.
- **Evidence gate**: pillar confidence < 25 → cannot be recommended or
  offered (still shown in the breakdown). The v2 scan-fallback's neutral-mid
  fill for strength/cardio no longer competes.
- **The Shredder is REAL** (Tyson's amendment over the v1 "eligibility
  only"): nutrition_phase = 'cutting' + fresh (≤90-day) bf_mid ≥ 20% (male) /
  28% (female) → Shredder recommended outright (`shredder_auto`). Cutters
  below the threshold keep `shredder_eligible` as a claimable alternative.
- Margins ride the affinities: `CHOICE_MARGIN = 5`, `BALANCED_SPREAD = 8`
  (over gated candidates only), `MIN_CONFIDENCE = 30` unchanged.
- New RPC fields: `affinities`, `ranking` (gated pillars in affinity order —
  the panel's display order), `shredder_auto`; `classification_version = 3`.
- `classify_evo_path_for(uuid)` is the per-user core (service-role only);
  the client wrapper keeps its signature.
- **THE GLOBAL RE-ASSESSMENT** (`require_origin_reassessment_v3`, EXECUTED
  LIVE 2026-07-17): every assigned origin (3, all aesthetic) retired to
  needs_assessment, previous state archived (migration_version 3), is_origin
  cleared, earned stages/unlocks untouched, idempotent (re-run = 0). Every
  player re-discovers their origin through the existing scan-prompt →
  reveal → claim flow under v3.

## Classification v1 constants (HISTORICAL — superseded by v3 above)
- `CHOICE_MARGIN = 5` — top two within 5 points → requires_choice (both offered)
- `BALANCED_SPREAD = 8` — all four within 8 points → requires_choice (all four)
- `MIN_CONFIDENCE = 30` — overall_confidence below → `insufficient_data`
  (client shows "complete the updated Evo Assessment"; migration_status =
  needs_assessment)

## Release ladder (spec Phases mapped to shippable units)
- **Release 1 — data foundation (migration 039)** ✅ SHIPPED 2026-07-17,
  applied + falsified: `paths` (seeded ×5), `user_paths`
  (unique(user_id,path), stage/xp/origin columns, owner-RLS),
  `evo_assessments` history, `user_path_migration_log`, profile columns
  (origin_path, active_path, active_stage, origin_assigned_at,
  origin_assignment_version, migration_status default 'pending'), plus the two
  server seams:
  - `classify_evo_path()` — deterministic, versioned, read-only; returns
    recommended/secondary/scores/confidence/requires_choice/choices/
    shredder_eligible or reason insufficient_data/no_assessment.
  - `assign_origin_path(p_path)` — the ATOMIC award: validates the pick
    against a fresh classification (recommendation, offered choices, or
    shredder eligibility), records the evo_assessments row, upserts
    user_paths (is_origin, min stage 1, never lowers), sets profile origin/
    active-if-missing, logs to user_path_migration_log. Idempotent: a second
    call returns already_assigned. ORIGIN NEVER CHANGES.
- **Release 2 — dual-write progression** ✅ SHIPPED 2026-07-17 (migration 040,
  applied + falsified): stages are DERIVED today (level+bf → currentStageFor),
  so the dual-write mirrors that derived truth — record_path_progress
  (monotonic, bounded, never lowers) + set_active_champion (clamped to the
  recorded stage), fired once per user+path+stage from the Forge screen
  (src/data/path-sync.ts). Legacy stays the read path; live-verified: a Forge
  visit mirrored aesthetic S3 + active champion for the smoke account.
  user_skill_nodes still deferred until a real spendable tree exists.
- **Release 3 — existing-user backfill** ✅ SHIPPED 2026-07-17 (migration 041,
  `backfill_origin_paths(dry_run)`, admin/service-role only). Dry run reviewed
  first: 17 accounts, 0 auto-migratable (nobody at confidence ≥30), 17 →
  needs_assessment — no origins guessed, nothing touched. Live run applied;
  second run proved idempotent (0 writes). Auto-assignment (top scorer,
  deterministic tie-break) activates as accounts cross the confidence gate on
  future runs. Stage copying rides the Release 2 dual-write (preserve-higher).
- **Releases 4+5 — reveal / banner / roster** ✅ SHIPPED 2026-07-17 as ONE
  flow (src/data/origin.ts + src/ui/character/origin-panel.tsx on the Forge):
  origin unset + classification OK → ORIGIN PATH DISCOVERED (score breakdown,
  choice buttons when scores are close, permanent claim → Stage 1 + roster);
  not enough data → the DISCOVER banner ("your current champion will not
  change"); origin set → YOUR PATHS roster (stage, ORIGIN/ACTIVE tags).
  Claiming never swaps the equipped champion (active only set when null).
  ORIGIN_FLAGS in origin.ts are the spec's Phase 12 kill-switches.
  ADAPTATION: no separate "neutral Forge Initiate" art exists — new users
  keep the derived look until their confidence crosses the gate, then the
  same reveal fires; onboarding untouched. All three states live-verified
  on WebKit iPhone (banner at conf 20; reveal→claim titan→roster at conf 80).
- **Release 6 — dual-read cutover** ✅ machinery SHIPPED 2026-07-17; deletion
  still gated. What shipped: (b) legacy snapshot taken
  (legacy_state_backup_20260717, 17 accounts, RLS-locked, no client access);
  (c) the DUAL-READ in use-display-identity.ts — an account WITH an origin
  reads its champion stage from the new schema (same-path, monotonic, capped
  4; earned stages can never regress), everyone else stays fully legacy —
  live-verified: a migrated account rendered its server stage 4 over a
  derived 3, and Forge/Home/Train/Arena/Customise/Battle all ran clean; flag
  newSchemaReadEnabled kills it instantly. STILL GATED: physically dropping
  legacy columns/derivation — only when (a) 100% of accounts are migrated
  (today 0/17; accounts migrate as confidence crosses 30 via backfill
  re-runs). Cross-path display override lands with the roster equip action.

## Non-negotiable migration rules (spec, AS AMENDED by Tyson 2026-07-17)
Never reduce an EARNED stage · never delete tree progress · never swap the
equipped champion without permission · never force re-onboarding.
**AMENDMENT (overrides the generic spec):** the old Elite Aesthetic DEFAULT is
a placeholder, not an earned unlock — "if their new formula says Titan, they
must lose aesthetic." Origin assignment grants only the assessed path. The
Release 3 backfill preserves EARNED aesthetic progress (stages actually
reached via the tree, purchased cosmetics) but does NOT carry over the
un-earned default grant.

## Test matrix (spec's 15 cases) — run before each release flips on
New-user clear winner / close pair / balanced; existing Elite S1→Titan origin;
Elite S4→Elite origin (no reset); Titan S2→Titan origin (stays S2); multi-path
user; no/incomplete assessment; corrupted character data (review_required);
cosmetic purchaser; mid-battle during deploy; nodes beyond stored stage;
app-close during reveal; migration script run twice (idempotent).
