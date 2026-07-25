-- EvoForge 095 — COMMAND: runner presence, remote control, architect authority.
--
-- Three faults, all in one sentence from Tyson: "most things are blocked and it
-- regularly says no runner connected, the runner should always be running as
-- long as this computer is on, and I should be able to start it through the
-- command app".
--
-- FAULT 1 — THE FLOOR CALLED A WORKING RUNNER DEAD.
-- command_claim_dispatch was the only thing writing last_seen_at, and the runner
-- calls it once per poll. A claimed job blocks that loop for as long as the work
-- takes: Claude Code up to 20 minutes, the Sentinel gate up to an hour. Against
-- `last_seen_at > now() - 2 minutes` the floor therefore reported NO RUNNER
-- CONNECTED precisely while the runner was doing its most valuable work — the
-- same class of lie as 091's 0% progress bars, which is the fault this product
-- exists in order not to commit. Presence is now its own heartbeat on its own
-- clock, and it carries STATE, so idle and working are different facts.
--
-- FAULT 2 — THE STUDIO COULD NOT BE STARTED FROM THE STUDIO.
-- The app runs on Vercel; the runner runs on a founder's machine. Nothing in a
-- browser can reach it. Inverting it fixes that without opening a port: the
-- founder writes a DESIRED state here and the supervisor reads it on its beat.
-- Nothing inbound, no tunnel, no credential in the browser.
--
-- FAULT 3 — EVERY AGENT TOUCHING SCHEMA OR CI DIED AT THE COMMIT.
-- The evoforge repo's commit-msg hook refuses protected paths (migrations/,
-- .github/, contracts/, auth/, the XP contract) unless the message carries
-- [architect]. The runner never wrote one, so four tasks did all their work and
-- then failed at `git commit`, stranding the changes in the working tree.
--
-- The fix is NOT to always write [architect]. That marker exists so an AI cannot
-- silently change security, schema, identity or payments; forging it on every
-- commit disables the guard while leaving it looking armed. Authority is granted
-- the way deployment already is — declared on the proposal, visible on the card
-- BEFORE anyone votes, carried onto the work order. Approving IS the
-- authorisation, and nothing else can grant it.
--
-- WHY TRIGGERS AND NOT A REWRITE. command_create_proposal and command_open_work
-- were both last replaced by 092 (founder_steps / founder_unblocks /
-- founder_done_when). Re-issuing them here from an older copy would silently
-- revert that work — so the flag propagates by trigger and the two function
-- bodies are left exactly as 092 left them.
--
-- FALSIFICATION CHECKLIST:
--   1. heartbeat as a worker with NO dispatch row anywhere -> command_pulse
--      reports runner_online true and the state.                    [presence]
--   2. command_set_runner_desired('stopped') -> command_audit gains a row.[audit]
--   3. the same call as a non-founder -> refused.                        [RLS]
--   4. set architect_authorised on a founder_action proposal -> forced
--      back to false by the trigger.                                  [forced]
--   5. approve an authorised proposal -> its work order carries the flag.
--   6. promote an authorised backlog candidate -> the proposal carries it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. RUNNER PRESENCE — a heartbeat that does not depend on claiming work.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_runners
  add column if not exists state      text not null default 'idle',
  add column if not exists current    jsonb not null default '{}'::jsonb,
  add column if not exists pid        integer,
  add column if not exists started_at timestamptz,
  add column if not exists version    text,
  -- Two different processes check in here and they answer different questions.
  -- The RUNNER answers "are the agents working". The SUPERVISOR answers "is the
  -- studio machine even on" — it is what makes Start from the app possible, so
  -- it must be visible separately. Counting a live supervisor as a live runner
  -- would recreate the exact fault this migration exists to fix, one level up.
  add column if not exists kind       text not null default 'runner';

