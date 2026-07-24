-- EvoForge 083 — THE ALERTING SPINE + the analytics write throttle.
--
-- WHY. On 2026-07-21 one athlete hit a hard Origin-binding failure and their
-- client emitted 20,051 session_start + 146 origin_binding_failed over 46 hours
-- before they left for good. Nothing noticed. The fix (082) landed two days
-- later because a human happened to look. Time-to-detection was ~48 hours.
--
-- THE 46-HOUR AVERAGE HID THE REAL SHAPE. It was not a slow retry at ~7/min:
-- measured per minute, that client wrote 2,412 rows in ONE minute (08:49) and
-- 60% of all 20,862 of its events inside the first 32 minutes. That is a spin
-- loop at ~40 inserts/second, which changes what each defence is worth:
--   • the THROTTLE bites almost immediately — a 120/hour cap per event name is
--     reached in about three seconds of that loop, and the 1,500/day ceiling
--     holds the whole incident to roughly 3,000 rows instead of 20,862 (7x);
--   • the WATCHDOG is what actually ends it, by putting a human on it in
--     minutes instead of days. R2 (200 rows / 15 min) trips seconds in.
--
-- The rules live in SQL on purpose: they can be falsified with a rolled-back
-- transaction, replayed against real history, and re-tuned without a deploy.
-- The edge function is a thin caller.
--
-- Depends on 080 (analytics_events rollups, app_admins, is_app_admin()).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. ALERTS
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.exec_alerts (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  severity    text not null default 'warning' check (severity in ('critical','warning','info')),
  title       text not null,
  detail      jsonb not null default '{}'::jsonb,
  subject_id  uuid,                    -- the athlete it is about, when it is about one
  opened_at   timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz
);
alter table public.exec_alerts enable row level security;
-- No client policy at all: admins read through the definer RPC below, and only
-- the watchdog (service role / definer) ever writes. RLS with no policy denies
-- every authenticated caller, which is exactly the intent.

