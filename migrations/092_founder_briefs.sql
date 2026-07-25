-- EvoForge 092 — tell the founder what to actually DO.
--
-- FOUND BY TYSON: "it needs to explain the founder action, I have no idea what
-- it needs me to do."
--
-- He was looking at this:
--
--     FOUNDER ACTION
--     Move off the shared Supabase mail sender
--     APPROVE. Highest value per hour on the board and it needs a founder
--     with DNS access.
--     [ I've done this ]
--
-- That second line is `exec_recommendation` — the Exec's argument for voting
-- YES. It is the right text before the vote and completely useless after it.
-- The card was showing the reason to approve where the instructions belong.
--
-- So a proposal now carries a FOUNDER BRIEF: ordered steps, what it unblocks,
-- and how we will know it is done. Authored when the candidate is written, so
-- the founders can also see at vote time exactly what approving signs them up
-- for — which is arguably where it matters most.
--
-- Steps are checkable and the ticks persist, because these are multi-session
-- jobs. Verifying a mail domain means waiting on DNS; nobody finishes that in
-- one sitting, and a checklist that forgets where you were is a worse checklist
-- than a piece of paper.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE BRIEF
-- ─────────────────────────────────────────────────────────────────────────────
-- [{ "step": "...", "detail": "...", "link": "https://..." }]
alter table public.command_proposals  add column if not exists founder_steps jsonb not null default '[]'::jsonb;
alter table public.command_work_orders add column if not exists founder_steps jsonb not null default '[]'::jsonb;
alter table public.command_backlog     add column if not exists founder_steps jsonb not null default '[]'::jsonb;

alter table public.command_proposals  add column if not exists founder_unblocks text not null default '';
alter table public.command_work_orders add column if not exists founder_unblocks text not null default '';
alter table public.command_backlog     add column if not exists founder_unblocks text not null default '';

alter table public.command_proposals  add column if not exists founder_done_when text not null default '';
alter table public.command_work_orders add column if not exists founder_done_when text not null default '';
alter table public.command_backlog     add column if not exists founder_done_when text not null default '';

-- Which steps are ticked. On the task, not the proposal: the proposal is the
-- decision and is locked once decided; progress is work.
alter table public.command_tasks add column if not exists steps_done integer[] not null default '{}';

create or replace function public.command_toggle_step(p_task uuid, p_index integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_done integer[];
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into t from command_tasks where id = p_task for update;
  if t is null then raise exception 'command: no such task'; end if;

  if p_index = any(t.steps_done) then
    select array_agg(x) into v_done from unnest(t.steps_done) x where x <> p_index;
  else
    v_done := array_append(t.steps_done, p_index);
  end if;

  update command_tasks
     set steps_done = coalesce(v_done, '{}'), updated_at = now()
   where id = p_task;
  return jsonb_build_object('ok', true, 'steps_done', coalesce(v_done, '{}'));
end $$;
grant execute on function public.command_toggle_step(uuid, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CARRY THE BRIEF THROUGH THE WORKFLOW
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_create_proposal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; v_id uuid; v_default text; v_policy text; v_exec text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  select (value)#>>'{}' into v_default from command_settings where key = 'default_deploy_policy';
  v_exec := coalesce(p->>'execution', 'engineering');
  v_policy := case when v_exec <> 'engineering' then 'gated'
                   else coalesce(p->>'deploy_policy', v_default, 'gated') end;

  v_ref := 'PROP-' || lpad(nextval('command_proposal_seq')::text, 3, '0');
  insert into command_proposals (
    ref, title, category, problem, recommendation, reasoning, benefits, risks,
    alternatives, complexity, departments, est_days, affected_screens, dependencies,
    exec_recommendation, documents, author_kind, author_key, author_id, status,
    opened_at, execution, deploy_policy, founder_steps, founder_unblocks, founder_done_when)
  values (
    v_ref,
    coalesce(p->>'title', 'Untitled'), coalesce(p->>'category', 'prototype'),
    coalesce(p->>'problem', ''), coalesce(p->>'recommendation', ''), coalesce(p->>'reasoning', ''),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'benefits','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'risks','[]'::jsonb))), '{}'),
    coalesce(p->'alternatives', '[]'::jsonb),
    coalesce(p->>'complexity', 'medium'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'departments','[]'::jsonb))), '{}'),
    nullif(p->>'est_days','')::numeric,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'affected_screens','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'dependencies','[]'::jsonb))), '{}'),
    coalesce(p->>'exec_recommendation', ''), coalesce(p->'documents', '[]'::jsonb),
    coalesce(p->>'author_kind', case when auth.uid() is null then 'agent' else 'founder' end),
    p->>'author_key', auth.uid(),
    case when coalesce(p->>'status','open') = 'draft' then 'draft' else 'open' end,
    case when coalesce(p->>'status','open') = 'draft' then null else now() end,
    v_exec, v_policy,
    coalesce(p->'founder_steps', '[]'::jsonb),
    coalesce(p->>'founder_unblocks', ''),
    coalesce(p->>'founder_done_when', ''))
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

