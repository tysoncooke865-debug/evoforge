-- EvoForge 062 — ONE HOME FOR PLANS (audit C2/A3, Tyson's call, 2026-07-19).
--
-- Plans lived in two places: user_plans (kind 'custom'|'ai', the 018 home)
-- and custom_workout_plan (the pre-018 row-per-exercise slot, kept because
-- Streamlit read it). Streamlit is retired; the split caused the DISCARD
-- bug (delete one home, the plan survives in the other) and doubled every
-- write. This migration is the ONE-SHOT copy: each user's legacy plan is
-- grouped exactly the way the client's groupPlanRows() did (newest
-- plan_name wins, timestamp order, canonical week order when every day is
-- built-in) and lands in the user_plans slot the client would have
-- resolved it into (looksLikeAiPlan: every day canonical → 'ai', else
-- 'custom') — ONLY where that slot is empty (resolvePlanSources gave
-- user_plans priority, so a filled slot already shadowed the legacy plan).
--
-- custom_workout_plan itself STAYS (owner-RLS'd history; nothing reads or
-- writes it after the client commit that rides with this migration).
--
-- FALSIFICATION CHECKLIST:
--  1. a user with legacy rows + empty user_plans → gains exactly one row,
--     payload matches groupPlanRows' shape (spot-check day order + fields).
--  2. a user whose slot is already filled → untouched (0 new rows).
--  3. re-run → 0 new rows (idempotent).
--  4. cross-user: the copy writes each user's own rows only.

with legacy as (
  select
    c.user_id,
    c.plan_name,
    c.workout,
    c.exercise,
    c.sets,
    c.reps,
    c.reason,
    c.day_goal,
    c."timestamp"
  from public.custom_workout_plan c
),
newest as (
  -- groupPlanRows: the plan_name of the newest row wins.
  select distinct on (user_id) user_id, plan_name
  from legacy
  order by user_id, "timestamp" desc
),
mine as (
  select l.*
  from legacy l
  join newest n on n.user_id = l.user_id and coalesce(l.plan_name, '') = coalesce(n.plan_name, '')
),
day_rows as (
  select
    user_id,
    workout as day,
    coalesce(max(day_goal), '') as goal,
    min("timestamp") as first_ts,
    jsonb_agg(
      jsonb_build_object(
        'exercise', coalesce(exercise, ''),
        'sets', coalesce(sets, 3),
        'reps', coalesce(reps, ''),
        'reason', coalesce(reason, '')
      )
      order by "timestamp" asc
    ) as exercises
  from mine
  group by user_id, workout
),
flags as (
  -- looksLikeAiPlan: EVERY day name is one of the canonical six.
  select
    user_id,
    bool_and(day in (
      'Push 1 - Strength', 'Pull 1 - Back Thickness', 'Push 2 - Hypertrophy',
      'Pull 2 - Width / V-Taper', 'Legs', 'Aesthetics'
    )) as all_canonical
  from day_rows
  group by user_id
),
plans as (
  select
    d.user_id,
    (select n.plan_name from newest n where n.user_id = d.user_id) as plan_name,
    f.all_canonical,
    jsonb_build_object(
      'plan_name', coalesce((select n.plan_name from newest n where n.user_id = d.user_id), 'My Plan'),
      'rationale', '',
      'days', jsonb_agg(
        jsonb_build_object('day', d.day, 'goal', d.goal, 'exercises', d.exercises)
        order by
          -- canonical week order for all-canonical plans, else own (timestamp) order
          case when f.all_canonical then
            array_position(
              array['Push 1 - Strength','Pull 1 - Back Thickness','Push 2 - Hypertrophy',
                    'Pull 2 - Width / V-Taper','Legs','Aesthetics'],
              d.day
            )
          else null end,
          d.first_ts asc
      )
    ) as payload
  from day_rows d
  join flags f on f.user_id = d.user_id
  group by d.user_id, f.all_canonical
)
insert into public.user_plans (user_id, kind, name, payload)
select
  p.user_id,
  case when p.all_canonical then 'ai' else 'custom' end,
  coalesce(nullif(trim(p.plan_name), ''), 'My Plan'),
  p.payload
from plans p
where not exists (
  select 1 from public.user_plans u
  where u.user_id = p.user_id
    and u.kind = case when p.all_canonical then 'ai' else 'custom' end
);
