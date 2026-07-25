-- EvoForge 091 — not every approved decision is engineering work.
--
-- FOUND BY TYSON LOOKING AT THE FLOOR: "the work in flight progress bar is at
-- 0%, I don't know if the agents are working." They were not. Two separate
-- faults, and the second is the interesting one.
--
-- FAULT 1 — no runner was connected. Nine dispatch rows sat pending with
-- attempts=0 and claimed_by=null, and the Development Floor rendered them as
-- 0% progress bars, which looks identical to work about to start. This whole
-- product exists to stop a system implying activity it cannot show, and its own
-- floor did exactly that. Fixed here with command_runners: the floor can now
-- say "no runner has checked in since 13:47" instead of drawing an empty bar.
--
-- FAULT 2 — the workflow assumed every approval is code. The first three
-- proposals the Exec raised were the three highest-value open items in the
-- company, and all three are things only a founder can do: decide who holds
-- admin, buy and verify a mail domain, issue a GitHub token. Approving them
-- manufactured nine engineering tasks that no agent could ever complete, and
-- would have sent Claude Code into the repo with nothing to write.
--
-- So a proposal now declares HOW it gets executed:
--
--   engineering    — agents build it. Dispatch rows are created. (unchanged)
--   founder_action — a founder does it by hand. A work order is still opened so
--                    it is tracked and audited, but the task is assigned to the
--                    council, NOT to an agent, and nothing is dispatched.
--   decision_only  — the vote IS the deliverable. Recording it is the whole
--                    act; no work order, no branch, no task.
--
-- The Exec must set this when it writes a candidate. Getting it wrong is now a
-- visible mistake rather than a silent queue of impossible work.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EXECUTION KIND
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_proposals
  add column if not exists execution text not null default 'engineering'
    check (execution in ('engineering', 'founder_action', 'decision_only'));
alter table public.command_backlog
  add column if not exists execution text not null default 'engineering'
    check (execution in ('engineering', 'founder_action', 'decision_only'));
alter table public.command_work_orders
  add column if not exists execution text not null default 'engineering';

