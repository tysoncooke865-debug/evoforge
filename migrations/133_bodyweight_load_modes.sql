-- EvoForge 133 — BODYWEIGHT LOAD MODES (release-critical beta fix).
--
-- THE BUG. `workout_log` carried one `weight` column, so four different sets
-- collapsed into one ambiguous number:
--
--     pull-up, bodyweight       -> 0 kg  x 12   ("no resistance")
--     pull-up, bodyweight       -> 76 kg x 12   (athlete typed their weight)
--     pull-up, +20 kg           -> 96 kg x 8    (bodyweight + added, merged)
--     pull-up, 30 kg assistance -> 30 kg x 10   (ASSISTANCE STORED AS LOAD)
--
-- The last one is the worst: an athlete lowering their assistance — the whole
-- point of the machine — reads as getting weaker, in e1RM, in volume and in
-- every personal record.
--
-- THE FIX. A set stores its MODE and its PARTS, never a pre-computed total.
-- Effective resistance is derived where it is needed (client/src/domain/
-- exercise-load.ts) and is never what the athlete reads.
--
-- SAFETY. This migration is ADDITIVE and REVERSIBLE:
--   * every existing row keeps its `weight` untouched;
--   * `legacy_weight` preserves the original for audit and rollback;
--   * the default mode is 'external', so bench press, squats, dumbbells,
--     cables and machines behave EXACTLY as before;
--   * historical `estimated_1rm` and `volume` are NOT recomputed — rewriting
--     an athlete's history is not a migration's job, and the derived values
--     are recomputed by the app from the parts going forward.
--
-- Apply by hand via the management API (HANDOVER §5), falsify with the smoke
-- accounts, THEN ship the client commit that depends on it.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- PART A — the canonical set columns
-- ─────────────────────────────────────────────────────────────────────────
alter table public.workout_log add column if not exists load_mode text not null default 'external';
alter table public.workout_log add column if not exists external_load_kg numeric;
alter table public.workout_log add column if not exists assistance_kg numeric;
alter table public.workout_log add column if not exists assistance_type text;
alter table public.workout_log add column if not exists assistance_description text;
alter table public.workout_log add column if not exists bodyweight_snapshot_kg numeric;
alter table public.workout_log add column if not exists duration_seconds integer;
alter table public.workout_log add column if not exists distance_meters numeric;
alter table public.workout_log add column if not exists reps_per_side boolean;

