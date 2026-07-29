-- 139 — SANDBOXES THAT RUN THE REAL APP, AND TWO ACCOUNTS THAT WERE COUNTING AS ATHLETES
--
-- NOT APPLIED. Written by the Dev Lab rebuild (2026-07-29) and deliberately
-- left unapplied: the Supabase project is shared production and the session
-- that wrote this was not authorised to change it. Apply commands are in
-- docs/DEVLAB_REBUILD.md §16.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1. THE DEFECT THIS MIGRATION FIXES, MEASURED BEFORE IT WAS WRITTEN
--
--   select count(distinct user_id) from analytics_events_real;   -->  20
--
--   Twenty athletes. Two of them are test harnesses:
--
--     smoke-test-claude@evoforge.internal      1176 events  (16 Jul - 24 Jul)
--     smoke-test-claude-2@evoforge.internal      37 events  (16 Jul - 23 Jul)
--
--   Migration 126 created command_synthetic_accounts precisely because a
--   tooling account walking the activation funnel moves activation_rate, which
--   is REL-001's release gate, and a rate over athletes moves with BOTH its
--   numerator and its denominator. It registered the Dev Lab account and
--   stopped there. The two smoke accounts — the ones HANDOVER.md tells every
--   session to sign in as when verifying a change in a real browser — were
--   never registered.
--
--   So 2 of 20 athletes in the deciding view are robots, and they are the two
--   most active "athletes" in it. Every per-athlete rate computed since 16 July
--   has been wrong, and nothing reported an error, because a wrong denominator
--   looks exactly like a right one.
--
--   This is the same class of miss as 126 itself: the fix was applied to the
--   instance that prompted it rather than to the category.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2. SANDBOXES
--
--   The Dev Lab used to reconstruct EvoForge screens, then photograph them.
--   It now RUNS the app: a git worktree of the product repo per experiment,
--   with its own branch, its own Expo dev server on its own port, and a
--   backend that refuses to write production.
--
--   command_lab_workspaces already existed as a thin placeholder (name, branch,
--   preview_url, status) from the dev-lab groundwork. It is EXTENDED here, not
--   replaced — ADD COLUMN IF NOT EXISTS only. Nothing is dropped anywhere in
--   this file.

begin;

-- ── 1. Register the two smoke accounts ──────────────────────────────────────
-- Idempotent, and keyed off auth.users so it cannot invent a uuid. If an
-- account has been deleted the insert simply matches nothing.
insert into command_synthetic_accounts (user_id, email, reason, registered_by)
select u.id,
       u.email,
       'Playwright smoke/verification account (HANDOVER.md §5) — a harness, not an athlete',
       '26ef77d9-4d6e-4967-898f-a614cc80255a'
from auth.users u
where u.email in (
        'smoke-test-claude@evoforge.internal',
        'smoke-test-claude-2@evoforge.internal'
      )
on conflict (user_id) do nothing;


-- ── 2. The experiment registry ──────────────────────────────────────────────
alter table command_lab_workspaces
  add column if not exists objective        text not null default '',
  add column if not exists created_by       uuid,
  add column if not exists base_commit      text not null default '',
  add column if not exists current_commit   text not null default '',
  add column if not exists worktree_path    text not null default '',
  add column if not exists port             integer,
  add column if not exists proxy_port       integer,
  add column if not exists kind             text not null default 'ui',
  add column if not exists approval         text not null default 'none',
  add column if not exists success_criteria jsonb not null default '[]'::jsonb,
  add column if not exists feature_flags    jsonb not null default '{}'::jsonb,
  add column if not exists test_state       text not null default 'default',
  add column if not exists desired          text not null default 'stopped',
  add column if not exists last_seen_at     timestamptz,
  add column if not exists archived_at      timestamptz;