-- A task can now be waiting on a person. Without this the floor has to call a
-- founder's to-do "queued", which is how nine impossible jobs looked normal.
alter table public.command_tasks drop constraint if exists command_tasks_status_check;
alter table public.command_tasks add constraint command_tasks_status_check
  check (status in ('queued','planning','building','testing','awaiting_review',
                    'blocked','completed','ready_for_release','awaiting_founder'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RUNNER PRESENCE — so "nobody is working" is a fact, not an inference.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_runners (
  worker       text primary key,
  last_seen_at timestamptz not null default now(),
  repo         text,
  claimed      bigint not null default 0,
  detail       jsonb not null default '{}'::jsonb
);
alter table public.command_runners enable row level security;
drop policy if exists command_runners_read on public.command_runners;
create policy command_runners_read on public.command_runners for select using (public.is_founder());
revoke insert, update, delete on public.command_runners from authenticated, anon;

-- Every claim is a heartbeat, including the ones that come back empty. A runner
-- that is up and idle and a runner that is not running at all must not look the
-- same on the floor.
create or replace function public.command_claim_dispatch(p_worker text, p_kinds text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; v_halted boolean;
begin
  insert into command_runners (worker, last_seen_at) values (p_worker, now())
  on conflict (worker) do update set last_seen_at = now();

  select (value)::text::boolean into v_halted from command_settings where key = 'halted';
  if coalesce(v_halted, false) then return jsonb_build_object('halted', true); end if;

  select * into d from command_dispatch
   where status = 'pending' and attempts < max_attempts
     and (p_kinds is null or kind = any(p_kinds))
   order by priority, created_at
   for update skip locked limit 1;
  if d is null then return jsonb_build_object('empty', true); end if;

  update command_dispatch
     set status = 'claimed', claimed_by = p_worker, claimed_at = now(),
         attempts = attempts + 1, updated_at = now()
   where id = d.id;
  update command_runners set claimed = claimed + 1 where worker = p_worker;

  return jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'payload', d.payload, 'attempt', d.attempts + 1,
    'work_order', (select to_jsonb(w) from command_work_orders w where w.id = d.work_order_id),
    'task', (select to_jsonb(t) from command_tasks t where t.id = d.task_id),
    'release', (select to_jsonb(r) from command_releases r where r.id = d.release_id),
    'proposal', (select to_jsonb(p) from command_proposals p
                  join command_work_orders w on w.proposal_id = p.id where w.id = d.work_order_id));
end $$;
revoke all on function public.command_claim_dispatch(text, text[]) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OPENING WORK, NOW AWARE OF WHO ACTUALLY DOES IT
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_open_work(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record; v_ref text; v_no int; v_wo uuid; v_branch text; v_agent text; v_ws uuid;
  v_task uuid; v_exec_task uuid;
begin
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if exists (select 1 from command_work_orders where proposal_id = p_proposal) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- The vote was the deliverable. Record it and stop — opening a branch for a
  -- decision is how a governance system fills up with work nobody can finish.
  if pr.execution = 'decision_only' then
    perform command_log('decision_recorded', 'proposal', p_proposal, pr.ref,
                        pr.ref || ' decided. No work order — the decision itself was the deliverable.',
                        jsonb_build_object('execution', 'decision_only'), 'system', 'automatic workflow');
    return jsonb_build_object('ok', true, 'execution', 'decision_only', 'work_order', null);
  end if;

  v_no := nextval('command_work_order_seq');
  v_ref := 'WO-' || lpad(v_no::text, 3, '0');
  v_branch := case when pr.execution = 'engineering'
                   then 'command/wo-' || lpad(v_no::text, 3, '0') || '-' || left(command_slug(pr.title), 40)
                   else '(no branch — founder action)' end;

  insert into command_work_orders (
    ref, proposal_id, title, objectives, scope, exclusions, acceptance_criteria,
    technical_requirements, design_requirements, testing_requirements,
    analytics_requirements, branch, assigned_agents, status, auto_deploy, execution)
  values (
    v_ref, p_proposal, pr.title,
    array[pr.recommendation], pr.problem,
    case when pr.execution = 'founder_action'
         then array['Anything an agent could do on its own — this work is blocked on a founder by nature']
         else array['Anything not named in the objectives',
                    case when pr.deploy_policy = 'auto'
                         then 'Any change outside ' || coalesce(nullif(array_to_string(pr.affected_screens, ', '), ''), 'the stated scope') || ' (this work order deploys on completion — scope creep ships)'
                         else 'Production deployment (requires a separate release vote)' end,
                    'Schema changes not named in the proposal'] end,
    pr.benefits, '{}', '{}',
    case when pr.execution = 'founder_action' then '{}'
         else array['Regression pass on affected screens', 'Sentinel review before release'] end,
    '{}', v_branch,
    case when pr.execution = 'founder_action' then '{}' else pr.departments end,
    'in_progress',
    pr.deploy_policy = 'auto' and pr.execution = 'engineering',
    pr.execution)
  returning id into v_wo;

  -- ── founder action: tracked and audited, but nothing is dispatched ────────
  if pr.execution = 'founder_action' then
    insert into command_tasks (work_order_id, agent_key, title, status, latest_reasoning, blocked_reason)
    values (v_wo, 'exec',
            pr.title,
            'awaiting_founder',
            'Approved. This one cannot be built by an agent — it needs a founder to act.',
            coalesce(nullif(pr.exec_recommendation, ''), 'Waiting on a founder.'));
    perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                        'Opened from ' || pr.ref || ' — FOUNDER ACTION, no agent assigned',
                        jsonb_build_object('execution', 'founder_action'), 'system', 'automatic workflow');
    return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref, 'execution', 'founder_action');
  end if;

  -- ── engineering: unchanged ────────────────────────────────────────────────
  insert into command_lab_workspaces (work_order_id, proposal_id, name, branch, status)
  values (v_wo, p_proposal, pr.title, v_branch, 'provisioned') returning id into v_ws;

  insert into command_tasks (work_order_id, agent_key, title, status, branch, latest_reasoning, started_at)
  values (v_wo, 'exec', 'Plan ' || v_ref || ' — ' || pr.title, 'planning', v_branch,
          'Work order opened by founder vote. Decomposing into department scope.', now())
  returning id into v_exec_task;

  insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
  values ('implement', v_wo, v_exec_task, 10,
          jsonb_build_object('role','exec','instruction','Plan the work order and write the implementation plan into the task events.'));

  foreach v_agent in array coalesce(pr.departments, '{}') loop
    if exists (select 1 from command_agents where key = v_agent and active) then
      insert into command_tasks (work_order_id, agent_key, title, status, branch, dependencies)
      values (v_wo, v_agent, pr.title, 'queued', v_branch, array['exec'])
      returning id into v_task;
      insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
      values ('implement', v_wo, v_task, 50, jsonb_build_object('role', v_agent));
    end if;
  end loop;

  perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                      'Auto-generated from ' || pr.ref || ' on approval' ||
                      case when pr.deploy_policy = 'auto' then ' — DEPLOY AUTHORISED by the same vote' else '' end,
                      jsonb_build_object('branch', v_branch, 'departments', pr.departments,
                                         'lab_workspace', v_ws, 'auto_deploy', pr.deploy_policy = 'auto'),
                      'system', 'automatic workflow');
  return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref,
                            'branch', v_branch, 'auto_deploy', pr.deploy_policy = 'auto');
