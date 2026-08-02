-- EvoForge 131 — ORIGIN EVOLUTION PATH: the canonical operation.
--
-- ONE function applies a finished workout to the active Origin Path.
-- Everything else (the trigger, the client hook, the post-workout screen)
-- calls it or reads what it wrote. Progression logic lives here and nowhere
-- else, so there is exactly one place to read when a number looks wrong.
--
-- It is idempotent by CONSTRAINT, not by convention: the insert into
-- origin_progress_events either lands or conflicts, and the conflict path
-- returns the already-applied answer instead of applying anything twice.
--
-- Requires 130.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- Deterministic helpers. No AI, no randomness, no clock-dependent branching
-- beyond the calendar week the caller is in.
-- ─────────────────────────────────────────────────────────────────────────

/**
 * Sessions needed to qualify a week.
 *
 * ~75% of the plan, rounded UP, which lands exactly on the spec's two worked
 * examples: a 3-session plan needs 3 (ceil(2.25)), a 4-session plan needs 3
 * (ceil(3.0)). Deload and injury-adjusted weeks drop one session but never
 * below one — a week with no training in it is not a training week.
 */
create or replace function public.origin_week_required(p_planned int, p_kind text default 'standard')
returns int language sql immutable as $$
  select greatest(1, case
    when coalesce(p_planned, 0) <= 0 then 1
    when p_kind in ('deload','injury_adjusted') then ceil(p_planned * 0.75)::int - 1
    else ceil(p_planned * 0.75)::int
  end);
$$;

/** Qualified weeks -> Origin Level. Monotonic; 12/26/48 are the gates. */
create or replace function public.origin_level_for_weeks(p_weeks int, p_awakened boolean)
returns int language sql immutable as $$
  select case
    when not p_awakened then 0
    when coalesce(p_weeks,0) >= 48 then 4
    when coalesce(p_weeks,0) >= 26 then 3
    when coalesce(p_weeks,0) >= 12 then 2
    else 1
  end;
$$;

/** Qualified weeks -> chapter. I 1-12, II 13-26, III 27-48, IV the Standard. */
create or replace function public.origin_chapter_for_weeks(p_weeks int)
returns int language sql immutable as $$
  select case
    when coalesce(p_weeks,0) >= 48 then 4
    when coalesce(p_weeks,0) >= 26 then 3
    when coalesce(p_weeks,0) >= 12 then 2
    else 1
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Start / update the athlete's path (onboarding commitment step)
-- ─────────────────────────────────────────────────────────────────────────
/**
 * Idempotent. Called when an Origin is bound and again if the athlete edits
 * their training days. It NEVER lowers a level, resets qualified_weeks or
 * changes the origin of a path that has already been awakened — switching
 * origins after awakening is a product decision (Reforge), not a side effect
 * of re-running onboarding.
 */
