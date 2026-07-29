-- 130 — SIX FUNCTIONAL AGENTS, AND AN ORCHESTRATOR THAT STOPS HAVING OPINIONS
--
-- WHAT WAS WRONG.
--
-- command_agents held fifteen rows. Ten of them were "directors" that differed
-- from each other by a name, an accent colour and a paragraph of mandate — not
-- by what data they could read, what they were allowed to do, or what shape of
-- output they had to produce. Four "workers" differed only in which kind of file
-- they were expected to touch, and the dispatcher never used that distinction:
-- every one of them received the identical context packet from compileContext()
-- and the identical model from chooseModel().
--
-- That is a cast list, not an architecture. Fifteen personas produced fifteen
-- flavours of confident prose and no independent check on any of it, because
-- nothing in the schema could express "this agent reviews that agent's work".
--
-- WHAT THIS DOES.
--
--   · Adds the columns that make an agent a system rather than a persona:
--     authority (enforced, not advised), the data sources it may read, the tools
--     it may call, the model tier it routes to, and its review obligation.
--   · Inserts six specialists plus one orchestrator.
--   · ARCHIVES the fifteen old rows rather than deleting them. command_tasks,
--     command_runs, command_work_orders.assigned_agents and every command_audit
--     row ever written name those keys. Deleting them would rewrite history and
--     orphan live work; `active=false, archived_at, superseded_by` keeps every
--     old page resolvable and every old row readable.
--   · Adds command_agent_route(), and teaches command_open_work to use it — so a
--     proposal whose departments still say 'atlas' opens a task for the
--     engineering agent instead of silently opening no task at all.
--
-- THE LAST POINT IS THE DANGEROUS ONE. command_open_work loops
-- `pr.departments` and creates a task only `if exists (… where key = v_agent and
-- active)`. Archiving the old agents without the routing map would mean every
-- proposal already carrying 'atlas' or 'nova' approves into a work order with an
-- exec plan task and NO implementation tasks — which looks exactly like a work
-- order in progress and never builds anything.

begin;

/* ── 1. The columns that make authority real ────────────────────────────── */

alter table command_agents
  add column if not exists role_kind       text,
  add column if not exists authority       text,
  add column if not exists alias           text not null default '',
  add column if not exists responsibility  text not null default '',
  add column if not exists reads           text[] not null default '{}',
  add column if not exists produces        text[] not null default '{}',
  add column if not exists tools           text[] not null default '{}',
  add column if not exists data_sources    text[] not null default '{}',
  add column if not exists model_tier      text not null default 'standard',
  add column if not exists limitations     text not null default '',
  add column if not exists requires_review boolean not null default true,
  add column if not exists archived_at     timestamptz,
  add column if not exists superseded_by   text;

-- 'specialist' and 'orchestrator' are new kinds. The old three stay legal so the
-- archived rows continue to satisfy their own constraint.
alter table command_agents drop constraint if exists command_agents_kind_check;
alter table command_agents add constraint command_agents_kind_check
  check (kind in ('exec','director','worker','specialist','orchestrator'));

-- THE AUTHORITY LADDER. Separate from `permission`, which stays exactly as it
-- was: permission is the release-gate ladder the constitution is written in
-- terms of, and rewriting its values would invalidate every stored autonomy
-- decision. This is the finer-grained thing the runtime actually enforces.
alter table command_agents drop constraint if exists command_agents_authority_check;
alter table command_agents add constraint command_agents_authority_check
  check (authority is null or authority in (
    'read_only',            -- reads data, writes nothing
    'research_only',        -- may record evidence and observations, nothing else
    'create_observations',  -- may record findings with evidence attached
    'create_recommendations',
    'create_proposals',     -- may put a decision in front of the founders
    'create_tasks',
    'modify_dev_code',      -- may commit to a work-order branch
    'modify_production_after_approval',
    'orchestrate'           -- routes work; may not author conclusions
  ));

alter table command_agents drop constraint if exists command_agents_model_tier_check;
alter table command_agents add constraint command_agents_model_tier_check
  check (model_tier in ('fast','standard','deep'));

