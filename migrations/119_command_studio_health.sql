-- EvoForge 119 — the studio stops lying about being busy, and heals itself.
--
-- THE BUG, AND WHY IT HID FOR A DAY
--
-- command_claim_dispatch filters `attempts < max_attempts`. Every claim
-- increments attempts. command_reclaim_stale_dispatch (098) returns an orphaned
-- job to 'pending' — and leaves attempts where it was.
--
-- So a job whose runner died three times became: status 'pending', attempts 3,
-- max_attempts 3. Permanently unclaimable, and still displaying as PENDING —
-- work that looks like it is about to start and never can. Five of them, the
-- oldest sitting there for twelve hours, while the Floor showed a queue and the
-- Exec reported "idle".
--
-- The conceptual error is small and total: THE ATTEMPT WAS CONSUMED BY A RUNNER
-- DYING, NOT BY THE WORK FAILING. A crash is not a failed try. Reclaim now
-- gives the attempt back, which prevents the state existing at all.
--
-- And because "prevent it" is never enough on its own, command_sweep_dispatch
-- converts any row that reaches the impossible state into a real failure with a
-- real reason. A queue is allowed to contain work that failed. It is not
-- allowed to contain work that is pretending.
--
-- ENVIRONMENTAL FAILURES ARE NOT CODE FAILURES
--
-- Eleven of the sixteen recorded dispatch failures say "verification failed:
-- typecheck, tests, lint" with tokens passing — the signature of a worktree
-- with no node_modules, not of broken code. tokens passes precisely because it
-- is the one check that runs on bare node. The runner now provisions
-- dependencies before verifying (see ensureDeps), so these are recoverable, and
-- the sweep can hand them back rather than leaving a day of work written off.
--
-- FALSIFICATION (scripts/_falsify119.mjs):
--   1. reclaiming an orphaned job does not consume an attempt.
--   2. a pending job at max attempts is swept into 'failed' with a reason.
--   3. the sweep never resurrects a job a founder cancelled.
--   4. requeue-after-fix is founder-only and needs a stated fix.
--   5. studio health reports stuck work rather than counting it as queued.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A CRASH IS NOT A FAILED ATTEMPT
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilt on 098's version — the detection logic (never seen, stopped, gone
 * quiet, claimed by an earlier incarnation) is unchanged and correct. The only
 * change is the one line that gives the attempt back.
 */
create or replace function public.command_reclaim_stale_dispatch(p_stale_minutes integer default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_tasks uuid[];
  v_rows int := 0;
begin
  select coalesce(array_agg(d.id), '{}'), coalesce(array_agg(d.task_id) filter (where d.task_id is not null), '{}')
    into v_ids, v_tasks
    from command_dispatch d
    left join command_runners r on r.worker = d.claimed_by
   where d.status = 'claimed'
     and (
          r.worker is null
       or r.state = 'stopped'
       or r.last_seen_at < now() - make_interval(mins => p_stale_minutes)
       or (r.started_at is not null and d.claimed_at is not null and d.claimed_at < r.started_at)
     );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'reclaimed', 0);
  end if;

  update command_dispatch
     set status = 'pending', claimed_by = null, claimed_at = null,
         -- THE FIX. The runner died; the job never got its turn. Charging it an
         -- attempt is how five jobs became permanently unclaimable while still
         -- showing as pending.
         attempts = greatest(0, attempts - 1),
         updated_at = now()
   where id = any(v_ids);
  get diagnostics v_rows = row_count;

  update command_tasks
     set status = 'queued', progress = 0, activity = null, activity_at = null, updated_at = now()
   where id = any(v_tasks)
     and status in ('building','planning','testing');

  perform command_log('dispatch_reclaimed', 'settings', null, 'dispatch',
                      v_rows || ' job(s) were claimed by a runner that is no longer running and have been returned to the queue with their attempt refunded',
                      jsonb_build_object('rows', v_rows, 'stale_minutes', p_stale_minutes));

  return jsonb_build_object('ok', true, 'reclaimed', v_rows);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE SWEEP — nothing may sit in a state it cannot leave
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn impossible states into honest ones.
 *
 * Called by the runner every cycle. It does not decide anything and it does not
 * retry anything — it takes rows that can never be claimed and marks them
 * failed with the reason, so the number on the Floor means what it says.
 *
 * Deliberately does NOT touch 'cancelled': a founder stopping a job is a
 * decision, and a sweep that quietly reopened it would be overriding a human.
 */
create or replace function public.command_sweep_dispatch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stuck int := 0; v_ids uuid[];
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

    perform command_log('dispatch_swept', 'settings', null, 'dispatch',
      format('%s job(s) were pending but unclaimable (attempts had reached the limit) and are now recorded as failed', v_stuck),
      jsonb_build_object('rows', v_stuck), 'system', 'sweep');
  end if;

  return jsonb_build_object('ok', true, 'swept', v_stuck);
end $$;

