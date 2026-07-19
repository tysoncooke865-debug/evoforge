-- EvoForge 065 — extra workouts per scheduled day.
--
-- workout_schedule.plan values WIDEN from a single string to
-- string | string[]. Array = [primary, ...extras]: slot 0 is the day's
-- primary choice and may be 'Rest'; extras are never 'Rest' and are
-- built-in day names or routine names (the routines table). A day with
-- no extras keeps serializing as a plain string — byte-identical to
-- every existing row, so no backfill, no table DDL, no RLS change (the
-- policies are value-agnostic and arrays pass through jsonb unchanged).
--
-- SEMANTICS (the contract, mirrored in
-- client/src/domain/scheduled-streak.ts — both carry this comment and
-- must move in lockstep, the 012 rule):
--   * a date is SCHEDULED iff it has at least one non-Rest entry — so
--     'Rest' + an extra IS a training day (the streak gets stricter for
--     that athlete, and the schedule page says so);
--   * TRAINED stays day-granular: any counted set on the date preserves
--     the streak, whichever of the day's workouts it belonged to.
--     Per-workout honesty lives in the Train bars, not the streak.
--
-- This file redefines scheduled_streak() ONLY. Base body is 061's
-- deployed version (w.weight >= 0 — the bodyweight-sets fix; replacing
-- from 012's original would silently revert it). The single change is
-- the `planned` extraction: an array value yields its first non-Rest
-- entry (or null when all-Rest), a scalar value reads as before.
--
-- FALSIFICATION (management API, smoke accounts, HANDOVER §5):
--   1. capture select * from scheduled_streak(<ALPHA>, current_date)
--      BEFORE apply; identical AFTER (old scalar rows untouched).
--   2. seed a backdated array-shape row for ALPHA via management SQL
--      (runs as postgres — the only way past the backdating RLS):
--      extra-only day + counted set extends the run; extra-only day
--      with no set breaks it; primary+extra day counts ONCE.
--   3. select has_function_privilege('authenticated',
--      'public.scheduled_streak(uuid,date)', 'execute') → false.
--   4. delete every seeded row; re-run step 1's query → ALPHA restored.

create or replace function public.scheduled_streak(p_user uuid, p_asof date)
returns table (length int, run_start date)
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := p_asof;
  n int := 0;
  first_completed date := null;
  planned text;
  trained boolean;
  steps int := 0;
begin
  loop
    exit when steps >= 1000;
    steps := steps + 1;

    select case
      when jsonb_typeof(ws.plan -> extract(dow from d)::int::text) = 'array' then (
        select t.e
        from jsonb_array_elements_text(ws.plan -> extract(dow from d)::int::text) as t(e)
        where t.e <> 'Rest'
        limit 1)
      else ws.plan ->> extract(dow from d)::int::text
    end into planned
    from public.workout_schedule ws
    where ws.user_id = p_user and ws.effective_from <= d
    order by ws.effective_from desc
    limit 1;

    if planned is null or planned = 'Rest' then
      -- rest / unscheduled: bridges, never breaks. But if the athlete has
      -- NO schedule at all ever, stop immediately (streak undefined).
      if not exists (select 1 from public.workout_schedule ws where ws.user_id = p_user and ws.effective_from <= d) then
        exit;
      end if;
      d := d - 1;
      continue;
    end if;

    select exists (
      select 1 from public.workout_log w
      where w.user_id = p_user and w.date = d and w.weight >= 0 and w.reps > 0
    ) into trained;

    if trained then
      n := n + 1;
      first_completed := d;
      d := d - 1;
    elsif d = p_asof then
      -- today still pending: skip, don't break
      d := d - 1;
    else
      exit;
    end if;
  end loop;

  return query select n, first_completed;
end;
$$;

-- CREATE OR REPLACE preserves ACLs, but assert the 012 revocation anyway:
-- this function exists only for the coin guard, never for clients.
-- AND close the gap 012 left open: revoking from authenticated/anon never
-- touched the default PUBLIC execute grant (proacl `=X/postgres`), through
-- which both roles could still execute. Falsified live 2026-07-20:
-- has_function_privilege('authenticated', ...) was TRUE until the PUBLIC
-- revoke below, FALSE after. postgres (owner) and service_role keep
-- execute — the 013 coin guard runs as the definer, unaffected.
revoke all on function public.scheduled_streak(uuid, date) from public, authenticated, anon;