alter table command_agents drop constraint if exists command_agents_role_kind_check;
alter table command_agents add constraint command_agents_role_kind_check
  check (role_kind is null or role_kind in
    ('strategy','user_research','analytics','market','engineering','review','orchestrator','legacy'));

comment on column command_agents.authority is
  'Enforced by command_assert_authority() and by the node runtime — not by prompt text. An agent asking for something above its level is refused by the database.';
comment on column command_agents.requires_review is
  'True when this agent''s output must pass the Independent Review Agent before it can reach the decision queue.';

/* ── 2. Archive the cast list ───────────────────────────────────────────── */

-- Every old row keeps its history, its audit trail and its detail page. It stops
-- being offered new work.
update command_agents set
  role_kind     = 'legacy',
  archived_at   = coalesce(archived_at, now()),
  active        = false,
  superseded_by = case key
    when 'exec'     then 'orchestrator'
    when 'forge'    then 'strategy'
    when 'catalyst' then 'strategy'
    when 'oracle'   then 'strategy'
    when 'pulse'    then 'analytics'
    when 'vanguard' then 'market'
    when 'sentinel' then 'reviewer'
    when 'atlas'    then 'engineering'
    when 'nova'     then 'engineering'
    when 'cipher'   then 'engineering'
    when 'pixel'    then 'engineering'
    when 'builder'  then 'engineering'
    when 'patch'    then 'engineering'
    when 'schema'   then 'engineering'
    when 'device'   then 'engineering'
    else 'strategy' end
where key in ('exec','forge','catalyst','oracle','pulse','vanguard','sentinel',
              'atlas','nova','cipher','pixel','builder','patch','schema','device');

/* ── 3. The six specialists, plus the orchestrator ──────────────────────── */

insert into command_agents
  (key, name, title, alias, kind, role_kind, mandate, responsibility, remit,
   reads, produces, tools, data_sources, permission, authority, model_tier,
   limitations, requires_review, accent, can_block, sort, active)
values

-- ── Orchestration. Deliberately NOT a source of opinions. ──
('orchestrator',
 'Orchestration Layer', 'Workflow coordinator', 'Studio Director / Exec',
 'orchestrator', 'orchestrator',
 'Routes work to the correct specialist, passes only relevant context, enforces the review and approval rules, and records why each routing decision was made. Produces no product conclusions of its own.',
 'Selects the specialist for a question, assembles its context, sequences dependent work, requests independent review, detects duplicates, enforces approval rules, chooses the model, and records the outcome.',
 array['routing','context assembly','duplicate detection','approval rules','model selection','failure handling'],
 array['The backlog, open proposals, work orders, task status, decision memory and pipeline state.'],
 array['Pipeline runs, routing decisions with a recorded reason, and work orders. Never a product recommendation.'],
 array['sql','dispatch'],
 array['command_backlog','command_proposals','command_pipeline_runs','command_decisions'],
 'observe', 'orchestrate', 'fast',
 'Cannot author a proposal''s conclusions. If it disagrees with a specialist it must record the disagreement rather than overwrite it.',
 false, '#38bdf8', false, 0, true),

-- ── 1. Product Strategy ──
('strategy',
 'Product Strategy Agent', 'Decides what to build next', 'Forge / Oracle / Catalyst',
 'specialist', 'strategy',
 'Determines what EvoForge should build, change, prioritise, postpone or reject, from evidence that already exists rather than from invented user demand.',
 'Turns validated problems into prioritised proposals with a success metric, an effort estimate, a confidence band and the strategic reason for the timing.',
 array['roadmap','prioritisation','feature specification','success metrics','monetisation','sequencing'],
 array['Product vision and roadmap, the feature inventory, analytics findings, user-research findings, competitor evidence, experiment results, past decisions and their outcomes, and current engineering capacity.'],
 array['Prioritised proposals carrying a change summary, expected user value, effort, risk, confidence, dependencies, a success metric and recommended timing.'],
 array['sql','memory','retrieval'],
 array['command_evidence','command_opportunities','command_decisions','command_outcomes','command_experiments','command_knowledge_objects'],
 'recommend', 'create_proposals', 'deep',
 'May not assert user demand that no evidence item supports. May not produce analytics figures itself — it cites the Analytics Agent or it says the number is unknown.',
 true, '#a78bfa', false, 10, true),

