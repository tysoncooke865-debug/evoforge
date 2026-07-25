-- EvoForge 090 — COMMAND: vote from a phone, and let the verdict actually ship.
--
-- TWO INSTRUCTIONS FROM TYSON (2026-07-25), AND THE RULE THEY COLLIDE WITH.
--
--   "all us founders should be able to vote on a decision remotely on our
--    phone, and once the verdict is in the AI should immediately begin
--    implementing and deploying the decision"
--
-- The brief that opened this project says, twice and in capitals: approval
-- authorises development, never deploy automatically, no AI may deploy to
-- production without explicit founder approval. Taken literally the two cannot
-- both hold, so this migration resolves them rather than quietly picking one.
--
-- THE RESOLUTION: a founder vote IS the explicit approval. The original rule
-- exists to stop an AGENT deciding on its own to ship — not to make the owners
-- press the same button twice. So a proposal now carries a deploy_policy that
-- every founder can SEE BEFORE VOTING:
--
--   'auto'  — "approving this also authorises deployment." The vote is the
--             approval the constitution demands; it is simply given in advance
--             and recorded against each founder's name.
--   'gated' — approval authorises development only; the finished work returns
--             to the Release Chamber for a second vote. The original behaviour.
--
-- WHAT CANNOT BE MADE AUTOMATIC, EVER. Monetisation, ownership and privacy
-- proposals are forced to 'gated' in a trigger, not by convention. Those are
-- the three categories the constitution already requires to be unanimous — the
-- decisions that can cost real money, real ownership or a real person's data.
-- A studio that ships those on a ten-minute timer is not autonomous, it is
-- unsupervised. The check lives in the database so no UI change can lift it.
--
-- AND THREE THINGS SURVIVE ON EVERY PATH: Sentinel can still block a release
-- (an AI veto over another AI's work); every deploy is recorded before it is
-- attempted, not after; and any ONE founder can halt everything alone —
-- stopping needs one voice, never two.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DEPLOY POLICY
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_proposals
  add column if not exists deploy_policy text not null default 'gated'
    check (deploy_policy in ('gated','auto'));
alter table public.command_work_orders
  add column if not exists auto_deploy boolean not null default false;
alter table public.command_releases
  add column if not exists pre_authorised boolean not null default false;
alter table public.command_releases
  add column if not exists deploy_log jsonb not null default '[]'::jsonb;

insert into public.command_settings (key, value, note) values
  ('default_deploy_policy', '"auto"'::jsonb,
   'What a new prototype/production/security proposal defaults to. "auto" means an approving vote also authorises deployment. Monetisation, ownership and privacy are forced to "gated" regardless of this setting.'),
  ('halted', 'false'::jsonb,
   'Emergency stop. Any single founder may set it. Blocks proposing, dispatching and deploying until cleared.'),
  ('halt_reason', '""'::jsonb, 'Why the studio is halted, and by whom.')
on conflict (key) do nothing;

-- The floor. A trigger, not a convention: the UI cannot offer what the database
-- refuses to store.
create or replace function public.command_force_gated()
returns trigger language plpgsql as $$
begin
  if new.category in ('monetisation','ownership','privacy') then
    new.deploy_policy := 'gated';
  end if;
  return new;
end $$;
drop trigger if exists command_proposals_force_gated on public.command_proposals;
create trigger command_proposals_force_gated
  before insert or update of category, deploy_policy on public.command_proposals
  for each row execute function public.command_force_gated();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE DISPATCH QUEUE — what the studio runner actually picks up.
-- ─────────────────────────────────────────────────────────────────────────────
-- The runner is a node process holding the service-role key (scripts/studio-
-- runner.mjs). It claims work here, drives Claude Code against the EvoForge
-- repo on the work order's branch, and reports back. The queue exists so that
-- "immediately begin implementing" survives the runner crashing, restarting or
-- being offline: nothing is lost, it is simply still pending.
create table if not exists public.command_dispatch (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('implement','verify','release','deploy')),
  work_order_id uuid references public.command_work_orders(id) on delete cascade,
  task_id       uuid references public.command_tasks(id) on delete cascade,
  release_id    uuid references public.command_releases(id) on delete cascade,
  status        text not null default 'pending'
                  check (status in ('pending','claimed','running','done','failed','cancelled')),
  priority      integer not null default 100,
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  claimed_by    text,
  claimed_at    timestamptz,
  payload       jsonb not null default '{}'::jsonb,
  result        jsonb not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.command_dispatch enable row level security;
create index if not exists command_dispatch_pending on public.command_dispatch (status, priority, created_at);

-- Atomic claim. SKIP LOCKED so two runners never take the same job, and a
-- halted studio hands out nothing at all.
create or replace function public.command_claim_dispatch(p_worker text, p_kinds text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; v_halted boolean;
begin
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

  return jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'payload', d.payload, 'attempt', d.attempts + 1,
    'work_order', (select to_jsonb(w) from command_work_orders w where w.id = d.work_order_id),
    'task', (select to_jsonb(t) from command_tasks t where t.id = d.task_id),
    'release', (select to_jsonb(r) from command_releases r where r.id = d.release_id),
    'proposal', (select to_jsonb(p) from command_proposals p
                  join command_work_orders w on w.proposal_id = p.id where w.id = d.work_order_id));
end $$;

create or replace function public.command_finish_dispatch(
  p_id uuid, p_status text, p_result jsonb default '{}'::jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from command_dispatch where id = p_id;
  if d is null then raise exception 'command: no such dispatch'; end if;
  update command_dispatch
     set status = p_status, result = coalesce(p_result,'{}'::jsonb), error = p_error, updated_at = now()
   where id = p_id;
  -- A failure that has retries left goes back on the queue rather than dying
  -- quietly, because a runner killed mid-build is the normal case, not an
  -- exceptional one.
  if p_status = 'failed' and d.attempts < d.max_attempts then
    update command_dispatch set status = 'pending', updated_at = now() where id = p_id;
  end if;
  perform command_log('dispatch_' || p_status, 'dispatch', p_id, d.kind,
                      d.kind || ' → ' || p_status || coalesce(' — ' || p_error, ''),
                      coalesce(p_result,'{}'::jsonb), 'agent', coalesce(d.claimed_by,'runner'));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WORK OPENING, NOW WITH DISPATCH
-- ─────────────────────────────────────────────────────────────────────────────
-- Same contract as 088 plus two things: carry the deploy policy onto the work
-- order, and enqueue the implementation work so the runner starts within
-- seconds of the deciding vote rather than whenever someone notices.
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

  v_no := nextval('command_work_order_seq');
  v_ref := 'WO-' || lpad(v_no::text, 3, '0');
  v_branch := 'command/wo-' || lpad(v_no::text, 3, '0') || '-' || left(command_slug(pr.title), 40);

  insert into command_work_orders (
    ref, proposal_id, title, objectives, scope, exclusions, acceptance_criteria,
    technical_requirements, design_requirements, testing_requirements,
    analytics_requirements, branch, assigned_agents, status, auto_deploy)
  values (
    v_ref, p_proposal, pr.title,
    array[pr.recommendation], pr.problem,
    array['Anything not named in the objectives',
          case when pr.deploy_policy = 'auto'
               then 'Any change outside ' || coalesce(nullif(array_to_string(pr.affected_screens, ', '), ''), 'the stated scope') || ' (this work order deploys on completion — scope creep ships)'
               else 'Production deployment (requires a separate release vote)' end,
          'Schema changes not named in the proposal'],
    pr.benefits, '{}', '{}',
    array['Regression pass on affected screens', 'Sentinel review before release'],
    '{}', v_branch, pr.departments, 'in_progress',
    pr.deploy_policy = 'auto')
  returning id into v_wo;

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
                      case when pr.deploy_policy = 'auto'
                           then ' — DEPLOY AUTHORISED by the same vote' else '' end,
                      jsonb_build_object('branch', v_branch, 'departments', pr.departments,
                                         'lab_workspace', v_ws, 'auto_deploy', pr.deploy_policy = 'auto'),
                      'system', 'automatic workflow');
  return jsonb_build_object('ok', true, 'work_order', v_wo, 'ref', v_ref,
                            'branch', v_branch, 'auto_deploy', pr.deploy_policy = 'auto');
end $$;
revoke all on function public.command_open_work(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FROM FINISHED WORK TO A RELEASE — automatically, on both paths.
-- ─────────────────────────────────────────────────────────────────────────────
-- Called by the runner when every task on a work order reaches
-- ready_for_release. Builds the Release Chamber document out of what actually
-- happened (the files each agent touched, the commits, the test results), then
-- either queues the deploy (pre-authorised) or parks it for a vote.
create or replace function public.command_raise_release(p_work_order uuid, p_body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wo record; pr record; v_ref text; v_id uuid; v_files text[]; v_open int;
begin
  select * into wo from command_work_orders where id = p_work_order;
  if wo is null then raise exception 'command: no such work order'; end if;
  select * into pr from command_proposals where id = wo.proposal_id;

  select count(*) into v_open from command_tasks
   where work_order_id = p_work_order and status not in ('completed','ready_for_release');
  if v_open > 0 then
    return jsonb_build_object('ok', false, 'reason', v_open || ' task(s) still open');
  end if;
  if exists (select 1 from command_releases where work_order_id = p_work_order
              and status not in ('rejected','withdrawn','rolled_back')) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select coalesce(array_agg(distinct f), '{}') into v_files
    from command_tasks t, unnest(t.files_modified) f where t.work_order_id = p_work_order;

  v_ref := 'REL-' || lpad(nextval('command_release_seq')::text, 3, '0');
  insert into command_releases (
    ref, work_order_id, title, summary, before_state, after_state, files_changed,
    db_changes, test_results, performance, security_review, rollback_plan,
    preview_build, known_issues, recommendation, category, pre_authorised, screenshots)
  values (
    v_ref, p_work_order, wo.title,
    coalesce(p_body->>'summary', wo.scope),
    coalesce(p_body->>'before_state',''), coalesce(p_body->>'after_state',''),
    v_files,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_body->'db_changes','[]'::jsonb))),'{}'),
    coalesce(p_body->'test_results','{}'::jsonb),
    coalesce(p_body->'performance','{}'::jsonb),
    coalesce(p_body->'security_review','{}'::jsonb),
    coalesce(p_body->>'rollback_plan', 'git revert the merge commit on ' || wo.branch || ' and redeploy the previous build.'),
    p_body->>'preview_build',
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_body->'known_issues','[]'::jsonb))),'{}'),
    coalesce(p_body->>'recommendation',''),
    coalesce(pr.category, 'production'),
    coalesce(wo.auto_deploy, false),
    coalesce(p_body->'screenshots','[]'::jsonb))
  returning id into v_id;

  insert into command_dispatch (kind, work_order_id, release_id, priority, payload)
  values ('verify', p_work_order, v_id, 20,
          jsonb_build_object('instruction','Run the Sentinel gate: lint, typecheck, tests, token/motion guards, export. Then post a verdict.'));

  perform command_log('release_raised', 'release', v_id, v_ref,
                      v_ref || ' raised from ' || wo.ref ||
                      case when wo.auto_deploy then ' — pre-authorised, deploys once Sentinel clears'
                           else ' — awaiting a founder vote' end,
                      jsonb_build_object('pre_authorised', wo.auto_deploy), 'agent', 'exec');
  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'pre_authorised', wo.auto_deploy);
