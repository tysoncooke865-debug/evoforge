-- 135 — THE THREE THINGS ACTUALLY STOPPING THE AGENTS
--
-- The Exec has reported the same sentence on every ten-minute cycle since
-- 2026-07-25:
--
--   "Every remaining improvement depends on a decision that has not been made:
--    native-builds → waiting on activation-cliff-jank (proposed);
--    payment-rail  → waiting on activation-cliff-jank (proposed)"
--
-- It reads like a founder is holding things up. Nobody is. Three separate
-- defects, each of which looks like waiting.
--
--
-- DEFECT 1 — A DEPENDENCY THAT CAN NEVER CLEAR.
--
--   command_dependency_block returns "waiting on X" whenever the backlog row X
--   has status <> 'done'. activation-cliff-jank sits at 'proposed'.
--
--   But its proposal — PROP-007 — was APPROVED on 2026-07-25, and WO-006 has
--   been in_progress ever since. The decision the dependants were waiting for
--   was made four days ago. Nothing in the system moves a backlog row from
--   'proposed' to 'done', so the row stays 'proposed' forever and two real
--   candidates stay blocked forever.
--
--   The fix is a semantic one, and it is worth being precise about. `depends_on`
--   in this schema means "do not ASK the founders about B until they have
--   settled A" — you cannot sensibly decide a payment rail while the activation
--   question is still open. It has never meant "wait until A has shipped". So
--   the block clears when the DECISION is made, which is what the dependants
--   were actually waiting for.
--
--
-- DEFECT 2 — SIX ACCEPTANCE CRITERIA, WRITTEN AND THROWN AWAY.
--
--   WO-012 has zero rows in command_criteria. The deck reports it, correctly, as
--   an order agents will refuse to implement because it has no checkable
--   definition of done.
--
--   Its backlog row carries SIX acceptance criteria in document->'acceptance',
--   written by the Dev Lab suggestion pipeline, each one specific and checkable
--   ("On a 390x844 simulator, opening the AI screen shows the RUN ANALYSIS
--   button fully on-screen above the three upload slots without scrolling").
--
--   command_open_work never copied them. Same class of seam as migration 131:
--   the producer wrote a key the consumer never read. This is not a founder
--   having failed to write criteria. It is criteria being written and dropped
--   on the floor.
--
--
-- DEFECT 3 — WORK ORDERS WHOSE ONLY DEFINITION OF DONE IS PROSE.
--
--   WO-007 to WO-011 have neither criteria nor an acceptance array. For those,
--   this migration does NOT invent criteria — guessing at a definition of done
--   is the failure the criteria rule exists to prevent. It promotes the
--   proposal's OWN stated expected_result to a single criterion, marks where it
--   came from in verify_ref, and leaves the rest to a person. An order whose
--   expected result was never stated either gets nothing, and correctly still
--   reads as blocked.

begin;

/* ── 1. A dependency clears when the decision is made ───────────────────── */

create or replace function public.command_dependency_block(p_depends text[])
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare d text; st text; v_prop uuid; v_pstatus text;
begin
  foreach d in array coalesce(p_depends, '{}') loop
    if d like 'PROP-%' then
      select status into st from command_proposals where ref = d;
      if st is null then return d || ' does not exist'; end if;
      if st in ('open','changes_requested','draft') then
        return 'waiting on ' || d || ' (' || st || ')';
      end if;
    else
      select status, proposal_id into st, v_prop from command_backlog where topic_key = d;
      if st is null then return 'unknown dependency ' || d; end if;

      -- Terminal states. 'done' is finished; 'dismissed' is a decision not to
      -- do it, which is every bit as settled as doing it.
      if st in ('done', 'dismissed') then continue; end if;

      -- THE FIX. 'proposed' means a proposal exists. What the dependants are
      -- waiting on is the DECISION, not the delivery — so a decided proposal
      -- clears the block even while its work order is still running.
      if st = 'proposed' and v_prop is not null then
        select status into v_pstatus from command_proposals where id = v_prop;
        if v_pstatus in ('approved','rejected','withdrawn','superseded') then
          continue;
        end if;
        return 'waiting on ' || d || ' — ' ||
               coalesce((select ref from command_proposals where id = v_prop), 'its proposal') ||
               ' is ' || coalesce(v_pstatus, 'unknown') || ' and needs a founder';
      end if;

      -- 'deferred' with a date in the past is not deferred any more.
      if st = 'deferred' then
        if exists (select 1 from command_backlog b
                    where b.topic_key = d and (b.defer_until is null or b.defer_until > now())) then
          return 'waiting on ' || d || ' (deferred)';
        end if;
        continue;
      end if;

      return 'waiting on ' || d || ' (' || st || ')';
    end if;
  end loop;
  return null;
end $$;

/* ── 2. Keep the backlog honest as decisions land ───────────────────────── */

-- A rejected proposal's topic is dismissed, not left as 'proposed' forever
-- pretending a decision is still pending. A completed work order marks its
-- topic done. Both by trigger, because a state machine nobody advances is a
-- state machine that deadlocks — which is defect 1.
create or replace function public.command_sync_backlog_state()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = old.status then return new; end if;

  if new.status in ('rejected','withdrawn','superseded') then
    update command_backlog
       set status = 'dismissed',
           defer_reason = 'The proposal raised for this was ' || new.status || '.',
           updated_at = now()
     where proposal_id = new.id and status = 'proposed';
  end if;
  return new;
end $$;

drop trigger if exists command_proposals_backlog_sync_trg on command_proposals;
create trigger command_proposals_backlog_sync_trg
  after update of status on command_proposals
  for each row execute function public.command_sync_backlog_state();

create or replace function public.command_sync_backlog_on_complete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status <> 'complete' or coalesce(old.status,'') = 'complete' then return new; end if;
  update command_backlog b
     set status = 'done', updated_at = now()
   where b.proposal_id = new.proposal_id and b.status = 'proposed';
  return new;
end $$;

drop trigger if exists command_work_orders_backlog_sync_trg on command_work_orders;
create trigger command_work_orders_backlog_sync_trg
  after update of status on command_work_orders
  for each row execute function public.command_sync_backlog_on_complete();

/* ── 3. Carry the acceptance criteria across ────────────────────────────── */

-- Extends command_open_work (as rewritten by 130). The only addition is the
-- criteria block at the end; everything else is byte-for-byte what 130 left.
create or replace function public.command_open_work(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  pr record; v_ref text; v_no int; v_wo uuid; v_branch text; v_agent text; v_ws uuid;
  v_task uuid; v_exec_task uuid; v_routed text[]; v_planner text;
  v_acc jsonb; v_i int; v_crit int := 0;
begin
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if exists (select 1 from command_work_orders where proposal_id = p_proposal) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if pr.execution = 'decision_only' then
    perform command_log('decision_recorded', 'proposal', p_proposal, pr.ref,
                        pr.ref || ' decided. No work order — the decision itself was the deliverable.',
                        jsonb_build_object('execution', 'decision_only'), 'system', 'automatic workflow');
    return jsonb_build_object('ok', true, 'execution', 'decision_only', 'work_order', null);
  end if;

  select key into v_planner from command_agents
   where active and role_kind = 'orchestrator' order by sort limit 1;
  v_planner := coalesce(v_planner, 'orchestrator');

  select coalesce(array_agg(distinct r), '{}')
    into v_routed
    from unnest(coalesce(pr.departments, '{}')) d
    cross join lateral command_agent_route(d) r
   where r is not null;

  v_no := nextval('command_work_order_seq');
  v_ref := 'WO-' || lpad(v_no::text, 3, '0');
  v_branch := case when pr.execution = 'engineering'
                   then 'command/wo-' || lpad(v_no::text, 3, '0') || '-' || left(command_slug(pr.title), 40)
                   else '(no branch — founder action)' end;

  insert into command_work_orders (
    ref, proposal_id, title, objectives, scope, exclusions, acceptance_criteria,
    technical_requirements, design_requirements, testing_requirements,
    analytics_requirements, branch, assigned_agents, status, auto_deploy, execution,
    founder_steps, founder_unblocks, founder_done_when)
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
         else array['Regression pass on affected screens', 'Independent review before release'] end,
    '{}', v_branch,
    case when pr.execution = 'founder_action' then '{}' else v_routed end,
    'in_progress',
    pr.deploy_policy = 'auto' and pr.execution = 'engineering',
    pr.execution, pr.founder_steps, pr.founder_unblocks, pr.founder_done_when)
  returning id into v_wo;

  -- ── THE CRITERIA THAT WERE BEING DROPPED ──
  -- The suggestion pipeline writes checkable acceptance criteria into
  -- document->'acceptance'. Nothing read them, so every devlab-sourced order
  -- opened with no definition of done and agents refused it — correctly, and
  -- for a reason that was never true.
  select b.document -> 'acceptance' into v_acc
    from command_backlog b where b.proposal_id = p_proposal limit 1;

  if jsonb_typeof(v_acc) = 'array' then
    for v_i in 0 .. jsonb_array_length(v_acc) - 1 loop
      if coalesce(trim(v_acc ->> v_i), '') <> '' then
        v_crit := v_crit + 1;
        insert into command_criteria (work_order_id, ref, statement, verify_by, verify_ref)
        values (v_wo, 'AC-' || v_crit, left(v_acc ->> v_i, 2000), 'manual',
                'written by the suggestion that raised this, carried across on approval');
      end if;
    end loop;
  end if;

  -- Nothing written? Fall back to the proposal's OWN stated expected result.
  -- Not an invention: it is what the proposal said would be true afterwards.
  if v_crit = 0 and coalesce(trim(pr.expected_result), '') <> '' then
    insert into command_criteria (work_order_id, ref, statement, verify_by, verify_ref)
    values (v_wo, 'AC-1', left(pr.expected_result, 2000), 'manual',
            'derived from the proposal''s stated expected result — a founder should sharpen this');
    v_crit := 1;
  end if;

  if pr.execution = 'founder_action' then
    insert into command_tasks (work_order_id, agent_key, title, status, latest_reasoning, blocked_reason)
    values (v_wo, v_planner, pr.title, 'awaiting_founder',
            coalesce(nullif(pr.recommendation, ''), 'Approved — this one needs a founder.'),
            case when jsonb_array_length(coalesce(pr.founder_steps,'[]'::jsonb)) > 0
                 then jsonb_array_length(pr.founder_steps) || ' steps to work through.'
                 else 'No steps were written for this. Ask the orchestration layer to brief it.' end);
    perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                        'Opened from ' || pr.ref || ' — FOUNDER ACTION, no agent assigned',
                        jsonb_build_object('execution', 'founder_action'), 'system', 'automatic workflow');
    return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref, 'execution', 'founder_action');
  end if;

  insert into command_lab_workspaces (work_order_id, proposal_id, name, branch, status)
  values (v_wo, p_proposal, pr.title, v_branch, 'provisioned') returning id into v_ws;

  insert into command_tasks (work_order_id, agent_key, title, status, branch, latest_reasoning, started_at)
  values (v_wo, v_planner, 'Plan ' || v_ref || ' — ' || pr.title, 'planning', v_branch,
          'Work order opened by founder vote. Decomposing into department scope.', now())
  returning id into v_exec_task;

  insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
  values ('implement', v_wo, v_exec_task, 10,
          jsonb_build_object('role','exec','instruction','Plan the work order and write the implementation plan into the task events.'));

  foreach v_agent in array v_routed loop
    insert into command_tasks (work_order_id, agent_key, title, status, branch, dependencies)
    values (v_wo, v_agent, pr.title, 'queued', v_branch, array[v_planner])
    returning id into v_task;
    insert into command_dispatch (kind, work_order_id, task_id, priority, payload)
    values ('implement', v_wo, v_task, 50, jsonb_build_object('role', v_agent));
  end loop;

  perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                      'Auto-generated from ' || pr.ref || ' on approval' ||
                      case when pr.deploy_policy = 'auto' then ' — DEPLOY AUTHORISED by the same vote' else '' end,
                      jsonb_build_object('branch', v_branch, 'departments', pr.departments,
                                         'routed_to', v_routed, 'criteria', v_crit,
                                         'lab_workspace', v_ws, 'auto_deploy', pr.deploy_policy = 'auto'),
                      'system', 'automatic workflow');
  return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref,
                            'branch', v_branch, 'routed_to', to_jsonb(v_routed),
                            'criteria', v_crit,
                            'auto_deploy', pr.deploy_policy = 'auto');
