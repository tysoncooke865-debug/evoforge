-- EvoForge 121 — a failure from Tuesday must not read as a failure from now.
--
-- 119's sweep set updated_at = now() on the rows it reclassified, and 119's
-- health function reported max(updated_at) as "last_at". The effect: ten
-- failures — four of them recorded by a code path that has SINCE BEEN FIXED,
-- and whose message ("Commit failed: " with nothing after it) is the exact
-- symptom that fix removed — all appeared to have happened in the last minute.
--
-- That is the same fault as the stuck queue 119 was written to expose: every
-- number true, the picture false. A founder reading it would have gone hunting
-- a git problem that was solved days ago.
--
-- So: when a job fails, record WHEN, and never move it afterwards. Health then
-- splits failures into recent and historical, because "four git failures, none
-- in the last day" is a completely different sentence from "four git failures"
-- and only one of them is worth acting on.

alter table public.command_dispatch
  add column if not exists failed_at timestamptz;

comment on column public.command_dispatch.failed_at is
  'When this job actually failed. Set once and never moved — a sweep or a '
  'reclassification must not make an old failure look recent.';

-- BACKFILL, AND AN ADMISSION: THE TRUE TIMES ARE GONE.
--
-- 119's sweep and requeue both set updated_at = now() on rows they touched, so
-- for every currently-failed row the only surviving timestamps are created_at
-- (when the job was queued) and a corrupted updated_at (when a maintenance
-- query last ran). There is no way to recover the moment each one actually
-- failed.
--
-- created_at is used, because it is a genuine lower bound — a job cannot fail
-- before it exists — and because the alternative is leaving ten historical
-- failures permanently badged as "today", which is the exact fault this
-- migration exists to remove. From here forward the trigger records the real
-- time and nothing moves it.
update public.command_dispatch
   set failed_at = created_at
 where status = 'failed' and failed_at is null;

/** Stamp failed_at exactly once, on the transition into 'failed'. */
create or replace function public.command_dispatch_stamp_failure()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'failed' and (old.status is distinct from 'failed') then
    new.failed_at := coalesce(new.failed_at, now());
  elsif new.status <> 'failed' then
    -- Requeued: the failure is over, so the stamp goes with it.
    new.failed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists command_dispatch_failure_stamp on public.command_dispatch;
create trigger command_dispatch_failure_stamp before update on public.command_dispatch
  for each row execute function public.command_dispatch_stamp_failure();

/**
 * Studio health, reading failure age honestly.
 *
 * Rebuilt on 119's version. The classification list is unchanged except that
 * the sweep's own message now has a class of its own — it was landing in
 * 'other' and reading as an uncategorised mystery when it is the most
 * self-explanatory row in the table.
 */
create or replace function public.command_studio_health()
returns jsonb language sql stable security definer set search_path = public as $$
  with f as (
    select case
             when error like 'Exhausted % attempts%' then 'stuck'
             when error ilike '%verification failed%' or error ilike '%could not run%'
               or error ilike '%typescript%' or error ilike '%cannot find module%'
               then 'environment'
             when error ilike '%protected paths%' then 'protected_paths'
             when error ilike '%acceptance criteria%' then 'no_criteria'
             when error ilike '%commit failed%' or error ilike '%push failed%' then 'git'
             when coalesce(trim(error),'') = '' then 'unexplained'
             else 'other' end as class,
           coalesce(failed_at, created_at) as at,
           error
      from command_dispatch where status = 'failed'
  ),
  classes as (
    select class, count(*) n,
           count(*) filter (where at > now() - interval '24 hours') recent,
           max(at) last_at,
           (array_agg(left(coalesce(error,'(no error recorded)'), 220) order by at desc))[1] example
      from f group by class
  )
  select jsonb_build_object(
    'generated_at', now(),
    'queue', jsonb_build_object(
      'claimable', (select count(*) from command_dispatch where status = 'pending' and attempts < max_attempts),
      'stuck', (select count(*) from command_dispatch where status = 'pending' and attempts >= max_attempts),
      'in_flight', (select count(*) from command_dispatch where status = 'claimed'),
      'failed', (select count(*) from command_dispatch where status = 'failed'),
      'failed_recent', (select count(*) from f where at > now() - interval '24 hours'),
      'oldest_pending', (select min(created_at) from command_dispatch where status = 'pending')),
    'failure_classes', (select coalesce(jsonb_agg(jsonb_build_object(
        'class', class, 'count', n, 'recent', recent, 'last_at', last_at, 'example', example,
        'meaning', case class
          when 'environment' then 'The toolchain was missing in the worktree, not the code being wrong. Recoverable: fix the environment and requeue.'
          when 'protected_paths' then 'The commit touched migrations, auth, payments or another protected path without architect authority. A founder grants it on the proposal — approving IS the authorisation.'
          when 'no_criteria' then 'The work order has no acceptance criteria, so there is no checkable definition of done. A founder must write them.'
          when 'git' then 'A git operation refused. The empty "Commit failed:" variant predates the fix that captures git output — git writes refusals to stdout, not stderr.'
          when 'stuck' then 'Pending but out of attempts, so it could never be claimed again. Recorded honestly by the sweep rather than left looking queued.'
          when 'unexplained' then 'The failure recorded no reason at all. That is itself a bug worth chasing.'
          else 'Uncategorised.' end,
        'recoverable', class in ('environment','git','stuck'))
      order by recent desc, n desc), '[]'::jsonb) from classes),
    'runners', (select coalesce(jsonb_agg(jsonb_build_object(
        'worker', worker, 'kind', kind, 'state', state,
        'fresh', last_seen_at > now() - interval '2 minutes',
        'last_seen_at', last_seen_at) order by kind), '[]'::jsonb) from command_runners),
    'exec', (select jsonb_build_object('action', action, 'reason', reason, 'at', at)
               from command_exec_heartbeat order by at desc limit 1),
    'work', jsonb_build_object(
      'orders_open', (select count(*) from command_work_orders where status = 'in_progress'),
      'orders_without_criteria', (select count(*) from command_work_orders w
                                   where w.status = 'in_progress'
                                     and not exists (select 1 from command_criteria c where c.work_order_id = w.id)),
      'proposals_open', (select count(*) from command_proposals where status in ('open','changes_requested')),
      'releases_blocked', (select count(*) from command_releases where sentinel_verdict = 'blocked')),
    'events', jsonb_build_object(
      'pending', (select count(*) from command_events where status = 'pending'),
      'dead', (select count(*) from command_events where status = 'dead'))
  );
$$;
grant execute on function public.command_studio_health() to authenticated;