end $$;
revoke all on function public.command_open_work(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PROPOSALS CARRY EXECUTION + THE DEPLOY DEFAULT ACTUALLY APPLIES
-- ─────────────────────────────────────────────────────────────────────────────
-- 090 added a default_deploy_policy setting and then never read it — a control
-- that does nothing is worse than no control, because someone will trust it.
create or replace function public.command_create_proposal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; v_id uuid; v_default text; v_policy text; v_exec text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  select (value)#>>'{}' into v_default from command_settings where key = 'default_deploy_policy';
  v_exec := coalesce(p->>'execution', 'engineering');
  -- Only engineering work can auto-deploy. There is nothing to ship from a
  -- decision, and a founder action ships by hand or not at all.
  v_policy := case when v_exec <> 'engineering' then 'gated'
                   else coalesce(p->>'deploy_policy', v_default, 'gated') end;

  v_ref := 'PROP-' || lpad(nextval('command_proposal_seq')::text, 3, '0');
  insert into command_proposals (
    ref, title, category, problem, recommendation, reasoning, benefits, risks,
    alternatives, complexity, departments, est_days, affected_screens, dependencies,
    exec_recommendation, documents, author_kind, author_key, author_id, status,
    opened_at, execution, deploy_policy)
  values (
    v_ref,
    coalesce(p->>'title', 'Untitled'),
    coalesce(p->>'category', 'prototype'),
    coalesce(p->>'problem', ''), coalesce(p->>'recommendation', ''), coalesce(p->>'reasoning', ''),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'benefits','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'risks','[]'::jsonb))), '{}'),
    coalesce(p->'alternatives', '[]'::jsonb),
    coalesce(p->>'complexity', 'medium'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'departments','[]'::jsonb))), '{}'),
    nullif(p->>'est_days','')::numeric,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'affected_screens','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'dependencies','[]'::jsonb))), '{}'),
    coalesce(p->>'exec_recommendation', ''),
    coalesce(p->'documents', '[]'::jsonb),
    coalesce(p->>'author_kind', case when auth.uid() is null then 'agent' else 'founder' end),
    p->>'author_key', auth.uid(),
    case when coalesce(p->>'status','open') = 'draft' then 'draft' else 'open' end,
    case when coalesce(p->>'status','open') = 'draft' then null else now() end,
    v_exec, v_policy)
  returning id into v_id;

  perform command_log('proposal_created', 'proposal', v_id, v_ref,
                      coalesce(p->>'title','Untitled'),
                      jsonb_build_object('category', coalesce(p->>'category','prototype'),
                                         'execution', v_exec, 'deploy_policy', v_policy),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      coalesce(p->>'author_key', (select name from command_founders where user_id = auth.uid()), 'system'));
  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref);
