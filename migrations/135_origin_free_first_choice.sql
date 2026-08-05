-- EvoForge 135 -- THE ORIGIN IS CHOSEN, NEVER RATIONED
-- (docs/ONBOARDING_V3_SPEC.md section 4).
--
-- THE PROBLEM. assign_origin_path accepts a path only if the candidate model
-- offered it (three of five) or a photo classification allows it. Under v3
-- the athlete picks their Origin BEFORE any evidence exists -- no lifts, no
-- measurements, no scan -- so origin_candidates_for shortlists three cards
-- from a goal string and a nutrition phase, and the server would then refuse
-- the other two on that shortlist's authority.
--
-- Refusing a character on evidence you do not have is exactly the failure
-- the v3 brief is about: someone short on confidence reads it as the app
-- deciding they are not lean or strong enough to be who they wanted to be.
--
-- THE CHANGE. One clause: a v3 athlete's FIRST origin may be any of the
-- five. Everything else is byte-identical to the deployed function.
--
--   * existing_origin is null -- first bind only; a re-choice still goes
--     through reforge_origin, which has its own rules and its own credit.
--   * onboarding_flow_version >= 3 -- v2 and legacy athletes are untouched,
--     and the migrated cohort keeps the shortlist it was designed for.
--
-- The free choice is RECORDED, not hidden: free_choice lands in the
-- assessment snapshot, the migration log and the RPC result.
-- followed_recommendation keeps its meaning and gains a better one -- the
-- athlete never saw the recommendation, so agreement is now unprompted
-- evidence about the model rather than a measure of its own suggestion.
--
-- Apply by hand via the management API (HANDOVER section 5), falsify with
-- the smoke accounts, THEN ship the client commit that depends on it.

CREATE OR REPLACE FUNCTION public.assign_origin_path(p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_flow int;
  v_free boolean := false;
begin
  if me is null then
    raise exception 'assign_origin_path: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_path not in ('aesthetic','mass','titan','cardio','shredder') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_origin');
  end if;

  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path, coalesce(onboarding_flow_version, 0)
    into existing_origin, v_flow
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
  -- ONBOARDING V3 (migration 135). A v3 athlete's FIRST Origin is a free
  -- five-way choice, because at that moment the model has no evidence to
  -- restrict it with: v3 collects no lifts, no measurements and no scan
  -- before this point, so origin_candidates_for is running on a goal string.
  -- A three-card shortlist derived from nothing is not a recommendation, and
  -- refusing the other two Origins on its authority is not a safeguard --
  -- it is the app telling an athlete they may not become the character they
  -- picked. The shortlist keeps its authority everywhere it HAS evidence:
  -- the free Reforge after three real workouts, and the migrated cohort.
  if not allowed and existing_origin is null and v_flow >= 3 then
    allowed := true; v_free := true; v_ver := 5;
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
            then cands || jsonb_build_object('followed_recommendation', v_followed,
                                             'free_choice', v_free)
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
  -- latest â€” never RETURNING INTO, which throws P0003 on a duplicated profile.
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
                             'free_choice', v_free, 'exclusive_wipe', true),
          'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1),
                            'champion', v_champion, 'firstbound', v_firstbound,
                            'followed_recommendation', v_followed,
                            'free_choice', v_free);
end;
$function$
;
