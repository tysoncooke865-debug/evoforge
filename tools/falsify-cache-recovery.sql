-- Falsify 166 against production, inside a transaction that rolls back.
begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table proof (ord serial, k text, v jsonb);

delete from public.forge_cache_claims where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
delete from public.recovery_runs      where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';

-- Four distinct training days, twenty sets on one of them.
insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
select '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', current_date - d, 'P166', 'Bench Press',
       'chest', s, 8, 60, now() - make_interval(days => d)
from generate_series(1, 4) d, generate_series(1, case when d = 1 then 20 else 1 end) s;

select set_config('request.jwt.claims',
  '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);

-- 1. THE LADDER COUNTS DISTINCT DAYS, NOT SETS. Twenty sets in one evening must
--    not climb four rungs.
insert into proof (k, v) select 'a_state', public.forge_cache_state();

-- 2. CLAIM IT, then claim again.
insert into proof (k, v) select 'b_balance_before', to_jsonb(public.coin_total_exact());
insert into proof (k, v) select 'c_claim', public.forge_cache_claim();
insert into proof (k, v) select 'd_claim_again', public.forge_cache_claim();
insert into proof (k, v) select 'e_balance_after', to_jsonb(public.coin_total_exact());

-- 3. A FORGED CACHE ROW CANNOT INVENT ITS AMOUNT.
do $$
declare cid uuid;
begin
  select id into cid from public.forge_cache_claims
   where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1' limit 1;
  begin
    insert into public.coin_events (user_id, kind, amount, source_id)
    values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'forge_cache', 9999, cid::text);
    insert into proof (k, v) values ('f_forged_cache', '"ALLOWED — BUG"');
  exception when others then
    insert into proof (k, v) values ('f_forged_cache', to_jsonb(sqlerrm));
  end;
end $$;

-- 4. THE RECOVERY RUN NEEDS A REAL FLOOR. ALPHA is rich, so it must refuse.
insert into proof (k, v) select 'g_recovery_when_rich', public.recovery_run_state();
do $$ begin
  begin
    perform public.recovery_run_claim();
    insert into proof (k, v) values ('h_claim_when_rich', '"ALLOWED — BUG"');
  exception when others then
    insert into proof (k, v) values ('h_claim_when_rich', to_jsonb(sqlerrm));
  end;
end $$;

-- 5. NOW MAKE THEM BROKE, and the floor should appear.
do $$
declare bal numeric;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.coin_total_exact() into bal from (select 1) x;
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'adjustment',
          -(select round(coalesce(sum(amount),0),2) from public.coin_events
             where user_id = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1'),
          'p166-drain', 'harness');
  perform set_config('request.jwt.claims',
    '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);
end $$;
insert into proof (k, v) select 'i_recovery_when_broke', public.recovery_run_state();
insert into proof (k, v) select 'j_recovery_claim', public.recovery_run_claim();
insert into proof (k, v) select 'k_balance_after_recovery', to_jsonb(public.coin_total_exact());

-- 6. AND IT DOES NOT RE-ARM WITHOUT A GENUINE CLIMB BACK OUT.
do $$ begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.coin_events (user_id, kind, amount, source_id, source_table)
  values ('30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1', 'adjustment', -50, 'p166-drain2', 'harness');
  perform set_config('request.jwt.claims',
    '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);
end $$;
insert into proof (k, v) select 'l_second_run_state', public.recovery_run_state();
do $$ begin
  begin
    perform public.recovery_run_claim();
    insert into proof (k, v) values ('m_second_run_claim', '"ALLOWED — FARMABLE, BUG"');
  exception when others then
    insert into proof (k, v) values ('m_second_run_claim', to_jsonb(sqlerrm));
  end;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select jsonb_pretty(jsonb_object_agg(k, v order by ord)) as proof from proof;
rollback;