-- The Exec's cycle passes the brief through with everything else.
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

    -- A founder action with no steps is not ready to be asked. Approving it
    -- would put a card in front of someone that cannot tell them what to do —
    -- which is exactly the failure this migration exists to fix.
    if v_block is null and b.execution = 'founder_action'
       and jsonb_array_length(coalesce(b.founder_steps, '[]'::jsonb)) = 0 then
      v_block := 'founder action with no written steps — the Exec must brief it first';
    end if;

    if v_block is null then
      v_res := command_create_proposal(
        (b.document || jsonb_build_object(
          'title', b.title, 'category', b.category,
          'departments', to_jsonb(b.departments),
          'execution', b.execution,
          'founder_steps', b.founder_steps,
          'founder_unblocks', b.founder_unblocks,
          'founder_done_when', b.founder_done_when,
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

-- command_open_work copies the brief onto the work order so the card has it
-- without joining back through a locked proposal.
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
         else array['Regression pass on affected screens', 'Sentinel review before release'] end,
    '{}', v_branch,
    case when pr.execution = 'founder_action' then '{}' else pr.departments end,
    'in_progress',
    pr.deploy_policy = 'auto' and pr.execution = 'engineering',
    pr.execution, pr.founder_steps, pr.founder_unblocks, pr.founder_done_when)
  returning id into v_wo;

  if pr.execution = 'founder_action' then
    insert into command_tasks (work_order_id, agent_key, title, status, latest_reasoning, blocked_reason)
    values (v_wo, 'exec', pr.title, 'awaiting_founder',
            coalesce(nullif(pr.recommendation, ''), 'Approved — this one needs a founder.'),
            case when jsonb_array_length(coalesce(pr.founder_steps,'[]'::jsonb)) > 0
                 then jsonb_array_length(pr.founder_steps) || ' steps to work through.'
                 else 'No steps were written for this. Ask the Exec to brief it.' end);
    perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                        'Opened from ' || pr.ref || ' — FOUNDER ACTION, no agent assigned',
                        jsonb_build_object('execution', 'founder_action'), 'system', 'automatic workflow');
    return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref, 'execution', 'founder_action');
  end if;

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
-- 3. BRIEF THE TWO THAT ARE ALREADY WAITING ON HIM
-- ─────────────────────────────────────────────────────────────────────────────
-- Written from what this project actually needs, not from a template. Where a
-- step depends on something outside our control (DNS propagation, a provider's
-- verification), it says so, because a checklist that pretends every step takes
-- a minute is how people give up on step 3.

update public.command_backlog set
  founder_unblocks = 'Password reset and email confirmation for every non-founder. Also one of the three items blocking a public launch.',
  founder_done_when = 'A password reset requested from a NON-founder address arrives in the inbox (not spam) and the link works.',
  founder_steps = $json$[
    {"step": "Pick a transactional sender and create the account",
     "detail": "Resend is the least setup; Postmark has the best deliverability reputation; AWS SES is cheapest at volume and the most fiddly. Any of the three is fine — this decision is reversible.",
     "link": "https://resend.com"},
    {"step": "Add the sending domain and copy the DNS records it gives you",
     "detail": "Use a domain you control. The provider will hand you an SPF (TXT), a DKIM (CNAME or TXT) and usually a DMARC record."},
    {"step": "Add those records at your DNS host, then wait for verification",
     "detail": "This is the step that is not instant — propagation is usually minutes but can be hours. The provider's dashboard will flip to Verified on its own; you do not need to sit there."},
    {"step": "Generate SMTP credentials",
     "detail": "You want host, port 587, username and password. Keep the password somewhere safe — most providers show it exactly once."},
    {"step": "Paste them into Supabase Auth SMTP settings",
     "detail": "Supabase dashboard -> Authentication -> Emails -> SMTP Settings (older UIs: Project Settings -> Auth -> SMTP). Enable custom SMTP. Sender email no-reply@yourdomain, sender name EvoForge.",
     "link": "https://supabase.com/dashboard/project/rysbpwpvnqbngqncrfaa/auth/smtp"},
    {"step": "Falsify it with a real reset",
     "detail": "Request a password reset from an address that is NOT a founder account, on a different mail provider (a Gmail if the sender domain is not Google). Confirm it lands in the inbox, not spam, and that the link actually signs you in. A green settings page is not proof — this project has been bitten by exactly that before."}
  ]$json$::jsonb
 where topic_key = 'custom-smtp';