-- ── 2. User Research ──
('research',
 'User Research Agent', 'Finds real user problems', 'Scout (user side)',
 'specialist', 'user_research',
 'Identifies real user problems, motivations, confusion and unmet needs from what users actually said or did.',
 'Clusters user feedback and behavioural signals into problem statements with frequency, severity, affected segment and the direct evidence behind each one.',
 array['feedback analysis','problem statements','segmentation','research questions','personas'],
 array['Beta feedback, support messages, surveys, app-store reviews, onboarding abandonment, feature usage and retention, plus public discussion of competitor products.'],
 array['User problem statements with evidence clusters, frequency, severity, affected segments, stated uncertainties and recommended research questions.'],
 array['sql','retrieval'],
 array['command_evidence','analytics_events_real','command_personas','command_competitor_observations'],
 'observe', 'create_observations', 'standard',
 'Cannot modify code or configuration. Must not generalise a single comment into a product conclusion — one report is recorded as one report.',
 true, '#34d399', false, 20, true),

-- ── 3. Product Analytics ──
('analytics',
 'Product Analytics Agent', 'Explains what users actually do', 'Pulse',
 'specialist', 'analytics',
 'Explains what athletes are doing inside EvoForge and whether shipped changes worked, from the event record and from nothing else.',
 'Reads funnels, cohorts, activation and retention from analytics_events_real, reports data-quality gaps as findings in their own right, and classifies the outcome of every shipped release against its recorded baseline.',
 array['funnels','cohorts','activation','retention','experiment readout','tracking quality','release outcomes'],
 array['Product events with tooling accounts excluded, metric definitions, experiment exposures and results, and release baselines.'],
 array['Findings with a confidence band, alternative explanations, named data-quality gaps, the specific event or property that is missing, and the next measurement worth taking.'],
 array['sql','retrieval'],
 array['analytics_events_real','command_metric_defs','command_experiments','command_experiment_results','command_releases'],
 'observe', 'create_observations', 'standard',
 'Must never report a metric that has no query behind it. An uninstrumented metric is reported as uninstrumented, never as zero.',
 true, '#38bdf8', false, 30, true),

-- ── 4. Market and Competitor Research ──
('market',
 'Market & Competitor Research Agent', 'Tracks competing products', 'Scout / Vanguard',
 'specialist', 'market',
 'Tracks competing and adjacent fitness products, their pricing, releases and reception, and what each means for EvoForge.',
 'Collects verifiable competitor observations with a source and an observation date, separates fact from opinion from inference, and states the product implication and whether it fits EvoForge''s strategy.',
 array['competitor tracking','pricing','release notes','store reviews','positioning','differentiation'],
 array['Competitor sites, pricing pages, release notes, app-store listings and reviews, public discussion, and EvoForge''s existing competitor records.'],
 array['Dated, sourced findings with a confidence and a relevance statement, plus a recommended response and the limits of the evidence.'],
 array['sql','web_fetch','web_search'],
 array['command_competitors','command_competitor_observations','command_evidence'],
 'observe', 'research_only', 'standard',
 'May not present undated or unfetched claims as current. May not recommend copying a competitor without stating whether the feature fits EvoForge''s strategy.',
 true, '#fbbf24', false, 40, true),

