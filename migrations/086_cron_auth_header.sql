-- EvoForge 086 — the cron jobs could not actually reach their edge functions.
--
-- FOUND BY CHECKING, not by reasoning: 084 and 085 scheduled `net.http_post`
-- with only `x-cron-secret`, and every scheduled call came back
--   401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}
-- Supabase's edge gateway verifies a JWT BEFORE the function body runs, so the
-- custom header never got a chance to be checked. The watchdog was writing
-- alerts correctly (5 activation_stall + 1 onboarding_stall on real athletes)
-- and the notification leg was silently 401ing every five minutes — an alerting
-- system that cannot alert.
--
-- Fix: send the PUBLISHABLE key as the Authorization bearer. It is already
-- public — it ships inside the browser bundle — so this grants nothing new; it
-- only satisfies the gateway. `x-cron-secret` remains the real authorization,
-- checked in constant time inside the function, which still refuses to run if
-- its secret is unset. Gateway pass and authorization stay separate on purpose.
--
-- Both keys are read from Vault at fire time and are NOT in this file: this
-- repo is public, and a migration is the last place a key should live.

select cron.unschedule(jobname) from cron.job
 where jobname in ('exec-notify', 'training-reminder');

select cron.schedule('exec-notify', '*/5 * * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/exec-notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'edge_gateway_key' limit 1),
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb
  )
$job$);

select cron.schedule('training-reminder', '0 8 * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/training-reminder',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'edge_gateway_key' limit 1),
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb
  )
$job$);

-- VERIFY AFTER APPLYING — the whole point of this migration is that a green
-- schedule proved nothing:
--   select status_code, content from net._http_response order by created desc limit 3;
-- 200 with {"ok":true,...} is success. A 401 here means the gateway again.
