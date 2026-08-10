-- EvoForge 190 - NO PLAN MEANS NO PLANNED REST.
--
-- 189 let a confirmed rest day advance the Forge Cache, guarded by "the plan must call
-- rest on that date". `scheduled_workouts_on` returns an EMPTY ARRAY for an athlete
-- with no schedule row at all, and 189 read empty as rest - so somebody who has never
-- set a plan could confirm rest every single day and climb rungs 1-6 for 280 coins
-- without logging one set.
--
-- Found while building the harness: the only training-clean smoke account had no
-- schedule, which is precisely the state that exposes it. A fixture chosen for being
-- clean turned out to be the adversarial case.
--
-- §6 says "planned rest days advance recovery-linked progression". Rest is generative
-- because the PLAN called for it; an absent plan is not a rest day, it is an absent
-- plan. The distinction between "your plan says rest today" and "you have no plan" was
-- collapsed and is now explicit.
--
-- The state function draws the same distinction, so the card offers CONFIRM REST DAY
-- only when there is a plan to be adherent to, and otherwise says what to do instead.

begin;

create or replace function public.forge_rest_confirm(p_day date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  d date := coalesce(p_day, (now() at time zone 'UTC')::date);
  scheduled text[];
  has_plan boolean;
  fresh boolean;
begin
  if me is null then
    raise exception 'forge_rest_confirm: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if d > (now() at time zone 'UTC')::date or d < (now() at time zone 'UTC')::date - 1 then
    raise exception 'forge_rest_confirm: rest is confirmed on the day, not in advance.'
      using errcode = 'check_violation';
  end if;

  -- 190: THERE MUST BE A PLAN. Without this, "no schedule" reads as "rest every day"
  -- and the ladder is climbable by tapping a button once a day forever.
  select exists (
    select 1 from public.workout_schedule ws
    where ws.user_id = me and ws.effective_from <= d
  ) into has_plan;
  if not has_plan then
    raise exception 'forge_rest_confirm: set a weekly plan first - rest counts because the plan calls for it.'
      using errcode = 'check_violation';
  end if;

  scheduled := public.scheduled_workouts_on(me, d);
  if array_length(scheduled, 1) is not null then
    raise exception 'forge_rest_confirm: your plan has % on %, so it is a training day.',
      array_to_string(scheduled, ' or '), d using errcode = 'check_violation';
  end if;

  insert into public.forge_rest_days (user_id, rest_day) values (me, d)
  on conflict (user_id, rest_day) do nothing;
  fresh := found;

  return jsonb_build_object('rest_day', d, 'confirmed', true, 'already', not fresh,
                            'state', public.forge_cache_state());
end;
$$;
revoke execute on function public.forge_rest_confirm(date) from public, anon;
grant execute on function public.forge_rest_confirm(date) to authenticated;

-- The card must not offer a button the server will refuse, so the state reports
-- whether a plan exists at all rather than only whether today is rest.
create or replace function public.forge_cache_state()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  base jsonb;
  has_plan boolean;
begin
  if me is null then
    raise exception 'forge_cache_state: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select exists (
    select 1 from public.workout_schedule ws
    where ws.user_id = me and ws.effective_from <= (now() at time zone 'UTC')::date
  ) into has_plan;

  base := public.forge_cache_state_v189();

  -- 190: an athlete with no plan has no planned rest. `today_is_rest` stays honest
  -- about the calendar; `can_confirm_rest` is what the card must key on.
  return base
    || jsonb_build_object(
         'has_plan', has_plan,
         'can_confirm_rest', has_plan
           and (base ->> 'today_is_rest')::boolean
           and not (base ->> 'today_rest_confirmed')::boolean)
    || case when has_plan then '{}'::jsonb else jsonb_build_object(
         'message', 'Set a weekly plan and the cache opens on your plan-adherent days.') end;
end;
$$;
revoke execute on function public.forge_cache_state() from public, anon;
grant execute on function public.forge_cache_state() to authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.forge_rest_confirm(date)'::regprocedure);
  if d not like '%set a weekly plan first%' then
    raise exception 'rest can still be confirmed without a plan';
  end if;
  d := pg_get_functiondef('public.forge_cache_state()'::regprocedure);
  if d not like '%can_confirm_rest%' then
    raise exception 'the state does not tell the card when rest is offerable';
  end if;
end $$;

commit;
