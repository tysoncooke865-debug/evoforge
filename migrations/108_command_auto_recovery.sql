-- EvoForge 108 — a coding error should fix itself; a judgement call should not.
--
-- Tyson: "whenever a block is detected, if it is just an error in coding etc,
-- fix the error and unblock it."
--
-- THE DISTINCTION THIS FILE EXISTS TO DRAW. Blocks are not one thing:
--
--   RECOVERABLE — a mechanical failure the agent can be told about and fix:
--     typecheck errors, failing tests, lint, a commit or push that failed for a
--     reason inside the agent's control. Re-running with the error text in hand
--     is exactly what a developer would do, and there is nobody to ask.
--
--   NOT RECOVERABLE — a block that is a JUDGEMENT, and retrying it is at best
--     waste and at worst harm:
--       · the agent wrote "BLOCKED:" — it deliberately refused, and looping it
--         until it stops refusing is coercing a considered answer out of the
--         one part of the system built to say no
--       · protected paths without architect authority — only a vote grants that
--       · the agent changed nothing — retrying an agent that found nothing to
--         do produces nothing again
--       · the attempt budget is spent — endless self-repair is the failure mode
--         this studio is explicitly built to avoid
--
-- Retrying the second class is how an autonomous system burns a day rediscovering
-- that it needs a human. So the classifier is conservative: anything it cannot
-- confidently call mechanical stays blocked for a founder.
--
-- FALSIFICATION CHECKLIST:
--   1. a typecheck failure is classified recoverable and requeued.
--   2. an agent's own "BLOCKED:" is NOT retried.
--   3. a protected-path refusal is NOT retried.
--   4. a task at its attempt budget is NOT retried, whatever the reason.
--   5. the failure text reaches the next attempt.

create or replace function public.command_classify_block(p_reason text)
returns jsonb language plpgsql immutable as $$
declare r text := lower(coalesce(p_reason, ''));
begin
  -- Order matters: the non-recoverable tests run FIRST, because several of them
  -- also contain words that look mechanical.
  if r like '%protected path%' or r like '%architect authority%' then
    return jsonb_build_object('recoverable', false, 'class', 'needs_authority',
      'why', 'Only a founder vote can grant architect authority. Retrying cannot obtain it.');
  end if;
  if r like '%without changing any file%' or r like '%no changes%' then
    return jsonb_build_object('recoverable', false, 'class', 'no_work_done',
      'why', 'The agent found nothing to change. Running it again produces the same nothing.');
  end if;
  if r like 'blocked:%' or r like '%i will not guess%' or r like '%no checkable definition%' then
    return jsonb_build_object('recoverable', false, 'class', 'agent_refused',
      'why', 'The agent deliberately refused. Looping it until it stops refusing defeats the one part of the system built to say no.');
  end if;
  if r like '%merge conflict%' then
    return jsonb_build_object('recoverable', false, 'class', 'merge_conflict',
      'why', 'Resolve by hand — an agent guessing at a conflict resolution can silently discard work.');
  end if;

  -- Mechanical: the agent can be shown the output and fix it.
  if r like '%verification failed%' or r like '%typecheck%' or r like '%tsc%'
     or r like '%test%' or r like '%lint%' or r like '%tokens%' then
    return jsonb_build_object('recoverable', true, 'class', 'checks_failed',
      'why', 'A failing check is a defect with its own error message attached — exactly what a retry can use.');
  end if;
  if r like '%commit failed%' or r like '%push failed%' then
    return jsonb_build_object('recoverable', true, 'class', 'git_mechanical',
      'why', 'A git failure with output is usually a state problem the next attempt can clear.');
  end if;

  return jsonb_build_object('recoverable', false, 'class', 'unknown',
    'why', 'Unrecognised block. Left for a human rather than retried on a guess.');
end $$;
grant execute on function public.command_classify_block(text) to authenticated;

/**
 * Requeue a blocked task, carrying the failure into the next attempt.
 *
 * Refuses when the block is a judgement, and refuses when the budget is spent.
 * The failure text is written into the work order's exec_state so the context
 * compiler can hand it to the next agent — a retry that is not told what went
 * wrong is just the same roll of the dice.
 */
create or replace function public.command_retry_task(p_task uuid, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; wo record; v_class jsonb; v_attempts int;
begin
  select * into t from command_tasks where id = p_task;
  if t is null then raise exception 'command: no such task'; end if;
  if t.status <> 'blocked' then
    return jsonb_build_object('ok', false, 'reason', 'task is not blocked');
  end if;

  select * into wo from command_work_orders where id = t.work_order_id;
  v_attempts := coalesce(wo.attempts_used, 0);

  if v_attempts >= coalesce(wo.attempt_budget, 3) and not p_force then
    return jsonb_build_object('ok', false, 'reason',
      format('attempt budget spent (%s/%s) — endless self-repair is the failure mode this studio avoids',
             v_attempts, wo.attempt_budget));
  end if;

  v_class := command_classify_block(t.blocked_reason);
  if not (v_class->>'recoverable')::boolean and not p_force then
    return jsonb_build_object('ok', false, 'class', v_class->>'class',
                              'reason', v_class->>'why');
  end if;

  -- Hand the failure forward. Without this the next attempt repeats the last.
  update command_work_orders
     set exec_state = coalesce(exec_state, '{}'::jsonb) || jsonb_build_object(
           'last_failure', jsonb_build_object(
             'task', t.agent_key,
             'reason', left(coalesce(t.blocked_reason,''), 1500),
             'class', v_class->>'class',
             'at', now())),
         attempts_used = v_attempts + 1,
         updated_at = now()
   where id = t.work_order_id;

  update command_tasks
     set status = 'queued', progress = 0, blocked_reason = null,
         activity = null, activity_at = null, updated_at = now()
   where id = p_task;

  insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
  values ('implement', t.work_order_id, p_task, 40, jsonb_build_object('role', t.agent_key, 'retry', true));

  perform command_log('task_auto_retried', 'work_order', t.work_order_id, wo.ref,
    format('%s auto-retried after a %s block (attempt %s of %s)',
           t.agent_key, v_class->>'class', v_attempts + 1, wo.attempt_budget),
    jsonb_build_object('class', v_class->>'class', 'attempt', v_attempts + 1));

  return jsonb_build_object('ok', true, 'class', v_class->>'class', 'attempt', v_attempts + 1);
end $$;
revoke all on function public.command_retry_task(uuid, boolean) from public, anon;
grant execute on function public.command_retry_task(uuid, boolean) to authenticated;
