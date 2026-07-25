-- EvoForge 100 — COMMAND: "done" has to mean something.
--
-- 099 gave criteria a home. This makes them load-bearing.
--
-- THE FAULT THIS CLOSES. command_open_work writes the same two or three
-- boilerplate strings onto every work order — "Regression pass on affected
-- screens", "Sentinel review before release" — regardless of what the work is,
-- and nothing has ever checked them. So a work order has been "successful" the
-- moment code merged, which is exactly the definition this system exists to
-- reject. The runner marks a task ready_for_release when git push returns 0.
--
-- From here:
--   · a work order cannot enter IMPLEMENTING with no checkable criterion
--   · it cannot reach RELEASED or VALIDATED with a criterion outstanding
--   · progress is the fraction of criteria MET, not a number a process invented
--     about its own control flow
--
-- ON NOT BREAKING WHAT IS RUNNING. Five work orders already exist, mid-flight,
-- with boilerplate criteria and no rows in command_criteria. Enforcing the gate
-- retroactively would wedge live work. So the gate applies on TRANSITION, the
-- backfill records honestly that those orders predate the rule, and progress
-- falls back to the old column when an order has no criteria rows — reported as
-- 'legacy' so the UI can say which kind of number it is showing.
--
-- FALSIFICATION CHECKLIST:
--   1. move a criteria-less order to IMPLEMENTING -> refused.
--   2. add one criterion -> the same move is allowed.
--   3. move to RELEASED with an unmet criterion -> refused.
--   4. mark it met (with verification) -> allowed.
--   5. progress on a 4-criteria order with 1 met -> 25, source 'criteria'.
--   6. progress on a legacy order -> the old value, source 'legacy'.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROGRESS THAT IS COUNTED, NOT CLAIMED
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_wo_progress(p_work_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_met int; v_legacy int;
begin
  select count(*), count(*) filter (where met) into v_total, v_met
    from command_criteria where work_order_id = p_work_order;

  if v_total > 0 then
    return jsonb_build_object(
      'source', 'criteria',
      'met', v_met, 'total', v_total,
      'percent', round((v_met::numeric / v_total) * 100)
    );
  end if;

  -- No criteria rows: this order predates the rule. Report the old number AND
  -- say where it came from, so a founder is never shown a milestone figure and
  -- a guess in the same shape.
  select round(avg(progress)) into v_legacy from command_tasks where work_order_id = p_work_order;
  return jsonb_build_object(
    'source', 'legacy',
    'met', 0, 'total', 0,
    'percent', coalesce(v_legacy, 0)
  );
end $$;
grant execute on function public.command_wo_progress(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE GATES
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_wo_stage_gate()
returns trigger language plpgsql set search_path = public as $$
declare v_total int; v_unmet int;
begin
  if new.stage is not distinct from old.stage then return new; end if;

  select count(*), count(*) filter (where not met) into v_total, v_unmet
    from command_criteria where work_order_id = new.id;

  -- Work orders opened before 099 carry no criteria rows and are exempt, or
  -- enforcing this would wedge live work mid-flight. New orders get criteria at
  -- creation, so the exemption closes itself as the old ones finish.
  if new.exec_state ? 'legacy_no_criteria' then return new; end if;

  if new.stage = 'IMPLEMENTING' and v_total = 0 then
    raise exception
      'command: % cannot enter IMPLEMENTING with no acceptance criteria — an order whose completion cannot be checked cannot be completed',
      new.ref;
  end if;

  if new.stage in ('RELEASED','VALIDATED') and v_unmet > 0 then
    raise exception
      'command: % has % acceptance criterion/criteria still unmet — code merging is not the same as the work being done',
      new.ref, v_unmet;
  end if;

  return new;
end $$;

drop trigger if exists command_wo_stage_gate_trg on public.command_work_orders;
create trigger command_wo_stage_gate_trg
  before update on public.command_work_orders
  for each row execute function public.command_wo_stage_gate();

-- Mark everything that already exists as predating the rule, honestly and
-- visibly, rather than silently exempting it forever.
update public.command_work_orders
   set exec_state = exec_state || jsonb_build_object(
         'legacy_no_criteria', true,
         'legacy_note', 'Opened before migration 100. Its acceptance criteria are the generated boilerplate and were never checkable.')
 where not exists (select 1 from command_criteria c where c.work_order_id = command_work_orders.id)
   and not (exec_state ? 'legacy_no_criteria');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CRITERIA, WRITTEN BY THE PLANNER — runner-only
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_set_criteria(p_work_order uuid, p_criteria jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_n int := 0;
begin
  if jsonb_typeof(p_criteria) <> 'array' or jsonb_array_length(p_criteria) = 0 then
    raise exception 'command: criteria must be a non-empty array';
  end if;

  for v_item in select * from jsonb_array_elements(p_criteria) loop
    v_n := v_n + 1;
    insert into command_criteria (work_order_id, ref, statement, verify_by, verify_ref)
    values (p_work_order,
            coalesce(v_item->>'ref', 'AC-' || v_n),
            v_item->>'statement',
            coalesce(v_item->>'verify_by', 'manual'),
            v_item->>'verify_ref')
    on conflict (work_order_id, ref) do update
      set statement = excluded.statement,
          verify_by = excluded.verify_by,
          verify_ref = excluded.verify_ref;
  end loop;

  -- Criteria now exist, so the legacy exemption no longer applies to this order.
  update command_work_orders
     set exec_state = exec_state - 'legacy_no_criteria' - 'legacy_note'
   where id = p_work_order;

  perform command_log('criteria_set', 'work_order', p_work_order,
                      (select ref from command_work_orders where id = p_work_order),
                      v_n || ' acceptance criteria recorded — the order can now be completed only by meeting them',
                      jsonb_build_object('count', v_n));
  return jsonb_build_object('ok', true, 'count', v_n);
end $$;
revoke all on function public.command_set_criteria(uuid, jsonb) from public, anon, authenticated;

create or replace function public.command_meet_criterion(
  p_criterion uuid, p_verification text, p_by text default 'agent'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from command_criteria where id = p_criterion;
  if c is null then raise exception 'command: no such criterion'; end if;
  if coalesce(trim(p_verification),'') = '' then
    -- The whole point. "It works" with nothing behind it is what boilerplate
    -- criteria were, and this is the door that let them be.
    raise exception 'command: a criterion cannot be met without stating how it was verified';
  end if;

  update command_criteria
     set met = true, met_at = now(), met_by = p_by, verification = p_verification
   where id = p_criterion;

  return jsonb_build_object('ok', true, 'ref', c.ref);
end $$;
revoke all on function public.command_meet_criterion(uuid, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RISK POLICY — what a given risk level demands, in one readable place
-- ─────────────────────────────────────────────────────────────────────────────
insert into command_settings (key, value) values
  ('risk_policy', $json${
    "LOW":    {"independent_review": false, "critical_flow_tests": false, "founder_release_approval": false,
               "auto_implement": true,  "note": "copy, isolated styling, tests, analytics instrumentation"},
    "MEDIUM": {"independent_review": true,  "critical_flow_tests": true,  "founder_release_approval": true,
               "auto_implement": true,  "note": "onboarding, workout logging, routing, progression UI, API behaviour"},
    "HIGH":   {"independent_review": true,  "critical_flow_tests": true,  "founder_release_approval": true,
               "auto_implement": false, "council_approval": true, "rollback_plan": true, "staged_release": true,
               "note": "auth, payments, privacy, physique photos, Evo Rating formula, migrations, destructive ops"}
  }$json$::jsonb)
on conflict (key) do nothing;

/** The paths that force HIGH regardless of what anyone typed. Mirrors the
 *  evoforge repo's own protected-path hook, so the two cannot drift into
 *  disagreeing about what is dangerous. */
create or replace function public.command_infer_risk(p_paths text[])
returns text language sql immutable as $$
  select case
    when exists (
      select 1 from unnest(coalesce(p_paths,'{}')) p
       where p like 'migrations/%' or p like '.github/%' or p like 'auth/%'
          or p like 'contracts/%' or p like 'supabase/functions/%'
          or p like '%xp%' or p like '%avatar_stats%' or p like '%payment%'
    ) then 'HIGH'
    when exists (
      select 1 from unnest(coalesce(p_paths,'{}')) p
       where p like 'client/src/app/%' or p like 'client/src/data/%'
    ) then 'MEDIUM'
    else 'LOW'
  end;
$$;
grant execute on function public.command_infer_risk(text[]) to authenticated;
