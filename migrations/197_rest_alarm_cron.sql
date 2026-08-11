-- EvoForge 197 — the ten-second tick behind the rest alarm.
-- Requires 196 and the deployed `rest-alarm` edge function.
--
-- WHY TEN SECONDS. A rest is 60–180 seconds, so the one-minute floor every
-- other job in this project uses would deliver a buzz up to a minute late,
-- which for a rest timer is the same as not delivering it. pg_cron here is
-- 1.6.4, which supports sub-minute intervals.
--
-- ---- THE COST GUARD, AND WHY IT IS NOT OPTIONAL ----
--
-- A ten-second job that called the edge function every time would invoke it
-- 8,640 times a day — about 259,000 a month, over half the free plan's entire
-- function allowance, to ask a mostly-empty table whether anything is due.
-- This project is on the FREE plan.
--
-- So the job asks Postgres FIRST. `exists (...)` against 196's partial index
-- is a cheap index probe, and `net.http_post` only runs when an alarm is
-- genuinely due. Edge invocations therefore track the number of rests that
-- actually expire while the app is backgrounded — a handful per workout —
-- rather than the passage of time.
--
-- Web Push cannot be sent from plpgsql (VAPID JWT signing and AES128GCM
-- payload encryption), which is why an edge function is in the loop at all.
--
-- The header/secret shape is copied verbatim from `training-reminder` and
-- `command-notify`: the gateway key gets past Supabase's own auth, and
-- `x-cron-secret` is the real authorisation.
--
-- FALSIFICATION:
--  1. `select cron.schedule(...)` returns a jobid and the job appears active.
--  2. With NO due rows, `cron.job_run_details` shows succeeded runs and
--     `net._http_response` gains NO new rows — the guard is holding.
--  3. Insert a row with fire_at = now(); within ~10s it is marked sent and a
--     response row appears.
--  4. Re-running this file is safe: unschedule-then-schedule is idempotent.

-- Idempotent: drop any previous incarnation before scheduling.
select cron.unschedule('rest-alarm-tick')
where exists (select 1 from cron.job where jobname = 'rest-alarm-tick');

select cron.schedule(
  'rest-alarm-tick',
  '10 seconds',
  $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/rest-alarm',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'edge_gateway_key' limit 1),
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb)
  where exists (
    select 1 from public.rest_alarms
     where sent_at is null
       and fire_at <= now()
       and fire_at > now() - interval '5 minutes'
  )
  $job$
);
