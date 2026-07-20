-- EvoForge 080 — PRODUCT ANALYTICS ROLLUPS + activity summary (Tyson, 2026-07-21).
--
-- Builds on the EXISTING analytics_events rail (migration 029: event_name + props
-- jsonb, owner-insert RLS, the data/analytics.ts::track emitter). This migration
-- adds:
--   • user_activity — a per-user summary (first/last seen, last login, sessions,
--     time-on-app) upserted by touch_activity();
--   • app_admins + is_app_admin() — gate the rollups;
--   • admin rollup RPCs (aggregates only) for the product dashboard: sign-ups,
--     DAU/WAU/MAU, workouts logged, avg session / time-on-app, per-day series,
--     top pages by views + time-on-page.
--
-- Client instrumentation (data/analytics.ts + use-analytics.ts) emits
-- 'session_start' / 'session_end' / 'page_view' events (props: page, duration_ms,
-- session_id) via the existing track(), and calls touch_activity on open. Sign-ups
-- and workouts are DERIVED server-side (auth.users / workout_log) so they're
-- accurate even if a client never emits an event. Privacy: routes + durations
-- only — no PII, matching the 029 analytics contract.

-- Helpful rollup indexes on the existing event table.
create index if not exists analytics_events_name_time on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_time on public.analytics_events (created_at desc);

-- ── per-user activity summary ────────────────────────────────────────────
create table if not exists public.user_activity (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_login_at timestamptz,
  sessions      integer not null default 0,
  total_ms      bigint  not null default 0
);
alter table public.user_activity enable row level security;
drop policy if exists user_activity_owner on public.user_activity;
create policy user_activity_owner on public.user_activity
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists user_activity_last_seen on public.user_activity (last_seen_at desc);

-- Upsert the caller's activity. p_login marks a fresh session; p_ms adds
-- time-on-app; every call bumps last_seen.
create or replace function public.touch_activity(p_login boolean default false, p_ms integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); add_ms bigint := greatest(0, least(86400000, coalesce(p_ms,0)));
begin
  if me is null then raise exception 'touch_activity: not signed in.' using errcode='insufficient_privilege'; end if;
  insert into user_activity (user_id, last_seen_at, last_login_at, sessions, total_ms)
  values (me, now(), case when p_login then now() else null end, case when p_login then 1 else 0 end, add_ms)
  on conflict (user_id) do update set
    last_seen_at  = now(),
    last_login_at = case when p_login then now() else user_activity.last_login_at end,
    sessions      = user_activity.sessions + case when p_login then 1 else 0 end,
    total_ms      = user_activity.total_ms + add_ms;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.touch_activity(boolean, integer) to authenticated;

-- ── admin gate ───────────────────────────────────────────────────────────
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_admins enable row level security;  -- no client policy: definer/service only
create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- ── admin rollups (aggregates only; gated) ───────────────────────────────
create or replace function public.analytics_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_app_admin() then raise exception 'analytics_overview: admin only.' using errcode='insufficient_privilege'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'total_users',   (select count(*) from auth.users),
    'signups_today', (select count(*) from auth.users where created_at >= date_trunc('day', now())),
    'signups_7d',    (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'signups_30d',   (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'dau',           (select count(*) from user_activity where last_seen_at >= now() - interval '1 day'),
    'wau',           (select count(*) from user_activity where last_seen_at >= now() - interval '7 days'),
    'mau',           (select count(*) from user_activity where last_seen_at >= now() - interval '30 days'),
    'active_now',    (select count(*) from user_activity where last_seen_at >= now() - interval '5 minutes'),
    'sets_logged_7d',     (select count(*) from workout_log where "timestamp" >= now() - interval '7 days'),
    'workouts_logged_7d', (select count(*) from (select distinct user_id, date, workout from workout_log where "timestamp" >= now() - interval '7 days') s),
    'avg_session_min',    (select round((avg((props->>'duration_ms')::numeric)/60000.0)::numeric, 1)
                             from analytics_events where event_name='session_end'
                              and (props->>'duration_ms') ~ '^[0-9]+$' and created_at >= now() - interval '30 days'),
    'avg_time_on_app_min',(select round((avg(total_ms)/60000.0)::numeric, 1) from user_activity where total_ms > 0),
    'never_returned',     (select count(*) from user_activity where sessions <= 1 and first_seen_at < now() - interval '2 days')
  );
end; $$;
grant execute on function public.analytics_overview() to authenticated;

create or replace function public.analytics_daily(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_days,30),1),180);
begin
  if not public.is_app_admin() then raise exception 'analytics_daily: admin only.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.day) from (
      select gs::date as day,
        (select count(*) from auth.users u where u.created_at::date = gs::date) as signups,
        (select count(distinct e.user_id) from analytics_events e where e.created_at::date = gs::date) as active_users,
        (select count(*) from workout_log w where w."timestamp"::date = gs::date) as sets_logged,
        (select count(*) from (select distinct user_id, date, workout from workout_log w where w."timestamp"::date = gs::date) s) as workouts_logged
      from generate_series(date_trunc('day', now()) - ((d-1) || ' days')::interval, date_trunc('day', now()), interval '1 day') gs
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.analytics_daily(integer) to authenticated;

create or replace function public.analytics_top_pages(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d int := least(greatest(coalesce(p_days,30),1),180);
begin
  if not public.is_app_admin() then raise exception 'analytics_top_pages: admin only.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select props->>'page' as page,
             count(*) as views,
             count(distinct user_id) as unique_users,
             round((avg((props->>'duration_ms')::numeric)/1000.0)::numeric, 1) as avg_seconds
      from analytics_events
      where event_name = 'page_view' and props->>'page' is not null
        and created_at >= now() - (d || ' days')::interval
      group by props->>'page'
      order by count(*) desc
      limit 40
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.analytics_top_pages(integer) to authenticated;