create or replace function public.origin_path_start(
  p_path text,
  p_training_days smallint[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_row  public.user_origin_paths;
  v_new  boolean := false;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if not exists (select 1 from public.paths where slug = p_path and status <> 'retired') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_path');
  end if;

  select * into v_row from public.user_origin_paths where user_id = v_user;

  if v_row.id is null then
    insert into public.user_origin_paths (user_id, origin_path_id, selected_training_days)
    values (v_user, p_path, coalesce(p_training_days, '{}'))
    on conflict (user_id) do nothing
    returning * into v_row;
    -- Lost the race with a second device: read the winner.
    if v_row.id is null then
      select * into v_row from public.user_origin_paths where user_id = v_user;
    else
      v_new := true;
      insert into public.origin_progress_events (user_id, origin_path_id, event_type, metadata)
      values (v_user, p_path, 'path_started', jsonb_build_object('training_days', p_training_days));
    end if;
  else
    update public.user_origin_paths set
      -- Only an un-awakened path may change its origin here.
      origin_path_id = case when current_level = 0 then p_path else origin_path_id end,
      selected_training_days = case
        when coalesce(array_length(p_training_days, 1), 0) > 0 then p_training_days
        else selected_training_days end,
      updated_at = now()
    where user_id = v_user
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true, 'created', v_new,
    'origin_path_id', v_row.origin_path_id,
    'current_level', v_row.current_level,
    'qualified_weeks', v_row.qualified_weeks);
end $$;
grant execute on function public.origin_path_start(text, smallint[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- THE CANONICAL OPERATION
-- ─────────────────────────────────────────────────────────────────────────
/**
 * Apply one finished workout to the active Origin Path.
 *
 * Order matters and mirrors the spec: authenticate, verify ownership, verify
 * completion, refuse duplicates, qualify, count the week, qualify the week,
 * unlock rewards, check the level, log, return.
 *
 * p_session_id is a workout_sessions row — the app's ONLY definition of "this
 * workout is complete" (migration 017). Passing anything else is refused, so
 * the game layer can never invent a completion the tracker does not have.
 *
 * THE OWNER IS AN EXPLICIT ARGUMENT, not auth.uid(). The trigger below must
 * run for the row's owner, and the offline finish queue can flush under a
 * different session than the one that logged the sets. (It also keeps the
 * 030/033 lesson: authority comes from a value the caller had to supply, not
 * from ambient session state this function could be tricked about.) The
 * `authenticated` grant is on the thin wrapper, which supplies auth.uid()
 * and nothing else.
 */
create or replace function public.origin_path_apply_workout_for(p_user uuid, p_session_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user        uuid := p_user;
  v_session     public.workout_sessions;
  v_path        public.user_origin_paths;
  v_week        public.origin_path_weeks;
  v_week_start  date;
  v_planned     int;
  v_required    int;
  v_applied     boolean := false;
  v_event_id    uuid;
  v_qualified   boolean := false;
  v_slot        int;
  v_awakened    boolean := false;
  v_old_level   int;
  v_new_level   int;
  v_reward      public.origin_path_rewards;
  v_rewards     jsonb := '[]'::jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- (2)(3) Ownership AND completion in one read: the marker's existence IS
  -- the completion, and RLS-independent ownership is checked explicitly
  -- because this function runs as definer.
  select * into v_session from public.workout_sessions where id = p_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_such_workout');
  end if;
  if v_session.user_id <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;

  select * into v_path from public.user_origin_paths where user_id = v_user;
  if v_path.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_path');
  end if;
  if v_path.status <> 'active' then
    -- A paused path banks nothing but loses nothing. Resuming picks up here.
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'path_' || v_path.status,
                              'current_level', v_path.current_level,
                              'qualified_weeks', v_path.qualified_weeks);
  end if;

  -- (5) Does the workout qualify? Beta rule, deliberately conservative: any
  -- workout finished on or after the path started counts once. Origin-specific
  -- qualification (a Titan week needing heavy compounds, say) is a
  -- configuration change to this branch and nothing else.
  if v_session.date < (v_path.started_at at time zone 'utc')::date then
    return jsonb_build_object('ok', true, 'applied', false, 'reason', 'before_path_start');
  end if;

  -- (4) DUPLICATE GUARD. The unique index decides, not this code path.
  insert into public.origin_progress_events
    (user_id, origin_path_id, workout_session_id, event_type, progress_amount, metadata)
  values
    (v_user, v_path.origin_path_id, p_session_id, 'workout_applied', 1,
     jsonb_build_object('date', v_session.date, 'workout', v_session.workout))
  on conflict do nothing
  returning id into v_event_id;

  v_applied := v_event_id is not null;
  if not v_applied then
    -- Already counted. Return the CURRENT state so a retry, a double tap or a
    -- refresh mid-update all render the same truthful screen.
    return jsonb_build_object(
      'ok', true, 'applied', false, 'reason', 'already_applied',
      'origin_path_id', v_path.origin_path_id,
      'current_level', v_path.current_level,
      'qualified_weeks', v_path.qualified_weeks,
      'active_week', v_path.active_week,
      'active_chapter', v_path.active_chapter);
  end if;

  -- (6) Count the week. planned/required are FROZEN on first touch.
  v_week_start := date_trunc('week', v_session.date::timestamp)::date;
  v_planned := greatest(1, coalesce(array_length(v_path.selected_training_days, 1), 3));
  v_required := public.origin_week_required(v_planned, 'standard');

  insert into public.origin_path_weeks
    (user_id, origin_path_id, week_start, planned_sessions, required_sessions, completed_sessions)
  values
    (v_user, v_path.origin_path_id, v_week_start, v_planned, v_required, 1)
  on conflict (user_id, origin_path_id, week_start) do update
    set completed_sessions = public.origin_path_weeks.completed_sessions + 1,
        updated_at = now()
  returning * into v_week;

  -- (7) Did the week just qualify? Only the transition counts — a fifth
  -- session in an already-qualified week banks nothing extra.
  if v_week.qualified_at is null and v_week.completed_sessions >= v_week.required_sessions then
    v_slot := v_path.qualified_weeks + 1;
    if v_slot <= 48 then
      update public.origin_path_weeks
        set qualified_at = now(), path_week_index = v_slot, updated_at = now()
        where id = v_week.id
        returning * into v_week;
      v_qualified := true;

      update public.user_origin_paths
        set qualified_weeks = v_slot,
            active_week = least(48, v_slot + 1),
            active_chapter = public.origin_chapter_for_weeks(v_slot),
            updated_at = now()
        where user_id = v_user
        returning * into v_path;

      insert into public.origin_progress_events
        (user_id, origin_path_id, event_type, progress_amount, metadata)
      values (v_user, v_path.origin_path_id, 'week_qualified', 1,
              jsonb_build_object('week_index', v_slot, 'week_start', v_week_start));

      -- (8) Unlock this week's reward. Permanent, automatic, exactly once.
      select * into v_reward from public.origin_path_rewards
        where origin_path_id = v_path.origin_path_id and week_index = v_slot;
      if v_reward.reward_id is not null then
        insert into public.origin_reward_claims
          (user_id, origin_path_id, reward_id, claimed_at)
        values (v_user, v_path.origin_path_id, v_reward.reward_id,
                case when v_reward.claim_mode = 'automatic' then now() else null end)
        on conflict (user_id, reward_id) do nothing;
        if found then
          v_rewards := v_rewards || jsonb_build_object(
            'reward_id', v_reward.reward_id, 'kind', v_reward.kind,
            'label', v_reward.label, 'claim_mode', v_reward.claim_mode);
          insert into public.origin_progress_events
            (user_id, origin_path_id, event_type, metadata)
          values (v_user, v_path.origin_path_id, 'reward_unlocked',
                  jsonb_build_object('reward_id', v_reward.reward_id, 'week_index', v_slot));
        end if;
      end if;
    end if;
  end if;

  -- (9) Level. THE AWAKENING: the first applied workout takes Dormant to
  -- Awakened immediately — it is the product's core promise and must not
  -- wait for a week to qualify.
  v_old_level := v_path.current_level;
  v_awakened := v_path.current_level >= 1 or v_applied;
  v_new_level := public.origin_level_for_weeks(v_path.qualified_weeks, v_awakened);
  -- Monotonic (invariant 4).
  v_new_level := greatest(v_new_level, v_old_level);

  if v_new_level <> v_old_level or v_path.first_workout_completed_at is null then
    update public.user_origin_paths
      set current_level = v_new_level,
          first_workout_completed_at = coalesce(first_workout_completed_at, now()),
          updated_at = now()
      where user_id = v_user
      returning * into v_path;
    if v_new_level <> v_old_level then
      insert into public.origin_progress_events
        (user_id, origin_path_id, event_type, progress_amount, metadata)
      values (v_user, v_path.origin_path_id, 'level_unlocked', v_new_level,
              jsonb_build_object('from', v_old_level, 'to', v_new_level));
    end if;
  end if;

  -- (10) The structured result the post-workout screen renders.
  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'origin_path_id', v_path.origin_path_id,
    'current_level', v_path.current_level,
    'level_unlocked', case when v_new_level <> v_old_level then v_new_level else null end,
    'awakened', v_old_level = 0 and v_new_level >= 1,
    'qualified_weeks', v_path.qualified_weeks,
    'active_week', v_path.active_week,
    'active_chapter', v_path.active_chapter,
    'week_completed_sessions', v_week.completed_sessions,
    'week_required_sessions', v_week.required_sessions,
    'week_qualified', v_qualified,
    'rewards_unlocked', v_rewards);
end $$;
revoke all on function public.origin_path_apply_workout_for(uuid, uuid) from public, authenticated, anon;

/** The client seam: the caller may only ever apply their OWN workout. */
create or replace function public.origin_path_apply_workout(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  return public.origin_path_apply_workout_for(auth.uid(), p_session_id);
end $$;
grant execute on function public.origin_path_apply_workout(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Read model: one round trip for every Path/Home surface
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.origin_path_state()
returns jsonb
language plpgsql security definer set search_path = public
stable as $$
declare
  v_user uuid := auth.uid();
  v_path public.user_origin_paths;
  v_week public.origin_path_weeks;
  v_week_start date := date_trunc('week', (now() at time zone 'utc'))::date;
  v_next public.origin_path_rewards;
  v_unlocked jsonb;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;

  select * into v_path from public.user_origin_paths where user_id = v_user;
  if v_path.id is null then return jsonb_build_object('ok', true, 'has_path', false); end if;

  select * into v_week from public.origin_path_weeks
    where user_id = v_user and origin_path_id = v_path.origin_path_id and week_start = v_week_start;

  select * into v_next from public.origin_path_rewards
    where origin_path_id = v_path.origin_path_id
      and week_index = least(48, v_path.qualified_weeks + 1);

  select coalesce(jsonb_agg(jsonb_build_object(
           'reward_id', c.reward_id, 'kind', r.kind, 'label', r.label,
           'week_index', r.week_index, 'unlocked_at', c.unlocked_at,
           'claimed_at', c.claimed_at) order by r.week_index), '[]'::jsonb)
    into v_unlocked
    from public.origin_reward_claims c
    join public.origin_path_rewards r on r.reward_id = c.reward_id
   where c.user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'has_path', true,
    'origin_path_id', v_path.origin_path_id,
    'status', v_path.status,
    'current_level', v_path.current_level,
    'active_chapter', v_path.active_chapter,
    'active_week', v_path.active_week,
    'qualified_weeks', v_path.qualified_weeks,
    'selected_training_days', v_path.selected_training_days,
    'started_at', v_path.started_at,
    'first_workout_completed_at', v_path.first_workout_completed_at,
    'this_week', case when v_week.id is null then null else jsonb_build_object(
      'week_start', v_week.week_start,
      'planned_sessions', v_week.planned_sessions,
      'required_sessions', v_week.required_sessions,
      'completed_sessions', v_week.completed_sessions,
      'qualified_at', v_week.qualified_at) end,
    'next_reward', case when v_next.reward_id is null then null else jsonb_build_object(
      'reward_id', v_next.reward_id, 'kind', v_next.kind, 'label', v_next.label,
      'description', v_next.description, 'week_index', v_next.week_index) end,
    'unlocked_rewards', v_unlocked);
end $$;
grant execute on function public.origin_path_state() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Pause / resume (illness, shift work, injury — never a loss of progress)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.origin_path_set_status(p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_path public.user_origin_paths;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if p_status not in ('active','paused') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;
  update public.user_origin_paths
     set status = p_status,
         paused_at = case when p_status = 'paused' then now() else null end,
         updated_at = now()
   where user_id = v_user
  returning * into v_path;
  if v_path.id is null then return jsonb_build_object('ok', false, 'reason', 'no_active_path'); end if;
  insert into public.origin_progress_events (user_id, origin_path_id, event_type)
  values (v_user, v_path.origin_path_id,
          case when p_status = 'paused' then 'path_paused' else 'path_resumed' end);
  return jsonb_build_object('ok', true, 'status', v_path.status);
end $$;
grant execute on function public.origin_path_set_status(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- THE TRIGGER — application is guaranteed, not requested
-- ─────────────────────────────────────────────────────────────────────────
/**
 * Finishing a workout applies it to the path, whatever wrote the marker: the
 * online mutation, the offline finish queue flushing days later, or a repair
 * script. The client RPC call is then a way to READ the result, not the only
 * way to earn it.
 *
 * INVARIANT 2: every error is swallowed into origin_path_errors. A raise here
 * would abort the INSERT and the athlete could not finish their workout —
 * fitness tracker first, progression game second.
 */
create or replace function public.origin_path_on_session_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.origin_path_apply_workout_for(new.user_id, new.id);
  exception when others then
    insert into public.origin_path_errors (user_id, context, sqlstate, message)
    values (new.user_id, 'session_insert_trigger', SQLSTATE, SQLERRM);
  end;
  return new;
end $$;

drop trigger if exists origin_path_apply on public.workout_sessions;
create trigger origin_path_apply
  after insert on public.workout_sessions
  for each row execute function public.origin_path_on_session_insert();

commit;
