-- EvoForge 129 — the product signal runs on its own, and a stuck lab job unsticks.
--
-- TWO THINGS, both about work that stops without anybody being told.
--
-- 1. command_product_scan has to run on a schedule or it is a button nobody
--    presses. pg_cron already drives command_exec_cycle every ten minutes; this
--    joins it at a slower beat, because a product failure is not a ten-minute
--    problem and an alert that fires six times an hour is an alert nobody reads.
--
-- 2. A Dev Lab job claimed by a worker that dies stays 'running' forever.
--    There was one on the board while this was written: Prophet's research,
--    stuck at 15% for fifty minutes, with no worker holding it. The dispatch
--    queue got exactly this treatment in 119 and 124 — the lab queue never did,
--    so the UI showed "running" for a job nothing was running.
--
-- THE ATTEMPT IS REFUNDED, as in 119. The first version of the dispatch reclaim
-- kept the attempt the crashed worker had spent, so five jobs became
-- permanently unclaimable while still displaying as pending. Same mistake is
-- available here and is not made.
--
-- FALSIFICATION (scripts/_falsify129.mjs):
--   1. a job whose worker stopped beating is returned to the queue.
--   2. a job whose worker IS beating is left alone, however long it has run.
--   3. the reclaim does not consume the attempt.
--   4. a job that has exhausted its attempts fails with a readable reason
--      rather than cycling forever.
--   5. the product scan is scheduled and its schedule is discoverable.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE LAB QUEUE UNSTICKS ITSELF
-- ─────────────────────────────────────────────────────────────────────────────

-- The table already carries attempts, max_attempts, claimed_at and worker.
-- The first version of this added a `claimed_by` column beside the existing
-- `worker`, and used an `updated_at` that does not exist — the reclaim raised
-- 42703 on its first real call. The columns are READ here, not assumed.
alter table public.command_lab_jobs
  add column if not exists attempts int not null default 0,
  add column if not exists max_attempts int not null default 3;

alter table public.command_lab_jobs drop column if exists claimed_by;

create or replace function public.command_lab_reclaim(p_stale_minutes int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cut timestamptz := now() - make_interval(mins => greatest(2, p_stale_minutes));
        v_freed int := 0; v_failed int := 0;
begin
  -- WHICH JOBS ARE ACTUALLY STRANDED.
  --
  -- The first version asked "is ANY lab worker beating?" and concluded nothing
  -- was stranded whenever one was. That is wrong in the exact case this exists
  -- for: a worker restarts, the new process knows nothing about the job the old
  -- one held, and the row reads 'running' forever while a perfectly healthy
  -- worker beats beside it. Two jobs were in that state when this was written.
  --
  -- The question is per job — is the worker THAT CLAIMED THIS ONE still on it?
  -- A claim older than the claiming worker's current life is a claim from a
  -- process that no longer exists, however healthy its replacement looks.
  with stranded as (
    select j.id from command_lab_jobs j
     where j.status = 'running'
       and coalesce(j.claimed_at, j.created_at) < v_cut
       and not exists (
         select 1 from command_runners r
          where r.kind = 'lab'
            and r.worker = j.worker
            and r.last_seen_at > now() - interval '3 minutes'
            and r.started_at <= j.claimed_at
       )
     for update skip locked
  ),
  requeued as (
    update command_lab_jobs j
       set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
           error = case when j.attempts >= j.max_attempts
                        then format('gave up after %s attempts — the worker stopped mid-job each time', j.attempts)
                        else null end,
           -- THE ATTEMPT IS NOT SPENT. The worker died; the job did not fail.
           -- Charging it would make a job unclaimable while still reading as
           -- pending, which is what 119 had to undo for the dispatch queue.
           worker = null,
           claimed_at = null,
           progress = case when j.attempts >= j.max_attempts then j.progress else 0 end
      from stranded s
     where j.id = s.id
    returning j.id, j.status
  )
  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'failed')
    into v_freed, v_failed
    from requeued;

  return jsonb_build_object('ok', true, 'requeued', coalesce(v_freed, 0), 'gave_up', coalesce(v_failed, 0),
                            'stale_after_minutes', greatest(2, p_stale_minutes));
end $$;

revoke all on function public.command_lab_reclaim(int) from public, anon;
grant execute on function public.command_lab_reclaim(int) to authenticated;

/**
 * A worker releases its own claims the moment it starts.
 *
 * This is the exact version of the question the reclaim above has to guess at.
 * A process that has just booted cannot be halfway through a job, so anything
 * still marked 'running' under its name is a claim from the process it
 * replaced. No timeout, no heartbeat comparison, no ambiguity.
 *
 * It exists because command_runners.started_at is not refreshed on restart —
 * the lab worker had been up for two hours and the row still said it started
 * two days ago, which made every timestamp-based test of "is this claim from a
 * dead process" answer no.
 */
create or replace function public.command_lab_release_mine(p_worker text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_freed int;
begin
  update command_lab_jobs
     set status = 'queued', worker = null, claimed_at = null, progress = 0, error = null
   where status = 'running' and worker = p_worker;
  get diagnostics v_freed = row_count;
  return jsonb_build_object('ok', true, 'released', v_freed, 'worker', p_worker);
end $$;

revoke all on function public.command_lab_release_mine(text) from public, anon;
grant execute on function public.command_lab_release_mine(text) to authenticated, service_role;

comment on function public.command_lab_reclaim(int) is
  'Return lab jobs stranded by a dead worker to the queue, without spending an attempt.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE PRODUCT SIGNAL RUNS WITHOUT BEING ASKED
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  -- Unschedule first so re-applying this migration cannot leave two copies
  -- scanning in parallel. 126 taught this the expensive way: an update that
  -- matched its own output ran twice and produced analytics_events_real_real.
  perform cron.unschedule('command-product-scan');
exception when others then
  null; -- not scheduled yet, which is the normal first run
end $$;

select cron.schedule(
  'command-product-scan',
  '17 * * * *',   -- hourly, off the ten-minute exec beat so they never collide
  $$select public.command_product_scan(7, 1)$$
);

do $$
begin
  perform cron.unschedule('command-lab-reclaim');
exception when others then
  null;
end $$;

select cron.schedule(
  'command-lab-reclaim',
  '*/10 * * * *',
  $$select public.command_lab_reclaim(12)$$
);