end $$;
grant execute on function public.command_create_proposal(jsonb) to authenticated;

-- The Exec's cycle must pass the candidate's execution kind through, or every
-- proposal it raises reverts to 'engineering' and we are back where we started.
create or replace function public.command_exec_cycle_inner()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_cap int; v_gap int; v_cooldown int; v_stale int;
  v_open int; v_last timestamptz; v_waiting text[]; v_blocked jsonb := '[]'::jsonb;
  b record; v_block text; v_res jsonb; v_reason text; v_stale_n int;
begin
  select (value)::text::boolean into v_on    from command_settings where key = 'autopilot';
  select (value)::text::int  into v_cap      from command_settings where key = 'max_open_proposals';
  select (value)::text::int  into v_gap      from command_settings where key = 'min_minutes_between_proposals';
  select (value)::text::int  into v_cooldown from command_settings where key = 'rejected_cooldown_days';
  select (value)::text::int  into v_stale    from command_settings where key = 'stale_task_hours';

  update command_backlog set status = 'candidate', defer_until = null, updated_at = now()
   where status = 'deferred' and defer_until is not null and defer_until <= now();

  -- Only agent-executable work can be stale. A founder action sitting for a
  -- week is a nudge, not an incident, and counting it as stale would train
  -- everyone to ignore the number.
  select count(*) into v_stale_n from command_tasks
   where status in ('building','testing','planning') and updated_at < now() - make_interval(hours => v_stale);

  select array_agg(ref order by created_at) into v_waiting
    from command_proposals where status in ('open','changes_requested');
  v_open := coalesce(array_length(v_waiting, 1), 0);

  if not coalesce(v_on, true) then
    insert into command_exec_heartbeat (action, reason, detail)
    values ('paused', 'Autopilot is off — the founders switched it off.',
            jsonb_build_object('open_proposals', v_open, 'stale_tasks', v_stale_n));
    return jsonb_build_object('action','paused');
  end if;

  if v_open >= v_cap then
    v_reason := 'Council queue is full (' || v_open || '/' || v_cap ||
                '). Nothing new is rational until the founders decide ' ||
                array_to_string(v_waiting, ', ') || '.';
    insert into command_exec_heartbeat (action, reason, detail)
    values ('idle', v_reason, jsonb_build_object('waiting_on', v_waiting, 'stale_tasks', v_stale_n));
    return jsonb_build_object('action','idle','reason',v_reason,'waiting_on',v_waiting);
  end if;

  select max(created_at) into v_last from command_proposals;
  if v_last is not null and v_last > now() - make_interval(mins => v_gap) then
    v_reason := 'Pacing — last proposal was ' ||
                round(extract(epoch from (now() - v_last)) / 60) || ' minutes ago, minimum gap is ' || v_gap || '.';
    insert into command_exec_heartbeat (action, reason, detail)
    values ('idle', v_reason, jsonb_build_object('last_proposal_at', v_last));
    return jsonb_build_object('action','idle','reason',v_reason);
  end if;

  for b in
    select * from command_backlog
     where status = 'candidate' and (defer_until is null or defer_until <= now())
     order by ((value_score * confidence_score * 10) / greatest(effort_score,1)) desc, created_at
  loop
    v_block := command_dependency_block(b.depends_on);

    if v_block is null and exists (
      select 1 from command_proposals p
       where p.status = 'rejected' and p.decided_at > now() - make_interval(days => v_cooldown)
         and p.id = b.proposal_id) then
      v_block := 'rejected within the ' || v_cooldown || '-day cooldown';
    end if;

    if v_block is null then
      v_res := command_create_proposal(
        (b.document || jsonb_build_object(
          'title', b.title, 'category', b.category,
          'departments', to_jsonb(b.departments),
          'execution', b.execution,
          'author_kind', 'agent', 'author_key', 'exec', 'status', 'open')));

      update command_backlog
         set status = 'proposed', proposal_id = (v_res->>'id')::uuid, updated_at = now()
       where id = b.id;

      insert into command_exec_heartbeat (action, reason, topic_key, proposal_id, detail)
      values ('proposed', 'Raised ' || (v_res->>'ref') || ' — ' || b.title,
              b.topic_key, (v_res->>'id')::uuid,
              jsonb_build_object('priority', (b.value_score * b.confidence_score * 10) / greatest(b.effort_score,1),
                                 'source', b.source, 'execution', b.execution));
      return jsonb_build_object('action','proposed','ref',v_res->>'ref','topic',b.topic_key);
    end if;

    v_blocked := v_blocked || jsonb_build_object('topic', b.topic_key, 'title', b.title, 'blocked_by', v_block);
  end loop;

  if jsonb_array_length(v_blocked) > 0 then
    v_reason := 'Every remaining improvement depends on a decision that has not been made: ' ||
                (select string_agg(x->>'topic' || ' → ' || (x->>'blocked_by'), '; ')
                   from jsonb_array_elements(v_blocked) x);
  else
    v_reason := 'No rational improvement is available. The backlog holds no scored candidate; ' ||
                'the Exec needs a fresh scan of the product before it can honestly recommend anything.';
  end if;

  insert into command_exec_heartbeat (action, reason, detail)
  values ('idle', v_reason, jsonb_build_object('blocked', v_blocked, 'stale_tasks', v_stale_n, 'waiting_on', v_waiting));
  return jsonb_build_object('action','idle','reason',v_reason,'blocked',v_blocked);
