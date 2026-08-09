-- EvoForge 174 — PLEDGING ABOVE YOUR BEST, ON THE ATHLETE'S OWN HEAD.
--
-- A DELIBERATE OVERRIDE OF INVARIANT 5 AND v5.1 (Tyson, 2026-08-09), asked for after
-- I raised the objection and he reaffirmed it. Recorded plainly here so the review
-- sees a decision rather than a drift.
--
-- WHAT THE SPEC SAYS, so nobody has to go looking:
--   v5.1  "No coin stake may ever attach to a PR attempt."
--   inv 5 "Do not reward unnecessary PR attempts. Do not solicit max attempts."
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. The rule was a flat refusal; it
-- becomes informed consent. Three things keep the override narrow:
--
--   1. THE ATHLETE MUST SAY SO, per pledge. `above_program_ack` defaults FALSE, so
--      an above-best target is still refused unless the pledge explicitly carries
--      the acknowledgement. Nothing is opted in by accident, and a client that has
--      not been taught the flag behaves exactly as before.
--   2. IT IS RECORDED. The flag is stored on the row, so "who accepted what" is
--      answerable later rather than inferred. That is the difference between putting
--      the onus on someone and merely removing a guard.
--   3. IT PAYS NOTHING EXTRA. Settlement stays a fixed 2x. Coins are therefore never
--      the REASON to attempt a PR — they are the same either way, and the athlete is
--      choosing the attempt, not being bought into it.
--
-- AND THE SOLICITATION BAN STAYS, untouched and not part of this override. v5.1 bans
-- two separate things: a stake on a PR attempt, and the APP suggesting one. Tyson
-- overrode the first. The second is about the product's behaviour rather than the
-- athlete's choice, and "the onus is on the user" only means anything if the user is
-- the one who thought of it. No copy, prompt, mission or progress indicator may
-- encourage a PR attempt.
--
-- Classification untouched: skill-resolved, zero RNG, money walls intact. This was
-- never a legal rule.

begin;

alter table public.workout_callouts
  add column if not exists above_program_ack boolean not null default false;

comment on column public.workout_callouts.above_program_ack is
  'The athlete explicitly accepted a target above their own logged best (174). '
  'Defaults false; an above-best pledge without it is refused.';

/**
 * The guard, with the flat refusal replaced by a consent check.
 *
 * `is_programmed_target` is unchanged and still tells the truth about whether a
 * target is inside programmed territory — it is now ADVISORY here rather than
 * absolute, and the client uses the same function to decide whether to ask.
 */
create or replace function public.forge_trial_eligibility_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  allowance jsonb;
  scheduled text[];
  ceiling int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  scheduled := public.scheduled_workouts_on(new.athlete_id, new.workout_date);
  if array_length(scheduled, 1) is null then
    raise exception 'forge_trial: % is a rest day. Rest is part of the plan.', new.workout_date
      using errcode = 'check_violation';
  end if;
  if not (new.workout_name = any (scheduled)) then
    raise exception 'forge_trial: your plan has % on that day, not %.',
      array_to_string(scheduled, ' or '), new.workout_name using errcode = 'check_violation';
  end if;

  -- 174: ABOVE YOUR BEST IS NOW A CHOICE, NOT A WALL — but it has to be made, and
  -- it is made per pledge. The message says what is being accepted rather than
  -- simply refusing, because an athlete who meant it needs to know how to proceed
  -- and one who did not needs to know what they nearly did.
  if not public.is_programmed_target(
       new.athlete_id, new.exercise, new.target_load_mode,
       new.target_weight_kg, new.target_reps)
     and not coalesce(new.above_program_ack, false) then
    raise exception
      'forge_trial: that target is above anything you have logged for %. Pledge on it only if you have decided to attempt it — the coins pay the same either way.',
      new.exercise using errcode = 'check_violation';
  end if;

  allowance := public.forge_trial_allowance(new.exercise, new.workout_date);
  ceiling := (allowance ->> 'max_stake')::int;
  if ceiling is not null and ceiling <= 0 then
    raise exception 'forge_trial: %', allowance ->> 'message'
      using errcode = 'check_violation';
  end if;
  if ceiling is not null and new.stake > ceiling then
    raise exception 'forge_trial: % coins is over today''s limit — %', new.stake,
      allowance ->> 'message' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ─────────── PROVEN: refused without the acknowledgement, allowed with it

do $$
declare
  u uuid; o uuid; sched text[]; ex text; best numeric; ok boolean := false;
begin
  select athlete_id, opponent_id into u, o
    from public.workout_callouts order by created_at desc limit 1;
  sched := public.scheduled_workouts_on(u, current_date);
  if u is null or array_length(sched, 1) is null then
    raise notice 'nobody training today — skipping the live check'; return;
  end if;
  select w.exercise, max(w.weight) into ex, best
    from public.workout_log w
    where w.user_id = u and w.weight > 0 and w.reps > 0 and w.date >= current_date - 30
    group by w.exercise order by max(w.weight) desc limit 1;

  perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', u), true);

  -- Above best, WITHOUT the acknowledgement -> still refused.
  begin
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at)
    values (u, o, u, current_date, sched[1], ex, 7, 3, 'external', best + 10,
            'probe174'::text, 10, 'offered', now() + interval '1 hour');
    raise exception 'an above-best pledge was allowed with NO acknowledgement';
  exception when check_violation then
    ok := true;
  end;
  if not ok then raise exception 'the consent check did not fire'; end if;

  -- Above best, WITH it -> allowed.
  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
    set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
    status, expires_at, above_program_ack)
  values (u, o, u, current_date, sched[1], ex, 8, 3, 'external', best + 10,
          'probe174'::text, 10, 'offered', now() + interval '1 hour', true);

  if not exists (select 1 from public.workout_callouts
                 where athlete_id = u and target_label = 'probe174' and above_program_ack) then
    raise exception 'the acknowledged pledge did not land';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from public.workout_callouts where athlete_id = u and target_label = 'probe174';
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;
