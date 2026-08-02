# Bodyweight load modes

> Status 2026-08-02: **canonical core + schema landed and tested
> (`d9554e2`); UI and persistence wiring NOT yet done.** The "Remaining
> work" section is the honest list — read it before assuming a screen
> behaves.

## 1. Root causes

`workout_log` carried a single `weight numeric` column, so four physically
different sets became one indistinguishable number:

| What the athlete did | What was stored |
|---|---|
| Pull-up, bodyweight | `0 kg × 12` |
| Pull-up, bodyweight (athlete typed their weight) | `76 kg × 12` |
| Pull-up, +20 kg | `96 kg × 8` (bodyweight and added, merged) |
| Pull-up, 30 kg machine assistance | `30 kg × 10` |

Three consequences, in order of severity:

1. **Assistance was recorded as weight lifted.** An athlete reducing their
   assistance from 30 kg to 20 kg — the entire purpose of the machine —
   registered as *lifting less*. Every e1RM, volume total and personal
   record moved the wrong way as they got stronger. This was not in the
   original report and is the most damaging of the three.
2. **A bodyweight set could never set a record.** `estimated1rm(0, reps)`
   is 0, so `0 kg × 12` was permanently invisible to PR detection.
3. **Weighted sets inflated everything.** A pull-up entered as a 96 kg
   total outranked every genuine back movement in e1RM and tonnage.

Two structural causes underneath them:

- **No load model in canonical exercise metadata.** `LibraryExercise` knew
  a pull-up was `equipment: 'Bodyweight'` and nothing more, so any
  behaviour would have had to be name-matching inside UI components.
- **One numeric field cannot carry a set's meaning.** Migration 061 had
  already made `0 kg` *storable*; it never made it *meaningful*.

## 2. The model

A set stores its **mode** and its **parts**, never a pre-computed total.

```
external            weightKg
bodyweight          (nothing — reps only)
weighted_bodyweight externalLoadKg      ADDED load only
assisted_bodyweight assistanceKg        assistance, always positive
repetition_only     reps
duration            durationSeconds
distance            distanceMeters
```

Effective resistance is **derived, never stored as the display value**:

```
bodyweight           = bodyweightSnapshotKg
weighted_bodyweight  = bodyweightSnapshotKg + externalLoadKg
assisted_bodyweight  = max(bodyweightSnapshotKg − assistanceKg, 0)
```

`null` is a real answer and callers must handle it — an athlete with no
weigh-in has no honest effective resistance, and we do not invent one.
The athlete always reads `BW + 20 kg × 8`, never `96 kg × 8`.

### Deliberate refusals

| We could have | We did not, because |
|---|---|
| Given push-ups a bodyweight coefficient | It is ~60–70% and varies with limb length and foot elevation. The brief says avoid invented precision, so push-ups are excluded from tonnage instead |
| Assigned bands a kilogram value | There isn't one. Band sets store a description and return `null` resistance |
| Back-filled historical bodyweight snapshots | We know what an athlete weighs today, not what they weighed in March |
| Auto-converted ambiguous historical rows | `76 / 96 / 30 kg` on a pull-up are indistinguishable in the data. They are flagged, not guessed |
| Defaulted an ambiguous transcript to external weight | That is precisely how `30 kg × 10` came to mean assistance-as-load |

## 3. Files

| File | Role |
|---|---|
| `client/src/domain/exercise-load.ts` | **The only place these rules live.** `validateExerciseSet` · `normaliseExerciseSet` · `formatExerciseSet` · `calculateEffectiveResistanceKg` · `copyPreviousSet` · unit conversion · bounds config |
| `client/src/domain/exercise-load-models.ts` | Resolves an exercise's load model from canonical metadata (explicit map → pattern over the base name → equipment fallback) and whether it counts toward tonnage |
| `client/src/domain/workout-transcript.ts` | `validateParsedSet` (untrusted-input gate) + `parseTranscript` (deterministic phrase parser) |
| `migrations/133_bodyweight_load_modes.sql` | Schema, constraints, conservative backfill, rollback block |

## 4. Migration decisions

Additive and reversible. `weight` is untouched; `legacy_weight` preserves
the original; `load_mode` defaults to `'external'` so **every weighted
exercise behaves exactly as before**.

| Rule | Rows | Action |
|---|---|---|
| C1 | Plank / dead hang / wall sit at 0 kg | → `duration`, `converted` |
| C2 | Air squat / burpee / sit-up at 0 kg | → `repetition_only`, `converted` |
| C3 | Pull-up / chin-up / dip / push-up at **0 kg** | → `bodyweight`, `converted` (a pull-up cannot be performed against zero resistance, so 0 kg can only ever have meant "just me") |
| C4 | Pull-up / chin-up / dip **with a load** | **NOT converted** — flagged `ambiguous` |
| C5 | Everything else | Untouched (`external` / `untouched` defaults) |

Historical `estimated_1rm` and `volume` are **not** recomputed. Rewriting
an athlete's history is not a migration's job.

The database now enforces the invariant that caused the bug:
`workout_log_load_parts_check` refuses a row carrying both added weight
and assistance, and refuses either being negative.

## 5. Remaining work (not yet done)

The canonical core is complete and tested. **These are outstanding and the
user-visible behaviour has not changed yet:**

1. **Persistence wiring** — `set-save.ts` / `useSaveSet` still write only
   `weight`. They need to carry the new columns and capture the
   bodyweight snapshot at save time.
2. **Active-workout keypad** — the segmented Bodyweight/Weighted/Assisted
   control in `exercise-logger.tsx`.
3. **History and previous-set formatting** — call sites must route through
   `formatExerciseSet`.
4. **Personal records** — separate record types (most unweighted reps,
   highest added load, lowest assistance, longest duration).
5. **Transcript review UI** — the ambiguity prompt and per-set editing.
6. **Tonnage call sites** — `summary.ts` / `progress-aggregates.ts` must
   consult `contributesToTonnage`.

Until 1–3 land, the migration is safe to apply but changes nothing an
athlete sees.

## 6. Rollout

1. Apply `133` via the management API (HANDOVER §5). Run PART B's audit
   query first and record the counts.
2. Verify RLS is unchanged: `workout_log` stays owner-only.
3. Confirm an ordinary bench-press set still saves and reads identically.
4. Land the wiring above, then verify with the smoke accounts.

## 7. Rollback

The client tolerates the columns being absent (missing-column reads
degrade to `external`), so rollback is safe with the app deployed. The
tested statement block is at the foot of `133_bodyweight_load_modes.sql`:
restore `weight` from `legacy_weight`, drop the constraints, drop the
columns.