end $$;

/* ── 4. Repair the orders already open ──────────────────────────────────── */

-- WO-012's six criteria, from the suggestion that raised it.
do $$
declare w record; v_acc jsonb; v_i int; v_n int;
begin
  for w in
    select wo.id, wo.ref, b.document -> 'acceptance' acc
      from command_work_orders wo
      join command_backlog b on b.proposal_id = wo.proposal_id
     where wo.status in ('open','in_progress','blocked')
       and jsonb_typeof(b.document -> 'acceptance') = 'array'
       and not exists (select 1 from command_criteria c where c.work_order_id = wo.id)
  loop
    v_acc := w.acc; v_n := 0;
    for v_i in 0 .. jsonb_array_length(v_acc) - 1 loop
      if coalesce(trim(v_acc ->> v_i), '') <> '' then
        v_n := v_n + 1;
        insert into command_criteria (work_order_id, ref, statement, verify_by, verify_ref)
        values (w.id, 'AC-' || v_n, left(v_acc ->> v_i, 2000), 'manual',
                'written by the suggestion that raised this; recovered by migration 135');
      end if;
    end loop;
    raise notice 'recovered % criteria for %', v_n, w.ref;
  end loop;
end $$;

-- The rest: the proposal's own expected result, marked as derived so a founder
-- can see it was not hand-written and sharpen it.
insert into command_criteria (work_order_id, ref, statement, verify_by, verify_ref)
select wo.id, 'AC-1', left(p.expected_result, 2000), 'manual',
       'derived by migration 135 from the proposal''s stated expected result — sharpen this'
  from command_work_orders wo
  join command_proposals p on p.id = wo.proposal_id
 where wo.status in ('open','in_progress','blocked')
   and coalesce(trim(p.expected_result), '') <> ''
   and not exists (select 1 from command_criteria c where c.work_order_id = wo.id);

/* ── 5. Clear the deadlock that is already sitting there ────────────────── */

-- activation-cliff-jank: PROP-007 approved 2026-07-25, WO-006 in flight. The
-- decision the dependants were waiting on has been made. The new
-- command_dependency_block already treats this correctly, but the row is left
-- accurate rather than relying on the function to paper over it.
update command_backlog b
   set updated_at = now(),
       defer_reason = case when b.defer_reason = '' then
         'Its proposal was decided; dependants are no longer blocked.' else b.defer_reason end
 where b.status = 'proposed'
   and exists (select 1 from command_proposals p
                where p.id = b.proposal_id and p.status in ('approved','rejected','withdrawn','superseded'));

commit;