-- ── 5. Product Engineering ──
('engineering',
 'Product Engineering Agent', 'Plans and builds approved work', 'Atlas / Nova / Builder / Patch / Schema / Device',
 'specialist', 'engineering',
 'Turns an approved proposal into a technically sound implementation plan, then executes it on a branch against that work order''s acceptance criteria.',
 'Produces an implementation plan naming affected files, migrations, risks, a rollback plan and a test plan; then commits the change and reports what it actually did, including any deviation from the approved proposal.',
 array['implementation planning','architecture','database migrations','UI implementation','performance','testing'],
 array['The approved work order and its acceptance criteria, the product repository, the schema, API contracts, existing tests and the design system.'],
 array['An implementation plan before it starts, and afterwards: files changed, behaviour changed, tests run and their results, remaining risks, manual verification steps and rollback instructions.'],
 array['read','edit','bash','sql'],
 array['product_repo','command_work_orders','command_criteria','command_lessons'],
 'build', 'modify_dev_code', 'deep',
 'Cannot approve its own work, cannot merge, and cannot deploy. High-risk changes — auth, migrations, payments, protected paths — require the approval recorded on the proposal before it may start.',
 true, '#f472b6', false, 50, true),

-- ── 6. Independent Review ──
('reviewer',
 'Independent Review Agent', 'Challenges every recommendation', 'Sentinel',
 'specialist', 'review',
 'Attempts to disprove every other agent''s recommendation before a founder ever sees it.',
 'Checks whether the evidence is genuine, recent and actually about EvoForge; whether the action solves the stated problem; whether it duplicates existing work or something already shipped; whether cheaper alternatives exist; and whether the stated confidence is justified.',
 array['evidence audit','duplicate detection','alternative explanations','risk discovery','confidence calibration','release gate'],
 array['The proposal under review, the evidence it cites, decision memory, active work orders, the current feature inventory — and deliberately NOT the originating agent''s reasoning trace.'],
 array['A verdict of supported / supported with revisions / more evidence required / rejected / duplicate / already implemented / strategically misaligned, with the unsupported claims named individually.'],
 array['sql','memory','retrieval'],
 array['command_proposals','command_evidence','command_decisions','command_outcomes','command_work_orders'],
 'release_candidate', 'read_only', 'deep',
 'Executes nothing and writes no proposals. Runs on an isolated context so it cannot inherit the reasoning it is meant to challenge.',
 false, '#f87171', true, 60, true)

on conflict (key) do update set
  name = excluded.name, title = excluded.title, alias = excluded.alias,
  kind = excluded.kind, role_kind = excluded.role_kind, mandate = excluded.mandate,
  responsibility = excluded.responsibility, remit = excluded.remit,
  reads = excluded.reads, produces = excluded.produces, tools = excluded.tools,
  data_sources = excluded.data_sources, permission = excluded.permission,
  authority = excluded.authority, model_tier = excluded.model_tier,
  limitations = excluded.limitations, requires_review = excluded.requires_review,
  accent = excluded.accent, can_block = excluded.can_block, sort = excluded.sort,
  active = true, archived_at = null, superseded_by = null;

/* ── 4. Routing: legacy department names → a live agent ─────────────────── */

-- The bridge that stops archiving from wedging live work. Given anything a
-- proposal's `departments` array might contain — an old agent key, a loose word
-- like 'design', or a new key — return the agent that should actually take it,
-- or null when nothing should.
create or replace function public.command_agent_route(p_dept text)
returns text language sql stable set search_path to 'public' as $$
  select case
    -- Already a live agent: pass it through untouched.
    when exists (select 1 from command_agents a where a.key = lower(trim(p_dept)) and a.active)
      then lower(trim(p_dept))
    -- An archived agent: follow its succession.
    when exists (select 1 from command_agents a where a.key = lower(trim(p_dept)) and a.superseded_by is not null)
      then (select a.superseded_by from command_agents a where a.key = lower(trim(p_dept)))
    -- Free text that was never an agent key. These strings are real: PROP-015
    -- carries departments = {engineering, design}.
    when lower(trim(p_dept)) in ('design','ui','ux','frontend','front-end','mobile','art','engineering','backend','back-end','database','db','performance','qa')
      then 'engineering'
    when lower(trim(p_dept)) in ('product','roadmap','growth-product','monetisation','progression','economy')
      then 'strategy'
    when lower(trim(p_dept)) in ('data','analytics','measurement')
      then 'analytics'
    when lower(trim(p_dept)) in ('research','user-research','ux-research')
      then 'research'
    when lower(trim(p_dept)) in ('market','competitor','competitors','growth')
      then 'market'
    when lower(trim(p_dept)) in ('security','review','qa-security')
      then 'reviewer'
    else null
  end
