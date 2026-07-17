# Origin analytics (2026-07-17)

## Rail [CONFIRMED]

`analytics_events` (migration 029): owner-insert RLS, `event_name`
(3–60 chars) + `props` jsonb. No third-party SDK exists. Emission pattern:
best-effort inline insert in a swallow-all try/catch (the evo-review-io
precedent). This program adds the repo's FIRST shared emitter,
`client/src/data/analytics.ts :: track(name, props)`, and migrates no
existing call sites (out of scope).

## Delivery semantics [documented limitation]

Client-side best-effort: an event can be LOST (offline, killed app) but is
emitted at most once per triggering interaction. The two events that must
be trustworthy-exactly-once for product accounting —
`origin_binding_completed` and `free_reforge_completed` — are ALSO derivable
server-side from `evo_assessments`/`user_path_migration_log` rows (the
authoritative record), so analytics loss never loses the fact.

## Event vocabulary

| Event | Fired from | Props (beyond defaults) |
|---|---|---|
| `onboarding_started` | onboarding mount (Act I, once per mount without profile) | — |
| `initial_assessment_started` | FORGE CHARACTER pressed | has_scan, split_chosen |
| `initial_assessment_completed` | profile insert success | — |
| `evo_rating_revealed` | rating reveal step shown | rating_band, confidence_label |
| `origin_calibration_started` | candidates RPC issued | — |
| `origin_candidates_generated` | RPC success | candidate_ids, types, recommended, model_version |
| `origin_candidates_revealed` | cards rendered | same as above |
| `origin_candidate_viewed` | preview opened | origin_id, type, dwell_ms on close |
| `origin_candidate_trialled` | preview move/stat panel expanded | origin_id |
| `origin_selected` | card selected | origin_id, type, followed_recommendation |
| `origin_binding_started` | bind RPC issued | origin_id |
| `origin_binding_completed` | bind ok | origin_id, followed_recommendation, user_type |
| `origin_binding_failed` | bind error/not-ok | reason (error category, no message bodies) |
| `stage_one_awakened` | ceremony shown | origin_id, champion |
| `onboarding_completed` | replace('/') after ceremony | duration_ms |
| `onboarding_resumed` | Act II entered with pre-existing profile | resume_step |
| `origin_selection_abandoned` | Act II unmount without bind (best-effort) | last_step |
| `free_reforge_unlocked` | claim_free_reforge ok | — |
| `free_reforge_started` | reforge candidates opened | — |
| `free_reforge_completed` | reforge_origin ok | from_origin, to_origin |

Default props on every event: `calibration_version`, `onboarding_step`
(when applicable), `user_type` ('new' | 'migrated'), `flow_version`.

Existing-user reveal (Phase 5) reuses the same names from
`origin_calibration_started` onward with `user_type: 'migrated'`.

## Privacy rules

- Never: photos, photo hashes, raw measurements (height/weight/bf values),
  lift numbers, display names.
- Rating is bucketed (`rating_band`: decade bucket, e.g. "40s") — never
  the exact value. Scores/affinities stay OUT of analytics (they live in
  the auditable `evo_assessments` snapshot, owner-readable only).
- Error props carry a CATEGORY string, never raw error messages (which can
  embed URLs/ids).

## Non-blocking rule

`track()` is fire-and-forget (`void` + internal catch); it must never gate
navigation, binding, or ceremony timing. [Tested: vitest asserts track
swallows a rejected insert; the UI never awaits it.]