end $$;
revoke all on function public.command_exec_cycle_inner() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. A FOUNDER MARKS THEIR OWN WORK DONE
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_complete_founder_task(p_task uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_name text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into t from command_tasks where id = p_task;
  if t is null then raise exception 'command: no such task'; end if;
  if t.status <> 'awaiting_founder' then
    raise exception 'command: % is not a founder action', t.title;
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_tasks
     set status = 'completed', progress = 100, completed_at = now(), updated_at = now(),
         blocked_reason = null,
         latest_reasoning = coalesce(nullif(p_note,''), 'Done by ' || v_name || '.')
   where id = p_task;
  update command_work_orders set status = 'complete', updated_at = now() where id = t.work_order_id;
  update command_backlog set status = 'done', updated_at = now()
   where proposal_id = (select proposal_id from command_work_orders where id = t.work_order_id);

  insert into command_task_events (task_id, kind, message)
  values (p_task, 'status', 'awaiting_founder → completed (' || v_name || ')');
  perform command_log('founder_action_done', 'task', p_task, null,
                      v_name || ' completed "' || t.title || '"' ||
                      case when p_note <> '' then ' — ' || p_note else '' end);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.command_complete_founder_task(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE PULSE REPORTS RUNNER PRESENCE
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_pulse()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'autopilot', (select value from command_settings where key = 'autopilot'),
    'last', (select to_jsonb(h) from command_exec_heartbeat h order by at desc limit 1),
    'recent', coalesce((select jsonb_agg(to_jsonb(h) order by h.at desc)
                          from (select * from command_exec_heartbeat order by at desc limit 20) h), '[]'::jsonb),
    -- The honest answer to "are the agents working": who has checked in, when,
    -- and how much work is sitting unclaimed.
    'runners', coalesce((select jsonb_agg(to_jsonb(r) order by r.last_seen_at desc)
                           from command_runners r), '[]'::jsonb),
    'runner_online', exists (select 1 from command_runners where last_seen_at > now() - interval '2 minutes'),
    'dispatch_pending', (select count(*) from command_dispatch where status = 'pending'),
    'dispatch_running', (select count(*) from command_dispatch where status in ('claimed','running')),
    'awaiting_founder', (select count(*) from command_tasks where status = 'awaiting_founder'),
    'backlog', coalesce((select jsonb_agg(x order by (x->>'priority')::int desc) from (
        select jsonb_build_object('topic_key', b.topic_key, 'title', b.title, 'status', b.status,
                                  'category', b.category, 'departments', b.departments,
                                  'rationale', b.rationale, 'source', b.source, 'execution', b.execution,
                                  'value', b.value_score, 'effort', b.effort_score,
                                  'confidence', b.confidence_score,
                                  'priority', (b.value_score * b.confidence_score * 10) / greatest(b.effort_score,1),
                                  'depends_on', b.depends_on,
                                  'blocked_by', command_dependency_block(b.depends_on),
                                  'defer_until', b.defer_until, 'defer_reason', b.defer_reason,
                                  'proposal_id', b.proposal_id) as x
          from command_backlog b where b.status in ('candidate','deferred','proposed')) s), '[]'::jsonb),
    'stale_tasks', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select id, agent_key, title, status, updated_at from command_tasks
         where status in ('building','testing','planning')
           and updated_at < now() - make_interval(hours => (select (value)::text::int from command_settings where key='stale_task_hours'))
         order by updated_at limit 10) t), '[]'::jsonb)
  );
