-- EvoForge 087 — the executive dashboard's data layer: a real agent-activity
-- rail, an audit log, one overview read, and the quick actions.
--
-- TYSON'S DECISIONS (2026-07-25), all four implemented here:
--   • extend the Expo app rather than found a Next.js project — so this is
--     ordinary app data behind the existing is_app_admin() gate, no new host,
--     no second auth, no duplicated design system;
--   • build the AI Workforce page FOR REAL — hence exec_agent_activity. The
--     house rule is "a system without a backend is HIDDEN, never mocked", so
--     the page shows what actually happened, including the honest answer
--     "nothing has run since 14:32";
--   • quick actions: YES.
--
-- ON QUICK ACTIONS AND THE APPROVAL GATE. The constitution says never deploy or
-- merge without founder approval. A founder tapping a button IS that approval —
-- the rule exists to stop an AGENT acting unilaterally, not to stop the owner
-- operating his own company. So every action here is (a) refused unless
-- is_app_admin(), (b) recorded in exec_action_log with who and when, and (c)
-- reversible or read-only. Nothing here deploys, merges, or touches athlete
-- data. The genuinely outward-facing actions (deploy, merge a PR, dispatch CI)
-- need a GitHub token that does not exist in this project yet; they are
-- deliberately ABSENT rather than present-and-broken.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. AGENT ACTIVITY — what the AI workforce actually did.
-- ─────────────────────────────────────────────────────────────────────────
-- Written by agent sessions through the service role (the management API), not
-- by the app: an agent is not a signed-in user and should not need to be one.
create table if not exists public.exec_agent_activity (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  department  text not null,            -- ceo · product · engineering · qa · ux · data
  task        text not null,
  status      text not null default 'running' check (status in ('running','done','failed','blocked')),
  model       text,
  commit_sha  text,
  detail      jsonb not null default '{}'::jsonb,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
alter table public.exec_agent_activity enable row level security;
create index if not exists exec_agent_activity_recent on public.exec_agent_activity (started_at desc);
create unique index if not exists exec_agent_activity_session_task
  on public.exec_agent_activity (session_id, task);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. ACTION AUDIT — every quick action, with who pressed it.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.exec_action_log (
  id       uuid primary key default gen_random_uuid(),
  actor_id uuid not null default auth.uid() references auth.users(id) on delete set null,
  action   text not null,
  detail   jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
alter table public.exec_action_log enable row level security;
create index if not exists exec_action_log_recent on public.exec_action_log (at desc);

create or replace function public.exec_log_action(p_action text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into exec_action_log (actor_id, action, detail) values (auth.uid(), p_action, p_detail);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. THE OVERVIEW — one round trip for the whole front page.
-- ─────────────────────────────────────────────────────────────────────────
-- The funnel is cohort-split at 2026-07-17 because the Origin flow launched
-- that day: mixing the cohorts made Origin binding look like a 44% cliff when
-- athletes before it simply never had a flow to complete. Any funnel number in
-- this product that is not cohort-split is wrong.
create or replace function public.exec_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  real_users int; profiled int; origins int; activated int; two_days int; four_days int;
  post_users int; post_profiled int; post_origins int; post_activated int;
  sets_7d int; alerts_open int; alerts_critical int; subs int; last_agent timestamptz;
  last_scan timestamptz;
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;

  with real as (select id, created_at from auth.users where email not like '%evoforge.internal')
  select count(*),
         count(*) filter (where exists (select 1 from profile p where p.user_id = r.id)),
         count(*) filter (where exists (select 1 from profile p where p.user_id = r.id and p.origin_path is not null)),
         count(*) filter (where exists (select 1 from workout_log w where w.user_id = r.id)),
         count(*) filter (where (select count(distinct w.date) from workout_log w where w.user_id = r.id) >= 2),
         count(*) filter (where (select count(distinct w.date) from workout_log w where w.user_id = r.id) >= 4)
    into real_users, profiled, origins, activated, two_days, four_days
    from real r;

  with post as (select id from auth.users
                 where email not like '%evoforge.internal' and created_at >= '2026-07-17')
  select count(*),
         count(*) filter (where exists (select 1 from profile p where p.user_id = po.id)),
         count(*) filter (where exists (select 1 from profile p where p.user_id = po.id and p.origin_path is not null)),
         count(*) filter (where exists (select 1 from workout_log w where w.user_id = po.id))
    into post_users, post_profiled, post_origins, post_activated
    from post po;

  select count(*) into sets_7d from workout_log where timestamp > now() - interval '7 days';
  select count(*) filter (where resolved_at is null),
         count(*) filter (where resolved_at is null and severity = 'critical')
    into alerts_open, alerts_critical from exec_alerts;
  select count(distinct user_id) into subs from push_subscriptions;
  select max(started_at) into last_agent from exec_agent_activity;
  select max(start_time) into last_scan from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid where j.jobname = 'exec-watchdog-scan' and d.status = 'succeeded';

  return jsonb_build_object(
    'generated_at', now(),
    'lifetime', jsonb_build_object(
      'signed_up', real_users, 'profiled', profiled, 'origins', origins,
      'activated', activated, 'trained_2d', two_days, 'trained_4d', four_days),
    'post_origin_cohort', jsonb_build_object(
      'signed_up', post_users, 'profiled', post_profiled,
      'origins', post_origins, 'activated', post_activated),
    'sets_7d', sets_7d,
    'alerts_open', alerts_open,
    'alerts_critical', alerts_critical,
    'push_subscribers', subs,
    'last_agent_at', last_agent,
    'last_watchdog_scan', last_scan
  );
end $$;

create or replace function public.exec_agent_recent(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.started_at desc)
      from (select * from exec_agent_activity
             order by started_at desc limit greatest(1, least(200, p_limit))) a), '[]'::jsonb);
end $$;

create or replace function public.exec_actions_recent(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.at desc)
      from (select * from exec_action_log order by at desc limit greatest(1, least(200, p_limit))) a),
    '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. QUICK ACTIONS. Admin-gated, audited, reversible.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.exec_resolve_alert(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  update exec_alerts set resolved_at = now() where id = p_id and resolved_at is null;
  get diagnostics n = row_count;
  perform exec_log_action('resolve_alert', jsonb_build_object('alert_id', p_id, 'changed', n));
  return jsonb_build_object('ok', true, 'resolved', n);
end $$;

create or replace function public.exec_run_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  res := exec_watchdog_scan();
  perform exec_log_action('run_watchdog', res);
  return res;
end $$;

create or replace function public.exec_snapshot_now()
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  res := exec_snapshot_metrics(current_date);
  perform exec_log_action('snapshot_now', res);
  return res;
end $$;

-- Pause/resume the watchdog. Reversible by definition, and the single most
-- likely thing to want at 2am when a rule is misfiring — better a documented
-- switch than someone editing cron by hand under pressure.
create or replace function public.exec_set_watchdog(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'admin only' using errcode='insufficient_privilege'; end if;
  update cron.job set active = p_enabled
   where jobname in ('exec-watchdog-scan', 'exec-notify');
  perform exec_log_action('set_watchdog', jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end $$;

grant execute on function public.exec_overview() to authenticated;
grant execute on function public.exec_agent_recent(integer) to authenticated;
grant execute on function public.exec_actions_recent(integer) to authenticated;
grant execute on function public.exec_resolve_alert(uuid) to authenticated;
grant execute on function public.exec_run_watchdog() to authenticated;
grant execute on function public.exec_snapshot_now() to authenticated;
grant execute on function public.exec_set_watchdog(boolean) to authenticated;
revoke all on function public.exec_log_action(text, jsonb) from public, anon, authenticated;
