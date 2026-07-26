-- EvoForge 122 — the studio was paying to redo work it had already finished.
--
-- Of eleven open dispatch rows, three task/kind pairs were DUPLICATED and three
-- pointed at tasks that were already `ready_for_release`. Roughly half the queue
-- was an agent about to redo finished work, or two agents about to do the same
-- work in parallel. Each one is a real model run with a real invoice.
--
-- HOW IT HAPPENED, IN TWO PARTS
--
--   Nothing ever cancelled a dispatch when its task finished. A task could
--   reach ready_for_release through one job while a second job for the same
--   task sat pending behind it, and the queue had no opinion about that.
--
--   And requeueing (121, mine) checked the dispatch row and not the task. When
--   I handed back six "recoverable" failures, some of them belonged to tasks
--   that had completed in the meantime — so the fix for a stuck queue
--   manufactured a redundant one.
--
-- THE STRUCTURAL FIX
--
--   A unique partial index: at most ONE open job per (task, kind). Not a check
--   in the requeue path, not a rule in the runner — an index, so no code path
--   that exists now or is written later can create the second one.
--
--   Plus a sweep that cancels open jobs whose task has finished, because the
--   index prevents duplicates and cannot know that a task moved on.
--
-- WHY 'cancelled' AND NOT 'failed': nothing went wrong. The work was done, or
-- was already being done. Recording it as a failure would put it in the deck's
-- failure classes and send somebody hunting a defect that never existed.
--
-- FALSIFICATION (scripts/_falsify122.mjs):
--   1. a second open dispatch for the same task and kind is refused.
--   2. the index permits a second one once the first is done.
--   3. the sweep cancels open dispatch whose task is finished.
--   4. requeue refuses to reopen a job whose task has finished.
--   5. dispatch with no task (deploy, verify) is unaffected.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CLEAN THE EXISTING MESS, BEFORE THE INDEX CAN REFUSE IT
-- ─────────────────────────────────────────────────────────────────────────────

-- Keep the most-progressed row per (task, kind): a claimed job is mid-flight and
-- cancelling it would waste the work already done. Ties break to the oldest,
-- because that is the one whose place in the queue was earned.
with ranked as (
  select id,
         row_number() over (
           partition by task_id, kind
           order by case status when 'claimed' then 0 else 1 end, created_at
         ) as rn
    from command_dispatch
   where status in ('pending','claimed') and task_id is not null
)
update command_dispatch d
   set status = 'cancelled',
       error = 'Duplicate: another job for the same task and kind was already open.',
       updated_at = now()
  from ranked
 where d.id = ranked.id and ranked.rn > 1;

update command_dispatch d
   set status = 'cancelled',
       error = 'The task reached ' || t.status || ' before this job ran, so there was nothing left to do.',
       updated_at = now()
  from command_tasks t
 where t.id = d.task_id
   and d.status in ('pending','claimed')
   and t.status in ('completed','ready_for_release','awaiting_founder');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ONE OPEN JOB PER TASK AND KIND. ENFORCED BY THE DATABASE.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists command_dispatch_one_open_per_task
  on public.command_dispatch(task_id, kind)
  where status in ('pending','claimed') and task_id is not null;

comment on index public.command_dispatch_one_open_per_task is
  'At most one open job per task and kind. An index rather than a check in the '
  'requeue path, so no code path written later can reintroduce the duplicate '
  'that had four agents queued to do one task.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE SWEEP KEEPS IT TRUE
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilt on 120's version. The stuck and orphaned passes are unchanged; a
 * third pass cancels jobs whose task finished while they waited.
 *
 * The index cannot do this one: it prevents two open jobs existing at once, and
 * has no opinion about a task that moved on afterwards.
 */