-- The status vocabulary the brief asks for. The column already carries a
-- default of 'provisioned' from the original table, so that value stays in the
-- list — dropping it would orphan any existing row, and this migration is
-- additive by contract.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'command_lab_workspaces'::regclass
      and conname = 'command_lab_workspaces_status_check'
  ) then
    alter table command_lab_workspaces
      add constraint command_lab_workspaces_status_check
      check (status in ('provisioned','draft','active','ready_for_review',
                        'approved','rejected','merged','archived','failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'command_lab_workspaces'::regclass
      and conname = 'command_lab_workspaces_desired_check'
  ) then
    alter table command_lab_workspaces
      add constraint command_lab_workspaces_desired_check
      check (desired in ('stopped','serving'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'command_lab_workspaces'::regclass
      and conname = 'command_lab_workspaces_kind_check'
  ) then
    alter table command_lab_workspaces
      add constraint command_lab_workspaces_kind_check
      check (kind in ('ui','functionality','data','prompt','agent','architecture'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'command_lab_workspaces'::regclass
      and conname = 'command_lab_workspaces_approval_check'
  ) then
    alter table command_lab_workspaces
      add constraint command_lab_workspaces_approval_check
      check (approval in ('none','approved','approved_with_revisions',
                          'needs_more_work','rejected'));
  end if;
end $$;

-- Two experiments must never share a branch: the whole isolation story is
-- "one branch, one worktree, one port", and git itself refuses to check a
-- branch out twice. Better to refuse at insert than to fail at worktree add.
create unique index if not exists command_lab_workspaces_branch_key
  on command_lab_workspaces (branch);


-- ── 3. Checkpoints ──────────────────────────────────────────────────────────
create table if not exists command_sandbox_checkpoints (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references command_lab_workspaces(id) on delete cascade,
  label         text not null,
  commit_sha    text not null default '',
  description   text not null default '',
  build_status  text not null default 'unknown',
  test_results  jsonb not null default '{}'::jsonb,
  migration_state jsonb not null default '{}'::jsonb,
  flag_state    jsonb not null default '{}'::jsonb,
  screenshot_path text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint command_sandbox_checkpoints_build_check
    check (build_status in ('unknown','ok','failed'))
);

create index if not exists command_sandbox_checkpoints_ws
  on command_sandbox_checkpoints (workspace_id, created_at desc);


-- ── 4. The refusal ledger ───────────────────────────────────────────────────
-- Every write the sandbox blocked. This is a genuinely new artefact: "what did
-- this screen actually try to write" was previously unanswerable, and it is the
-- thing that makes a refused edge function legible instead of mysterious.
create table if not exists command_sandbox_refusals (
  id           bigserial primary key,
  workspace_id uuid references command_lab_workspaces(id) on delete cascade,
  at           timestamptz not null default now(),
  method       text not null,
  path         text not null,
  rpc          text,
  reason       text not null
);

create index if not exists command_sandbox_refusals_ws
  on command_sandbox_refusals (workspace_id, at desc);


-- ── 5. RLS ──────────────────────────────────────────────────────────────────
-- Founder-only, matching every other command_* table. is_founder() takes no
-- arguments (verified against pg_proc before this was written).
alter table command_sandbox_checkpoints enable row level security;
alter table command_sandbox_refusals    enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'command_sandbox_checkpoints'
                   and policyname = 'founders read checkpoints') then
    create policy "founders read checkpoints" on command_sandbox_checkpoints
      for select using (is_founder());
  end if;
  if not exists (select 1 from pg_policies
                 where tablename = 'command_sandbox_refusals'
                   and policyname = 'founders read refusals') then
    create policy "founders read refusals" on command_sandbox_refusals
      for select using (is_founder());
  end if;
end $$;


-- ── 6. Functions ────────────────────────────────────────────────────────────
-- All NEW names. Nothing here redefines an existing function, so none of them
-- can create a second overload of one.

create or replace function command_sandbox_upsert(p jsonb)
returns command_lab_workspaces
language plpgsql security definer set search_path = public as $$
declare v_row command_lab_workspaces;
begin
  if not is_founder() then
    raise exception 'founders only';
  end if;

  insert into command_lab_workspaces (
    name, branch, objective, kind, created_by, base_commit,
    worktree_path, port, proxy_port, status, success_criteria, notes
  )
  values (
    coalesce(p->>'name', 'untitled experiment'),
    coalesce(p->>'branch', 'sandbox/' || gen_random_uuid()::text),
    coalesce(p->>'objective', ''),
    coalesce(p->>'kind', 'ui'),
    auth.uid(),
    coalesce(p->>'base_commit', ''),
    coalesce(p->>'worktree_path', ''),
    nullif(p->>'port', '')::int,
    nullif(p->>'proxy_port', '')::int,
    coalesce(p->>'status', 'draft'),
    coalesce(p->'success_criteria', '[]'::jsonb),
    coalesce(p->>'notes', '')
  )
  on conflict (branch) do update set
    name             = excluded.name,
    objective        = excluded.objective,
    kind             = excluded.kind,
    worktree_path    = excluded.worktree_path,
    port             = coalesce(excluded.port, command_lab_workspaces.port),
    proxy_port       = coalesce(excluded.proxy_port, command_lab_workspaces.proxy_port),
    success_criteria = excluded.success_criteria
  returning * into v_row;

  insert into command_audit (actor_kind, actor_id, actor_label, action,
                             entity_kind, entity_id, entity_ref, summary, detail)
  values ('founder', auth.uid(), 'founder', 'sandbox_upsert',
          'sandbox', v_row.id, v_row.branch,
          'Sandbox experiment ' || v_row.name, to_jsonb(v_row));

  return v_row;
end $$;


-- Desired state, read by the supervisor on its own beat. The founder writes
-- what they want; the machine reconciles. Same inversion as lab_desired,
-- because Vercel can execute nothing and this machine has nothing inbound.
create or replace function command_sandbox_set_desired(p_branch text, p_desired text)
returns command_lab_workspaces
language plpgsql security definer set search_path = public as $$
declare v_row command_lab_workspaces;
begin
  if not is_founder() then
    raise exception 'founders only';
  end if;
  if p_desired not in ('stopped', 'serving') then
    raise exception 'desired must be stopped or serving, got %', p_desired;
  end if;

  update command_lab_workspaces
     set desired = p_desired,
         status  = case when p_desired = 'serving' and status = 'draft'
                        then 'active' else status end
   where branch = p_branch
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no sandbox on branch %', p_branch;
  end if;

  insert into command_audit (actor_kind, actor_id, actor_label, action,
                             entity_kind, entity_id, entity_ref, summary, detail)
  values ('founder', auth.uid(), 'founder', 'sandbox_desired',
          'sandbox', v_row.id, v_row.branch,
          'Sandbox ' || v_row.name || ' -> ' || p_desired,
          jsonb_build_object('desired', p_desired));

  return v_row;
end $$;


create or replace function command_sandbox_record_refusal(p jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into command_sandbox_refusals (workspace_id, method, path, rpc, reason)
  values (
    nullif(p->>'workspace_id','')::uuid,
    coalesce(p->>'method','?'),
    coalesce(p->>'path','?'),
    nullif(p->>'rpc',''),
    coalesce(p->>'reason','')
  )
  returning id into v_id;
  return v_id;
end $$;


create or replace function command_sandbox_checkpoint(p jsonb)
returns command_sandbox_checkpoints
language plpgsql security definer set search_path = public as $$
declare v_row command_sandbox_checkpoints;
begin
  if not is_founder() then
    raise exception 'founders only';
  end if;

  insert into command_sandbox_checkpoints (
    workspace_id, label, commit_sha, description, build_status,
    test_results, migration_state, flag_state, screenshot_path, created_by
  )
  values (
    (p->>'workspace_id')::uuid,
    coalesce(p->>'label','checkpoint'),
    coalesce(p->>'commit_sha',''),
    coalesce(p->>'description',''),
    coalesce(p->>'build_status','unknown'),
    coalesce(p->'test_results','{}'::jsonb),
    coalesce(p->'migration_state','{}'::jsonb),
    coalesce(p->'flag_state','{}'::jsonb),
    nullif(p->>'screenshot_path',''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end $$;


-- What the Dev Lab renders. One row per experiment, with the two counts a
-- founder actually needs at a glance: how many writes were refused, and how
-- many checkpoints exist to fall back to.
create or replace function command_sandbox_board()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
  from (
    select w.id, w.name, w.branch, w.objective, w.kind, w.status, w.approval,
           w.desired, w.port, w.proxy_port, w.worktree_path, w.base_commit,
           w.current_commit, w.preview_url, w.test_state, w.feature_flags,
           w.success_criteria, w.notes, w.created_at, w.last_seen_at, w.archived_at,
           (select count(*) from command_sandbox_refusals r where r.workspace_id = w.id) as refusals,
           (select count(*) from command_sandbox_checkpoints c where c.workspace_id = w.id) as checkpoints
    from command_lab_workspaces w
    where w.archived_at is null
  ) x;
$$;

commit;
