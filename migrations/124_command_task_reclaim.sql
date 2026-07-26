-- EvoForge 124 — a task showing an agent at work, with no agent and no job.
--
-- Sentinel's WO-005 task sat at status 'building', progress 69%, for over an
-- hour, with ZERO open dispatch rows behind it. The Floor showed an agent
-- working. Nothing was working.
--
-- HOW IT HAPPENS, AND WHY 098 NEVER CAUGHT IT
--
--   command_reclaim_stale_dispatch looks at DISPATCH rows still in 'claimed'
--   and returns them to the queue. It has no opinion about a task whose
--   dispatch has already closed — and that is exactly the state a runner
--   restart produces: the job finishes or is cancelled, the agent is killed
--   mid-run, and the task is left in a working state with nothing pointing at
--   it. Reclaim sees no claimed dispatch and reports "reclaimed 0", truthfully.
--
--   My own dedupe sweep (122) made this reachable more often: cancelling a
--   duplicate dispatch closed the only row that reclaim would have looked at.
--
-- TWO GAPS, BOTH ABOUT WORK THAT IS INVISIBLE RATHER THAN FAILED
--
--   1. A task WORKING with no open job — stranded. Nothing will ever move it.
--   2. A task QUEUED with no open job — equally stranded, and worse, it looks
--      like something waiting its turn rather than something forgotten.
--
--   Both are returned to a state the runner can act on, and the second is
--   re-dispatched, which is what closes the loop: the studio notices its own
--   dropped work instead of waiting to be told.
--
-- WHY A GRACE PERIOD. A task legitimately has no dispatch for the few seconds
-- between a job finishing and the next being created. Ten minutes is far longer
-- than any real gap and far shorter than anyone's patience.
--
-- FALSIFICATION (scripts/_falsify124.mjs):
--   1. a working task with no open job is returned to queued.
--   2. a working task WITH an open job is left alone.
--   3. a recently-updated task is left alone — the grace period is real.
--   4. a queued task with no job is re-dispatched exactly once.
--   5. re-dispatch respects the one-open-job-per-task index.
--   6. terminal tasks are never touched.

/**
 * Rebuilt on 122's version. The stuck, orphaned and already-finished passes are
 * unchanged; two passes are added for tasks rather than dispatch rows.
 */
create or replace function public.command_sweep_dispatch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_stuck int := 0; v_orphan int := 0; v_done int := 0;
  v_stranded int := 0; v_redispatched int := 0;
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from command_dispatch
   where status = 'pending' and attempts >= max_attempts;

  if coalesce(array_length(v_ids,1),0) > 0 then
    update command_dispatch
       set status = 'failed',
           error = coalesce(nullif(error,''),
             'Exhausted ' || max_attempts || ' attempts and could never be claimed again. ' ||
             'It was left showing as pending, which is why nothing appeared to be wrong.'),
           updated_at = now()
     where id = any(v_ids);
    get diagnostics v_stuck = row_count;
  end if;

  update command_dispatch d
     set status = 'cancelled',
         error = 'The work order, release or task this job referred to no longer exists.',
         updated_at = now()
   where d.status in ('pending','claimed')
     and ((d.work_order_id is not null and not exists (select 1 from command_work_orders w where w.id = d.work_order_id))
       or (d.release_id    is not null and not exists (select 1 from command_releases r where r.id = d.release_id))
       or (d.task_id       is not null and not exists (select 1 from command_tasks t where t.id = d.task_id)));
  get diagnostics v_orphan = row_count;

  update command_dispatch d
     set status = 'cancelled',
         error = 'The task reached ' || t.status || ' before this job ran, so there was nothing left to do.',
         updated_at = now()
    from command_tasks t
   where t.id = d.task_id
     and d.status = 'pending'
     and t.status in ('completed','ready_for_release','awaiting_founder');
  get diagnostics v_done = row_count;

  -- 4. STRANDED: a task claims to be working and nothing is working it.
  --
  -- This is the state the Floor renders as an agent mid-task. Returned to
  -- 'queued' with its progress cleared, because a resumed job starts over —
  -- leaving 69% on the bar would be a second lie about the same task.
  update command_tasks t
     set status = 'queued', progress = 0, activity = null, activity_at = null, updated_at = now()
   where t.status in ('building','planning','testing')
     and t.updated_at < now() - interval '10 minutes'
     and not exists (select 1 from command_dispatch d
                      where d.task_id = t.id and d.status in ('pending','claimed'));
  get diagnostics v_stranded = row_count;

  -- 5. FORGOTTEN: queued, and nothing will ever pick it up.
  --
  -- The unique index guarantees at most one open job per task, so this cannot
  -- create a duplicate. Only for work orders still in progress: re-dispatching
  -- against a closed order would resurrect finished work.
  insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
  select 'implement', t.work_order_id, t.id, 5,
         jsonb_build_object('instruction', 'Re-dispatched by the sweep: this task was queued with no job behind it.')
    from command_tasks t
    join command_work_orders w on w.id = t.work_order_id
   where t.status = 'queued'
     and w.status = 'in_progress'
     and t.updated_at < now() - interval '10 minutes'
     and not exists (select 1 from command_dispatch d
                      where d.task_id = t.id and d.status in ('pending','claimed'));
  get diagnostics v_redispatched = row_count;

  if v_stuck + v_orphan + v_done + v_stranded + v_redispatched > 0 then
    perform command_log('dispatch_swept', 'settings', null, 'dispatch',
      format('%s unclaimable recorded as failed; %s pointed at something gone; %s for tasks already finished; '
          || '%s task(s) were stranded mid-work with no job and returned to the queue; %s re-dispatched',
             v_stuck, v_orphan, v_done, v_stranded, v_redispatched),
      jsonb_build_object('stuck', v_stuck, 'orphaned', v_orphan, 'already_done', v_done,
                         'stranded', v_stranded, 'redispatched', v_redispatched),
      'system', 'sweep');
  end if;

  return jsonb_build_object('ok', true, 'swept', v_stuck, 'orphaned', v_orphan,
                            'already_done', v_done, 'stranded', v_stranded,
                            'redispatched', v_redispatched);
end $$;

/**
 * Studio health, now able to see work that is invisible rather than failed.
 *
 * Rebuilt on 121's version with one addition: `stranded`. A task in a working
 * state with no job behind it was previously counted nowhere at all — not in
 * the queue, not in flight, not failed. It rendered on the Floor as an agent
 * at work and appeared in no number a founder could check.
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
           coalesce(failed_at, created_at) as at, error
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
      -- Work that looks alive and is not attached to anything.
      'stranded', (select count(*) from command_tasks t
                    where t.status in ('building','planning','testing')
                      and not exists (select 1 from command_dispatch d
                                       where d.task_id = t.id and d.status in ('pending','claimed'))),
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
      'orders_awaiting_verification', (select count(*) from command_work_orders w
                                        where w.status = 'in_progress'
                                          and exists (select 1 from command_criteria c where c.work_order_id = w.id and not c.met)
                                          and not exists (select 1 from command_tasks t
                                                           where t.work_order_id = w.id
                                                             and t.status in ('queued','building','planning','testing'))),
      'proposals_open', (select count(*) from command_proposals where status in ('open','changes_requested')),
      'releases_blocked', (select count(*) from command_releases where sentinel_verdict = 'blocked')),
    'events', jsonb_build_object(
      'pending', (select count(*) from command_events where status = 'pending'),
      'dead', (select count(*) from command_events where status = 'dead'))
  );
$$;
grant execute on function public.command_studio_health() to authenticated;

select public.command_sweep_dispatch();
