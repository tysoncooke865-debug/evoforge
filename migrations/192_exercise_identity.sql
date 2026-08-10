-- EvoForge 192 — CANONICAL EXERCISE IDENTITY on the log
-- (the training-system upgrade, 2026-08-10).
--
-- THE PROBLEM. `workout_log.exercise` is a free-text column and it has been
-- doing the job of a primary key for exercise identity. So the moment an AI
-- plan wrote `Bench Press (Strength Focused)` instead of `Bench Press`, four
-- years of history stopped existing: no "last time", no prefill, and a PR
-- baseline of zero. Identity cannot be a string a language model retypes.
--
-- WHAT THIS MIGRATION IS, AND IS NOT.
--
-- It is ONE NULLABLE COLUMN and one index. It is not the mechanism. The
-- client derives the same id from the name on read (client/src/domain/
-- exercise-identity.ts), which is why this could ship without a flag day: an
-- un-backfilled row and a backfilled row answer the same question, one of
-- them a few microseconds slower. This column exists so that FUTURE
-- server-side work — strength graphs, plateau detection, exercise PR history,
-- volume progression — can `group by exercise_id` instead of re-deriving the
-- resolver in SQL.
--
--   * NOT NULL is deliberately NOT set. Every write path already tolerates
--     this column's absence (set-save.ts strips it and retries), and a NOT
--     NULL would turn any client running ahead of the resolver into a failed
--     save. A null here means "derive it", which is always available.
--   * No CHECK, no foreign key. There is no exercise table to point at: the
--     catalogue lives in TypeScript (exercise-ids.generated.ts) because that
--     is where the 1,099 library entries already live, and a second copy in
--     Postgres would be a second source of truth to drift.
--   * `exercise` IS UNTOUCHED. It stays exactly the string the athlete saw
--     when they logged the set. Nothing renames history.
--
-- THE ID FORMAT, so a future reader can reproduce it without the client:
--   lowercase, drop apostrophes, fold every other non-alphanumeric run to a
--   single space, trim, then replace spaces with underscores.
--     'Barbell Bench Press'  -> 'barbell_bench_press'
--     "Farmer's Walk"        -> 'farmers_walk'
--     'T-Bar Row'            -> 't_bar_row'
--   Two id namespaces are reserved: 'custom_<uuid>' for a user_exercises row,
--   and 'name_<slug>' for a name nothing in the catalogue recognises.
--
-- RLS is untouched: workout_log's owner-only policies cover every column, and
-- adding one does not widen them.
--
-- FALSIFICATION CHECKLIST (as ALPHA, seed -> assert -> delete):
--  1. `select count(*) from workout_log` is IDENTICAL before and after.
--  2. an existing row's exercise / weight / reps / date / set are unchanged.
--  3. a set saved by the live client lands with a populated exercise_id.
--  4. a set saved with exercise_id omitted still inserts (column is nullable).
--  5. select as BRAVO returns none of ALPHA's rows (RLS intact).

begin;

alter table public.workout_log
  add column if not exists exercise_id text;

comment on column public.workout_log.exercise_id is
  'Canonical exercise identity (2026-08-10). Derived from the display name: '
  'lowercase, apostrophes dropped, non-alphanumeric runs folded to underscores. '
  'Nullable — the client derives the same value from `exercise` when absent. '
  'Namespaces: <catalogue slug> | custom_<user_exercises.id> | name_<slug>.';

-- The access pattern every history read has: this athlete, this exercise,
-- most recent first. Partial on NOT NULL so the index stays small until the
-- backfill (193) has run, and never carries the rows it cannot answer for.
create index if not exists workout_log_user_exercise_id_date_idx
  on public.workout_log (user_id, exercise_id, date desc)
  where exercise_id is not null;

commit;
