-- EvoForge 066 — the weekly schedule learns a SOURCE per day
--
-- The schedule stored only a day NAME per weekday (012's `plan` jsonb,
-- '0'..'6' → name | 'Rest'), and every day's exercises came from ONE global
-- plan source (profile.active_plan_source, migration 035). Athletes wanted a
-- week that MIXES sources: AI push Monday, my-plan legs Wednesday, built-in
-- pull Friday. This adds a PARALLEL map so each day can name its own source.
--
-- WHY A NEW COLUMN, NOT A RESHAPED `plan`: the streak function
-- scheduled_streak() (012) and its client twins read `plan ->> dow` as a
-- plain string and compare to 'Rest'. Nesting the source inside `plan` would
-- break that (`->>` on an object returns JSON text, and the 'Rest' test would
-- silently fail — the coin guard of 013 rides on it). A separate `sources`
-- jsonb column leaves `plan` and every existing reader byte-for-byte
-- untouched: nothing that doesn't opt in changes.
--
--   sources: jsonb, nullable. '0'..'6' → SourceIndex smallint (0 my plan,
--   1 AI plan, 2 built-in). A day absent from the map (or the whole column
--   null) follows the global plan source, exactly as before.
--
-- No RLS/policy change: the row's owner-only policies (012) already cover
-- every column; the insert/update guard still keys on effective_from.
--
-- Falsification (run after applying, as ALPHA):
--   (a) an existing schedule still reads + trains identically (sources null).
--   (b) EDIT SCHEDULE saving a mixed week persists `sources`; today.tsx
--       resolves each day from its own source; the streak is unaffected.

alter table public.workout_schedule
  add column if not exists sources jsonb;

comment on column public.workout_schedule.sources is
  'PER-DAY SOURCE (066): jsonb map ''0''..''6'' (getUTCDay) -> SourceIndex '
  '(0 my plan / 1 ai plan / 2 built-in). Null or a missing day = follow the '
  'global plan source. Parallel to plan so scheduled_streak() (which reads '
  'plan->>dow as a string) is untouched.';