end $$;

-- Sentinel's verdict is what releases the deploy on the pre-authorised path.
-- Rewritten from 088 so that clearing the gate enqueues the deploy itself: the
-- founders' authorisation plus Sentinel's pass is the complete condition, and
-- nothing should sit waiting for a human to notice both happened.
create or replace function public.command_sentinel_verdict(
  p_release uuid, p_verdict text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record; v_halted boolean; v_queued boolean := false;
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

  if p_verdict = 'blocked' then
    update command_releases set status = 'changes_requested', updated_at = now() where id = p_release;
    update command_dispatch set status = 'cancelled', updated_at = now()
     where release_id = p_release and kind = 'deploy' and status in ('pending','claimed');
  elsif p_verdict = 'approved' and rel.pre_authorised and rel.status = 'open' then
    select (value)::text::boolean into v_halted from command_settings where key = 'halted';
    if coalesce(v_halted, false) then
      perform command_log('deploy_withheld', 'release', p_release, rel.ref,
                          'Sentinel cleared ' || rel.ref || ' but the studio is halted — deploy not queued.',
                          '{}'::jsonb, 'system', 'safety');
    else
      update command_releases set status = 'approved', decided_at = now(), updated_at = now() where id = p_release;
      insert into command_dispatch (kind, work_order_id, release_id, priority, payload)
      values ('deploy', rel.work_order_id, p_release, 5,
              jsonb_build_object('instruction','Merge the work order branch and push. CI deploys.'));
      v_queued := true;
      perform command_log('deploy_queued', 'release', p_release, rel.ref,
                          rel.ref || ' cleared Sentinel and was pre-authorised by the founders — deploying now.',
                          '{}'::jsonb, 'system', 'automatic workflow');
    end if;
  end if;

  perform command_log('sentinel_verdict', 'release', p_release, rel.ref,
                      'Sentinel: ' || p_verdict || case when p_note <> '' then ' — ' || p_note else '' end,
                      jsonb_build_object('verdict', p_verdict),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      case when auth.uid() is null then 'Sentinel'
                           else (select name from command_founders where user_id = auth.uid()) end);
  return jsonb_build_object('ok', true, 'verdict', p_verdict, 'deploy_queued', v_queued);
end $$;

-- The gated path: a founder vote that approves also queues the deploy, because
-- pressing approve in the Release Chamber IS the instruction to ship.
create or replace function public.command_vote_release(
  p_release uuid, p_choice text, p_rationale text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record; t jsonb; v_name text; v_status text; v_halted boolean;
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
    select (value)::text::boolean into v_halted from command_settings where key = 'halted';
    if not coalesce(v_halted, false) then
      insert into command_dispatch (kind, work_order_id, release_id, priority, payload)
      values ('deploy', rel.work_order_id, p_release, 5,
              jsonb_build_object('instruction','Merge the work order branch and push. CI deploys.'));
    end if;
    perform command_log('release_approved', 'release', p_release, rel.ref,
                        rel.ref || ' approved ' || (t->>'approve') || '/' || (t->>'founders') ||
                        ' — deploy queued', t, 'system', 'council');
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

-- The runner reports the outcome of an actual deploy. Recorded whether it
-- worked or not — a failed deploy that leaves no trace is how you end up
-- believing something shipped.
create or replace function public.command_record_deploy(
  p_release uuid, p_ok boolean, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rel record;
begin
  select * into rel from command_releases where id = p_release;
  if rel is null then raise exception 'command: no such release'; end if;
  if rel.status <> 'approved' then
    raise exception 'command: % is % — only an approved release may be deployed', rel.ref, rel.status;
  end if;
  update command_releases
     set status = case when p_ok then 'deployed' else 'approved' end,
         deployed_at = case when p_ok then now() else deployed_at end,
         deploy_log = deploy_log || jsonb_build_array(p_detail || jsonb_build_object('at', now(), 'ok', p_ok)),
         updated_at = now()
   where id = p_release;
  if p_ok then
    update command_work_orders set status = 'complete', updated_at = now() where id = rel.work_order_id;
    update command_tasks set status = 'completed', updated_at = now()
     where work_order_id = rel.work_order_id and status = 'ready_for_release';
    update command_backlog set status = 'done', updated_at = now()
     where proposal_id = (select proposal_id from command_work_orders where id = rel.work_order_id);
  end if;
  perform command_log(case when p_ok then 'release_deployed' else 'deploy_failed' end,
                      'release', p_release, rel.ref,
                      rel.ref || case when p_ok then ' is live in production.' else ' FAILED to deploy.' end,
                      p_detail, 'agent', 'runner');
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE HALT — one founder, alone, stops everything.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_halt(p_on boolean, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; v_cancelled int := 0;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_settings set value = to_jsonb(p_on), updated_at = now() where key = 'halted';
  update command_settings set value = to_jsonb(coalesce(p_reason,'')), updated_at = now() where key = 'halt_reason';

  if p_on then
    update command_dispatch set status = 'cancelled', updated_at = now()
     where status in ('pending','claimed') and kind = 'deploy';
    get diagnostics v_cancelled = row_count;
  end if;

  perform command_log(case when p_on then 'studio_halted' else 'studio_resumed' end,
                      'settings', null, 'halted',
                      case when p_on then v_name || ' halted the studio — ' || coalesce(nullif(p_reason,''),'no reason given')
                           else v_name || ' resumed the studio' end,
                      jsonb_build_object('cancelled_deploys', v_cancelled));
  return jsonb_build_object('ok', true, 'halted', p_on, 'cancelled_deploys', v_cancelled);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PHONE PUSH — so a vote can be cast from anywhere.
-- ─────────────────────────────────────────────────────────────────────────────
-- Separate from the athlete app's push_subscriptions: different origin,
-- different service worker, different subscription object. Same VAPID pair, so
-- the existing edge secrets sign these too.
create table if not exists public.command_push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
alter table public.command_push_subscriptions enable row level security;

create or replace function public.command_subscribe_push(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  insert into command_push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p->>'endpoint', auth.uid(), p->>'p256dh', p->>'auth', coalesce(p->>'user_agent',''))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
                                       auth = excluded.auth, user_agent = excluded.user_agent;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.command_unsubscribe_push(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from command_push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- The outbox. A row per founder per event, claimed by the sender exactly once,
-- so a retry cannot double-buzz three phones at 3am (the 085 lesson: claim
-- BEFORE sending; the failure mode must be silence, not a double send).
create table if not exists public.command_outbox (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  kind      text not null,
  title     text not null,
  body      text not null,
  url       text not null default '/',
  created_at timestamptz not null default now(),
  sent_at   timestamptz,
  claimed_at timestamptz
);
alter table public.command_outbox enable row level security;
create index if not exists command_outbox_unsent on public.command_outbox (created_at) where sent_at is null;

create or replace function public.command_notify_founders(
  p_kind text, p_title text, p_body text, p_url text default '/', p_except uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into command_outbox (user_id, kind, title, body, url)
  select f.user_id, p_kind, p_title, p_body, p_url
    from command_founders f
   where f.active and (p_except is null or f.user_id <> p_except);
end $$;

-- Every event a phone should buzz for. Triggers rather than call sites: a new
-- proposal path added later still notifies, because the notification is a
-- property of the row changing, not of the function that changed it.
create or replace function public.command_proposal_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    perform command_notify_founders('proposal_open',
      'New proposal — ' || new.ref,
      new.title || ' · ' || upper(new.category) ||
      case when new.deploy_policy = 'auto' then ' · approving also authorises deploy' else '' end,
      '/council/' || new.ref, new.author_id);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status
        and new.status in ('approved','rejected') then
    perform command_notify_founders('proposal_decided',
      new.ref || ' ' || new.status,
      new.title, '/council/' || new.ref, null);
  end if;
  return new;
end $$;
drop trigger if exists command_proposals_notify on public.command_proposals;
create trigger command_proposals_notify after insert or update on public.command_proposals
  for each row execute function public.command_proposal_notify();

create or replace function public.command_release_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and not new.pre_authorised then
    perform command_notify_founders('release_open',
      'Release awaiting your vote — ' || new.ref, new.title, '/releases/' || new.ref, null);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'deployed' then
    perform command_notify_founders('deployed', new.ref || ' is live', new.title, '/releases/' || new.ref, null);
  end if;
  return new;
end $$;
drop trigger if exists command_releases_notify on public.command_releases;
create trigger command_releases_notify after insert or update on public.command_releases
  for each row execute function public.command_release_notify();

-- Claimed-then-sent, by the edge function.
create or replace function public.command_claim_outbox(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with claimed as (
    update command_outbox set claimed_at = now()
     where id in (select id from command_outbox
                   where sent_at is null and (claimed_at is null or claimed_at < now() - interval '5 minutes')
                   order by created_at limit greatest(1, least(100, p_limit))
                   for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'title', c.title, 'body', c.body, 'url', c.url,
           'subs', (select coalesce(jsonb_agg(jsonb_build_object(
                             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                      from command_push_subscriptions s where s.user_id = c.user_id))), '[]'::jsonb)
    into v from claimed c;
  return v;
end $$;

create or replace function public.command_mark_sent(p_ids bigint[], p_dead text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update command_outbox set sent_at = now() where id = any(p_ids);
  delete from command_push_subscriptions where endpoint = any(coalesce(p_dead, '{}'));
  return jsonb_build_object('ok', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE AUTOPILOT CYCLE RESPECTS THE HALT
-- ─────────────────────────────────────────────────────────────────────────────
-- 089's cycle body moves to _inner and command_exec_cycle becomes the guard in
-- front of it. Split rather than edited so the halt check cannot be lost inside
-- a later rewrite of the scoring logic — the thing that stops the studio and the
-- thing that runs it are now separate functions.
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
       where p.status = 'rejected'
         and p.decided_at > now() - make_interval(days => v_cooldown)
         and p.id = b.proposal_id) then
      v_block := 'rejected within the ' || v_cooldown || '-day cooldown';
    end if;

    if v_block is null then
      v_res := command_create_proposal(
        (b.document || jsonb_build_object(
          'title', b.title, 'category', b.category,
          'departments', to_jsonb(b.departments),
          'author_kind', 'agent', 'author_key', 'exec', 'status', 'open')));

      update command_backlog
         set status = 'proposed', proposal_id = (v_res->>'id')::uuid, updated_at = now()
       where id = b.id;

      insert into command_exec_heartbeat (action, reason, topic_key, proposal_id, detail)
      values ('proposed', 'Raised ' || (v_res->>'ref') || ' — ' || b.title,
              b.topic_key, (v_res->>'id')::uuid,
              jsonb_build_object('priority', (b.value_score * b.confidence_score * 10) / greatest(b.effort_score,1),
                                 'source', b.source));
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

create or replace function public.command_exec_cycle()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_halted boolean; v_reason text;
begin
  select (value)::text::boolean into v_halted from command_settings where key = 'halted';
  if coalesce(v_halted, false) then
    select (value)#>>'{}' into v_reason from command_settings where key = 'halt_reason';
    insert into command_exec_heartbeat (action, reason)
    values ('paused', 'Studio halted by a founder — ' || coalesce(nullif(v_reason,''), 'no reason given'));
    return jsonb_build_object('action','paused','reason',v_reason);
  end if;
  return command_exec_cycle_inner();
end $$;
revoke all on function public.command_exec_cycle_inner() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS, GRANTS, SCHEDULE
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_dispatch','command_push_subscriptions','command_outbox'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

grant execute on function public.command_halt(boolean, text) to authenticated;
grant execute on function public.command_subscribe_push(jsonb) to authenticated;
grant execute on function public.command_unsubscribe_push(text) to authenticated;
grant execute on function public.command_raise_release(uuid, jsonb) to authenticated;
grant execute on function public.command_sentinel_verdict(uuid, text, text) to authenticated;
grant execute on function public.command_vote_release(uuid, text, text) to authenticated;
-- Runner-only: these move real work and must never be reachable from a browser.
revoke all on function public.command_claim_dispatch(text, text[]) from public, anon, authenticated;
revoke all on function public.command_finish_dispatch(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.command_record_deploy(uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.command_claim_outbox(int) from public, anon, authenticated;
revoke all on function public.command_mark_sent(bigint[], text[]) from public, anon, authenticated;
revoke all on function public.command_notify_founders(text, text, text, text, uuid) from public, anon, authenticated;

select cron.unschedule('command-notify') where exists (select 1 from cron.job where jobname = 'command-notify');
select cron.schedule('command-notify', '* * * * *', $job$
  select net.http_post(
    url     := 'https://rysbpwpvnqbngqncrfaa.supabase.co/functions/v1/command-notify',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                                 where name = 'edge_gateway_key' limit 1),
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                                    where name = 'cron_secret' limit 1)),
    body    := '{}'::jsonb)
$job$);