$$;

comment on function public.command_agent_route(text) is
  'Legacy department name or agent key -> the live agent that should take the work. Returns null when nothing should, so a caller can tell "route to nobody" from "route to engineering".';

/* ── 5. Authority enforcement, in the database ──────────────────────────── */

-- §18: "Any action outside an agent's authority must be blocked by the system
-- rather than relying only on prompt instructions." A prompt that says "you may
-- not modify code" is a request. This is the refusal.
create or replace function public.command_assert_authority(p_agent text, p_action text)
returns boolean language plpgsql stable set search_path to 'public' as $$
declare v_auth text; v_rank int; v_need int;
begin
  select authority into v_auth from command_agents where key = p_agent;
  if v_auth is null then
    raise exception 'command: % has no recorded authority — refusing % rather than assuming', p_agent, p_action
      using errcode = 'insufficient_privilege';
  end if;

  v_rank := array_position(array['read_only','research_only','create_observations',
                                 'create_recommendations','create_proposals','create_tasks',
                                 'modify_dev_code','modify_production_after_approval'], v_auth);
  -- The orchestrator is off the ladder on purpose: it may route anything and
  -- author nothing, so ranking it would give it authorship by arithmetic.
  if v_auth = 'orchestrate' then
    if p_action in ('route','dispatch','record_decision') then return true; end if;
    raise exception 'command: the orchestration layer may not %. It routes work; it does not author conclusions', p_action
      using errcode = 'insufficient_privilege';
  end if;

  v_need := case p_action
    when 'read'                then 1
    when 'record_evidence'     then 2
    when 'record_observation'  then 3
    when 'recommend'           then 4
    when 'create_proposal'     then 5
    when 'create_task'         then 6
    when 'modify_dev_code'     then 7
    when 'modify_production'   then 8
    else null end;

  if v_need is null then
    raise exception 'command: unknown action % — refusing rather than allowing', p_action
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(v_rank, 0) < v_need then
    raise exception 'command: % holds % and may not % — this is enforced here, not asked for in a prompt',
      p_agent, v_auth, p_action using errcode = 'insufficient_privilege';
  end if;
  return true;
end $$;

revoke all on function public.command_assert_authority(text, text) from public, anon;
grant execute on function public.command_assert_authority(text, text) to authenticated, service_role;
grant execute on function public.command_agent_route(text) to authenticated, service_role, anon;

/* ── 6. Teach command_open_work the routing map ─────────────────────────── */

-- Read from pg_get_functiondef and EXTENDED, not reconstructed. Migration 125
-- was reconstructed from memory, dropped a NOT NULL default, and every insert
-- failed with 23502. The only edits below are:
--   · v_agent is routed through command_agent_route
--   · the exec plan task is created for 'orchestrator' rather than 'exec'
--   · duplicate routes collapse (two legacy departments can map to one agent)
create or replace function public.command_open_work(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  pr record; v_ref text; v_no int; v_wo uuid; v_branch text; v_agent text; v_ws uuid;
  v_task uuid; v_exec_task uuid; v_routed text[]; v_planner text;
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

  -- Whoever is actually alive to plan. Never a literal 'exec': that key is
  -- archived, and a task pointing at an archived agent is a task no dispatcher
  -- will ever claim.
  select key into v_planner from command_agents
   where active and role_kind = 'orchestrator' order by sort limit 1;
  v_planner := coalesce(v_planner, 'orchestrator');

  -- Route the departments ONCE, up front, so the count below is the count of
  -- tasks that will actually exist.
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
                                         'routed_to', v_routed,
                                         'lab_workspace', v_ws, 'auto_deploy', pr.deploy_policy = 'auto'),
                      'system', 'automatic workflow');
  return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref,
                            'branch', v_branch, 'routed_to', to_jsonb(v_routed),
                            'auto_deploy', pr.deploy_policy = 'auto');
end $$;

commit;
