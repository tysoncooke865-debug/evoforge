-- EvoForge 179 - GRACE DAYS AND A ONE-TAP PAUSE (Spec v5 §6).
--
-- §6: "grace days and streak protection on by default... one-tap pause for life
-- events... no stat loss for absence, illness, injury, or travel."
--
-- WHAT WAS ALREADY RIGHT, so this only adds what is missing. `scheduled_streak` is
-- plan-aware and a REST DAY BRIDGES rather than breaks, best is preserved, and
-- there is no "your streak is about to die" copy anywhere in the product. §6's
-- framing half was never the problem.
--
-- WHAT WAS MISSING is the other half: a missed PLANNED day broke the run outright,
-- with no grace and no way to say "I am injured". For a training app that is the
-- exact pressure §6 exists to remove - it rewards training through an illness.
--
-- ── TWO MECHANISMS, DELIBERATELY DIFFERENT ──
--
--   A PAUSE is declared, open-ended, and covers everything. Injury, illness,
--   travel. Days inside it BRIDGE exactly as a rest day does: they neither count
--   nor break. It is one tap to start and one to end, and it is not rationed,
--   because rationing "I broke my wrist" is the behaviour this rule forbids.
--
--   A GRACE DAY is automatic, silent, and rationed. Two per rolling 30 days by
--   default. It absorbs a missed planned day you did not declare - life happening
--   without paperwork. Rationed because unlimited grace means the streak measures
--   nothing at all.
--
-- ON BY DEFAULT, as §6 requires: `grace_per_30d` is 2 in config, so every athlete
-- has protection without finding a setting. Nothing needs switching on.
--
-- NEITHER IS A COIN MECHANIC. No RNG, no pledge, no balance touched, nothing
-- purchasable - a streak pause cannot be bought and grace cannot be topped up.
-- That matters: "buy a streak freeze" is the pattern §8 calls a compliance defect,
-- and this deliberately has no such surface.

begin;

-- ─────────────────────────────────────────────────────────── the pause

create table if not exists public.streak_pauses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  started_on date not null default (now() at time zone 'UTC')::date,
  -- NULL means still paused. An open pause bridges every day up to today.
  ended_on date,
  reason text,
  created_at timestamptz not null default now(),
  constraint streak_pause_ordered check (ended_on is null or ended_on >= started_on)
);

comment on table public.streak_pauses is
  'Declared breaks for injury, illness or travel (179). Days inside a pause bridge '
  'the streak exactly as a planned rest day does. Never purchasable.';

create index if not exists streak_pauses_user_range
  on public.streak_pauses (user_id, started_on desc);

-- ONE OPEN PAUSE AT A TIME. Two overlapping open pauses would make "am I paused"
-- ambiguous and "end my pause" pick one arbitrarily.
create unique index if not exists streak_pauses_one_open
  on public.streak_pauses (user_id) where ended_on is null;

alter table public.streak_pauses enable row level security;

drop policy if exists streak_pauses_owner_select on public.streak_pauses;
create policy streak_pauses_owner_select on public.streak_pauses
  for select using (user_id = auth.uid());
drop policy if exists streak_pauses_owner_insert on public.streak_pauses;
create policy streak_pauses_owner_insert on public.streak_pauses
  for insert with check (user_id = auth.uid());
drop policy if exists streak_pauses_owner_update on public.streak_pauses;
create policy streak_pauses_owner_update on public.streak_pauses
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists streak_pauses_owner_delete on public.streak_pauses;
create policy streak_pauses_owner_delete on public.streak_pauses
  for delete using (user_id = auth.uid());

-- ───────────────────────────────────────────────────────── the allowance

create table if not exists public.forge_streak_config (
  id int primary key default 1,
  grace_per_30d int not null default 2,
  updated_at timestamptz not null default now(),
  constraint forge_streak_config_one_row check (id = 1),
  constraint forge_streak_config_sane check (grace_per_30d between 0 and 10)
);
insert into public.forge_streak_config (id) values (1) on conflict (id) do nothing;

alter table public.forge_streak_config enable row level security;
drop policy if exists forge_streak_config_read on public.forge_streak_config;
-- Config is not per-user data; every signed-in athlete may read the rule that
-- applies to them, and nobody may write it from the client.
create policy forge_streak_config_read on public.forge_streak_config
  for select using (auth.uid() is not null);

-- ───────────────────────────────────────────────── the streak, with both

