-- EvoForge 173 — A FIRST-TIME EXERCISE IS NOT A MAX ATTEMPT.
--
-- 163's `is_programmed_target` returned FALSE when an athlete had never logged the
-- exercise, on the reasoning that with no history there is nothing to compare
-- against. That was my over-implementation and not the spec: v5 §4 forbids "PR
-- attempts and above-program loads", and an exercise you have simply never done is
-- neither. It is new.
--
-- The effect in production was that a genuinely planned exercise could never carry a
-- pledge until it had been logged at least once — including every exercise in a new
-- athlete's first programme, which is exactly the population least able to work out
-- why the button was missing.
--
-- WHAT REPLACES IT: with no history, the target is accepted. The remaining walls do
-- the work — it must be a scheduled training day, it must be one of the day's
-- workouts, a miss ends the day, and the escalation ramp still bounds the amount.
--
-- WHAT DOES NOT CHANGE, AND WILL NOT: a target above the athlete's own logged best
-- is still refused. That is v5.1's "no coin stake may ever attach to a PR attempt"
-- and invariant 5's physiotherapist test, and it is the one eligibility rule here
-- with a physical-harm rationale rather than a behavioural one. Coins on a max
-- attempt are a reason to grind out a rep under fatigue.
--
-- Classification is untouched either way: skill-resolved, zero RNG, money walls
-- intact.

begin;

create or replace function public.is_programmed_target(
  p_user uuid,
  p_exercise text,
  p_load_mode text,
  p_weight_kg numeric,
  p_reps int
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  best_weight numeric;
  best_reps int;
begin
  if p_load_mode is distinct from 'external' or p_weight_kg is null then
    select max(w.reps) into best_reps
    from public.workout_log w
    where w.user_id = p_user and w.exercise = p_exercise and w.reps > 0;
    -- 173: NEVER DONE IT IS NOT A PR ATTEMPT. There is no personal best to exceed,
    -- so there is nothing here that the physiotherapist test is protecting against.
    if best_reps is null then
      return true;
    end if;
    return p_reps <= best_reps;
  end if;

  select max(w.weight) into best_weight
  from public.workout_log w
  where w.user_id = p_user and w.exercise = p_exercise and w.weight > 0 and w.reps > 0;
  if best_weight is null then
    return true;
  end if;
  -- Above your own best IS a max attempt, and stays refused. v5.1: "no coin stake
  -- may ever attach to a PR attempt."
  return p_weight_kg <= best_weight;
end;
$$;
revoke execute on function public.is_programmed_target(uuid, text, text, numeric, int) from public, anon;
grant execute on function public.is_programmed_target(uuid, text, text, numeric, int) to authenticated;

-- ─────────── PROVEN: new is allowed, above-best still is not

do $$
declare
  u uuid;
  ex text;
  best numeric;
begin
  select athlete_id into u from public.workout_callouts order by created_at desc limit 1;
  if u is null then raise notice 'no athlete — skipping'; return; end if;

  -- A first-time exercise is now eligible…
  if not public.is_programmed_target(u, 'Zercher Squat (never done)', 'external', 60, 5) then
    raise exception 'a first-time exercise is still refused';
  end if;
  if not public.is_programmed_target(u, 'Some New Bodyweight Thing', 'bodyweight', null, 12) then
    raise exception 'a first-time bodyweight exercise is still refused';
  end if;

  -- …and a max attempt on a known one is still refused.
  select w.exercise, max(w.weight) into ex, best
    from public.workout_log w
    where w.user_id = u and w.weight > 0 and w.reps > 0
    group by w.exercise order by max(w.weight) desc limit 1;
  if ex is not null then
    if public.is_programmed_target(u, ex, 'external', best + 5, 5) then
      raise exception 'a PR attempt on % (%kg over a %kg best) was allowed', ex, 5, best;
    end if;
    if not public.is_programmed_target(u, ex, 'external', best, 5) then
      raise exception 'the athlete''s own best was refused as if it were a PR';
    end if;
  end if;
end $$;

commit;
