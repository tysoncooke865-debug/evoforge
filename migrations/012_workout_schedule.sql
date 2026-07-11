-- EvoForge 012 — the weekly schedule + the streak's server-side mirror
-- (IMPROVEMENT_PLAN #11). Additive; Streamlit never reads either object.
--
-- workout_schedule is EFFECTIVE-DATED: judging a past day needs the plan
-- that was in force THEN. RLS forbids backdating beyond one day, so a
-- broken streak cannot be retroactively "rescheduled" into rest days.
-- plan jsonb keys are JS getDay() strings '0'..'6' (UTC-date-derived, the
-- same toISOString convention every date in this app already uses);
-- values are the six live PPPPLA day names or 'Rest'.
--
-- scheduled_streak() exists ONLY so migration 013's coin guard can verify
-- milestone claims server-side; execute is revoked from authenticated.
-- It must move in lockstep with client/src/domain/scheduled-streak.ts —
-- both carry this comment, and the client's fixture suite doubles as the
-- reference behaviour.

create table if not exists public.workout_schedule (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  effective_from date not null,
  plan           jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, effective_from)
);

alter table public.workout_schedule enable row level security;

drop policy if exists workout_schedule_owner_select on public.workout_schedule;
create policy workout_schedule_owner_select on public.workout_schedule
  for select to authenticated using (user_id = auth.uid());

drop policy if exists workout_schedule_owner_insert on public.workout_schedule;
create policy workout_schedule_owner_insert on public.workout_schedule
  for insert to authenticated
  with check (user_id = auth.uid() and effective_from >= current_date - 1);

drop policy if exists workout_schedule_owner_update on public.workout_schedule;
create policy workout_schedule_owner_update on public.workout_schedule
  for update to authenticated
  using (user_id = auth.uid() and effective_from >= current_date - 1)
  with check (user_id = auth.uid() and effective_from >= current_date - 1);

-- Walk backwards from p_asof: completed scheduled days extend the run,
-- rest/unscheduled days bridge it, TODAY pending is skipped, a missed
-- scheduled day ends it. 1000-day cap.
create or replace function public.scheduled_streak(p_user uuid, p_asof date)
returns table (length int, run_start date)
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := p_asof;
  n int := 0;
  first_completed date := null;
  planned text;
  trained boolean;
  steps int := 0;
begin
  loop
    exit when steps >= 1000;
    steps := steps + 1;

    select ws.plan ->> extract(dow from d)::int::text into planned
    from public.workout_schedule ws
    where ws.user_id = p_user and ws.effective_from <= d
    order by ws.effective_from desc
    limit 1;

    if planned is null or planned = 'Rest' then
      -- rest / unscheduled: bridges, never breaks. But if the athlete has
      -- NO schedule at all ever, stop immediately (streak undefined).
      if not exists (select 1 from public.workout_schedule ws where ws.user_id = p_user and ws.effective_from <= d) then
        exit;
      end if;
      d := d - 1;
      continue;
    end if;

    select exists (
      select 1 from public.workout_log w
      where w.user_id = p_user and w.date = d and w.weight > 0 and w.reps > 0
    ) into trained;

    if trained then
      n := n + 1;
      first_completed := d;
      d := d - 1;
    elsif d = p_asof then
      -- today still pending: skip, don't break
      d := d - 1;
    else
      exit;
    end if;
  end loop;

  return query select n, first_completed;
end;
$$;

revoke all on function public.scheduled_streak(uuid, date) from authenticated, anon;