/**
 * THE RUN, counting grace and pauses.
 *
 * Walks back from `p_asof`. The ONLY change to the existing shape is what happens
 * on a missed planned day: it used to `exit`, and now it may be absorbed.
 *
 * GRACE IS COUNTED IN A ROLLING WINDOW, not per calendar month. A month boundary
 * would let an athlete miss the 30th and the 1st and the 2nd and the 3rd with four
 * grace days between two "months", which is not what "two a month" means to
 * anybody. Walking backwards, a miss at date d is absorbed only if fewer than
 * `grace_per_30d` grace days have already been spent in the 30 days at or after d.
 */
create or replace function public.scheduled_streak(p_user uuid, p_asof date)
returns table(length integer, run_start date)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d date := p_asof;
  n int := 0;
  first_completed date := null;
  planned text;
  trained boolean;
  paused boolean;
  steps int := 0;
  allowance int;
  spent date[] := '{}';
  spent_nearby int;
begin
  select coalesce(grace_per_30d, 2) into allowance from public.forge_streak_config where id = 1;
  allowance := coalesce(allowance, 2);

  loop
    exit when steps >= 1000;
    steps := steps + 1;

    select case
      when jsonb_typeof(ws.plan -> extract(dow from d)::int::text) = 'array' then (
        select t.e
        from jsonb_array_elements_text(ws.plan -> extract(dow from d)::int::text) as t(e)
        where t.e <> 'Rest'
        limit 1)
      else ws.plan ->> extract(dow from d)::int::text
    end into planned
    from public.workout_schedule ws
    where ws.user_id = p_user and ws.effective_from <= d
    order by ws.effective_from desc
    limit 1;

    if planned is null or planned = 'Rest' then
      if not exists (select 1 from public.workout_schedule ws
                     where ws.user_id = p_user and ws.effective_from <= d) then
        exit;
      end if;
      d := d - 1;
      continue;
    end if;

    select exists (
      select 1 from public.workout_log w
      where w.user_id = p_user and w.date = d and w.weight >= 0 and w.reps > 0
    ) into trained;

    if trained then
      n := n + 1;
      first_completed := d;
      d := d - 1;
      continue;
    end if;

    if d = p_asof then
      -- today still pending: skip, don't break, and don't spend grace on a day
      -- the athlete may yet train.
      d := d - 1;
      continue;
    end if;

    -- 179: A DECLARED PAUSE BRIDGES. Unrationed, because rationing an injury is
    -- the pressure §6 exists to remove.
    select exists (
      select 1 from public.streak_pauses p
      where p.user_id = p_user and p.started_on <= d
        and (p.ended_on is null or p.ended_on >= d)
    ) into paused;
    if paused then
      d := d - 1;
      continue;
    end if;

    -- 179: OTHERWISE SPEND A GRACE DAY, if one is left in this 30-day window.
    select count(*) into spent_nearby
    from unnest(spent) as s(day)
    where s.day >= d and s.day < d + 30;

    if spent_nearby < allowance then
      spent := spent || d;
      d := d - 1;
      continue;
    end if;

    exit;
  end loop;

  return query select n, first_completed;
end;
$function$;
revoke execute on function public.scheduled_streak(uuid, date) from public, anon;
grant execute on function public.scheduled_streak(uuid, date) to authenticated;

-- ───────────────────────────────────────────────────────── the controls

/** Am I paused, and how much grace is left? One read for the whole screen. */
create or replace function public.my_streak_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  allowance int;
  open_pause public.streak_pauses;
  used int;
begin
  if me is null then
    raise exception 'my_streak_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(grace_per_30d, 2) into allowance from public.forge_streak_config where id = 1;
  select * into open_pause from public.streak_pauses
   where user_id = me and ended_on is null limit 1;

  -- Missed planned days in the last 30, which is what grace was spent on.
  select count(*) into used
  from generate_series((now() at time zone 'UTC')::date - 29,
                       (now() at time zone 'UTC')::date - 1, interval '1 day') g(day)
  where public.scheduled_workouts_on(me, g.day::date) <> '{}'
    and not exists (select 1 from public.workout_log w
                    where w.user_id = me and w.date = g.day::date and w.reps > 0)
    and not exists (select 1 from public.streak_pauses p
                    where p.user_id = me and p.started_on <= g.day::date
                      and (p.ended_on is null or p.ended_on >= g.day::date));

  return jsonb_build_object(
    'grace_per_30d', coalesce(allowance, 2),
    'grace_used_30d', least(coalesce(used, 0), coalesce(allowance, 2)),
    'paused', open_pause.id is not null,
    'paused_since', open_pause.started_on,
    'pause_reason', open_pause.reason);
