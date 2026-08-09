begin;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
create temp table d(ord serial, k text, v jsonb);

-- Real athlete, real schedule, real history. Jesse trains today.
do $$
declare u uuid := '49fda21a-2651-430c-87d7-e28cb1cac0ea';
        o uuid := '26ef77d9-4d6e-4967-898f-a614cc80255a';
        sched text[]; ex1 text; ex2 text; ex3 text; w1 numeric; r1 int;
begin
  delete from public.workout_callouts where athlete_id = u and workout_date = current_date;
  sched := public.scheduled_workouts_on(u, current_date);

  select exercise, max(weight), max(reps) into ex1, w1, r1 from public.workout_log
   where user_id=u and weight>0 and reps>0 and date >= current_date-30 group by exercise order by 1 limit 1;
  select exercise into ex2 from public.workout_log
   where user_id=u and weight>0 and reps>0 and date >= current_date-30 and exercise<>ex1 group by exercise order by 1 limit 1;
  select exercise into ex3 from public.workout_log
   where user_id=u and weight>0 and reps>0 and date >= current_date-30 and exercise not in (ex1,ex2) group by exercise order by 1 limit 1;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u), true);

  -- 1. FIRST PLEDGE IS UNBOUNDED. No cap, no ceiling — max_stake null.
  insert into d(k,v) select 'a_first_allowance', public.forge_trial_allowance(ex1, current_date);

  -- 2. A BIG FIRST PLEDGE GOES THROUGH. 400 would have been refused at the old 150.
  begin
    perform public.callout_create(o, current_date, sched[1]::text, ex1::text, 1, r1, 'external'::text, w1,
                                  w1::text||' kg x '||r1::text, 400);
    insert into d(k,v) values ('b_pledge_400', to_jsonb('ACCEPTED'::text));
  exception when others then insert into d(k,v) values ('b_pledge_400', to_jsonb(('REFUSED: '||sqlerrm)::text)); end;

  -- 3. ESCALATION STILL BITES: next may be at most 2 x 400.
  insert into d(k,v) select 'c_next_allowance', public.forge_trial_allowance(ex2, current_date);
  begin
    perform public.callout_create(o, current_date, sched[1]::text, ex2::text, 1, 5, 'external'::text,
                                  (select max(weight) from public.workout_log where user_id=u and exercise=ex2),
                                  '900 test'::text, 900);
    insert into d(k,v) values ('d_escalate_900', to_jsonb('ACCEPTED — BRAKE GONE, BUG'::text));
  exception when others then insert into d(k,v) values ('d_escalate_900', to_jsonb(('refused: '||sqlerrm)::text)); end;

  -- 4. ONE PER EXERCISE PER SESSION still bites.
  begin
    perform public.callout_create(o, current_date, sched[1]::text, ex1::text, 2, r1, 'external'::text, w1, '50 test'::text, 50);
    insert into d(k,v) values ('e_same_exercise', to_jsonb('ACCEPTED — BRAKE GONE, BUG'::text));
  exception when others then insert into d(k,v) values ('e_same_exercise', to_jsonb(('refused: '||sqlerrm)::text)); end;

  -- 5. A MISS STILL ENDS THE DAY.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.workout_callouts set status='settled', result='miss'
   where athlete_id=u and workout_date=current_date;
  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u), true);
  insert into d(k,v) select 'f_after_miss', public.forge_trial_allowance(ex3, current_date);
  begin
    perform public.callout_create(o, current_date, sched[1]::text, ex3::text, 1, 5, 'external'::text,
                                  (select max(weight) from public.workout_log where user_id=u and exercise=ex3),
                                  '10 test'::text, 10);
    insert into d(k,v) values ('g_pledge_after_miss', to_jsonb('ACCEPTED — BRAKE GONE, BUG'::text));
  exception when others then insert into d(k,v) values ('g_pledge_after_miss', to_jsonb(('refused: '||sqlerrm)::text)); end;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select jsonb_pretty(jsonb_object_agg(k,v order by ord)) as r from d;
rollback;
