-- EvoForge 006 — stop XP being minted from nothing
--
-- ###########################################################################
-- #  DO NOT RUN THIS AGAINST PRODUCTION FIRST. See STEP 3.                   #
-- #  Run it on a THROWAWAY project, confirm the trigger sees auth.uid(),     #
-- #  THEN production. The whole file rests on an assumption that must be     #
-- #  proven on a live PostgREST before it touches real users' data.         #
-- ###########################################################################
--
-- THE HOLE
--   migrations/002 gives xp_events an insert policy that checks only OWNERSHIP:
--       for insert to authenticated with check (user_id = auth.uid())
--   So any signed-in user can POST straight to /rest/v1/xp_events with their own
--   JWT and body {"kind":"adjustment","amount":999999}. Postgres fills user_id from
--   auth.uid(), the with-check passes (their own id), amount<>0 passes -- and they
--   have minted arbitrary XP. The append-only design stops TAMPERING; it does
--   nothing against a POISONED INSERT.
--
-- WHAT THIS FIXES, AND WHAT IT DOES NOT
--   A before-insert trigger rejects server-only kinds and RECOMPUTES the amount
--   from a real, owned source row -- the client's amount is ignored entirely. After
--   this, a raw insert can only ever grant what an actual workout_log/cardio_log row
--   of yours is worth.
--
--   It does NOT make XP uncheatable. workout_log and cardio_log are user-writable by
--   design (a user inserts their own sets with any date/weight/reps). A determined
--   user can fabricate plausible log rows and legitimately earn matching XP. The
--   leaderboard is TRUST-ON-FIRST-USE against a known, small user base until workout
--   WRITES are themselves validated -- a separate, later task. This raises the bar
--   from "one POST mints a million XP" to "you must fake a believable history."


-- ===========================================================================
-- STEP 1 — the trigger function
-- ===========================================================================
create or replace function public.xp_events_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ok   boolean;
  mins numeric;
begin
  -- service_role (server-side, bypasses RLS) may write anything: backfills,
  -- corrections, 'adjustment'. A normal authenticated user may not.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.kind = 'set' then
    -- Must point at a real set of the caller's, and the amount is NOT the client's.
    select exists (
      select 1 from public.workout_log w
      where w.id = new.source_id
        and w.user_id = auth.uid()
        and w.weight > 0 and w.reps > 0
    ) into ok;
    if not ok then
      raise exception 'xp_events: no matching workout_log row for this set (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    new.amount := 10;               -- domain/xp.py XP_PER_SET
    new.source_table := 'workout_log';
    return new;

  elsif new.kind = 'cardio' then
    -- Read the caller's own cardio row ONCE, into a numeric. `found` is set by the
    -- select, so a missing/foreign row is caught without a second query.
    select c.minutes into mins
    from public.cardio_log c
    where c.id = new.source_id and c.user_id = auth.uid();
    if not found then
      raise exception 'xp_events: no matching cardio_log row (%).', new.source_id
        using errcode = 'check_violation';
    end if;
    -- Recompute from the row's minutes: floor(minutes*2), mirroring 002 STEP 3.
    new.amount := floor(coalesce(mins, 0) * 2)::int;
    new.source_table := 'cardio_log';
    if new.amount <= 0 then
      raise exception 'xp_events: cardio session is worth no XP.'
        using errcode = 'check_violation';
    end if;
    return new;

  else
    -- 'adjustment', 'achievement', or anything else is server-only.
    raise exception 'xp_events: kind % may only be written by the server.', new.kind
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;


-- ===========================================================================
-- STEP 2 — attach it
-- ===========================================================================
drop trigger if exists xp_events_guard_biu on public.xp_events;
create trigger xp_events_guard_biu
  before insert on public.xp_events
  for each row execute function public.xp_events_guard();


-- ===========================================================================
-- STEP 3 — THE STAGING GATE. Run these on a THROWAWAY project first.
--
-- This trigger reads auth.uid() and auth.role(). Those are GUC lookups populated
-- from the JWT, NOT RLS -- so they SHOULD be visible inside a security-definer
-- trigger under a normal authenticated request. But that is not verified on a live
-- PostgREST here. Prove it before production:
--
--   As a normal authenticated user (their JWT, via the REST API or the app):
--     (a) POST xp_events {"kind":"adjustment","amount":999999}
--         -> REJECTED ("kind adjustment may only be written by the server").
--     (b) POST xp_events {"kind":"set","amount":999999,"source_id":<a real set of
--         theirs>}  -> ACCEPTED, and the stored row has amount = 10, not 999999.
--     (c) POST xp_events {"kind":"set","source_id":<some other user's set id>}
--         -> REJECTED (no matching owned workout_log row).
--     (d) Log a set through the APP -> still works, amount 10, no error surfaced.
--         (record_xp_event already swallows a failed grant without failing the save.)
--
--   If (a)-(d) behave -> ship 006 to production.
--   If the trigger CANNOT see auth.uid()/auth.role() (everything rejects, or the
--   role check never matches) -> DO NOT ship this. Fall back: revoke the insert
--   policy from authenticated and mint XP only through a security-definer
--   grant_set_xp(source_id) RPC. That is a code change to record_set_event(); ask
--   Claude. It needs no JWT-context assumption.
-- ===========================================================================