end $$;
grant execute on function public.command_pulse() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RECLASSIFY WHAT IS ALREADY IN FLIGHT
-- ─────────────────────────────────────────────────────────────────────────────
-- PROP-001/002/003 were approved as engineering work and are not. Their nine
-- dispatch rows are cancelled rather than deleted — the record should show that
-- work was queued and withdrawn, not that it never existed.
update public.command_backlog set execution = 'decision_only'
 where topic_key in ('admin-account-review', 'git-history-email');
update public.command_backlog set execution = 'founder_action'
 where topic_key in ('custom-smtp', 'github-token', 'legal-operator-details', 'payment-rail');

update public.command_proposals set execution = 'decision_only' where ref = 'PROP-001';
update public.command_proposals set execution = 'founder_action' where ref in ('PROP-002', 'PROP-003');
update public.command_proposals p set execution = b.execution
  from public.command_backlog b
 where b.proposal_id = p.id and p.status in ('open', 'changes_requested');

update public.command_work_orders w set execution = p.execution
  from public.command_proposals p where p.id = w.proposal_id;

update public.command_dispatch d set status = 'cancelled', updated_at = now(),
       error = 'Cancelled by 091: this work order is a founder action or a decision, not engineering.'
  from public.command_work_orders w
 where w.id = d.work_order_id and w.execution <> 'engineering' and d.status in ('pending', 'claimed');

-- Collapse the impossible agent tasks into one honest founder task per order.
delete from public.command_tasks t
 using public.command_work_orders w
 where w.id = t.work_order_id and w.execution <> 'engineering' and t.agent_key <> 'exec';

update public.command_tasks t
   set status = 'awaiting_founder', progress = 0, branch = null,
       latest_reasoning = 'Approved. This one cannot be built by an agent — it needs a founder to act.',
       blocked_reason = coalesce(nullif((select exec_recommendation from command_proposals p
                                          join command_work_orders w2 on w2.proposal_id = p.id
                                         where w2.id = t.work_order_id), ''), 'Waiting on a founder.'),
       updated_at = now()
  from public.command_work_orders w
 where w.id = t.work_order_id and w.execution = 'founder_action';

-- A decision_only proposal should not hold a work order at all.
delete from public.command_tasks t using public.command_work_orders w
 where w.id = t.work_order_id and w.execution = 'decision_only';
delete from public.command_lab_workspaces ws using public.command_work_orders w
 where w.id = ws.work_order_id and w.execution = 'decision_only';
delete from public.command_dispatch d using public.command_work_orders w
 where w.id = d.work_order_id and w.execution = 'decision_only';
delete from public.command_work_orders where execution = 'decision_only';

insert into public.command_audit (actor_kind, actor_label, action, entity_kind, entity_ref, summary, detail)
values ('system', 'migration 091', 'reclassify', 'proposal', null,
        'Nine engineering tasks were queued for three proposals that only a founder can complete. '
        'PROP-001 is a decision (work order withdrawn); PROP-002 and PROP-003 are founder actions '
        '(one tracked task each, nothing dispatched).',
        jsonb_build_object('cause', 'the workflow assumed every approval is code'));
