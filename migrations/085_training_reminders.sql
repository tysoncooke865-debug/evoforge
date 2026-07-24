-- EvoForge 085 — TRAINING REMINDERS: give push something worth being subscribed to.
--
-- The push rail has existed since 053 and works. It has ONE subscriber, for two
-- reasons, both fixed by this change and its client half:
--   1. the opt-in is buried in a modal behind the Social tab's bell icon, and is
--      pitched as a SOCIAL feature ("get pushed when friends react") — social has
--      17 posts and 5 friendships in its entire lifetime;
--   2. nothing has ever SENT a training message. send-push is invoked only for
--      social events, so even the one subscriber gets nothing worth returning for.
--
-- A reminder is only welcome if it is true, so `training_reminder_due()` refuses
-- to nudge anyone whose nudge would be noise: never before an athlete has
-- trained at all (a stranger is not owed a notification), never twice in a day,
-- never on a day they have already trained, and never to someone who has drifted
-- for weeks (that is a win-back campaign, a different thing, with different
-- consent).

-- Idempotent by construction: the PK makes a double-send impossible, which is
-- the only guarantee worth having when a scheduler can retry.
create table if not exists public.push_reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  kind    text not null default 'training',
  sent_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);
alter table public.push_reminder_log enable row level security;
-- No client policy: written by the sender (service role), read by nobody else.

/**
 * Who should be nudged today, and with what.
 *
 * Returns at most one row per athlete. `workout` is the name their own schedule
 * says is due — a reminder that names the session is a reminder; one that says
 * "time to train!" is spam.
 */
create or replace function public.training_reminder_due(p_now timestamptz default now())
returns table (user_id uuid, workout text, streak_days int)
language plpgsql security definer set search_path = public as $$
declare
  -- The athlete's local day. There is no per-user timezone in the schema, and
  -- the user base is Australian, so AEST is the honest assumption to state
  -- rather than pretend UTC is anyone's day. Revisit when timezones are stored.
  local_today date := (p_now at time zone 'Australia/Sydney')::date;
  dow text := extract(dow from (p_now at time zone 'Australia/Sydney'))::int::text;
begin
  return query
  with subscribed as (
    select distinct s.user_id from push_subscriptions s
  ),
  activated as (
    -- Never nudge someone who has never logged a set: they have not opted into
    -- a training habit, and a notification is not how you create one.
    select w.user_id,
           max(w.date::date) as last_day,
           count(distinct w.date::date) as days_trained
      from workout_log w group by w.user_id
  )
  select a.user_id,
         coalesce(
           (select case
                     when jsonb_typeof(sch.plan -> dow) = 'array' then sch.plan -> dow ->> 0
                     else sch.plan ->> dow
                   end
              from workout_schedule sch
             where sch.user_id = a.user_id and sch.effective_from <= local_today
             order by sch.effective_from desc limit 1),
           'your next session')::text,
         a.days_trained::int
    from activated a
    join subscribed s on s.user_id = a.user_id
   where a.last_day < local_today                    -- not already trained today
     and a.last_day >= local_today - 21              -- not a drifted athlete
     and not exists (                                -- not already nudged today
           select 1 from push_reminder_log l
            where l.user_id = a.user_id and l.day = local_today and l.kind = 'training')
     and coalesce(
           (select case
                     when jsonb_typeof(sch.plan -> dow) = 'array' then sch.plan -> dow ->> 0
                     else sch.plan ->> dow
                   end
              from workout_schedule sch
             where sch.user_id = a.user_id and sch.effective_from <= local_today
             order by sch.effective_from desc limit 1),
           'your next session') is distinct from 'Rest';  -- respect their rest day
end $$;

revoke all on function public.training_reminder_due(timestamptz) from public, anon, authenticated;

-- 18:00 AEST — after work, before the gym closes. UTC in cron, always.
select cron.unschedule(jobname) from cron.job where jobname = 'training-reminder';
select cron.schedule('training-reminder', '0 8 * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/training-reminder',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb
  )
$job$);
