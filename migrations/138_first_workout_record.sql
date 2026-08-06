-- EvoForge 138 — THE FIRST WORKOUT IS A RECORD, NOT AN INFERENCE.
--
-- THE BUG (Tyson, 2026-08-06): after tapping START FIRST WORKOUT, Train still
-- said "YOUR FIRST WORKOUT / START FIRST WORKOUT". Tapping it again reopened
-- the same day, which is harmless — nothing is created until a set is logged
-- — but it reads as "that did not work", and inviting a second tap on a
-- create-shaped button is how confusing duplicates get made.
--
-- WHY THE CLIENT COULD NOT ALREADY TELL. Every signal it had was derived:
--
--   * `workout_log` rows      — zero until the first SET lands, so a workout
--                               opened and not yet logged looks untouched;
--   * `workout_sessions`      — finish markers only;
--   * the session store's
--     `activeWorkout`         — persisted, but in AsyncStorage: per device,
--                               and `signOut` clears every store by doctrine.
--
-- So "have they started their first workout?" had no durable answer, and the
-- CTA fell back to `completedSets > 0`, which is exactly the wrong question.
--
-- WHAT THIS STORES. When, and WHICH workout — so the CTA can resume the same
-- session rather than re-deriving one and risking a different answer after a
-- plan edit. The date is the athlete's LOCAL calendar date (domain/today.ts),
-- matching `workout_log.date`, so the two can be compared without timezone
-- arithmetic.
--
-- WRITE-ONCE. The first answer wins: a second tap, a retry, a second device
-- and a re-login all converge on the same record. That is what makes the CTA
-- idempotent, and it is enforced here rather than trusted to every caller.
--
-- Purely additive, nullable, owner-only RLS inherited from `profile`.
-- Apply by hand via the management API (HANDOVER §5), falsify, THEN ship.

begin;

alter table public.profile
  add column if not exists first_workout_at timestamptz,
  add column if not exists first_workout_name text,
  add column if not exists first_workout_date date;

comment on column public.profile.first_workout_at is
  'When the athlete first OPENED their first workout. NULL = never started. Independent of whether a set was logged.';
comment on column public.profile.first_workout_name is
  'Which workout was opened, so the CTA resumes that one rather than re-deriving.';
comment on column public.profile.first_workout_date is
  'The athlete''s LOCAL calendar date for that session — same basis as workout_log.date.';

create or replace function public.profile_first_workout_guard()
returns trigger
language plpgsql
as $$
begin
  -- Once is once. A second tap cannot move the record, and nothing can clear
  -- it — clearing is what would make START come back after RESUME.
  if old.first_workout_at is not null then
    new.first_workout_at := old.first_workout_at;
    new.first_workout_name := old.first_workout_name;
    new.first_workout_date := old.first_workout_date;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_first_workout_guard_trigger on public.profile;
create trigger profile_first_workout_guard_trigger
  before update on public.profile
  for each row execute function public.profile_first_workout_guard();

commit;