/**
 * Hand failed work back after the cause was fixed.
 *
 * Founder-only and the fix must be stated, for the same reason replaying an
 * event is: requeueing work whose cause is unresolved just burns the attempts
 * again and buries the real reason under a second identical failure.
 *
 * `p_only_environmental` requeues just the ones whose failure signature says
 * the toolchain was missing rather than the code being wrong — the eleven
 * "typecheck, tests, lint" rows where tokens passed.
 */
create or replace function public.command_requeue_dispatch(
  p_reason text, p_only_environmental boolean default true, p_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows int := 0; v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say what was fixed. Requeueing work whose cause is unresolved just fails it again and buries the reason';
  end if;

  select name into v_name from command_founders where user_id = auth.uid();

  update command_dispatch
     set status = 'pending', attempts = 0, claimed_by = null, claimed_at = null,
         error = null, updated_at = now()
   where status = 'failed'
     and (p_ids is null or id = any(p_ids))
     and (not p_only_environmental
          -- The signature of a missing toolchain: the checks that need npm/npx
          -- failed while `tokens`, the one that runs on bare node, passed.
          or error ilike '%verification failed%'
          or error ilike '%could not run%'
          or error ilike '%typescript%'
          or error ilike '%cannot find module%');
  get diagnostics v_rows = row_count;

  perform command_log('dispatch_requeued', 'settings', null, 'dispatch',
    format('%s requeued %s failed job(s)%s — %s', coalesce(v_name,'a founder'), v_rows,
           case when p_only_environmental then ' whose failure looked environmental' else '' end, p_reason),
    jsonb_build_object('rows', v_rows, 'reason', p_reason, 'only_environmental', p_only_environmental));

  return jsonb_build_object('ok', true, 'requeued', v_rows);
end $$;
revoke all on function public.command_requeue_dispatch(text, boolean, uuid[]) from public, anon;
grant execute on function public.command_requeue_dispatch(text, boolean, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. STUDIO HEALTH — what is actually wrong, and who has to act
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * One call answering "is the studio working, and if not, why".
 *
 * Every entry names a cause and who can clear it. The Floor previously showed a
 * queue length and a runner light, both of which were green while five jobs
 * were permanently stuck — the numbers were true and the picture was false.
 *
 * Failures are grouped by CLASS rather than listed, because eleven rows saying
 * "verification failed" are one problem, and reading them as eleven is how a
 * single missing node_modules looked like a codebase falling apart.
 */
create or replace function public.command_studio_health()
returns jsonb language sql stable security definer set search_path = public as $$
  with fail_classes as (
    select case
             when error ilike '%verification failed%' or error ilike '%could not run%'
               or error ilike '%typescript%' or error ilike '%cannot find module%'
               then 'environment'
             when error ilike '%protected paths%' then 'protected_paths'
             when error ilike '%acceptance criteria%' then 'no_criteria'
             when error ilike '%commit failed%' then 'git'
             when coalesce(trim(error),'') = '' then 'unexplained'
             else 'other' end as class,
           count(*) n,
           max(updated_at) last_at,
           (array_agg(left(coalesce(error,'(no error recorded)'), 220) order by updated_at desc))[1] as example
      from command_dispatch where status = 'failed'
     group by 1
  )
  select jsonb_build_object(
    'generated_at', now(),
    'queue', jsonb_build_object(
      'claimable', (select count(*) from command_dispatch
                     where status = 'pending' and attempts < max_attempts),
      -- The number that was missing. Pending but unclaimable.
      'stuck', (select count(*) from command_dispatch
                 where status = 'pending' and attempts >= max_attempts),
      'in_flight', (select count(*) from command_dispatch where status = 'claimed'),
      'failed', (select count(*) from command_dispatch where status = 'failed'),
      'oldest_pending', (select min(created_at) from command_dispatch where status = 'pending')),
    'failure_classes', (select coalesce(jsonb_agg(jsonb_build_object(
        'class', class, 'count', n, 'last_at', last_at, 'example', example,
        'meaning', case class
          when 'environment' then 'The toolchain was missing in the worktree, not the code being wrong. Recoverable: fix the environment and requeue.'
          when 'protected_paths' then 'The commit touched migrations, auth, payments or another protected path without architect authority. A founder must grant it or narrow the work order.'
          when 'no_criteria' then 'The work order has no acceptance criteria, so there is no checkable definition of done. A founder must write them.'
          when 'git' then 'A git operation refused. Usually the main checkout was dirty or a branch was held elsewhere.'
          when 'unexplained' then 'The failure recorded no reason at all. That is itself a bug — git writes refusals to stdout, so a silent failure means the output was never captured.'
          else 'Uncategorised.' end,
        'recoverable', class in ('environment','git'))
      order by n desc), '[]'::jsonb) from fail_classes),
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HEAL WHAT IS ALREADY BROKEN
-- ─────────────────────────────────────────────────────────────────────────────

-- The five stuck rows, recorded honestly rather than left pretending.
select public.command_sweep_dispatch();

-- WO-006 and WO-005 have no acceptance criteria, which is why an agent refused
-- to implement them — correctly, and with nowhere to go afterwards. That is a
-- founder decision, not something to invent here: command_studio_health now
-- reports orders_without_criteria so it is visible rather than discovered by
-- reading a failure message three days later.
