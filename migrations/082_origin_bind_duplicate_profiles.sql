-- 082 — Origin binding tolerates duplicate profile rows (the besnardslater bug).
--
-- profile has ALWAYS allowed multiple rows per user — the app convention is
-- "latest created_at wins" (client useProfile takes data[len-1]). But 048's
-- assign_origin_path ended with
--     update profile ... where user_id = me returning firstbound_origin into v_firstbound;
-- and PL/pgSQL raises P0003 ("query returned more than one row") when RETURNING
-- INTO sees two rows — so an athlete with a duplicated profile row could NEVER
-- bind an origin: the RPC 400'd, the client collapsed it to "network", and
-- retrying forever changed nothing. Reproduced verbatim as the affected user
-- (P0003) before this fix. reforge_origin had the same bomb in its final scalar
-- subquery (21000 with two rows).
--
-- Fix: same bodies as 048, with every single-row read made deterministic
-- ("order by created_at desc limit 1" — latest wins, matching the client) and
-- the RETURNING INTO replaced by update-then-select. Updates still write ALL of
-- the user's profile rows, so whichever row any older reader picks, the origin
-- fields agree.

create or replace function public.assign_origin_path(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing_origin text;
  cands jsonb; cls jsonb;
  allowed boolean := false;
  v_ver int;
  prev jsonb;
  v_stage int;
  v_champion text;
  v_firstbound text;
  v_followed boolean;
begin
  if me is null then
    raise exception 'assign_origin_path: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_path not in ('aesthetic','mass','titan','cardio','shredder') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_origin');
  end if;

  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path into existing_origin
    from profile where user_id = me order by created_at desc limit 1;
  if existing_origin is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_assigned', 'origin_path', existing_origin);
  end if;

  cands := public.origin_candidates_for(me);
  if (cands->>'ok')::boolean
     and exists (select 1 from jsonb_array_elements(cands->'candidates') c
                 where c->>'originId' = p_path) then
    allowed := true; v_ver := 5;
  end if;
  cls := public.classify_evo_path();
  if not allowed and coalesce((cls->>'ok')::boolean, false)
     and ((cls->'choices') ? p_path
          or (p_path = 'shredder' and coalesce((cls->>'shredder_eligible')::boolean, false))) then
    allowed := true; v_ver := 4;
  end if;
  if not allowed then
    return jsonb_build_object('ok', false, 'reason', 'not_offered');
  end if;

  v_champion := case p_path
    when 'aesthetic' then 'aesthetic' when 'titan' then 'titan'
    when 'mass' then 'titan' when 'cardio' then 'apex'
    when 'shredder' then 'shredded' end;
  v_followed := v_ver = 5 and p_path = cands->>'recommended_origin';

  select jsonb_build_object('origin_path', origin_path, 'active_path', active_path,
                            'migration_status', migration_status)
    into prev from profile where user_id = me order by created_at desc limit 1;

  insert into evo_assessments (user_id, overall_evo_rating, strength_score, cardio_score,
                               aesthetics_score, size_score, recommended_path, secondary_path,
                               confidence, classification_version, raw_input_snapshot)
  values (me,
          case when v_ver = 5 then (cands->>'evo_rating')::int else (cls->>'evo_rating')::int end,
          case when v_ver = 5 then (cands->'scores'->>'titan')::numeric else (cls->'scores'->>'titan')::numeric end,
          case when v_ver = 5 then (cands->'scores'->>'cardio')::numeric else (cls->'scores'->>'cardio')::numeric end,
          case when v_ver = 5 then (cands->'scores'->>'aesthetic')::numeric else (cls->'scores'->>'aesthetic')::numeric end,
          case when v_ver = 5 then (cands->'scores'->>'mass')::numeric else (cls->'scores'->>'mass')::numeric end,
          case when v_ver = 5 then cands->>'recommended_origin' else cls->>'recommended_path' end,
          null,
          case when v_ver = 5 then null else (cls->>'confidence')::int end,
          v_ver,
          case when v_ver = 5
            then cands || jsonb_build_object('followed_recommendation', v_followed)
            else cls end);

  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- 048 EXCLUSIVITY: the origin is the ONLY character with data.
  delete from user_paths where user_id = me and path <> p_path;

  insert into user_champion_bond (user_id, champion)
  values (me, v_champion)
  on conflict (user_id, champion) do nothing;
  delete from user_champion_bond
   where user_id = me and champion <> v_champion and champion <> 'gymerica';

  -- 082: update ALL profile rows (duplicates stay in agreement), then read the
  -- latest — never RETURNING INTO, which throws P0003 on a duplicated profile.
  update profile set
    origin_path = p_path, origin_assigned_at = now(), origin_assignment_version = v_ver,
    migration_status = 'classified', active_path = p_path, active_stage = coalesce(v_stage, 1),
    firstbound_origin = coalesce(firstbound_origin, p_path)
  where user_id = me;
  select firstbound_origin into v_firstbound
    from profile where user_id = me order by created_at desc limit 1;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, v_ver, prev,
          jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path_v5',
                             'champion', v_champion, 'followed_recommendation', v_followed,
                             'exclusive_wipe', true),
          'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1),
                            'champion', v_champion, 'firstbound', v_firstbound,
                            'followed_recommendation', v_followed);