-- Audit + rollback. Written ONCE, by the backfill below, and never again.
alter table public.workout_log add column if not exists legacy_weight numeric;
-- 'untouched'  — never considered, or ordinary external load (the default).
-- 'converted'  — high-confidence conversion; see PART C.
-- 'ambiguous'  — a bodyweight-family exercise with a load we CANNOT safely
--                interpret. Left exactly as it was, flagged for review.
alter table public.workout_log add column if not exists load_migration_status text not null default 'untouched';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workout_log_load_mode_check') then
    alter table public.workout_log add constraint workout_log_load_mode_check
      check (load_mode in ('external','bodyweight','weighted_bodyweight',
                           'assisted_bodyweight','repetition_only','duration','distance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_log_assistance_type_check') then
    alter table public.workout_log add constraint workout_log_assistance_type_check
      check (assistance_type is null or assistance_type in ('machine','band','partner','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workout_log_migration_status_check') then
    alter table public.workout_log add constraint workout_log_migration_status_check
      check (load_migration_status in ('untouched','converted','ambiguous'));
  end if;
  -- THE INVARIANT THAT CAUSED THE BUG, now enforced by the database: a set
  -- cannot be both added-to and assisted, and neither may be negative.
  if not exists (select 1 from pg_constraint where conname = 'workout_log_load_parts_check') then
    alter table public.workout_log add constraint workout_log_load_parts_check
      check (
        not (external_load_kg is not null and assistance_kg is not null)
        and (external_load_kg is null or external_load_kg >= 0)
        and (assistance_kg is null or assistance_kg >= 0)
        and (bodyweight_snapshot_kg is null or bodyweight_snapshot_kg > 0)
      );
  end if;
end $$;

-- RLS is inherited: workout_log is already owner-only (migration 001) and
-- adding columns does not change a policy. Verified in the rollout checklist.

-- ─────────────────────────────────────────────────────────────────────────
-- PART B — what the data actually looks like (run BEFORE part C)
-- ─────────────────────────────────────────────────────────────────────────
-- Deliberately a comment, not a DO block: an operator should LOOK before
-- converting anything. The conversion in part C is written to be correct
-- whatever this returns, but the numbers belong in the rollout notes.
--
--   select lower(exercise) as ex, count(*),
--          count(*) filter (where weight = 0)  as zero_kg,
--          count(*) filter (where weight > 0)  as with_load
--     from public.workout_log
--    where lower(exercise) ~ '(pull-?up|chin-?up|dip|push-?up|plank|dead ?hang|air squat|burpee)'
--    group by 1 order by 2 desc;

-- ─────────────────────────────────────────────────────────────────────────
-- PART C — conservative backfill
-- ─────────────────────────────────────────────────────────────────────────
-- THE RULE: convert only where the original entry has exactly one honest
-- meaning. Everything else stays as it is and is FLAGGED, never guessed.
--
-- Deliberately NOT done: converting every 0 kg row. A 0 kg bench press is a
-- data-entry mistake, not a bodyweight set, and the brief is explicit that a
-- blanket conversion is wrong.

update public.workout_log set legacy_weight = weight where legacy_weight is null;

-- C1. Duration holds: a plank row's "reps" were always seconds-ish nonsense,
-- but we do NOT reinterpret them — we only record the mode so the UI stops
-- asking for a weight. reps stay exactly where they are.
update public.workout_log
   set load_mode = 'duration', load_migration_status = 'converted'
 where load_migration_status = 'untouched'
   and coalesce(weight, 0) = 0
   and lower(exercise) ~ '(plank|dead ?hang|wall sit|hollow hold|l-?sit)';

-- C2. Repetition-only movements at 0 kg. Unambiguous: nobody loads an air
-- squat with zero kilograms — they did the reps.
update public.workout_log
   set load_mode = 'repetition_only', load_migration_status = 'converted'
 where load_migration_status = 'untouched'
   and coalesce(weight, 0) = 0
   and lower(exercise) ~ '(air squat|bodyweight squat|burpee|mountain climber|jumping jack|sit-?up|crunch)';

-- C3. Bodyweight-family movements at 0 kg -> bodyweight. High confidence: a
-- pull-up cannot be performed against zero resistance, so 0 kg can only ever
-- have meant "just me".
update public.workout_log
   set load_mode = 'bodyweight', load_migration_status = 'converted'
 where load_migration_status = 'untouched'
   and coalesce(weight, 0) = 0
   and lower(exercise) ~ '(pull-?up|chin-?up|dip|push-?up|press-?up|muscle-?up|inverted row)';

-- C4. AMBIGUOUS: a bodyweight-family movement WITH a load. This is the
-- `76 kg x 12` / `96 kg x 8` / `30 kg x 10` case, and it is genuinely
-- undecidable from the data — added weight, assistance and a mistakenly
-- entered total all look identical. NOTHING is converted; the rows keep
-- their original mode and value and are flagged so the app can offer the
-- athlete a one-tap reinterpretation later.
--
-- 'Assisted ...' is the one sub-case we could arguably auto-convert, but a
-- machine's stack number and an added-plate number are the same shape, and
-- being wrong here silently rewrites someone's training history.
update public.workout_log
   set load_migration_status = 'ambiguous'
 where load_migration_status = 'untouched'
   and coalesce(weight, 0) > 0
   and lower(exercise) ~ '(pull-?up|chin-?up|dip|push-?up|press-?up|muscle-?up)';

-- C5. Everything else is ordinary external load and is already correct.
-- No statement needed: 'external' / 'untouched' are the column defaults.

-- Historical bodyweight snapshots are NOT invented. bodyweight_snapshot_kg
-- stays null for every converted row: we know what the athlete weighed today,
-- not what they weighed in March. Effective resistance for those rows is
-- therefore null, and the app excludes them rather than guessing.

commit;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (tested shape; run inside a transaction)
-- ─────────────────────────────────────────────────────────────────────────
-- The client tolerates these columns being absent (missing-column reads
-- degrade to 'external'), so a rollback is safe with the app still deployed.
--
--   begin;
--   update public.workout_log set weight = legacy_weight where legacy_weight is not null;
--   alter table public.workout_log
--     drop constraint if exists workout_log_load_parts_check,
--     drop constraint if exists workout_log_load_mode_check,
--     drop constraint if exists workout_log_assistance_type_check,
--     drop constraint if exists workout_log_migration_status_check;
--   alter table public.workout_log
--     drop column if exists load_mode,
--     drop column if exists external_load_kg,
--     drop column if exists assistance_kg,
--     drop column if exists assistance_type,
--     drop column if exists assistance_description,
--     drop column if exists bodyweight_snapshot_kg,
--     drop column if exists duration_seconds,
--     drop column if exists distance_meters,
--     drop column if exists reps_per_side,
--     drop column if exists load_migration_status,
--     drop column if exists legacy_weight;
--   commit;