update public.command_backlog set
  founder_unblocks = 'Lets the studio merge and deploy without leaning on the credential manager on your laptop, and lights up the deploy/merge/CI actions that are deliberately absent today.',
  founder_done_when = 'GITHUB_TOKEN is set in evoforge-command/.env.local and the runner has been restarted.',
  founder_steps = $json$[
    {"step": "Open GitHub's fine-grained token page",
     "detail": "Fine-grained, not classic. A classic token cannot be scoped to one repository.",
     "link": "https://github.com/settings/personal-access-tokens/new"},
    {"step": "Resource owner: tysoncooke865-debug. Repository access: Only select repositories -> evoforge",
     "detail": "Add evoforge-command too if you want the studio to be able to deploy this site as well."},
    {"step": "Permissions: Contents = Read and write. Actions = Read-only. Nothing else.",
     "detail": "Metadata read-only is added automatically. Do NOT grant Workflows or Administration — the studio has no business editing CI definitions or repo settings, and a token that can is a token that will."},
    {"step": "Expiration 90 days, and write the rotation date somewhere you will see it",
     "detail": "A token with no expiry is a credential nobody ever revokes."},
    {"step": "Paste it into C:\\Users\\tyson\\evoforge-command\\.env.local as GITHUB_TOKEN=...",
     "detail": "That file is gitignored. Never put it in the repo and never give it a NEXT_PUBLIC_ prefix — that would compile it into the browser bundle."},
    {"step": "Restart the studio runner so it picks the token up",
     "detail": "node scripts/studio-runner.mjs in evoforge-command. It reads .env.local once at startup."}
  ]$json$::jsonb
 where topic_key = 'github-token';

update public.command_backlog set
  founder_unblocks = 'Public launch. The App Store, the Play Store and any real marketing all need these filled in.',
  founder_done_when = 'The operating entity, contact inbox and jurisdiction are real values in the shipped legal documents, and a lawyer has read them.',
  founder_steps = $json$[
    {"step": "Decide the operating entity", "detail": "Sole trader, or a company. This has tax and liability consequences that outlast the app, so it is worth a conversation with an accountant rather than a guess."},
    {"step": "Stand up a monitored inbox", "detail": "Something like privacy@ or support@ on the domain. It has to be genuinely monitored — a privacy policy naming a dead inbox is worse than one naming none."},
    {"step": "Set the governing jurisdiction", "detail": "Almost certainly the state you operate from."},
    {"step": "Replace the placeholders in the shipped legal documents", "detail": "Terms, Privacy and the AI-processing notice all carry them."},
    {"step": "Have a lawyer read the set before any public launch", "detail": "Particularly the AI-processing notice and the physique-photo handling — those are the unusual parts."}
  ]$json$::jsonb
 where topic_key = 'legal-operator-details';

-- Push the briefs onto the live proposals, work orders and tasks.
update public.command_proposals p set
  founder_steps = b.founder_steps, founder_unblocks = b.founder_unblocks, founder_done_when = b.founder_done_when
  from public.command_backlog b
 where b.proposal_id = p.id and jsonb_array_length(b.founder_steps) > 0;

update public.command_work_orders w set
  founder_steps = p.founder_steps, founder_unblocks = p.founder_unblocks, founder_done_when = p.founder_done_when
  from public.command_proposals p
 where p.id = w.proposal_id and jsonb_array_length(p.founder_steps) > 0;

update public.command_tasks t set
  latest_reasoning = coalesce(nullif(p.recommendation, ''), t.latest_reasoning),
  blocked_reason   = jsonb_array_length(p.founder_steps) || ' steps to work through.',
  updated_at = now()
  from public.command_work_orders w
  join public.command_proposals p on p.id = w.proposal_id
 where w.id = t.work_order_id and t.status = 'awaiting_founder'
   and jsonb_array_length(p.founder_steps) > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SERVE THE BRIEF
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_founder_work()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'task_id', t.id, 'title', t.title, 'updated_at', t.updated_at,
      'steps_done', t.steps_done, 'summary', t.latest_reasoning,
      'work_order_ref', w.ref, 'proposal_ref', p.ref,
      'steps', w.founder_steps, 'unblocks', w.founder_unblocks, 'done_when', w.founder_done_when
    ) order by t.created_at)
      from command_tasks t
      join command_work_orders w on w.id = t.work_order_id
      left join command_proposals p on p.id = w.proposal_id
     where t.status = 'awaiting_founder'), '[]'::jsonb);
end $$;
grant execute on function public.command_founder_work() to authenticated;