end;
$$;

create or replace function public.reforge_origin(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_origin text; v_granted timestamptz; v_used timestamptz;
  cands jsonb;
  prev jsonb;
  v_stage int;
  v_champion text;
  v_firstbound text;
begin
  if me is null then
    raise exception 'reforge_origin: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_path not in ('aesthetic','mass','titan','cardio','shredder') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_origin');
  end if;
  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path, reforge_granted_at, reforge_used_at
    into v_origin, v_granted, v_used
    from profile where user_id = me order by created_at desc limit 1;
  if v_origin is null then
    return jsonb_build_object('ok', false, 'reason', 'no_origin');
  end if;
  if v_granted is null then
    return jsonb_build_object('ok', false, 'reason', 'not_granted');
  end if;
  if v_used is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used', 'used_at', v_used);
  end if;
  if p_path = v_origin then
    return jsonb_build_object('ok', false, 'reason', 'same_origin');
  end if;

  cands := public.origin_candidates_for(me);
  if not coalesce((cands->>'ok')::boolean, false)
     or not exists (select 1 from jsonb_array_elements(cands->'candidates') c
                    where c->>'originId' = p_path) then
    return jsonb_build_object('ok', false, 'reason', 'not_offered');
  end if;

  v_champion := case p_path
    when 'aesthetic' then 'aesthetic' when 'titan' then 'titan'
    when 'mass' then 'titan' when 'cardio' then 'apex'
    when 'shredder' then 'shredded' end;

  select jsonb_build_object('origin_path', origin_path, 'active_path', active_path,
                            'active_stage', active_stage, 'firstbound_origin', firstbound_origin)
    into prev from profile where user_id = me order by created_at desc limit 1;

  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- 048 EXCLUSIVITY: the old origin does NOT stay collected — it is wiped.
  delete from user_paths where user_id = me and path <> p_path;

  insert into user_champion_bond (user_id, champion)
  values (me, v_champion)
  on conflict (user_id, champion) do nothing;
  delete from user_champion_bond
   where user_id = me and champion <> v_champion and champion <> 'gymerica';

  -- firstbound_origin is untouched (the guard trigger enforces it anyway).
  update profile set
    origin_path = p_path, active_path = p_path, active_stage = coalesce(v_stage, 1),
    origin_assignment_version = 5, migration_status = 'classified',
    reforge_used_at = now()
  where user_id = me;
  select firstbound_origin into v_firstbound
    from profile where user_id = me order by created_at desc limit 1;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, 5, prev,
          jsonb_build_object('origin_path', p_path, 'via', 'reforge_origin',
                             'previous_origin', v_origin, 'champion', v_champion,
                             'exclusive_wipe', true),
          'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1),
                            'champion', v_champion, 'previous_origin', v_origin,
                            'firstbound', v_firstbound);
end;
$$;

revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
revoke all on function public.reforge_origin(text) from public, anon, authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
grant execute on function public.reforge_origin(text) to authenticated;