do $$ begin
  alter table public.command_runners add constraint command_runners_kind_ck
    check (kind in ('runner','supervisor'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.command_runners add constraint command_runners_state_ck
    check (state in ('starting','idle','working','stopping','stopped','error'));
exception when duplicate_object then null; end $$;

comment on column public.command_runners.state is
  'What the runner is doing RIGHT NOW. Written by its own heartbeat timer, never '
  'by claiming work — a runner busy inside a 20-minute job still reports every 20s.';
comment on column public.command_runners.current is
  'The job in hand: {task, ref, kind, since}. Empty object when idle.';

-- Runner-only: it holds the service key, so this is never reachable from a
-- browser. The revoke below is the guard, not a convention.
create or replace function public.command_runner_heartbeat(
  p_worker  text,
  p_state   text default 'idle',
  p_current jsonb default '{}'::jsonb,
  p_detail  jsonb default null,
  p_pid     integer default null,
  p_version text default null,
  p_kind    text default 'runner'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_desired text; v_halted boolean;
begin
  insert into command_runners (worker, last_seen_at, state, current, pid, version,
                               started_at, detail, kind)
  values (p_worker, now(), coalesce(p_state,'idle'), coalesce(p_current,'{}'::jsonb),
          p_pid, p_version, now(), coalesce(p_detail,'{}'::jsonb), coalesce(p_kind,'runner'))
  on conflict (worker) do update set
    last_seen_at = now(),
    kind    = coalesce(excluded.kind, command_runners.kind),
    state   = coalesce(excluded.state, command_runners.state),
    current = coalesce(excluded.current, '{}'::jsonb),
    pid     = coalesce(excluded.pid, command_runners.pid),
    version = coalesce(excluded.version, command_runners.version),
    -- started_at only moves when the process is genuinely new, so "up since"
    -- stays true across every intermediate beat.
    started_at = case when command_runners.state in ('stopped','error')
                        or p_state = 'starting'
                      then now() else command_runners.started_at end,
    -- A null detail means "nothing new to say", not "forget what you knew" —
    -- the startup preflight (github/claude checks) must survive every beat.
    detail  = coalesce(p_detail, command_runners.detail);

  select (value)#>>'{}' into v_desired from command_settings where key = 'runner_desired';
  select (value)::text::boolean into v_halted from command_settings where key = 'halted';

  -- The reply IS the control channel: the supervisor learns on every beat
  -- whether the founders still want it running.
  return jsonb_build_object(
    'ok', true,
    'desired', coalesce(v_desired, 'running'),
    'halted', coalesce(v_halted, false)
  );
end $$;

revoke all on function public.command_runner_heartbeat(text, text, jsonb, jsonb, integer, text, text)
  from public, anon, authenticated;
-- The 6-arg signature from this migration's first application is superseded;
-- drop it so there is exactly one heartbeat entry point to reason about.
drop function if exists public.command_runner_heartbeat(text, text, jsonb, jsonb, integer, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REMOTE CONTROL — the founder states intent; the machine obeys on its beat.
-- ─────────────────────────────────────────────────────────────────────────────
insert into command_settings (key, value)
values ('runner_desired', to_jsonb('running'::text))
on conflict (key) do nothing;

create or replace function public.command_set_runner_desired(p_desired text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_desired not in ('running','stopped') then
    raise exception 'command: desired must be running or stopped';
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_settings set value = to_jsonb(p_desired), updated_at = now()
   where key = 'runner_desired';

  perform command_log('runner_desired_set', 'settings', null, 'runner_desired',
                      coalesce(v_name,'a founder') || ' asked the studio runner to ' ||
                      case when p_desired = 'running' then 'start' else 'stop' end,
                      jsonb_build_object('desired', p_desired));

  return jsonb_build_object('ok', true, 'desired', p_desired);
end $$;
grant execute on function public.command_set_runner_desired(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ARCHITECT AUTHORITY — granted by the vote, propagated by trigger.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_proposals
  add column if not exists architect_authorised boolean not null default false;
alter table public.command_work_orders
  add column if not exists architect_authorised boolean not null default false;
alter table public.command_backlog
  add column if not exists architect_authorised boolean not null default false;

comment on column public.command_proposals.architect_authorised is
  'Approving this proposal also authorises commits touching the evoforge repo''s '
  'protected paths (migrations/, .github/, contracts/, auth/, the XP contract). '
  'Shown on the card BEFORE the vote. Only engineering work can hold it.';

-- Only engineering can carry it: there is no commit to mark on a decision, and a
-- founder action is done by hand. Enforced in a trigger so no UI or RPC path can
-- set it on the wrong kind — 090's forced-gated lesson, where a control any
-- caller could lift was worth nothing.
create or replace function public.command_force_architect_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.execution is distinct from 'engineering' then
    new.architect_authorised := false;
  end if;
  return new;
end $$;

drop trigger if exists command_proposals_architect_scope on public.command_proposals;
create trigger command_proposals_architect_scope
  before insert or update on public.command_proposals
  for each row execute function public.command_force_architect_scope();

drop trigger if exists command_backlog_architect_scope on public.command_backlog;
create trigger command_backlog_architect_scope
  before insert or update on public.command_backlog
  for each row execute function public.command_force_architect_scope();

-- A candidate's authority must survive promotion. The Exec sets backlog.proposal_id
-- when it raises one; that is the moment the two rows are linked, so that is where
-- the flag is copied. Done here rather than inside command_create_proposal because
-- 092 owns that body and re-issuing it from an older copy would revert its briefs.
create or replace function public.command_carry_architect_to_proposal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.proposal_id is not null
     and new.proposal_id is distinct from old.proposal_id
     and new.architect_authorised then
    update command_proposals set architect_authorised = true
     where id = new.proposal_id and execution = 'engineering';
  end if;
  return new;
end $$;

drop trigger if exists command_backlog_carry_architect on public.command_backlog;
create trigger command_backlog_carry_architect
  after update on public.command_backlog
  for each row execute function public.command_carry_architect_to_proposal();

-- And onto the work order, which is what the runner actually reads. Same reason
-- for the trigger: command_open_work is 092's.
create or replace function public.command_inherit_architect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.proposal_id is not null then
    select p.architect_authorised into new.architect_authorised
      from command_proposals p where p.id = new.proposal_id;
    new.architect_authorised := coalesce(new.architect_authorised, false);
  end if;
  return new;
end $$;

drop trigger if exists command_work_orders_inherit_architect on public.command_work_orders;
create trigger command_work_orders_inherit_architect
  before insert on public.command_work_orders
  for each row execute function public.command_inherit_architect();

-- The founders' own control: grant or withdraw the authority on an OPEN proposal,
-- before the vote closes. After that the vote has already been cast against a
-- stated scope, and changing it would rewrite what people agreed to.
create or replace function public.command_set_proposal_architect(p_proposal uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; pr record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if pr.status <> 'open' then
    raise exception 'command: % is % — architect authority is part of what the council voted on',
      pr.ref, pr.status;
  end if;
  if p_on and pr.execution <> 'engineering' then
    raise exception 'command: % is %, and only engineering work commits anything',
      pr.ref, pr.execution;
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_proposals set architect_authorised = p_on where id = p_proposal;

  perform command_log('proposal_architect_set', 'proposal', p_proposal, pr.ref,
                      coalesce(v_name,'a founder') ||
                      case when p_on then ' granted ' else ' withdrew ' end ||
                      'architect authority on ' || pr.ref ||
                      ' — protected paths (migrations, CI, contracts, auth)',
                      jsonb_build_object('architect_authorised', p_on));
  return jsonb_build_object('ok', true, 'architect_authorised', p_on);
end $$;
grant execute on function public.command_set_proposal_architect(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE PULSE TELLS THE TRUTH ABOUT THE RUNNER
--    (091's body verbatim; only the runner fields and backlog flag are added —
--     092/093 did not touch this function.)
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
    'runners', coalesce((select jsonb_agg(to_jsonb(r) order by r.last_seen_at desc)
                           from command_runners r), '[]'::jsonb),
    -- Now a real fact rather than "has it claimed anything lately". Two minutes
    -- against a 20-second beat allows six missed beats before the floor calls it
    -- down, and a runner that stopped ON PURPOSE reports stopped, not offline.
    'runner_online', exists (
      select 1 from command_runners
       where kind = 'runner'
         and last_seen_at > now() - interval '2 minutes'
         and state <> 'stopped'),
    -- The supervisor is the answer to "will pressing Start do anything". With it
    -- up, Start works; without it, the studio machine is off or the task is not
    -- installed, and the app must say so instead of offering a dead button.
    'supervisor_online', exists (
      select 1 from command_runners
       where kind = 'supervisor' and last_seen_at > now() - interval '2 minutes'),
    'runner_desired', coalesce((select (value)#>>'{}' from command_settings where key = 'runner_desired'), 'running'),
    'runner_state', (select r.state from command_runners r where r.kind = 'runner' order by r.last_seen_at desc limit 1),
    'runner_current', coalesce((select r.current from command_runners r where r.kind = 'runner' order by r.last_seen_at desc limit 1), '{}'::jsonb),
    'dispatch_pending', (select count(*) from command_dispatch where status = 'pending'),
    'dispatch_running', (select count(*) from command_dispatch where status in ('claimed','running')),
    'awaiting_founder', (select count(*) from command_tasks where status = 'awaiting_founder'),
    'backlog', coalesce((select jsonb_agg(x order by (x->>'priority')::int desc) from (
        select jsonb_build_object('topic_key', b.topic_key, 'title', b.title, 'status', b.status,
                                  'category', b.category, 'departments', b.departments,
                                  'rationale', b.rationale, 'source', b.source, 'execution', b.execution,
                                  'architect_authorised', b.architect_authorised,
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
