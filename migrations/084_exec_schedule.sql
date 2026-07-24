-- EvoForge 084 — schedule the watchdog, and make the daily snapshot
-- reconstructible from history.
--
-- 083 shipped the rules; this makes them RUN. Supabase has no pg_cron by
-- default, so both extensions are enabled here:
--   • pg_cron — runs exec_watchdog_scan() every 5 minutes IN THE DATABASE.
--     Detection therefore has no external dependency and no delivery window to
--     miss (a GitHub Actions cron drifts 5–15 minutes, which is most of the
--     detection budget).
--   • pg_net  — lets that schedule reach exec-notify, which is the only leg
--     that must live outside Postgres (it VAPID-signs a Web Push payload).
--
-- 083 CORRECTED, not edited: `exec_snapshot_metrics` computed three metrics
-- "as of now" (users_total, alerts_open, push_subscribers), so running it for a
-- past date would have written TODAY's totals onto that date — a trend line
-- that looks plausible and is fabricated. Every metric below is now a function
-- of the day it describes, so the 14-day backfill at the end is honest.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────
-- The snapshot, every metric reconstructible for any past day.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.exec_snapshot_metrics(p_day date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  rows_written int := 0;
  day_start timestamptz := p_day::timestamptz;
  day_end   timestamptz := (p_day + 1)::timestamptz;
begin
  insert into exec_metric_daily (day, metric, value)
  select p_day, m.metric, m.value from (
    -- cumulative, as of the END of that day
    select 'users_total' metric,
           (select count(*) from auth.users
             where email not like '%evoforge.internal' and created_at < day_end)::numeric value
    union all select 'push_subscribers',
           (select count(distinct user_id) from push_subscriptions where created_at < day_end)
    -- that day only
    union all select 'signups_1d',
           (select count(*) from auth.users where email not like '%evoforge.internal'
              and created_at >= day_start and created_at < day_end)
    union all select 'sets_1d',
           (select count(*) from workout_log where timestamp >= day_start and timestamp < day_end)
    union all select 'active_athletes_1d',
           (select count(distinct user_id) from workout_log
             where timestamp >= day_start and timestamp < day_end)
    union all select 'analytics_rows_1d',
           (select count(*) from analytics_events where created_at >= day_start and created_at < day_end)
    union all select 'alerts_opened_1d',
           (select count(*) from exec_alerts where opened_at >= day_start and opened_at < day_end)
    -- the funnel, for the cohort that signed up that day
    union all select 'activated_1d',
           (select count(*) from auth.users u
             where u.email not like '%evoforge.internal'
               and u.created_at >= day_start and u.created_at < day_end
               and exists (select 1 from workout_log w where w.user_id = u.id))
  ) m
  on conflict (day, metric) do update set value = excluded.value;
  get diagnostics rows_written = row_count;
  return jsonb_build_object('ok', true, 'day', p_day, 'metrics', rows_written);
end $$;

revoke all on function public.exec_snapshot_metrics(date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- The schedule. Times are UTC (pg_cron always is); the daily job runs just
-- after UTC midnight and snapshots the day that just CLOSED, so a snapshot is
-- never taken of a partial day.
-- ─────────────────────────────────────────────────────────────────────────
-- Idempotent: unschedule first so re-running this file cannot stack duplicate
-- jobs firing the same scan five times a minute.
select cron.unschedule(jobname) from cron.job
 where jobname in ('exec-watchdog-scan', 'exec-notify', 'exec-snapshot');

select cron.schedule('exec-watchdog-scan', '*/5 * * * *',
  $job$ select public.exec_watchdog_scan() $job$);

select cron.schedule('exec-snapshot', '7 0 * * *',
  $job$ select public.exec_snapshot_metrics(current_date - 1) $job$);

-- The secret is read from Vault at fire time and is NOT in this file — this
-- repo is public. Insert it once, out of band:
--   select vault.create_secret('<value>', 'cron_secret', 'exec-notify caller auth');
-- and set the same value as the CRON_SECRET edge-function secret.
select cron.schedule('exec-notify', '*/5 * * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/exec-notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb
  )
$job$);

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill 14 days of real history so the trend line exists on day one.
-- Honest because every metric above is a function of the day it describes.
-- ─────────────────────────────────────────────────────────────────────────
do $$
declare d date;
begin
  for d in select generate_series(current_date - 14, current_date - 1, interval '1 day')::date loop
    perform public.exec_snapshot_metrics(d);
  end loop;
end $$;