end;
$$;
revoke execute on function public.my_streak_state() from public, anon;
grant execute on function public.my_streak_state() to authenticated;

/** One tap. Idempotent: pausing while paused returns the pause you already have. */
create or replace function public.streak_pause_start(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  row public.streak_pauses;
begin
  if me is null then
    raise exception 'streak_pause_start: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into row from public.streak_pauses where user_id = me and ended_on is null limit 1;
  if row.id is not null then
    return jsonb_build_object('paused', true, 'since', row.started_on, 'already', true);
  end if;
  insert into public.streak_pauses (user_id, reason)
  values (me, nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into row;
  return jsonb_build_object('paused', true, 'since', row.started_on, 'already', false);
end;
$$;
revoke execute on function public.streak_pause_start(text) from public, anon;
grant execute on function public.streak_pause_start(text) to authenticated;

/** And one tap back. Ending a pause you do not have is not an error. */
create or replace function public.streak_pause_end()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  row public.streak_pauses;
begin
  if me is null then
    raise exception 'streak_pause_end: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  update public.streak_pauses
     set ended_on = (now() at time zone 'UTC')::date
   where user_id = me and ended_on is null
  returning * into row;
  return jsonb_build_object('paused', false, 'ended', row.ended_on);
end;
$$;
revoke execute on function public.streak_pause_end() from public, anon;
grant execute on function public.streak_pause_end() to authenticated;

-- ─────────────── PROVEN: grace absorbs, a pause bridges, and neither is infinite

do $$
declare
  u uuid := '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';   -- ALPHA, the smoke account
  base date := date '2024-06-03';   -- a Monday, long before any real training
  len int;
begin
  -- A REAL user is required (workout_schedule has an FK to auth.users), but a
  -- window nobody has trained in, so this measures the RULE and not somebody's
  -- history. Everything below is deleted again at the end.
  if exists (select 1 from public.workout_log w
             where w.user_id = u and w.date between base - 40 and base + 40) then
    raise notice 'the probe window is not empty - skipping'; return;
  end if;
  delete from public.workout_log where user_id = u and date between base - 40 and base + 40;
  delete from public.workout_schedule where user_id = u and effective_from = base - 400;
  delete from public.streak_pauses where user_id = u and reason = 'probe';

  insert into public.workout_schedule (user_id, plan, effective_from)
  values (u, jsonb_build_object(
    '0', 'Rest', '1', 'Push', '2', 'Pull', '3', 'Legs', '4', 'Push', '5', 'Pull', '6', 'Rest'),
    base - 400);

  -- Ten consecutive weekday sessions, then a gap we control.
  insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
  select u, g.day::date, 'Push', 'Test Lift', 'Chest', 1, 5, 50, now()
  from generate_series(base, base + 13, interval '1 day') g(day)
  where extract(dow from g.day) between 1 and 5;

  -- 1. A CLEAN RUN COUNTS. 10 weekdays over the fortnight.
  select s.length into len from public.scheduled_streak(u, base + 13) s;
  if len <> 10 then raise exception 'a clean run counted % not 10', len; end if;

  -- 2. ONE MISSED PLANNED DAY IS ABSORBED BY GRACE, not fatal.
  delete from public.workout_log where user_id = u and date = base + 8;   -- a Tuesday
  select s.length into len from public.scheduled_streak(u, base + 13) s;
  if len <> 9 then
    raise exception 'grace did not absorb one missed day: got % (expected 9)', len;
  end if;

  -- 3. A THIRD MISS IN THE SAME 30 DAYS BREAKS THE RUN. Grace is rationed at 2.
  delete from public.workout_log where user_id = u and date in (base + 7, base + 9);
  select s.length into len from public.scheduled_streak(u, base + 13) s;
  if len >= 9 then
    raise exception 'grace was not rationed: three misses still counted %', len;
  end if;

  -- 4. A PAUSE OVER THE SAME DAYS BRIDGES ALL OF THEM.
  insert into public.streak_pauses (user_id, started_on, ended_on, reason)
  values (u, base + 7, base + 9, 'probe');
  select s.length into len from public.scheduled_streak(u, base + 13) s;
  if len <> 7 then
    raise exception 'a pause did not bridge three missed days: got % (expected 7)', len;
  end if;

  delete from public.workout_log where user_id = u and date between base - 40 and base + 40;
  delete from public.workout_schedule where user_id = u and effective_from = base - 400;
  delete from public.streak_pauses where user_id = u and reason = 'probe';
  raise notice 'streak grace and pause proven';
end $$;

commit;