-- One OPEN alert per (kind, subject) — the watchdog runs every few minutes and
-- must not stack 300 copies of the same problem. Partial unique index, so a
-- resolved alert never blocks the same problem recurring later.
create unique index if not exists exec_alerts_open_uniq
  on public.exec_alerts (kind, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where resolved_at is null;
create index if not exists exec_alerts_open on public.exec_alerts (opened_at desc) where resolved_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. METRIC HISTORY — today every number is a level with no trend behind it.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.exec_metric_daily (
  day    date not null,
  metric text not null,
  value  numeric not null,
  primary key (day, metric)
);
alter table public.exec_metric_daily enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. THE THROTTLE
-- ─────────────────────────────────────────────────────────────────────────
-- The counts are per-athlete and time-bounded, so they need this index or the
-- trigger becomes a sequential scan on every single analytics insert.
create index if not exists analytics_events_user_name_time
  on public.analytics_events (user_id, event_name, created_at desc);
create index if not exists analytics_events_user_time
  on public.analytics_events (user_id, created_at desc);

create or replace function public.analytics_events_throttle()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := coalesce(new.user_id, auth.uid());
  same_name int;
  all_today int;
begin
  -- Service-role writers (the watchdog, backfills) are never throttled.
  if me is null then return new; end if;

  select count(*) into same_name from analytics_events
   where user_id = me and event_name = new.event_name
     and created_at > now() - interval '1 hour';
  if same_name >= 120 then return null; end if;

  select count(*) into all_today from analytics_events
   where user_id = me and created_at > now() - interval '1 day';
  if all_today >= 1500 then return null; end if;

  return new;
end $$;

-- RETURN NULL, not RAISE: track() is fire-and-forget and swallows errors, so an
-- exception would be invisible anyway — and dropping quietly avoids teaching a
-- retry loop to retry harder. The first 120 rows/hour still land, which is far
-- more than the watchdog needs to see the flood.
drop trigger if exists analytics_events_throttle_trg on public.analytics_events;
create trigger analytics_events_throttle_trg
  before insert on public.analytics_events
  for each row execute function public.analytics_events_throttle();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. THE WATCHDOG
-- ─────────────────────────────────────────────────────────────────────────
-- Opens an alert per rule. Returns what it opened so the caller can notify.
-- `p_now` is injectable ONLY so the rules can be replayed against history in a
-- rolled-back transaction (see the falsification block at the end of this file).
create or replace function public.exec_watchdog_scan(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  opened jsonb := '[]'::jsonb;
  r record;
  n int;
  denom int;
  activated int;
begin
  -- ── R1 error burst: one athlete failing the same thing over and over.
  -- THE 2026-07-21 RULE. That athlete logged 146 origin_binding_failed; this
  -- fires at 20 within 15 minutes, which they passed inside the first hour.
  for r in
    select e.user_id, count(*) n, array_agg(distinct e.event_name) names
      from analytics_events e
     where e.created_at between p_now - interval '15 minutes' and p_now
       and (e.event_name like '%_failed' or e.event_name like '%_error')
     group by e.user_id having count(*) >= 20
  loop
    insert into exec_alerts (kind, severity, title, detail, subject_id)
    values ('error_burst', 'critical',
            'An athlete is failing repeatedly',
            jsonb_build_object('events', r.n, 'names', r.names, 'window', '15 min'),
            r.user_id)
    on conflict do nothing;
    if found then opened := opened || jsonb_build_object('kind','error_burst','user',r.user_id); end if;
  end loop;

  -- ── R2 write flood: a client stuck in a loop, whatever the loop is.
  for r in
    select e.user_id, count(*) n
      from analytics_events e
     where e.created_at between p_now - interval '15 minutes' and p_now
     group by e.user_id having count(*) >= 200
  loop
    insert into exec_alerts (kind, severity, title, detail, subject_id)
    values ('write_flood', 'critical',
            'A client is flooding analytics',
            jsonb_build_object('events', r.n, 'window', '15 min'),
            r.user_id)
    on conflict do nothing;
    if found then opened := opened || jsonb_build_object('kind','write_flood','user',r.user_id); end if;
  end loop;

  -- ── R3 onboarding stall: profiled, but never bound an origin.
  for r in
    select p.user_id
      from profile p
     where p.created_at between p_now - interval '7 days' and p_now - interval '24 hours'
       and p.origin_path is null
     group by p.user_id
  loop
    insert into exec_alerts (kind, severity, title, detail, subject_id)
    values ('onboarding_stall', 'warning',
            'An athlete has a profile but no origin after 24h',
            jsonb_build_object('window', '24h'), r.user_id)
    on conflict do nothing;
    if found then opened := opened || jsonb_build_object('kind','onboarding_stall','user',r.user_id); end if;
  end loop;

  -- ── R4 activation stall: bound an origin, never logged a set.
  -- THE CURRENT CLIFF (2026-07-25): post-Origin cohort went 10 profiled ->
  -- 8 bound -> 3 logged. This is the rule that would have caught that live.
  for r in
    select p.user_id
      from profile p
     where p.origin_assigned_at between p_now - interval '7 days' and p_now - interval '48 hours'
       and p.origin_path is not null
       and not exists (select 1 from workout_log w where w.user_id = p.user_id)
     group by p.user_id
  loop
    insert into exec_alerts (kind, severity, title, detail, subject_id)
    values ('activation_stall', 'warning',
            'An athlete bound an origin but has never logged a set',
            jsonb_build_object('window', '48h'), r.user_id)
    on conflict do nothing;
    if found then opened := opened || jsonb_build_object('kind','activation_stall','user',r.user_id); end if;
  end loop;

  -- ── R5 activation rate collapse. Needs a real denominator: with 3 signups a
  -- week, one unlucky athlete is not a trend.
  select count(*) into denom from auth.users u
   where u.created_at between p_now - interval '14 days' and p_now - interval '24 hours'
     and u.email not like '%evoforge.internal';
  if denom >= 8 then
    select count(*) into activated from auth.users u
     where u.created_at between p_now - interval '14 days' and p_now - interval '24 hours'
       and u.email not like '%evoforge.internal'
       and exists (select 1 from workout_log w where w.user_id = u.id);
    if activated::numeric / denom < 0.30 then
      insert into exec_alerts (kind, severity, title, detail)
      values ('activation_drop', 'critical',
              'Fewer than 30% of new athletes are logging a set',
              jsonb_build_object('activated', activated, 'signups', denom,
                                 'rate', round(activated::numeric / denom, 3)))
      on conflict do nothing;
      if found then opened := opened || jsonb_build_object('kind','activation_drop'); end if;
    end if;
  end if;

  -- ── R6 the lights are off: nobody trained at all.
  select count(*) into n from workout_log w
   where w.timestamp > p_now - interval '48 hours';
  if n = 0 then
    insert into exec_alerts (kind, severity, title, detail)
    values ('zero_training', 'critical',
            'No sets logged by anyone in 48 hours',
            jsonb_build_object('window', '48h'))
    on conflict do nothing;
    if found then opened := opened || jsonb_build_object('kind','zero_training'); end if;
  end if;

  -- ── auto-resolve: a per-athlete alert closes itself once the athlete moves on.
  update exec_alerts a set resolved_at = p_now
   where a.resolved_at is null and a.subject_id is not null
     and (
       (a.kind in ('error_burst','write_flood')
         and not exists (select 1 from analytics_events e
                          where e.user_id = a.subject_id
                            and e.created_at > p_now - interval '30 minutes'))
       or (a.kind = 'onboarding_stall'
         and exists (select 1 from profile p
                      where p.user_id = a.subject_id and p.origin_path is not null))
       or (a.kind = 'activation_stall'
         and exists (select 1 from workout_log w where w.user_id = a.subject_id))
     );

  return jsonb_build_object('ok', true, 'at', p_now, 'opened', opened);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. DAILY SNAPSHOT — the trend substrate.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.exec_snapshot_metrics(p_day date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rows_written int := 0;
begin
  insert into exec_metric_daily (day, metric, value)
  select p_day, m.metric, m.value from (
    select 'users_total' metric,
           (select count(*) from auth.users where email not like '%evoforge.internal')::numeric value
    union all select 'signups_1d',
           (select count(*) from auth.users where email not like '%evoforge.internal'
              and created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz)
    union all select 'sets_1d',
           (select count(*) from workout_log where timestamp >= p_day::timestamptz and timestamp < (p_day + 1)::timestamptz)
    union all select 'active_athletes_1d',
           (select count(distinct user_id) from workout_log where timestamp >= p_day::timestamptz and timestamp < (p_day + 1)::timestamptz)
    union all select 'analytics_rows_1d',
           (select count(*) from analytics_events where created_at >= p_day::timestamptz and created_at < (p_day + 1)::timestamptz)
    union all select 'alerts_open',
           (select count(*) from exec_alerts where resolved_at is null)
    union all select 'push_subscribers',
           (select count(distinct user_id) from push_subscriptions)
  ) m
  on conflict (day, metric) do update set value = excluded.value;
  get diagnostics rows_written = row_count;
  return jsonb_build_object('ok', true, 'day', p_day, 'metrics', rows_written);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. ADMIN READS (aggregates + alerts). Every one re-checks is_app_admin().
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.exec_alerts_open()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by
             case a.severity when 'critical' then 0 when 'warning' then 1 else 2 end, a.opened_at desc)
      from exec_alerts a where a.resolved_at is null), '[]'::jsonb);
end $$;

create or replace function public.exec_metrics_recent(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(m) order by m.day, m.metric)
      from exec_metric_daily m
     where m.day > current_date - greatest(1, least(365, p_days))), '[]'::jsonb);
end $$;

revoke all on function public.exec_watchdog_scan(timestamptz) from public, anon, authenticated;
revoke all on function public.exec_snapshot_metrics(date) from public, anon, authenticated;
grant execute on function public.exec_alerts_open() to authenticated;
grant execute on function public.exec_metrics_recent(integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- FALSIFICATION (run by hand, in a transaction, ROLLED BACK — see HANDOVER §5).
-- Every rule here was forced to fire before it was trusted:
--
--   begin;
--   -- R1: replay 2026-07-21 by pointing p_now at the real burst window.
--   select public.exec_watchdog_scan('2026-07-21 09:05:00+00'::timestamptz);
--   select kind, severity, title, detail from exec_alerts where resolved_at is null;
--   rollback;
--
-- On the real 07-21 data that returns error_burst AND write_flood at 09:05 —
-- 46 hours before the athlete gave up, and 2 days before 082 shipped.
-- ─────────────────────────────────────────────────────────────────────────
