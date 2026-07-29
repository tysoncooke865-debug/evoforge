-- 140 — 139 SAID IT ADDED A STATUS VOCABULARY. IT DID NOT.
--
-- WHAT HAPPENED
--
--   139 widened command_lab_workspaces.status to the vocabulary the Dev Lab
--   rebuild needs (draft, ready_for_review, approved, rejected, merged, failed)
--   and guarded the ALTER the way this repo guards everything:
--
--     if not exists (select 1 from pg_constraint
--                    where conname = 'command_lab_workspaces_status_check')
--     then alter table ... add constraint ... check (status in (...));
--
--   A constraint of that exact name ALREADY existed, from the original dev-lab
--   groundwork, allowing only ('provisioned','active','archived'). So the guard
--   was satisfied, the ALTER was skipped, and the migration applied cleanly and
--   reported success — while the thing it promised did not exist.
--
--   It surfaced on the first real call:
--
--     select command_sandbox_upsert('{"branch":"sandbox/probe-139",...}')
--     ERROR: 23514 new row violates check constraint
--            "command_lab_workspaces_status_check"
--
--   because command_sandbox_upsert defaults status to 'draft'. Every sandbox
--   the Dev Lab tried to create would have failed, and the failure would have
--   looked like a bug in the new function rather than in the migration that
--   silently did nothing.
--
-- THE LESSON, which is a NEW one and belongs beside the others
--
--   `if not exists (... where conname = X)` tests a NAME, not a MEANING. Two
--   constraints can share a name and permit different things, and the guard
--   cannot tell them apart — so it converts "this migration is idempotent" into
--   "this migration is a no-op against an older definition of itself".
--
--   For a CHECK whose whole purpose is its value list, guard on the DEFINITION
--   or do not guard at all: drop and recreate, which is idempotent by
--   construction and cannot silently inherit someone else's vocabulary.
--
-- IS THIS DESTRUCTIVE? No.
--
--   Dropping a CHECK and replacing it with a STRICTLY WIDER one cannot
--   invalidate a row: every value the old constraint permitted
--   ('provisioned','active','archived') appears in the new list, and all ten
--   existing rows are 'provisioned' (verified before applying). No data is
--   read, written, or deleted.

begin;

-- Unconditional, because that is the only way to be sure which definition is
-- in place afterwards.
alter table command_lab_workspaces
  drop constraint if exists command_lab_workspaces_status_check;

alter table command_lab_workspaces
  add constraint command_lab_workspaces_status_check
  check (status in ('provisioned','draft','active','ready_for_review',
                    'approved','rejected','merged','archived','failed'));


-- While here: command_sandbox_checkpoint accepted a payload with no
-- workspace_id and failed with 23502 from the table, which names a column
-- rather than the mistake. A checkpoint of nothing is never meaningful, so say
-- so where the caller can act on it.
create or replace function command_sandbox_checkpoint(p jsonb)
returns command_sandbox_checkpoints
language plpgsql security definer set search_path = public as $$
declare
  v_row command_sandbox_checkpoints;
  v_ws  uuid := nullif(p->>'workspace_id', '')::uuid;
begin
  if not is_founder() then
    raise exception 'founders only';
  end if;

  if v_ws is null then
    raise exception 'command_sandbox_checkpoint needs a workspace_id';
  end if;

  if not exists (select 1 from command_lab_workspaces w where w.id = v_ws) then
    raise exception 'no sandbox workspace %', v_ws;
  end if;

  insert into command_sandbox_checkpoints (
    workspace_id, label, commit_sha, description, build_status,
    test_results, migration_state, flag_state, screenshot_path, created_by
  )
  values (
    v_ws,
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


-- Same shape of hole in the refusal ledger: it accepted a refusal belonging to
-- no workspace, which is how a ledger fills with entries nobody can trace back
-- to an experiment. The proxy always knows which sandbox it is serving.
create or replace function command_sandbox_record_refusal(p jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_ws uuid := nullif(p->>'workspace_id', '')::uuid;
begin
  if v_ws is not null
     and not exists (select 1 from command_lab_workspaces w where w.id = v_ws) then
    raise exception 'no sandbox workspace %', v_ws;
  end if;

  insert into command_sandbox_refusals (workspace_id, method, path, rpc, reason)
  values (
    v_ws,
    coalesce(p->>'method','?'),
    coalesce(p->>'path','?'),
    nullif(p->>'rpc',''),
    coalesce(p->>'reason','')
  )
  returning id into v_id;
  return v_id;
end $$;

commit;
