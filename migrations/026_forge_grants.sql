-- EvoForge 026 — PROGRESSION_OVERHAUL P4: server-granted Forge XP +
-- weekly_momentum + the idempotent history migration.
--
-- Two SECURITY DEFINER claim functions (the 013 coin pattern — the server
-- re-proves the evidence, the unique event_key absorbs repeats):
--
--   forge_claim_weekly(week_start) — counts the caller's DISTINCT trained
--     days (valid sets: weight>0 AND reps>0) in that COMPLETED week vs
--     their weekly_target: >=100% -> 250 XP, >=80% -> 150 XP, else nothing.
--     Key weekly_target:{week_start}. Also upserts weekly_momentum.
--
--   forge_migrate_history() — the ONE-SHOT §43 conversion: every distinct
--     historical (date, workout) session pair earns workout_completed 100
--     XP under key migration:v1:workout:{date}:{workout}; the caller's
--     legacy level/xp (xp_events-derived) is FROZEN into user_progression.
--     Rerun-safe: on conflict do nothing, and the legacy freeze only
--     writes when null.
--
-- FALSIFICATION: run migrate as ALPHA -> N grants; rerun -> 0 new rows;
-- weekly claim on an incomplete week -> 'not_met'; on a complete PAST
-- week -> granted once, second call 'already_claimed'.

create table if not exists public.weekly_momentum (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid()
                     references auth.users(id) on delete cascade,
  week_start         date not null,
  target_sessions    integer not null check (target_sessions between 1 and 7),
  completed_sessions integer not null default 0,
  completion_ratio   numeric(4,3) not null default 0,
  status             text not null default 'pending'
                     check (status in ('pending','success','partial','missed','bridged')),
  recovery_week_used boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, week_start)
);

alter table public.weekly_momentum enable row level security;
create policy "own momentum select" on public.weekly_momentum
  for select using (user_id = auth.uid());
create policy "own momentum insert" on public.weekly_momentum
  for insert with check (user_id = auth.uid());
create policy "own momentum update" on public.weekly_momentum
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Amend 023's guard: inserts arriving through SECURITY DEFINER functions
-- execute as the function owner (postgres), not the 'authenticated' role —
-- a distinction a client cannot forge through PostgREST. Those grants are
-- the server's own and pass; direct client inserts still hit the kind
-- allowlist below.
create or replace function public.xp_ledger_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role' then
    return new;
  end if;
  if current_user not in ('authenticated', 'anon') then
    return new; -- a security-definer grant function is speaking
  end if;

  if new.user_id is distinct from auth.uid() then
    raise exception 'xp_ledger: cannot write another user''s ledger';
  end if;

  case new.event_type
    when 'workout_completed' then
      if not exists (
        select 1 from public.workout_sessions ws
        where ws.user_id = auth.uid() and ws.id::text = new.source_id
      ) then
        raise exception 'xp_ledger: workout_completed needs a real finish marker';
      end if;
      new.xp_awarded := 100;
    when 'weekly_checkin' then
      new.xp_awarded := 20;
    when 'cardio_test_completed' then
      new.xp_awarded := 50;
    when 'evo_scan_completed' then
      new.xp_awarded := 40;
    else
      raise exception 'xp_ledger: kind % is server-granted only', new.event_type;
  end case;

  return new;
end;
$$;

create or replace function public.forge_claim_weekly(p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_target integer;
  v_days integer;
  v_ratio numeric;
  v_xp integer := 0;
  v_key text;
begin
  if uid is null then
    return jsonb_build_object('granted', 0, 'reason', 'not_signed_in');
  end if;
  -- Only COMPLETED weeks are judged (the week must have ended).
  if p_week_start + 7 > current_date then
    return jsonb_build_object('granted', 0, 'reason', 'week_not_finished');
  end if;

  select coalesce(weekly_target, 3) into v_target
  from public.user_progression where user_id = uid;
  if v_target is null then v_target := 3; end if;

  select count(distinct date) into v_days
  from public.workout_log
  where user_id = uid
    and date >= p_week_start and date < p_week_start + 7
    and coalesce(weight, 0) > 0 and coalesce(reps, 0) > 0;

  v_ratio := v_days::numeric / v_target;
  if v_ratio >= 1 then v_xp := 250;
  elsif v_ratio >= 0.8 then v_xp := 150;
  end if;

  insert into public.weekly_momentum (user_id, week_start, target_sessions, completed_sessions, completion_ratio, status)
  values (uid, p_week_start, v_target, v_days, least(v_ratio, 9.999),
          case when v_ratio >= 1 then 'success' when v_ratio >= 0.8 then 'partial' else 'missed' end)
  on conflict (user_id, week_start) do update
    set completed_sessions = excluded.completed_sessions,
        completion_ratio = excluded.completion_ratio,
        status = excluded.status,
        updated_at = now();

  if v_xp = 0 then
    return jsonb_build_object('granted', 0, 'reason', 'not_met', 'days', v_days, 'target', v_target);
  end if;

  v_key := 'weekly_target:' || p_week_start::text;
  insert into public.xp_ledger (user_id, event_key, event_type, source_id, xp_awarded)
  values (uid, v_key, 'weekly_target', p_week_start::text, v_xp)
  on conflict (user_id, event_key) do nothing;
  if not found then
    return jsonb_build_object('granted', 0, 'reason', 'already_claimed');
  end if;
  return jsonb_build_object('granted', v_xp, 'reason', 'granted', 'days', v_days, 'target', v_target);
end;
$$;

-- ---------------------------------------------------------------------
create or replace function public.forge_migrate_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_new integer := 0;
  v_legacy_xp bigint;
begin
  if uid is null then
    return jsonb_build_object('migrated', 0, 'reason', 'not_signed_in');
  end if;

  -- Every distinct historical session -> one idempotent 100 XP grant.
  with sessions as (
    select distinct date, workout
    from public.workout_log
    where user_id = uid
      and coalesce(weight, 0) > 0 and coalesce(reps, 0) > 0
  ), ins as (
    insert into public.xp_ledger (user_id, event_key, event_type, source_id, xp_awarded)
    select uid,
           'migration:v1:workout:' || date::text || ':' || workout,
           'workout_completed_migrated',
           date::text,
           100
    from sessions
    on conflict (user_id, event_key) do nothing
    returning 1
  )
  select count(*) into v_new from ins;

  -- Freeze the legacy public level ONCE (xp_events total; the old curve
  -- lives in app code — we store raw XP and the app derives for display).
  select coalesce(sum(amount), 0) into v_legacy_xp
  from public.xp_events where user_id = uid;

  update public.user_progression
  set legacy_xp = coalesce(legacy_xp, v_legacy_xp),
      migration_version = coalesce(migration_version, 'v1'),
      updated_at = now()
  where user_id = uid;
  if not found then
    insert into public.user_progression (user_id, legacy_xp, migration_version)
    values (uid, v_legacy_xp, 'v1')
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('migrated', v_new, 'legacy_xp', v_legacy_xp, 'reason', 'ok');
end;
$$;