create or replace function public.command_sweep_dispatch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stuck int := 0; v_orphan int := 0; v_done int := 0; v_ids uuid[];
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

  -- The task finished while this job waited. Not a failure — there is simply
  -- nothing left to do, and running it would pay a model to redo finished work.
  update command_dispatch d
     set status = 'cancelled',
         error = 'The task reached ' || t.status || ' before this job ran, so there was nothing left to do.',
         updated_at = now()
    from command_tasks t
   where t.id = d.task_id
     and d.status = 'pending'
     and t.status in ('completed','ready_for_release','awaiting_founder');
  get diagnostics v_done = row_count;

  if v_stuck + v_orphan + v_done > 0 then
    perform command_log('dispatch_swept', 'settings', null, 'dispatch',
      format('%s unclaimable job(s) recorded as failed; %s pointed at something that no longer exists; %s were for tasks that had already finished',
             v_stuck, v_orphan, v_done),
      jsonb_build_object('stuck', v_stuck, 'orphaned', v_orphan, 'already_done', v_done),
      'system', 'sweep');
  end if;

  return jsonb_build_object('ok', true, 'swept', v_stuck, 'orphaned', v_orphan, 'already_done', v_done);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. REQUEUE STOPS MANUFACTURING THE PROBLEM
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilt on 119's version, with two conditions added.
 *
 * A failed job is only worth reopening if its task still needs doing and
 * nothing else is already doing it. Without those checks, requeueing a stuck
 * queue creates a redundant one — which is exactly what happened when six
 * "recoverable" failures were handed back and some of their tasks had finished
 * in the meantime.
 */
create or replace function public.command_requeue_dispatch(
  p_reason text, p_only_environmental boolean default true, p_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows int := 0; v_skipped_done int := 0; v_skipped_dup int := 0; v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say what was fixed. Requeueing work whose cause is unresolved just fails it again and buries the reason';
  end if;

  select name into v_name from command_founders where user_id = auth.uid();

  select count(*) into v_skipped_done
    from command_dispatch d join command_tasks t on t.id = d.task_id
   where d.status = 'failed' and (p_ids is null or d.id = any(p_ids))
     and t.status in ('completed','ready_for_release','awaiting_founder');

  select count(*) into v_skipped_dup
    from command_dispatch d
   where d.status = 'failed' and (p_ids is null or d.id = any(p_ids))
     and d.task_id is not null
     and exists (select 1 from command_dispatch o
                  where o.task_id = d.task_id and o.kind = d.kind
                    and o.status in ('pending','claimed'));

  update command_dispatch d
     set status = 'pending', attempts = 0, claimed_by = null, claimed_at = null,
         error = null, updated_at = now()
   where d.status = 'failed'
     and (p_ids is null or d.id = any(p_ids))
     and (not p_only_environmental
          or d.error ilike '%verification failed%'
          or d.error ilike '%could not run%'
          or d.error ilike '%typescript%'
          or d.error ilike '%cannot find module%')
     -- The task must still need doing.
     and (d.task_id is null
          or exists (select 1 from command_tasks t
                      where t.id = d.task_id
                        and t.status not in ('completed','ready_for_release','awaiting_founder')))
     -- And nothing else may already be doing it. The unique index would refuse
     -- this anyway; checking here turns a constraint violation that aborts the
     -- whole statement into a row that is simply skipped and counted.
     and not exists (select 1 from command_dispatch o
                      where o.task_id = d.task_id and o.kind = d.kind
                        and o.status in ('pending','claimed') and d.task_id is not null);
  get diagnostics v_rows = row_count;

  perform command_log('dispatch_requeued', 'settings', null, 'dispatch',
    format('%s requeued %s failed job(s)%s — %s%s', coalesce(v_name,'a founder'), v_rows,
           case when p_only_environmental then ' whose failure looked environmental' else '' end, p_reason,
           case when v_skipped_done + v_skipped_dup > 0
                then format(' (skipped %s already finished and %s already queued)', v_skipped_done, v_skipped_dup)
                else '' end),
    jsonb_build_object('rows', v_rows, 'reason', p_reason,
                       'skipped_finished', v_skipped_done, 'skipped_duplicate', v_skipped_dup));

  return jsonb_build_object('ok', true, 'requeued', v_rows,
                            'skipped_finished', v_skipped_done, 'skipped_duplicate', v_skipped_dup);
end $$;
revoke all on function public.command_requeue_dispatch(text, boolean, uuid[]) from public, anon;
grant execute on function public.command_requeue_dispatch(text, boolean, uuid[]) to authenticated;

select public.command_sweep_dispatch();
