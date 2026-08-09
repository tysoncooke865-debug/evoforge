-- Falsify migration 163 against production, inside a transaction that rolls back.
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table proof (ord serial, k text, v jsonb);

-- ALPHA: a known schedule and a known best. Monday(1) = "Push 1 - Strength".
delete from public.workout_callouts
 where athlete_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'
    or opponent_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
-- Only the plan of the LATEST row: effective_from is part of the primary key, and
-- rewriting it collided with an existing schedule row.
update public.workout_schedule
   set plan = '{"0":"Rest","1":"Push 1 - Strength","2":"Pull 1","3":"Rest","4":"Push 1 - Strength","5":"Rest","6":"Rest"}'::jsonb
 where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'
   and effective_from = (select max(effective_from) from public.workout_schedule
                          where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1');

-- Real history for every exercise the test pledges on. Without it the
-- programmed-target wall refuses them first and the brake is never reached — which
-- is exactly what happened on the first run, and made four assertions vacuous.
insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', current_date - 10, 'P163', 'Bench Press',
        'chest', 1, 5, 100, now() - interval '10 days'),
       ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', current_date - 10, 'P163', 'Overhead Press',
        'shoulders', 1, 5, 60, now() - interval '10 days'),
       ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', current_date - 10, 'P163', 'Incline Press',
        'chest', 1, 5, 70, now() - interval '10 days');

-- Find a date that IS "Push 1 - Strength" and one that is Rest.
insert into proof (k, v) select 'a_schedule', jsonb_build_object(
  'push_day', (select min(d)::text from generate_series(current_date, current_date + 6, '1 day') d
               where public.scheduled_workout_on('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', d::date) = 'Push 1 - Strength'),
  'rest_day', (select min(d)::text from generate_series(current_date, current_date + 6, '1 day') d
               where public.scheduled_workout_on('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', d::date) is null));

-- 1. THE PROGRAMMED-TARGET TEST, exactly.
insert into proof (k, v) select 'b_programmed', jsonb_build_object(
  'at_best_100kg',   public.is_programmed_target('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1','Bench Press','external',100,5),
  'below_90kg',      public.is_programmed_target('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1','Bench Press','external',90,5),
  'above_105kg_PR',  public.is_programmed_target('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1','Bench Press','external',105,5),
  'more_reps_same_load', public.is_programmed_target('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1','Bench Press','external',100,10),
  'never_done_it',   public.is_programmed_target('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1','Zercher Squat','external',60,5));

-- Helper: try an insert as the athlete and report what happened.
create or replace function pg_temp.try_pledge(
  p_date date, p_workout text, p_exercise text, p_weight numeric, p_reps int, p_stake int
) returns text language plpgsql as $$
begin
  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
    set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake, status,
    expires_at)
  values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', '699ddb56-69b5-4070-854b-df73f578f19b',
          '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', p_date, p_workout, p_exercise,
          1, p_reps, 'external', p_weight, p_weight || ' kg x ' || p_reps, p_stake, 'offered',
          now() + interval '1 day');
  return 'ALLOWED';
exception when others then
  return sqlerrm;
end;
$$;

select set_config('request.jwt.claims',
  '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);

do $$
declare push_day date; rest_day date;
begin
  select min(d)::date into push_day from generate_series(current_date, current_date + 6, '1 day') d
   where public.scheduled_workout_on('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', d::date) = 'Push 1 - Strength';
  select min(d)::date into rest_day from generate_series(current_date, current_date + 6, '1 day') d
   where public.scheduled_workout_on('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', d::date) is null;

  -- 2. A REST DAY IS REFUSED.
  insert into proof (k, v) values ('c_rest_day',
    to_jsonb(pg_temp.try_pledge(rest_day, 'Push 1 - Strength', 'Bench Press', 90, 5, 25)));

  -- 3. THE WRONG WORKOUT IS REFUSED.
  insert into proof (k, v) values ('d_wrong_workout',
    to_jsonb(pg_temp.try_pledge(push_day, 'Pull 1', 'Bench Press', 90, 5, 25)));

  -- 4. A PR ATTEMPT IS REFUSED.
  insert into proof (k, v) values ('e_pr_attempt',
    to_jsonb(pg_temp.try_pledge(push_day, 'Push 1 - Strength', 'Bench Press', 105, 5, 25)));

  -- 5. AN IN-PROGRAM TARGET IS ALLOWED.
  insert into proof (k, v) values ('f_in_program',
    to_jsonb(pg_temp.try_pledge(push_day, 'Push 1 - Strength', 'Bench Press', 90, 5, 25)));

  -- 6. ONE TRIAL PER EXERCISE PER SESSION.
  insert into proof (k, v) values ('g_second_same_exercise',
    to_jsonb(pg_temp.try_pledge(push_day, 'Push 1 - Strength', 'Bench Press', 85, 5, 25)));

  -- 7. ESCALATION: the first pledge was 25, so at most 50 next.
  insert into proof (k, v) values ('h_escalation_over',
    to_jsonb(pg_temp.try_pledge(push_day, 'Push 1 - Strength', 'Overhead Press', 40, 5, 120)));
  insert into proof (k, v) select 'i_allowance', public.forge_trial_allowance('Overhead Press', push_day);
end $$;

-- 8. A MISS ENDS THE DAY.
do $$
declare push_day date;
begin
  select min(d)::date into push_day from generate_series(current_date, current_date + 6, '1 day') d
   where public.scheduled_workout_on('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', d::date) = 'Push 1 - Strength';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- A miss is result='miss' on a settled row. There is no 'lost' status.
  update public.workout_callouts set status = 'settled', result = 'miss'
   where athlete_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and workout_date = push_day;
  perform set_config('request.jwt.claims',
    '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);
  insert into proof (k, v) values ('j_after_a_miss',
    to_jsonb(pg_temp.try_pledge(push_day, 'Push 1 - Strength', 'Incline Press', 40, 5, 25)));
  insert into proof (k, v) select 'k_allowance_after_miss',
    public.forge_trial_allowance('Incline Press', push_day);
end $$;

-- 9. NO ODDS COLUMNS SURVIVE.
insert into proof (k, v) select 'l_odds_columns', to_jsonb(coalesce(string_agg(column_name, ', '), 'none'))
  from information_schema.columns
  where table_schema = 'public' and table_name = 'workout_callouts' and column_name ilike '%odds%';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select jsonb_pretty(jsonb_object_agg(k, v order by ord)) as proof from proof;
rollback;
