-- EvoForge 168 — HOTFIX: the call out list was throwing.
--
-- 163 dropped `hit_probability`, `odds_model_version` and `odds_evidence` from
-- `workout_callouts`, and updated `callout_create` in the same migration. It missed
-- two other functions that still named those columns:
--
--   my_workout_callouts        SELECTs them -> every read of the list threw, so an
--                              incoming pledge was invisible to the person it was
--                              sent to. Reported from production.
--   workout_callout_lock_guard COPIES them old->new on update -> accepting or
--                              settling a call out would have thrown too.
--
-- WHY THE FALSIFICATION DID NOT CATCH IT. It exercised the CREATE path thoroughly —
-- rest days, wrong workouts, above-program targets, every cap — and never once
-- listed a call out or accepted one. A guard that only tests the path you changed
-- misses the paths that merely READ what you changed. 163's own check looked for
-- odds-shaped COLUMNS and found none, which was true and not the question.
--
-- Both bodies below are taken from the LIVE functions with only the dropped columns
-- removed; nothing else is touched.

begin;

CREATE OR REPLACE FUNCTION public.my_workout_callouts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'my_workout_callouts: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        c.id, c.athlete_id, c.opponent_id, c.initiated_by,
        c.workout_date, c.workout_name, c.exercise, c.set_no,
        c.target_reps, c.target_load_mode, c.target_weight_kg, c.target_label,
        c.stake, c.stake * 2 as pot,
          c.status, c.result, c.actual_reps, c.actual_weight_kg, c.actual_load_mode,
        c.dispute_reason,
        c.athlete_calloff_at, c.opponent_calloff_at,
        c.created_at, c.expires_at, c.accepted_at, c.set_logged_at,
        c.verified_at, c.settled_at,
        (c.athlete_id = me) as i_am_athlete,
        coalesce(ppa.display_name, 'Athlete') as athlete_name,
        coalesce(ppo.display_name, 'Athlete') as opponent_name
      from public.workout_callouts c
      left join public.public_profile ppa on ppa.user_id = c.athlete_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where (c.athlete_id = me or c.opponent_id = me)
        -- Enough history for the hub to show what just happened, and not so much
        -- that a year of settled calls rides down the wire on every poll.
        and (c.status in ('offered', 'accepted', 'awaiting_verification', 'disputed')
             or c.created_at > now() - interval '2 days')
    ) x
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.workout_callout_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.accepted_at is not null then
    new.athlete_id         := old.athlete_id;
    new.opponent_id        := old.opponent_id;
    new.workout_date       := old.workout_date;
    new.workout_name       := old.workout_name;
    new.exercise           := old.exercise;
    new.set_no             := old.set_no;
    new.target_reps        := old.target_reps;
    new.target_load_mode   := old.target_load_mode;
    new.target_weight_kg   := old.target_weight_kg;
    new.target_label       := old.target_label;
    new.stake              := old.stake;
    new.accepted_at        := old.accepted_at;
  end if;
  -- A paid result is final. Re-settlement must be a no-op, not an update â€” and
  -- an edit to the underlying set hours later must not rewrite what was paid.
  if old.status = 'settled' then
    new.status     := old.status;
    new.result     := old.result;
    new.settled_at := old.settled_at;
    new.actual_reps      := old.actual_reps;
    new.actual_weight_kg := old.actual_weight_kg;
    new.actual_load_mode := old.actual_load_mode;
  end if;
  return new;
end;
$function$;

-- ─────────────────────── PROVEN: nothing live names a dropped column

do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (pg_get_functiondef(p.oid) like '%hit_probability%'
      or pg_get_functiondef(p.oid) like '%odds_model_version%'
      or pg_get_functiondef(p.oid) like '%odds_evidence%');
  if bad is not null then
    raise exception 'these live functions still name a dropped column: %', bad;
  end if;

  -- And the list actually runs. A definer function with a bad column reference
  -- only fails when CALLED, which is precisely how this reached production.
  perform set_config('request.jwt.claims',
    '{"sub":"30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1","role":"authenticated"}', true);
  perform public.my_workout_callouts();
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;
