-- EvoForge 088 — COMMAND: the founder council and the autonomous studio.
--
-- This is the governing data layer for EvoForge Command, the internal website at
-- which Tyson, Jesse and Charlie run the company. It is deliberately NOT part of
-- the consumer app's data model: nothing here is readable by an athlete, and
-- nothing in here writes to athlete data.
--
-- THE CONSTITUTION, ENCODED
--   AI proposes.      -> command_proposals (author_kind='agent' is normal)
--   Founders decide.  -> command_votes, tallied in SQL, thresholds by category
--   AI builds.        -> the approval trigger opens a work order + tasks itself
--   Founders release. -> command_releases needs its OWN vote; approval of a
--                        proposal authorises DEVELOPMENT ONLY.
--
-- The single most important rule in this file: NOTHING HERE DEPLOYS. The vote
-- RPC opens work; it never ships it. Deployment is an act outside this database
-- performed after a release vote, and the release vote's success sets a status,
-- not a side effect.
--
-- WHY THE WRITE PATHS ARE ALL SECURITY DEFINER RPCs. If founders could UPDATE
-- these tables directly, the audit trail would be optional. Every mutation here
-- goes through a function that writes command_audit in the same transaction, so
-- an unaudited change is not something you have to remember to avoid — it is
-- something the schema does not offer. RLS gives founders SELECT and nothing
-- else. Agents write through the service role (an agent is not a signed-in user
-- and should never need to be one), which is why the agent-facing tables carry
-- no INSERT policy at all.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. HELPERS
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.command_slug(p_text text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create sequence if not exists public.command_proposal_seq start 1;
create sequence if not exists public.command_work_order_seq start 1;
create sequence if not exists public.command_release_seq start 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FOUNDERS — the only three accounts that exist here.
-- ─────────────────────────────────────────────────────────────────────────────
-- No public registration: membership is a row, and a row is added by hand
-- through the management API. Sign-in is ordinary Supabase auth against the
-- same project as the app, so a founder has one identity, not two.
create table if not exists public.command_founders (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  title      text not null default 'Founder',
  accent     text not null default '#38BDF8',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.command_founders enable row level security;

create or replace function public.is_founder()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from command_founders where user_id = auth.uid() and active);
$$;
revoke all on function public.is_founder() from public, anon;
grant execute on function public.is_founder() to authenticated;

-- The quorum denominator. Expressed as a count rather than the literal 3 so
-- that "2 of 3" survives a fourth founder without silently becoming a minority.
create or replace function public.command_founder_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from command_founders where active;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE AI ORG — exec, directors, engineering workers.
-- ─────────────────────────────────────────────────────────────────────────────
-- Permission levels are ordered and meaningful: observe < recommend < prototype
-- < build < release_candidate. No level authorises production. That ceiling is
-- not a policy note, it is the absence of a level above release_candidate.
create table if not exists public.command_agents (
  key          text primary key,
  name         text not null,
  title        text not null,
  kind         text not null check (kind in ('exec', 'director', 'worker')),
  mandate      text not null,
  remit        text[] not null default '{}',
  permission   text not null default 'recommend'
                 check (permission in ('observe','recommend','prototype','build','release_candidate')),
  accent       text not null default '#38BDF8',
  can_block    boolean not null default false,   -- Sentinel may block a release.
  sort         integer not null default 100,
  active       boolean not null default true
);
alter table public.command_agents enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PROPOSALS — every meaningful decision.
-- ─────────────────────────────────────────────────────────────────────────────
-- category drives the vote threshold. It is not cosmetic and it is not editable
-- after the proposal opens (see command_open_proposal): changing the category of
-- a live proposal would change the arithmetic underneath votes already cast.
create table if not exists public.command_proposals (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text unique not null,
  title               text not null,
  category            text not null default 'prototype'
                        check (category in ('prototype','production','monetisation','ownership','privacy','security')),
  status              text not null default 'draft'
                        check (status in ('draft','open','approved','rejected','changes_requested','withdrawn','superseded')),

  -- The proposal document. Every field the constitution names.
  problem             text not null default '',
  recommendation      text not null default '',
  reasoning           text not null default '',
  benefits            text[] not null default '{}',
  risks               text[] not null default '{}',
  alternatives        jsonb  not null default '[]'::jsonb,   -- [{option, why_not}]
  complexity          text   not null default 'medium' check (complexity in ('trivial','low','medium','high','extreme')),
  departments         text[] not null default '{}',          -- command_agents.key
  est_days            numeric,
  affected_screens    text[] not null default '{}',
  dependencies        text[] not null default '{}',
  exec_recommendation text not null default '',
  documents           jsonb  not null default '[]'::jsonb,   -- [{label, url}]

  author_kind         text not null default 'agent' check (author_kind in ('agent','founder')),
  author_key          text,                                   -- agent key, when author_kind='agent'
  author_id           uuid references auth.users(id) on delete set null,

  supersedes          uuid references public.command_proposals(id) on delete set null,
  created_at          timestamptz not null default now(),
  opened_at           timestamptz,
  decided_at          timestamptz,
  locked_at           timestamptz,
  updated_at          timestamptz not null default now()
);
alter table public.command_proposals enable row level security;
create index if not exists command_proposals_status on public.command_proposals (status, created_at desc);
create index if not exists command_proposals_search on public.command_proposals
  using gin (to_tsvector('english', title || ' ' || problem || ' ' || recommendation || ' ' || reasoning));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VOTES
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per founder per proposal, updated in place when a founder changes
-- their mind before the decision lands. command_vote_history keeps the changes,
-- because "who moved, and when" is exactly the thing an audit trail exists for.
create table if not exists public.command_votes (
  proposal_id uuid not null references public.command_proposals(id) on delete cascade,
  founder_id  uuid not null references public.command_founders(user_id) on delete cascade,
  choice      text not null check (choice in ('approve','reject','request_changes','abstain')),
  rationale   text not null default '',
  at          timestamptz not null default now(),
  primary key (proposal_id, founder_id)
);
alter table public.command_votes enable row level security;

create table if not exists public.command_vote_history (
  id          bigserial primary key,
  proposal_id uuid not null references public.command_proposals(id) on delete cascade,
  founder_id  uuid not null,
  choice      text not null,
  rationale   text not null default '',
  at          timestamptz not null default now()
);
alter table public.command_vote_history enable row level security;
create index if not exists command_vote_history_proposal on public.command_vote_history (proposal_id, at desc);

create table if not exists public.command_comments (
  id           uuid primary key default gen_random_uuid(),
  proposal_id  uuid references public.command_proposals(id) on delete cascade,
  release_id   uuid,
  author_kind  text not null default 'founder' check (author_kind in ('founder','agent')),
  author_id    uuid references auth.users(id) on delete set null,
  author_key   text,
  body         text not null,
  at           timestamptz not null default now()
);
alter table public.command_comments enable row level security;
create index if not exists command_comments_proposal on public.command_comments (proposal_id, at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WORK ORDERS — what an approval actually produces.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_work_orders (
  id                       uuid primary key default gen_random_uuid(),
  ref                      text unique not null,
  proposal_id              uuid not null references public.command_proposals(id) on delete cascade,
  title                    text not null,
  objectives               text[] not null default '{}',
  scope                    text not null default '',
  exclusions               text[] not null default '{}',
  acceptance_criteria      text[] not null default '{}',
  technical_requirements   text[] not null default '{}',
  design_requirements      text[] not null default '{}',
  testing_requirements     text[] not null default '{}',
  analytics_requirements   text[] not null default '{}',
  branch                   text not null,
  assigned_agents          text[] not null default '{}',
  status                   text not null default 'open'
                             check (status in ('open','in_progress','blocked','complete','cancelled')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
alter table public.command_work_orders enable row level security;
create index if not exists command_work_orders_status on public.command_work_orders (status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. THE DEVELOPMENT FLOOR — one row per agent per piece of work.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_tasks (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid references public.command_work_orders(id) on delete cascade,
  agent_key      text not null references public.command_agents(key),
  title          text not null,
  status         text not null default 'queued'
                   check (status in ('queued','planning','building','testing','awaiting_review','blocked','completed','ready_for_release')),
  progress       integer not null default 0 check (progress between 0 and 100),
  branch         text,
  files_modified text[] not null default '{}',
  dependencies   text[] not null default '{}',
  preview_url    text,
  latest_reasoning text not null default '',
  blocked_reason text,
  session_id     text,
  model          text,
  commit_sha     text,
  started_at     timestamptz,
  updated_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
alter table public.command_tasks enable row level security;
create index if not exists command_tasks_live on public.command_tasks (status, updated_at desc);
create index if not exists command_tasks_order on public.command_tasks (work_order_id);

-- The reasoning stream. Append-only by construction — there is no update path.
create table if not exists public.command_task_events (
  id      bigserial primary key,
  task_id uuid not null references public.command_tasks(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null default 'note'
            check (kind in ('note','plan','edit','test','blocked','unblocked','status','commit','review')),
  message text not null,
  detail  jsonb not null default '{}'::jsonb
);
alter table public.command_task_events enable row level security;
create index if not exists command_task_events_task on public.command_task_events (task_id, at desc);
create index if not exists command_task_events_recent on public.command_task_events (at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. DEV LAB — isolated workspaces. Nothing here touches production.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_lab_workspaces (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.command_work_orders(id) on delete cascade,
  proposal_id   uuid references public.command_proposals(id) on delete set null,
  name          text not null,
  branch        text not null,
  preview_url   text,
  status        text not null default 'provisioned'
                  check (status in ('provisioned','active','archived')),
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  reset_at      timestamptz
);
alter table public.command_lab_workspaces enable row level security;

-- 7b. LAB EXHIBITS — how the AI shows the founders a thing instead of describing it.
--
-- A proposal that says "make the Arena card feel faster" is a paragraph a
-- founder has to imagine. An exhibit is the same claim, rendered, side by side
-- with what exists today, inside the Dev Lab where it cannot touch production.
-- Every proposal an agent raises SHOULD carry one; the council page links
-- straight into the lab so a vote is cast against something seen, not read.
--
-- payload is a render spec, not markup dumped into the page. The lab renders it
-- through a sandboxed iframe with no same-origin access, so an exhibit cannot
-- read a founder's session even though its whole purpose is to run code.
create table if not exists public.command_lab_exhibits (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.command_lab_workspaces(id) on delete cascade,
  proposal_id  uuid references public.command_proposals(id) on delete cascade,
  release_id   uuid,
  agent_key    text references public.command_agents(key),
  title        text not null,
  summary      text not null default '',
  kind         text not null default 'ui_variant'
                 check (kind in ('ui_variant','comparison','flow','simulation','asset','data','embed')),
  payload      jsonb not null default '{}'::jsonb,
  preview_url  text,
  status       text not null default 'staged' check (status in ('staged','reviewed','archived')),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now()
);
alter table public.command_lab_exhibits enable row level security;
create index if not exists command_lab_exhibits_proposal on public.command_lab_exhibits (proposal_id, created_at desc);
create index if not exists command_lab_exhibits_recent on public.command_lab_exhibits (created_at desc);

create or replace function public.command_add_exhibit(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  insert into command_lab_exhibits (workspace_id, proposal_id, release_id, agent_key, title, summary, kind, payload, preview_url, pinned)
  values (nullif(p->>'workspace_id','')::uuid, nullif(p->>'proposal_id','')::uuid,
          nullif(p->>'release_id','')::uuid, p->>'agent_key',
          coalesce(p->>'title','Untitled exhibit'), coalesce(p->>'summary',''),
          coalesce(p->>'kind','ui_variant'), coalesce(p->'payload','{}'::jsonb),
          p->>'preview_url', coalesce((p->>'pinned')::boolean, false))
  returning id into v_id;
  select ref into v_ref from command_proposals where id = nullif(p->>'proposal_id','')::uuid;
  perform command_log('exhibit_staged', 'exhibit', v_id, v_ref,
                      coalesce(p->>'agent_key','agent') || ' staged "' || coalesce(p->>'title','') || '" in Dev Lab',
                      jsonb_build_object('kind', coalesce(p->>'kind','ui_variant')),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      coalesce(p->>'agent_key', (select name from command_founders where user_id = auth.uid()), 'system'));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. THE RELEASE CHAMBER — the second gate. Approval here is not deployment.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_releases (
  id               uuid primary key default gen_random_uuid(),
  ref              text unique not null,
  work_order_id    uuid references public.command_work_orders(id) on delete set null,
  title            text not null,
  summary          text not null default '',
  before_state     text not null default '',
  after_state      text not null default '',
  screenshots      jsonb not null default '[]'::jsonb,   -- [{label, url}]
  files_changed    text[] not null default '{}',
  db_changes       text[] not null default '{}',
  test_results     jsonb not null default '{}'::jsonb,
  performance      jsonb not null default '{}'::jsonb,
  security_review  jsonb not null default '{}'::jsonb,
  rollback_plan    text not null default '',
  preview_build    text,
  known_issues     text[] not null default '{}',
  recommendation   text not null default '',
  category         text not null default 'production'
                     check (category in ('prototype','production','monetisation','ownership','privacy','security')),
  sentinel_verdict text not null default 'pending'
                     check (sentinel_verdict in ('pending','approved','blocked')),
  sentinel_note    text not null default '',
  status           text not null default 'open'
                     check (status in ('open','approved','rejected','changes_requested','deployed','rolled_back','withdrawn')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  deployed_at      timestamptz,
  updated_at       timestamptz not null default now()
);
alter table public.command_releases enable row level security;
create index if not exists command_releases_status on public.command_releases (status, created_at desc);

create table if not exists public.command_release_votes (
  release_id uuid not null references public.command_releases(id) on delete cascade,
  founder_id uuid not null references public.command_founders(user_id) on delete cascade,
  choice     text not null check (choice in ('approve','reject','request_changes','abstain')),
  rationale  text not null default '',
  at         timestamptz not null default now(),
  primary key (release_id, founder_id)
);
alter table public.command_release_votes enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. THE AUDIT — permanent, append-only, searchable.
-- ─────────────────────────────────────────────────────────────────────────────
-- "Store permanently" is enforced, not promised: no UPDATE or DELETE policy
-- exists, and the privilege is revoked from authenticated outright. Founders can
-- read history; nobody signed in can edit it.
create table if not exists public.command_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_kind  text not null check (actor_kind in ('founder','agent','system')),
  actor_id    uuid,
  actor_label text not null,
  action      text not null,
  entity_kind text not null,
  entity_id   uuid,
  entity_ref  text,
  summary     text not null,
  detail      jsonb not null default '{}'::jsonb
);
alter table public.command_audit enable row level security;
create index if not exists command_audit_recent on public.command_audit (at desc);
create index if not exists command_audit_entity on public.command_audit (entity_kind, entity_id);
create index if not exists command_audit_search on public.command_audit
  using gin (to_tsvector('english', action || ' ' || actor_label || ' ' || coalesce(entity_ref,'') || ' ' || summary));

create or replace function public.command_log(
  p_action text, p_entity_kind text, p_entity_id uuid, p_entity_ref text,
  p_summary text, p_detail jsonb default '{}'::jsonb,
  p_actor_kind text default null, p_actor_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_label text;
begin
  v_kind := coalesce(p_actor_kind, case when auth.uid() is null then 'system' else 'founder' end);
  v_label := coalesce(p_actor_label,
                      (select name from command_founders where user_id = auth.uid()),
                      'system');
  insert into command_audit (actor_kind, actor_id, actor_label, action, entity_kind, entity_id, entity_ref, summary, detail)
  values (v_kind, auth.uid(), v_label, p_action, p_entity_kind, p_entity_id, p_entity_ref, p_summary, p_detail);
end $$;
revoke all on function public.command_log(text,text,uuid,text,text,jsonb,text,text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. THE RULES OF THE VOTE
-- ─────────────────────────────────────────────────────────────────────────────
-- 'majority'  -> approvals * 2 > active founders   (2 of 3)
-- 'unanimous' -> approvals     = active founders   (3 of 3)
-- Security additionally requires Sentinel's verdict, and Sentinel may block.
create or replace function public.command_rule(p_category text)
returns text language sql immutable as $$
  select case p_category
           when 'monetisation' then 'unanimous'
           when 'ownership'    then 'unanimous'
           when 'privacy'      then 'unanimous'
           else 'majority'
         end;
$$;

create or replace function public.command_tally(p_proposal uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cat text; v_total int; a int; r int; c int; ab int; v_rule text; v_needed int;
begin
  select category into v_cat from command_proposals where id = p_proposal;
  if v_cat is null then return null; end if;
  v_total := command_founder_count();
  v_rule  := command_rule(v_cat);
  v_needed := case when v_rule = 'unanimous' then v_total else (v_total / 2) + 1 end;

  select count(*) filter (where choice = 'approve'),
         count(*) filter (where choice = 'reject'),
         count(*) filter (where choice = 'request_changes'),
         count(*) filter (where choice = 'abstain')
    into a, r, c, ab
    from command_votes where proposal_id = p_proposal;

  return jsonb_build_object(
    'rule', v_rule, 'founders', v_total, 'needed', v_needed,
    'approve', a, 'reject', r, 'request_changes', c, 'abstain', ab,
    'cast', a + r + c + ab,
    -- A rejection majority is decisive whatever the approval rule: under
    -- unanimity a single reject is already fatal, so the check is "can the
    -- approval threshold still be reached with the votes that remain".
    'approved', a >= v_needed,
    'rejected', (v_total - r) < v_needed
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. AUTHORING AND OPENING A PROPOSAL
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_create_proposal(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text; v_id uuid; v_is_founder boolean;
begin
  v_is_founder := is_founder();
  -- Agents reach this through the service role, where auth.uid() is null.
  if auth.uid() is not null and not v_is_founder then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  v_ref := 'PROP-' || lpad(nextval('command_proposal_seq')::text, 3, '0');
  insert into command_proposals (
    ref, title, category, problem, recommendation, reasoning, benefits, risks,
    alternatives, complexity, departments, est_days, affected_screens, dependencies,
    exec_recommendation, documents, author_kind, author_key, author_id, status, opened_at)
  values (
    v_ref,
    coalesce(p->>'title', 'Untitled'),
    coalesce(p->>'category', 'prototype'),
    coalesce(p->>'problem', ''),
    coalesce(p->>'recommendation', ''),
    coalesce(p->>'reasoning', ''),
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
    p->>'author_key',
    auth.uid(),
    case when coalesce(p->>'status','open') = 'draft' then 'draft' else 'open' end,
    case when coalesce(p->>'status','open') = 'draft' then null else now() end)
  returning id into v_id;

  perform command_log('proposal_created', 'proposal', v_id, v_ref,
                      coalesce(p->>'title','Untitled'),
                      jsonb_build_object('category', coalesce(p->>'category','prototype')),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      coalesce(p->>'author_key', (select name from command_founders where user_id = auth.uid()), 'system'));
  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. THE AUTOMATIC WORKFLOW
-- ─────────────────────────────────────────────────────────────────────────────
-- Runs the instant a proposal reaches its threshold, inside the same
-- transaction as the deciding vote. Lock -> work order -> departments -> branch
-- -> Dev Lab workspace -> notify the Exec -> plan -> begin. And then it stops:
-- there is no deploy step here and there must never be one.
create or replace function public.command_open_work(p_proposal uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record; v_ref text; v_no int; v_wo uuid; v_branch text; v_agent text; v_ws uuid;
begin
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if exists (select 1 from command_work_orders where proposal_id = p_proposal) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_no := nextval('command_work_order_seq');
  v_ref := 'WO-' || lpad(v_no::text, 3, '0');
  v_branch := 'command/wo-' || lpad(v_no::text, 3, '0') || '-' ||
              left(command_slug(pr.title), 40);

  insert into command_work_orders (
    ref, proposal_id, title, objectives, scope, exclusions, acceptance_criteria,
    technical_requirements, design_requirements, testing_requirements,
    analytics_requirements, branch, assigned_agents, status)
  values (
    v_ref, p_proposal, pr.title,
    array[pr.recommendation],
    pr.problem,
    -- Explicit exclusions default to the constitution's own scope rule rather
    -- than to an empty list: an unbounded work order is how scope creeps.
    array['Anything not named in the objectives',
          'Production deployment (requires a separate release vote)',
          'Changes to systems outside ' || coalesce(nullif(array_to_string(pr.affected_screens, ', '), ''), 'the stated scope')],
    pr.benefits,
    '{}', '{}',
    array['Regression pass on affected screens', 'Sentinel review before release'],
    '{}',
    v_branch,
    pr.departments,
    'in_progress');
  select id into v_wo from command_work_orders where ref = v_ref;

  insert into command_lab_workspaces (work_order_id, proposal_id, name, branch, status)
  values (v_wo, p_proposal, pr.title, v_branch, 'provisioned')
  returning id into v_ws;

  -- The Exec plans first; every assigned department queues behind it.
  insert into command_tasks (work_order_id, agent_key, title, status, branch, latest_reasoning, started_at)
  values (v_wo, 'exec', 'Plan ' || v_ref || ' — ' || pr.title, 'planning', v_branch,
          'Work order opened by founder vote. Decomposing into department scope.', now());

  foreach v_agent in array coalesce(pr.departments, '{}') loop
    if exists (select 1 from command_agents where key = v_agent and active) then
      insert into command_tasks (work_order_id, agent_key, title, status, branch, dependencies)
      values (v_wo, v_agent, pr.title, 'queued', v_branch, array['exec']);
    end if;
  end loop;

  perform command_log('work_order_opened', 'work_order', v_wo, v_ref,
                      'Auto-generated from ' || pr.ref || ' on majority approval',
                      jsonb_build_object('branch', v_branch, 'departments', pr.departments,
                                         'lab_workspace', v_ws),
                      'system', 'automatic workflow');
  return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref, 'branch', v_branch);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. CASTING A VOTE
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_cast_vote(
  p_proposal uuid, p_choice text, p_rationale text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pr record; t jsonb; v_name text; v_work jsonb := null; v_status text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_choice not in ('approve','reject','request_changes','abstain') then
    raise exception 'command: unknown vote %', p_choice;
  end if;

  select * into pr from command_proposals where id = p_proposal for update;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if pr.status not in ('open','changes_requested') then
    raise exception 'command: % is % — voting is closed', pr.ref, pr.status;
  end if;

  select name into v_name from command_founders where user_id = auth.uid();

  insert into command_votes (proposal_id, founder_id, choice, rationale, at)
  values (p_proposal, auth.uid(), p_choice, coalesce(p_rationale,''), now())
  on conflict (proposal_id, founder_id)
    do update set choice = excluded.choice, rationale = excluded.rationale, at = now();
  insert into command_vote_history (proposal_id, founder_id, choice, rationale)
  values (p_proposal, auth.uid(), p_choice, coalesce(p_rationale,''));

  perform command_log('vote_cast', 'proposal', p_proposal, pr.ref,
                      v_name || ' voted ' || p_choice,
                      jsonb_build_object('choice', p_choice, 'rationale', p_rationale));

  t := command_tally(p_proposal);

  if (t->>'approved')::boolean then
    v_status := 'approved';
    update command_proposals
       set status = 'approved', decided_at = now(), locked_at = now(), updated_at = now()
     where id = p_proposal;
    perform command_log('proposal_approved', 'proposal', p_proposal, pr.ref,
                        pr.ref || ' approved ' || (t->>'approve') || '/' || (t->>'founders') ||
                        ' — locked. Development authorised; deployment is NOT.',
                        t, 'system', 'council');
    v_work := command_open_work(p_proposal);

  elsif (t->>'rejected')::boolean then
    v_status := 'rejected';
    update command_proposals
       set status = 'rejected', decided_at = now(), locked_at = now(), updated_at = now()
     where id = p_proposal;
    perform command_log('proposal_rejected', 'proposal', p_proposal, pr.ref,
                        pr.ref || ' rejected — ' || (t->>'reject') || ' against', t, 'system', 'council');

  elsif (t->>'request_changes')::int > 0 then
    v_status := 'changes_requested';
    update command_proposals set status = 'changes_requested', updated_at = now() where id = p_proposal;
  else
    v_status := pr.status;
  end if;

  return jsonb_build_object('ok', true, 'status', v_status, 'tally', t, 'work', v_work);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. THE RELEASE VOTE — approval sets a status. It does not ship anything.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_release_tally(p_release uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cat text; v_sentinel text; v_total int; a int; r int; c int; ab int; v_rule text; v_needed int;
begin
  select category, sentinel_verdict into v_cat, v_sentinel from command_releases where id = p_release;
  if v_cat is null then return null; end if;
  v_total := command_founder_count();
  v_rule  := command_rule(v_cat);
  v_needed := case when v_rule = 'unanimous' then v_total else (v_total / 2) + 1 end;

  select count(*) filter (where choice = 'approve'), count(*) filter (where choice = 'reject'),
         count(*) filter (where choice = 'request_changes'), count(*) filter (where choice = 'abstain')
    into a, r, c, ab from command_release_votes where release_id = p_release;

  return jsonb_build_object(
    'rule', v_rule, 'founders', v_total, 'needed', v_needed,
    'approve', a, 'reject', r, 'request_changes', c, 'abstain', ab, 'cast', a + r + c + ab,
    'sentinel', v_sentinel,
    -- Sentinel may block a release. A block is not a vote and cannot be
    -- outvoted; it is a gate that must be cleared before the count matters.
    'approved', a >= v_needed and v_sentinel = 'approved',
    'rejected', (v_total - r) < v_needed or v_sentinel = 'blocked',
    'blocked_by_sentinel', v_sentinel <> 'approved');
end $$;

create or replace function public.command_vote_release(
  p_release uuid, p_choice text, p_rationale text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record; t jsonb; v_name text; v_status text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into rel from command_releases where id = p_release for update;
  if rel is null then raise exception 'command: no such release'; end if;
  if rel.status not in ('open','changes_requested') then
    raise exception 'command: % is % — voting is closed', rel.ref, rel.status;
  end if;

  select name into v_name from command_founders where user_id = auth.uid();
  insert into command_release_votes (release_id, founder_id, choice, rationale, at)
  values (p_release, auth.uid(), p_choice, coalesce(p_rationale,''), now())
  on conflict (release_id, founder_id)
    do update set choice = excluded.choice, rationale = excluded.rationale, at = now();

  perform command_log('release_vote', 'release', p_release, rel.ref,
                      v_name || ' voted ' || p_choice || ' on ' || rel.ref,
                      jsonb_build_object('choice', p_choice, 'rationale', p_rationale));

  t := command_release_tally(p_release);
  if (t->>'approved')::boolean then
    v_status := 'approved';
    update command_releases set status = 'approved', decided_at = now(), updated_at = now() where id = p_release;
    -- Note what this does NOT do. Nothing is deployed here. A human runs the
    -- deploy and then calls command_mark_deployed, which is why deployed_at is
    -- a separate act with its own audit row.
    perform command_log('release_approved', 'release', p_release, rel.ref,
                        rel.ref || ' approved for deployment — awaiting a human to ship it',
                        t, 'system', 'council');
  elsif (t->>'rejected')::boolean then
    v_status := 'rejected';
    update command_releases set status = 'rejected', decided_at = now(), updated_at = now() where id = p_release;
    perform command_log('release_rejected', 'release', p_release, rel.ref, rel.ref || ' rejected', t, 'system', 'council');
  elsif (t->>'request_changes')::int > 0 then
    v_status := 'changes_requested';
    update command_releases set status = 'changes_requested', updated_at = now() where id = p_release;
  else
    v_status := rel.status;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'tally', t);
end $$;

-- Sentinel's gate. Callable by the QA agent through the service role, and by a
-- founder acting as Sentinel's escalation path — recorded either way.
create or replace function public.command_sentinel_verdict(
  p_release uuid, p_verdict text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_verdict not in ('pending','approved','blocked') then
    raise exception 'command: unknown verdict %', p_verdict;
  end if;
  select * into rel from command_releases where id = p_release;
  if rel is null then raise exception 'command: no such release'; end if;

  update command_releases set sentinel_verdict = p_verdict, sentinel_note = coalesce(p_note,''), updated_at = now()
   where id = p_release;
  perform command_log('sentinel_verdict', 'release', p_release, rel.ref,
                      'Sentinel: ' || p_verdict || case when p_note <> '' then ' — ' || p_note else '' end,
                      jsonb_build_object('verdict', p_verdict),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      case when auth.uid() is null then 'Sentinel' else
                           (select name from command_founders where user_id = auth.uid()) end);
  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end $$;

-- Deployment is recorded, never performed. Refuses on an unapproved release so
-- the audit trail cannot claim an approval that never happened.
create or replace function public.command_mark_deployed(p_release uuid, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into rel from command_releases where id = p_release;
  if rel is null then raise exception 'command: no such release'; end if;
  if rel.status <> 'approved' then
    raise exception 'command: % is % — only an approved release can be marked deployed', rel.ref, rel.status;
  end if;
  update command_releases set status = 'deployed', deployed_at = now(), updated_at = now() where id = p_release;
  update command_work_orders set status = 'complete', updated_at = now() where id = rel.work_order_id;
  perform command_log('release_deployed', 'release', p_release, rel.ref,
                      rel.ref || ' marked deployed', p_detail);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.command_rollback(p_release uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into rel from command_releases where id = p_release;
  if rel is null then raise exception 'command: no such release'; end if;
  update command_releases set status = 'rolled_back', updated_at = now() where id = p_release;
  perform command_log('release_rolled_back', 'release', p_release, rel.ref,
                      'Rolled back — ' || coalesce(p_reason,'no reason given'),
                      jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. FOUNDER ACTIONS ON PROPOSALS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_comment(
  p_proposal uuid, p_body text, p_release uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ref text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'command: empty comment'; end if;

  insert into command_comments (proposal_id, release_id, author_kind, author_id, body)
  values (p_proposal, p_release, case when auth.uid() is null then 'agent' else 'founder' end, auth.uid(), p_body)
  returning id into v_id;

  select ref into v_ref from command_proposals where id = p_proposal;
  perform command_log('comment', coalesce(case when p_release is null then 'proposal' end, 'release'),
                      coalesce(p_proposal, p_release), v_ref, left(p_body, 140));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.command_withdraw_proposal(p_proposal uuid, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if pr.status in ('approved','rejected') then
    raise exception 'command: % is decided and locked', pr.ref;
  end if;
  update command_proposals set status = 'withdrawn', decided_at = now(), locked_at = now(), updated_at = now()
   where id = p_proposal;
  perform command_log('proposal_withdrawn', 'proposal', p_proposal, pr.ref,
                      pr.ref || ' withdrawn — ' || coalesce(nullif(p_reason,''), 'no reason given'));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. THE DASHBOARD — one round trip.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'me', (select jsonb_build_object('name', name, 'title', title, 'accent', accent)
             from command_founders where user_id = auth.uid()),
    'counts', jsonb_build_object(
      'open_proposals',   (select count(*) from command_proposals where status in ('open','changes_requested')),
      'awaiting_my_vote', (select count(*) from command_proposals p
                            where p.status in ('open','changes_requested')
                              and not exists (select 1 from command_votes v
                                               where v.proposal_id = p.id and v.founder_id = auth.uid())),
      'open_work_orders', (select count(*) from command_work_orders where status in ('open','in_progress')),
      'active_tasks',     (select count(*) from command_tasks
                            where status in ('planning','building','testing','awaiting_review')),
      'blocked_tasks',    (select count(*) from command_tasks where status = 'blocked'),
      'ready_for_release',(select count(*) from command_tasks where status = 'ready_for_release'),
      'open_releases',    (select count(*) from command_releases where status in ('open','changes_requested')),
      'lab_workspaces',   (select count(*) from command_lab_workspaces where status <> 'archived')
    ),
    'proposals', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object(
          'id', p.id, 'ref', p.ref, 'title', p.title, 'category', p.category, 'status', p.status,
          'complexity', p.complexity, 'departments', p.departments, 'created_at', p.created_at,
          'author_kind', p.author_kind, 'author_key', p.author_key,
          'tally', command_tally(p.id),
          'exhibits', (select count(*) from command_lab_exhibits e where e.proposal_id = p.id and e.status <> 'archived'),
          'my_vote', (select choice from command_votes v where v.proposal_id = p.id and v.founder_id = auth.uid())
        ) as x from command_proposals p
         where p.status in ('open','changes_requested') order by p.created_at desc limit 12) s), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from (
        select * from command_tasks
         where status <> 'completed' order by updated_at desc limit 12) t), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from (
        select * from command_tasks where status = 'blocked' order by updated_at desc limit 8) t), '[]'::jsonb),
    'releases', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
        select id, ref, title, status, category, sentinel_verdict, created_at
          from command_releases where status not in ('deployed','rolled_back','withdrawn')
         order by created_at desc limit 6) r), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (
        select * from command_audit order by at desc limit 14) a), '[]'::jsonb),
    -- Exhibits waiting to be looked at. These are the things the AI wants the
    -- founders to SEE before voting, so they surface on the front page.
    'exhibits', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('id', e.id, 'title', e.title, 'kind', e.kind, 'summary', e.summary,
                                  'agent_key', e.agent_key, 'created_at', e.created_at,
                                  'proposal_id', e.proposal_id,
                                  'proposal_ref', (select ref from command_proposals p where p.id = e.proposal_id)) as x
          from command_lab_exhibits e where e.status = 'staged'
         order by e.created_at desc limit 6) s), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', e.at, 'kind', e.kind, 'message', e.message,
                                  'agent', t.agent_key, 'task', t.title, 'task_id', t.id) as x
          from command_task_events e join command_tasks t on t.id = e.task_id
         order by e.at desc limit 14) s), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(x order by x->>'sort') from (
        select jsonb_build_object(
          'key', ag.key, 'name', ag.name, 'title', ag.title, 'kind', ag.kind,
          'accent', ag.accent, 'permission', ag.permission, 'sort', ag.sort,
          'task', (select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                             'progress', t.progress, 'updated_at', t.updated_at)
                     from command_tasks t where t.agent_key = ag.key and t.status <> 'completed'
                    order by t.updated_at desc limit 1)
        ) as x from command_agents ag where ag.active) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. AGENT WRITE PATH (service role only — no client grant).
-- ─────────────────────────────────────────────────────────────────────────────
-- An agent claims a task, streams reasoning, and hands back. It can reach
-- 'ready_for_release'. It cannot reach 'deployed', because that status does not
-- exist on a task — shipping is a release-chamber act, gated by a founder vote.
create or replace function public.command_agent_update(
  p_task uuid, p_status text default null, p_progress integer default null,
  p_reasoning text default null, p_files text[] default null,
  p_event_kind text default 'note', p_message text default null,
  p_session text default null, p_model text default null,
  p_commit text default null, p_blocked_reason text default null,
  p_preview_url text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from command_tasks where id = p_task for update;
  if t is null then raise exception 'command: no such task'; end if;

  update command_tasks set
    status = coalesce(p_status, status),
    progress = coalesce(p_progress, progress),
    latest_reasoning = coalesce(p_reasoning, latest_reasoning),
    files_modified = coalesce(p_files, files_modified),
    session_id = coalesce(p_session, session_id),
    model = coalesce(p_model, model),
    commit_sha = coalesce(p_commit, commit_sha),
    preview_url = coalesce(p_preview_url, preview_url),
    blocked_reason = case when p_status = 'blocked' then coalesce(p_blocked_reason, blocked_reason)
                          when p_status is not null then null else blocked_reason end,
    started_at = coalesce(started_at, case when p_status in ('planning','building') then now() end),
    completed_at = case when p_status in ('completed','ready_for_release') then now() else completed_at end,
    updated_at = now()
  where id = p_task;

  if p_message is not null then
    insert into command_task_events (task_id, kind, message) values (p_task, coalesce(p_event_kind,'note'), p_message);
  end if;
  if p_status is not null and p_status is distinct from t.status then
    insert into command_task_events (task_id, kind, message)
    values (p_task, 'status', t.status || ' → ' || p_status);
    perform command_log('task_' || p_status, 'task', p_task, t.branch,
                        t.agent_key || ': ' || t.title || ' → ' || p_status,
                        jsonb_build_object('from', t.status, 'to', p_status),
                        'agent', t.agent_key);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.command_agent_update(uuid,text,integer,text,text[],text,text,text,text,text,text,text)
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. RLS — founders read everything, write nothing directly.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'command_founders','command_agents','command_proposals','command_votes',
    'command_vote_history','command_comments','command_work_orders','command_tasks',
    'command_task_events','command_lab_workspaces','command_lab_exhibits',
    'command_releases','command_release_votes','command_audit'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

grant execute on function public.is_founder() to authenticated;
grant execute on function public.command_dashboard() to authenticated;
grant execute on function public.command_tally(uuid) to authenticated;
grant execute on function public.command_release_tally(uuid) to authenticated;
grant execute on function public.command_cast_vote(uuid, text, text) to authenticated;
grant execute on function public.command_vote_release(uuid, text, text) to authenticated;
grant execute on function public.command_sentinel_verdict(uuid, text, text) to authenticated;
grant execute on function public.command_mark_deployed(uuid, jsonb) to authenticated;
grant execute on function public.command_rollback(uuid, text) to authenticated;
grant execute on function public.command_create_proposal(jsonb) to authenticated;
grant execute on function public.command_comment(uuid, text, uuid) to authenticated;
grant execute on function public.command_withdraw_proposal(uuid, text) to authenticated;
grant execute on function public.command_add_exhibit(jsonb) to authenticated;
revoke all on function public.command_open_work(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. SEED — the founders and the AI org.
-- ─────────────────────────────────────────────────────────────────────────────
-- Founders are matched by email against auth.users, so this migration is safe
-- to re-run and does not hard-code user ids.
insert into public.command_founders (user_id, name, title, accent)
select u.id, v.name, v.title, v.accent
  from (values
    ('tysoncooke865@gmail.com',      'Tyson',   'Founder · Product',    '#38BDF8'),
    ('newletterwhore@gmail.com',     'Jesse',   'Founder',              '#A78BFA'),
    ('charli.lachlan.davis@gmail.com','Charlie', 'Founder',             '#34D399')
  ) as v(email, name, title, accent)
  join auth.users u on lower(u.email) = v.email
on conflict (user_id) do update set name = excluded.name, title = excluded.title, accent = excluded.accent;

insert into public.command_agents (key, name, title, kind, mandate, remit, permission, accent, can_block, sort)
values
  ('exec','Studio Director','AI Executive','exec',
   'Understands the EvoForge vision, prioritises work, maintains the roadmap, rejects unnecessary work, creates work orders, assigns departments, monitors progress, reviews deliverables and reports to the founders. Never writes production code — it delegates.',
   array['Roadmap','Prioritisation','Work orders','Department assignment','Founder reporting'],
   'recommend','#38BDF8',false,0),

  ('forge','Forge','Product Director','director',
   'Owns what gets built and why: roadmap, feature specifications, onboarding, retention, acceptance criteria and feature documentation.',
   array['Roadmap','Specifications','Onboarding','Retention','Acceptance criteria','Documentation'],
   'recommend','#38BDF8',false,10),

  ('atlas','Atlas','Technical Director','director',
   'Owns how it is built: architecture, Supabase, Expo, React Native, APIs, security architecture, performance and engineering planning.',
   array['Architecture','Supabase','Expo / React Native','APIs','Security architecture','Performance'],
   'build','#60A5FA',false,20),

  ('nova','Nova','UI/UX Director','director',
   'Owns how it feels: UI redesigns, the component library, design system, interactions, animation and accessibility. All experimentation happens inside Dev Lab.',
   array['UI redesign','Dev Lab','Component library','Design system','Interactions','Accessibility'],
   'prototype','#22D3EE',false,30),

  ('cipher','Cipher','Gameplay Director','director',
   'Owns the Arena: battles, combat, ghosts, rivals, progression gameplay, difficulty and mechanics.',
   array['Arena','Battles','Combat','Ghosts','Rivals','Difficulty'],
   'prototype','#F472B6',false,40),

  ('oracle','Oracle','Progression Director','director',
   'Owns the numbers athletes chase: XP, Evo Rating, coins, economy, evolution, unlocks, reward balance and retention pacing.',
   array['XP','Evo Rating','Economy','Unlocks','Reward balance','Retention pacing'],
   'recommend','#A78BFA',false,50),

  ('pixel','Pixel','Art Director','director',
   'Owns the look: character direction, sprites, 3D models, VFX, icons, skins and animation standards.',
   array['Character direction','Sprites','3D','VFX','Icons','Animation standards'],
   'prototype','#FBBF24',false,60),

  ('sentinel','Sentinel','QA & Security Director','director',
   'Owns whether it is safe to ship: testing, regression, authentication, exploits, Supabase security, performance and App Store readiness. Sentinel may block a release.',
   array['Testing','Regression','Auth','Exploits','Supabase security','Release approval'],
   'release_candidate','#F87171',true,70),

  ('pulse','Pulse','Data Director','director',
   'Owns the truth about behaviour: analytics, funnels, retention, A/B testing, dashboards and player insight.',
   array['Analytics','Funnels','Retention','A/B testing','Dashboards'],
   'observe','#34D399',false,80),

  ('vanguard','Vanguard','Growth Director','director',
   'Owns reach: beta testers, App Store optimisation, referrals, launch, social content, creator outreach and community.',
   array['Beta','ASO','Referrals','Launch','Social','Community'],
   'recommend','#FB923C',false,90),

  ('builder','Builder','Feature Engineer','worker',
   'Builds approved features. Nothing else.',
   array['Approved features'],'build','#60A5FA',false,100),
  ('patch','Patch','Bugfix Engineer','worker',
   'Fixes bugs. Nothing else.',
   array['Bug fixes'],'build','#38BDF8',false,110),
  ('schema','Schema','Database Engineer','worker',
   'Database work only: migrations, RLS, indexes, data contracts.',
   array['Migrations','RLS','Indexes'],'build','#A78BFA',false,120),
  ('device','Device','Performance Engineer','worker',
   'Performance optimisation only: bundle size, frame time, latency, memory.',
   array['Bundle size','Frame time','Latency','Memory'],'build','#34D399',false,130)
on conflict (key) do update set
  name = excluded.name, title = excluded.title, kind = excluded.kind,
  mandate = excluded.mandate, remit = excluded.remit, permission = excluded.permission,
  accent = excluded.accent, can_block = excluded.can_block, sort = excluded.sort;
