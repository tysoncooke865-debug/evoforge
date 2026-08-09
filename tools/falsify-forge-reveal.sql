-- Falsify migration 161 against production, inside a transaction that rolls back.
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table proof (ord serial, k text, v jsonb);

-- ALPHA needs a clean slate for today and a prior best to beat.
delete from public.forge_reveals where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';

-- A prior best: 100 kg x 5 on Deadlift, a week ago.
insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', current_date - 7, 'P161', 'Deadlift',
        'back', 1, 5, 100, now() - interval '7 days');

-- Three candidate sets today: a tiny gain, a real gain, and an extra rep.
insert into public.workout_log (id, user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
values ('00000000-0000-4000-8000-00000161a001', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1',
        current_date, 'P161', 'Deadlift', 'back', 2, 5, 101, now()),
       ('00000000-0000-4000-8000-00000161a002', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1',
        current_date, 'P161', 'Deadlift', 'back', 3, 5, 105, now() + interval '1 min'),
       ('00000000-0000-4000-8000-00000161a003', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1',
        current_date, 'P161', 'Deadlift', 'back', 4, 6, 100, now() + interval '2 min');

-- 1. THE QUALIFYING-PR THRESHOLD. +1 kg is a PR for coins but NOT for a reveal.
insert into proof (k, v) select 'a_pr_threshold', jsonb_build_object(
  'plus_1kg',  public.is_qualifying_pr('00000000-0000-4000-8000-00000161a001', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'),
  'plus_5kg',  public.is_qualifying_pr('00000000-0000-4000-8000-00000161a002', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'),
  'plus_1rep', public.is_qualifying_pr('00000000-0000-4000-8000-00000161a003', '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'));

-- 2. GRANTING, AND THE CEILINGS.
insert into proof (k, v) select 'b_grant_workout', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'workout_complete',
    to_char(current_date, 'YYYY-MM-DD'), current_date, null) is not null);
insert into proof (k, v) select 'c_same_event_twice', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'workout_complete',
    to_char(current_date, 'YYYY-MM-DD'), current_date, null) is null);
insert into proof (k, v) select 'd_grant_pr', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'pr',
    '00000000-0000-4000-8000-00000161a002', current_date, 'Deadlift') is not null);
-- a THIRD reveal on the same day must be refused (2/day ceiling)
insert into proof (k, v) select 'e_third_today_refused', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'pr',
    '00000000-0000-4000-8000-00000161a003', current_date, 'Squat') is null);
-- and a second PR reveal for the SAME EXERCISE inside 7 days, on a later day
insert into proof (k, v) select 'f_pr_per_exercise_7d', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'pr',
    '00000000-0000-4000-8000-00000161a001', current_date + 1, 'Deadlift') is null);
-- a DIFFERENT exercise on a later day is fine
insert into proof (k, v) select 'g_other_exercise_ok', to_jsonb(
  public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'pr',
    '00000000-0000-4000-8000-00000161a003', current_date + 1, 'Bench Press') is not null);
-- a third producer cannot exist
do $$ begin
  begin
    perform public.forge_reveal_grant('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1',
      'app_open', 'x', current_date, null);
    insert into proof (k, v) values ('h_third_producer', '"ALLOWED — BUG"');
  exception when others then
    insert into proof (k, v) values ('h_third_producer', to_jsonb(sqlerrm));
  end;
end $$;

-- 3. CLAIMING. As the athlete, so the definer bodies authorise as a client's would.
select set_config('request.jwt.claims',
  '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);

insert into proof (k, v) select 'i_balance_before', to_jsonb(public.coin_total_exact());
insert into proof (k, v) select 'j_claim', public.forge_reveal_claim(
  (select id from public.forge_reveals
    where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and claimed_at is null
    order by granted_at limit 1));
insert into proof (k, v) select 'k_balance_after', to_jsonb(public.coin_total_exact());

-- 4. A SECOND CLAIM OF THE SAME REVEAL PAYS NOTHING MORE.
insert into proof (k, v) select 'l_replay', public.forge_reveal_claim(
  (select id from public.forge_reveals
    where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and claimed_at is not null
    order by claimed_at limit 1));
insert into proof (k, v) select 'm_balance_after_replay', to_jsonb(public.coin_total_exact());

-- 5. INVARIANT 1: the claim can only ever raise a balance.
insert into proof (k, v) select 'n_ledger_rows', jsonb_build_object(
  'rows', count(*), 'min_amount', min(amount), 'all_positive', bool_and(amount > 0))
  from public.coin_events
  where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and kind = 'reveal_bonus';

-- 6. A HAND-WRITTEN CLAIM CANNOT INVENT ITS AMOUNT.
do $$
declare rid uuid;
begin
  select id into rid from public.forge_reveals
   where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and claimed_at is not null limit 1;
  begin
    insert into public.coin_events (user_id, kind, amount, source_id)
    values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'reveal_bonus', 9999, rid::text);
    insert into proof (k, v) values ('o_forged_amount', '"ALLOWED — BUG"');
  exception when others then
    insert into proof (k, v) values ('o_forged_amount', to_jsonb(sqlerrm));
  end;
end $$;

-- 7. THE PUBLISHED TABLE IS VISIBLE BEFORE A CLAIM, and its shape is §3's.
insert into proof (k, v) select 'p_table', jsonb_build_object(
  'rows', count(*), 'total_weight', sum(weight),
  'ev', round(sum(coins * weight)::numeric / sum(weight), 2),
  'min_coins', min(coins))
  from public.forge_reveal_table where version = 1;

-- 8. ANOTHER ATHLETE'S REVEAL IS NOT CLAIMABLE.
do $$
declare rid uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"699ddb56-69b5-4070-854b-df73f578f19b","role":"authenticated"}', true);
  select id into rid from public.forge_reveals
   where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' and claimed_at is null limit 1;
  begin
    perform public.forge_reveal_claim(rid);
    insert into proof (k, v) values ('q_others_reveal', '"ALLOWED — BUG"');
  exception when others then
    insert into proof (k, v) values ('q_others_reveal', to_jsonb(sqlerrm));
  end;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select jsonb_pretty(jsonb_object_agg(k, v order by ord)) as proof from proof;
rollback;
