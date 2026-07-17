# Origin Calibration — engine spec (candidate model v5, 2026-07-17)

The calibration engine produces EXACTLY THREE distinct Origin candidates —
Resonant (who you are), Destined (who you want to become), Anomaly (the
plausible wildcard) — plus one non-binding recommendation. It never binds.

`CANDIDATE_MODEL_VERSION = 5` — continues the deployed classification
version line (v1 039 → v2 042 → v3 045 → v4 046). v4 (`classify_evo_path`)
REMAINS DEPLOYED and untouched for the legacy reveal; v5 is a new seam.

## 1. Authority model [decision]

- The SERVER is the authority: `origin_candidates_for(uuid)` (SQL, definer)
  generates and `assign_origin_path` v5 re-validates the pick against a
  fresh server-side generation. Repo precedent: classify v1–v4.
- A PURE TS REFERENCE ENGINE (`client/src/domain/origin/candidates.ts`)
  implements the identical formula for unit tests and UI derivations.
  Parity is pinned by golden cases: the vitest suite asserts the TS engine
  over fixtures, and Phase 3 falsification replays the same fixtures
  against the production SQL (the glicko byte-pin philosophy, applied at
  case granularity rather than byte granularity).
- [REJECTED] client-side generation as authority — would let a tampered
  client widen its own candidate set. The RPC result is also what the UI
  renders, so client/server drift cannot mislead the player.

## 2. Canonical inputs (CalibrationInput)

Sourced from the SAME rows the initial Evo Rating consumes — no second
assessment system. All inputs optional; every absence has a documented
fallback and a confidence consequence, never a crash.

| Input | Source [CONFIRMED] | Missing behaviour |
|---|---|---|
| pillar scores + per-pillar confidence | `evo_rating_current` (the just-run first review for new users) | pillar treated per evidence tiers below |
| scan size/aesthetics | freshest confirmed/pending `physique_assessments` | fall through to self-report tier |
| bench/squat/deadlift e1rm, bodyweight, height, sex, training_years | `profile` (onboarding self-report) | strength/size proxies unavailable → those origins can only appear via goal/playstyle |
| body-fat mid | latest `bodyfat_log` (bf_mid or low/high mean) | leanness proxy unavailable; shredder resonance off |
| nutrition_phase | `profile` | no shredder auto-resonance |
| primary_goal | `profile.primary_goal` [NEW] | destined falls back to nutrition_phase mapping, else goal-less rule §5 |
| battle_style | `profile.battle_style` [NEW] | anomaly falls back to untapped-pillar rule |

## 3. Evidence tiers per pillar (resonance scoring)

Affinity vocabulary continues v3/v4: `affinity = score − baseline`
(baselines aesthetic 60 · mass 52 · titan 50 · cardio 48, CALIBRATION_V3,
unchanged). A pillar's resonance score comes from the FIRST available tier:

- **Tier E (evidence)**: rating pillar with confidence ≥ 25 (v4's gate) —
  affinity as deployed.
- **Tier S (self-report)** [NEW in v5, onboarding-grade]:
  - strength: best of bench/(bw·1.00), squat/(bw·1.40), deadlift/(bw·1.60)
    ratio vs 1.0 ≡ baseline; affinity = (ratio − 1.0) · 25, clamped ±20.
    (Bands mirror RELATIVE_ANCHORS' mid-band slopes; documented constants.)
  - size: normalised FFMI (the deployed `normalisedFfmi` formula) with bf
    mid from bodyfat_log else phase-derived default (cutting 22/bulking
    18/else 20 male; +8 female): affinity = (ffmi − 20) · 4 male /
    (ffmi − 17) · 4 female, clamped ±20.
  - leanness→shredder: only as auto-resonance, v4 rule unchanged (cutting
    phase + fresh bf ≥ 20 male / 28 female).
  - cardio: NO self-report tier — cardio resonance requires evidence
    (never recommend Apex Engine to someone who never logged cardio).
  - aesthetic: NO self-report tier beyond the scan (self-grading physique
    was removed from the product on purpose).
- **Tier X (absent)**: pillar cannot be the Resonant candidate.

Manipulation note [documented]: Tier S trusts onboarding self-report — the
same trust already extended to `base_level` (`startingLevelV2`). It can
only skew the player's OWN starting recommendation; it feeds no
leaderboard, no reward, and the player chooses freely anyway. Tier E, when
present, always outranks Tier S.

## 4. Candidate selection

1. **Resonant** = highest-affinity origin among tiers E/S (shredder
   auto-resonance overrides when its rule fires, reason CUTTING_PHASE_HIGH_BF).
   If NO pillar clears tier E/S: resonant slot falls to the goal mapping
   (reason BALANCED_ATHLETE) — new users always get three cards.
2. **Destined** = goal→origin map (mirrors `paths.fitness_category`):
   strength→titan · muscle_gain→mass · fat_loss→shredder ·
   cardio→cardio · aesthetics→aesthetic. Fallback: nutrition_phase
   (cutting→shredder, bulking→mass, else aesthetic). If it collides with
   Resonant, walk the player's goal-adjacency row (documented table below)
   to the first distinct origin.
3. **Anomaly** = first distinct origin from, in order: (a) the SECOND
   highest tier-E/S affinity ("secondary strength", reason UNTAPPED_*),
   (b) the battle_style map force→titan/mass · form→aesthetic ·
   flow→cardio/shredder (reason *_PLAYSTYLE), (c) the static diversity
   ladder cardio→shredder→mass→titan→aesthetic (reason CONTRAST_PATH).
   The ladder guarantees three DISTINCT origins always exist (5 ≥ 3).
4. **Recommended** = Resonant when it came from tier E, else Destined.
   `requires_choice` is ALWAYS true in v5 — the player decides; the engine
   never auto-selects and binding never accepts an origin outside the set.

Goal-adjacency rows (for Destined collision): strength→[titan,mass,
aesthetic] · muscle_gain→[mass,titan,aesthetic] · fat_loss→[shredder,
cardio,aesthetic] · cardio→[cardio,shredder,titan] ·
aesthetics→[aesthetic,shredder,mass].

Determinism: pure function of (inputs, version); ties break by slug order.
Identical stored inputs → identical candidates → safe resume.

## 5. Reason codes (closed vocabulary, v5)

`HIGH_RELATIVE_STRENGTH · HIGH_MUSCLE_SIZE · HIGH_CARDIO_CAPACITY ·
HIGH_LEANNESS · HIGH_AESTHETIC_BALANCE · BALANCED_ATHLETE ·
CUTTING_PHASE_HIGH_BF · STRENGTH_PRIMARY_GOAL · MUSCLE_GAIN_PRIMARY_GOAL ·
FAT_LOSS_PRIMARY_GOAL · CARDIO_PRIMARY_GOAL · AESTHETIC_PRIMARY_GOAL ·
PHASE_INFERRED_GOAL · POWER_PLAYSTYLE · PRECISION_PLAYSTYLE ·
TEMPO_PLAYSTYLE · UNTAPPED_STRENGTH · UNTAPPED_SIZE · UNTAPPED_CARDIO ·
UNTAPPED_LEANNESS · UNTAPPED_AESTHETICS · CONTRAST_PATH`

Display text derives ONLY from `reasonText(code)` in the domain module.
Components never invent recommendation copy.

## 6. Candidate payload

```ts
interface OriginCandidate {
  originId: OriginId;                       // the five slugs
  recommendationType: 'resonant'|'destined'|'anomaly';
  score: number;                            // affinity, 1 decimal
  reasonCodes: OriginReasonCode[];          // ≥1, ordered by weight
  currentStrengthMatch: number;             // 0..100 (tier E/S affinity mapped)
  goalAlignment: number;                    // 0..100
  playstyleAlignment: number;               // 0..100
}
```

RPC result adds: `recommended_origin`, `candidate_model_version: 5`,
`evo_rating`, `scores`, `input_snapshot_kind` (evidence/self_report/mixed).
Champion preview data (stats, signature moves, style) is derived
client-side from the EXISTING domain (`championForBranch` →
`CHAMPIONS`/`movesForChampion`/`styleOfChampion`) — no duplication.

## 7. Storage (auditability)

At binding, `evo_assessments` gains one row: classification_version 5,
`raw_input_snapshot` = the full RPC payload INCLUDING the three candidates,
recommendation, and `followed_recommendation` boolean. No photos, no raw
measurements beyond what the payload already carries (scores + affinities).
Selection timestamp = `profile.origin_assigned_at` (existing).

## 8. Free Reforge calibration

The reforge run is the SAME engine at the SAME version discipline, executed
after ≥3 valid post-binding workout days — by then tier E evidence exists
(strength pillar from real logged sets), which is exactly the "improved
real-world data" the product rule wants. Grant/consume mechanics in
ORIGIN_DATA_MODEL.md §5; transfer rules in EXISTING_USER_ORIGIN_MIGRATION.md §4.

## 9. Fairness + safety notes

- Beginners: tier S + goals guarantee three meaningful cards with zero
  training history; nothing shames a low score (affinities are relative).
- Advanced: tier E dominates automatically; the anomaly surfaces their
  second pillar rather than a random card.
- Missing everything (no lifts, no scan, no bf, no goal): resonant→goal
  fallback→phase fallback→BALANCED_ATHLETE aesthetic; destined walks
  adjacency; anomaly walks the ladder — three cards, low scores, honest
  reason codes. Tested (see ORIGIN_TEST_PLAN.md C-7).
- Invalid values (negative lifts, bf > 75, height 0): normalised to the
  documented ranges before scoring; out-of-range → treated as absent.
