-- EvoForge 045 — ORIGIN CLASSIFICATION v3 + the GLOBAL RE-ASSESSMENT
-- (Tyson, 2026-07-17): "most characters' origin having to be aesthetics" —
-- rework the scoring so origins vary: Mass Monster for size, Titan for
-- strength, Elite Aesthetic for physique, Apex Engine for cardio, and THE
-- SHREDDER for a high body-fat athlete in a cutting phase. Every current
-- player is REQUIRED to take a new Evo assessment and receive a new origin
-- under this system.
--
-- WHY v1/v2 skewed aesthetic (measured on production, 2026-07-17): the four
-- pillar scores live on DIFFERENT effective scales — aesthetics averaged
-- 60.6 and beat size on 10/10 rating rows (fallbacks 45–70, symmetry
-- compressed toward 70, legacy physique evidence nearly always present),
-- while strength/cardio bottom out at provisional floors (30/35–45) and any
-- missing movement category annihilates strength geometrically. Comparing
-- them RAW hands aesthetic the top slot almost every time (3/3 assigned
-- origins were aesthetic). The pillar formulas themselves are correct and
-- byte-pinned by goldens — the fix lives HERE, in the cross-pillar layer.
--
-- THE v3 MODEL:
--   affinity(pillar) = score − BASELINE(pillar)
-- where the baselines are versioned calibration constants representing what
-- a typical evidenced EvoForge athlete scores on THAT pillar (fit to the
-- 2026-07-17 production distribution): aesthetic 60 · mass 52 · titan 50 ·
-- cardio 48. You are classified by which pillar you are most ABOVE YOUR
-- PEERS on, not by which pillar's formula is most generous.
--   EVIDENCE GATE: a pillar whose confidence is below 25 cannot be
-- recommended and cannot appear in a choice — no more "Apex Engine" for an
-- athlete who never logged a run. It still shows in the score breakdown.
--   SHREDDER (Tyson's rule): nutrition_phase = 'cutting' AND a fresh
-- (≤90-day) body-fat midpoint at or above 20% (male) / 28% (female) →
-- The Shredder is the origin, outright. Cutters below the threshold keep
-- shredder_eligible as a claimable alternative, as before.
--   Choice margins ride the AFFINITIES now: all candidates within 8 → choose
-- among them; top two within 5 → choose between them; else outright.
--
-- CALIBRATION_V3 (revise like the strength reference curves — versioned,
-- never scattered): baselines above; evidence gate 25; shredder bf 20/28,
-- freshness 90 days.

-- ---- the classifier core, callable per-user (the batch needs it) ----
create or replace function public.classify_evo_path_for(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; a record;
  v_phase text; v_sex text;
  v_bf numeric; v_bf_date date;
  s_size numeric; s_aes numeric; s_str numeric; s_cnd numeric;
  c_size int; c_aes int; c_str int; c_cnd int;
  v_conf int; v_rating int;
  scores jsonb; affinities jsonb; candidates jsonb;
  top_path text; top_aff numeric; second_path text; second_aff numeric;
  spread numeric; requires_choice boolean; choices jsonb;
  shredder_auto boolean := false; shredder_eligible boolean := false;
  n_candidates int;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 3);
  end if;

  select * into r from evo_rating_current where user_id = p_user;

  if found and coalesce(r.overall_confidence, 0) >= 30 then
    s_size := r.size_score;     c_size := coalesce(r.size_confidence, 0);
    s_aes  := r.aesthetics_score; c_aes := coalesce(r.aesthetics_confidence, 0);
    s_str  := r.strength_score; c_str  := coalesce(r.strength_confidence, 0);
    s_cnd  := r.cardio_score;   c_cnd  := coalesce(r.cardio_confidence, 0);
    v_conf := r.overall_confidence; v_rating := r.displayed_rating;
  else
    -- SCAN FALLBACK (042): the freshest confirmed/pending EvoGuide scan
    -- carries size/aesthetics; strength/cardio come from the rating row's
    -- pillars WITH their own confidences — the neutral mid fill of v2 is
    -- gone, because the evidence gate below already keeps an unevidenced
    -- pillar out of the running.
    select * into a from physique_assessments
      where user_id = p_user and status in ('confirmed', 'pending_confirmation')
      order by assessment_date desc limit 1;
    if not found then
      if r is null then
        return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 3);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'insufficient_data',
        'confidence', coalesce(r.overall_confidence, 0), 'classification_version', 3);
    end if;
    s_size := a.size_score;      c_size := greatest(coalesce(a.confidence, 30), 30);
    s_aes  := a.aesthetics_score; c_aes := greatest(coalesce(a.confidence, 30), 30);
    s_str  := coalesce(r.strength_score, (a.size_score + a.aesthetics_score) / 2);
    c_str  := coalesce(r.strength_confidence, 0);
    s_cnd  := coalesce(r.cardio_score, (a.size_score + a.aesthetics_score) / 2);
    c_cnd  := coalesce(r.cardio_confidence, 0);
    v_conf := greatest(coalesce(r.overall_confidence, 0), 30);
    v_rating := coalesce(r.displayed_rating, round((s_size + s_aes) / 2)::int);
  end if;

  select nutrition_phase, sex into v_phase, v_sex from profile where user_id = p_user limit 1;
  shredder_eligible := coalesce(v_phase, '') = 'cutting';

  -- Shredder: high body fat + cutting = the journey IS the character.
  if shredder_eligible then
    select coalesce(bf_mid, (bf_low + bf_high) / 2), date into v_bf, v_bf_date
      from bodyfat_log
      where user_id = p_user and (bf_mid is not null or (bf_low is not null and bf_high is not null))
      order by "timestamp" desc limit 1;
    if v_bf is not null
       and coalesce(v_bf_date, current_date) >= current_date - 90
       and v_bf >= (case when coalesce(v_sex, 'male') = 'female' then 28 else 20 end) then
      shredder_auto := true;
    end if;
  end if;

  scores := jsonb_build_object(
    'titan', round(s_str, 1), 'cardio', round(s_cnd, 1),
    'aesthetic', round(s_aes, 1), 'mass', round(s_size, 1)
  );
  -- CALIBRATION_V3 baselines — aesthetic 60 · mass 52 · titan 50 · cardio 48.
  affinities := jsonb_build_object(
    'titan', round(s_str - 50, 1), 'cardio', round(s_cnd - 48, 1),
    'aesthetic', round(s_aes - 60, 1), 'mass', round(s_size - 52, 1)
  );
  -- The evidence gate: confidence ≥ 25 or the pillar cannot be recommended.
  candidates := '{}'::jsonb;
  if c_str >= 25 then candidates := candidates || jsonb_build_object('titan', affinities->'titan'); end if;
  if c_cnd >= 25 then candidates := candidates || jsonb_build_object('cardio', affinities->'cardio'); end if;
  if c_aes >= 25 then candidates := candidates || jsonb_build_object('aesthetic', affinities->'aesthetic'); end if;
  if c_size >= 25 then candidates := candidates || jsonb_build_object('mass', affinities->'mass'); end if;

  select count(*) into n_candidates from jsonb_each_text(candidates);
  if n_candidates = 0 and not shredder_auto then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_data',
      'confidence', v_conf, 'classification_version', 3);
  end if;

  if shredder_auto then
    top_path := 'shredder';
    requires_choice := false;
    choices := jsonb_build_array('shredder');
    select k into second_path from jsonb_each_text(candidates) as t(k, v)
      order by v::numeric desc, k limit 1;
  else
    select k, v::numeric into top_path, top_aff from jsonb_each_text(candidates) as t(k, v)
      order by v::numeric desc, k limit 1;
    select k, v::numeric into second_path, second_aff from jsonb_each_text(candidates) as t(k, v)
      order by v::numeric desc, k offset 1 limit 1;
    select max(v::numeric) - min(v::numeric) into spread from jsonb_each_text(candidates) as t(k, v);

    if n_candidates > 1 and spread <= 8 then
      requires_choice := true;
      choices := (select jsonb_agg(k order by v::numeric desc, k) from jsonb_each_text(candidates) as t(k, v));
    elsif n_candidates > 1 and top_aff - second_aff <= 5 then
      requires_choice := true; choices := jsonb_build_array(top_path, second_path);
    else
      requires_choice := false; choices := jsonb_build_array(top_path);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'recommended_path', top_path, 'secondary_path', second_path,
    'scores', scores, 'affinities', affinities,
    'ranking', coalesce((select jsonb_agg(k order by v::numeric desc, k) from jsonb_each_text(candidates) as t(k, v)), '[]'::jsonb),
    'confidence', v_conf, 'requires_choice', requires_choice, 'choices', choices,
    'shredder_eligible', shredder_eligible, 'shredder_auto', shredder_auto,
    'evo_rating', v_rating, 'classification_version', 3
  );
end; $$;

-- ---- the caller-facing wrapper keeps its exact signature ----
create or replace function public.classify_evo_path() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'classify_evo_path: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return classify_evo_path_for(auth.uid());
end; $$;

-- ---- assign_origin_path: unchanged semantics (042's equip), v3 stamps ----
create or replace function public.assign_origin_path(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cls jsonb; allowed boolean; prev jsonb; existing_origin text; v_stage int;
begin
  if me is null then raise exception 'assign_origin_path: not signed in.' using errcode='insufficient_privilege'; end if;
  select origin_path into existing_origin from profile where user_id = me limit 1;
  if existing_origin is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_assigned', 'origin_path', existing_origin);
  end if;
  cls := classify_evo_path();
  if not (cls->>'ok')::boolean then return jsonb_build_object('ok', false, 'reason', cls->>'reason'); end if;
  allowed := (cls->'choices') ? p_path or (p_path = 'shredder' and (cls->>'shredder_eligible')::boolean);
  if not allowed then return jsonb_build_object('ok', false, 'reason', 'not_offered', 'choices', cls->'choices'); end if;

  select jsonb_build_object('origin_path', origin_path, 'active_path', active_path, 'migration_status', migration_status)
    into prev from profile where user_id = me limit 1;

  insert into evo_assessments (user_id, overall_evo_rating, strength_score, cardio_score, aesthetics_score, size_score,
                               recommended_path, secondary_path, confidence, classification_version, raw_input_snapshot)
  values (me, (cls->>'evo_rating')::int, (cls->'scores'->>'titan')::numeric, (cls->'scores'->>'cardio')::numeric,
          (cls->'scores'->>'aesthetic')::numeric, (cls->'scores'->>'mass')::numeric,
          cls->>'recommended_path', cls->>'secondary_path', (cls->>'confidence')::int, 3, cls);

  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- EQUIP the origin (042): the champion appears on the podium.
  update profile set
    origin_path = p_path, origin_assigned_at = now(), origin_assignment_version = 3,
    migration_status = 'classified', active_path = p_path, active_stage = coalesce(v_stage, 1)
  where user_id = me;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, 3, prev, jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path_v3'), 'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1));
end; $$;

-- ---- the GLOBAL RE-ASSESSMENT: every assigned origin is retired ----
-- Tyson 2026-07-17: "every current player is required to get a new evo
-- rating and origin character based on this new system." Every profile that
-- holds an origin (or a classified/migrated status) is reset to
-- needs_assessment: the previous state is archived to the migration log,
-- is_origin comes off the path rows, and the profile's origin fields clear.
-- EARNED progress is untouched — user_paths rows keep is_unlocked, stages
-- and xp; active_path/active_stage stay as they are so nothing visibly
-- breaks before the new claim (the dual-read ignores them while origin is
-- null). The client then runs the machinery that already exists: the
-- sign-in scan prompt + Home podium button force the NEW Evo assessment
-- (the origin-unset cooldown exception reopens the scan), and the Forge
-- reveal assigns the new origin under classification v3.
-- Idempotent: a second run finds nothing to reset. Admin/service-role only.
create or replace function public.require_origin_reassessment_v3(p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u record;
  n_reset int := 0;
  prev_by_path jsonb := '{}'::jsonb;
begin
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'require_origin_reassessment_v3: admin only.' using errcode='insufficient_privilege';
  end if;

  for u in
    select user_id, origin_path, active_path, active_stage, migration_status
    from profile
    where origin_path is not null or migration_status in ('classified', 'migrated')
  loop
    n_reset := n_reset + 1;
    if u.origin_path is not null then
      prev_by_path := jsonb_set(prev_by_path, array[u.origin_path],
        to_jsonb(coalesce((prev_by_path->>u.origin_path)::int, 0) + 1));
    end if;

    if not p_dry_run then
      insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
      values (u.user_id, 3,
              jsonb_build_object('origin_path', u.origin_path, 'active_path', u.active_path,
                                 'active_stage', u.active_stage, 'migration_status', u.migration_status),
              jsonb_build_object('via', 'require_origin_reassessment_v3', 'migration_status', 'needs_assessment'),
              'ok', now());

      update user_paths set is_origin = false, updated_at = now()
        where user_id = u.user_id and is_origin;

      update profile set
        origin_path = null, origin_assigned_at = null, origin_assignment_version = null,
        migration_status = 'needs_assessment'
      where user_id = u.user_id;
    end if;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'reset', n_reset, 'previous_origins', prev_by_path);
end; $$;

-- grants (the 036 lesson: revoke EXPLICITLY, grant back what's needed)
revoke all on function public.classify_evo_path_for(uuid) from public, anon, authenticated;
revoke all on function public.classify_evo_path() from public, anon, authenticated;
revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
revoke all on function public.require_origin_reassessment_v3(boolean) from public, anon, authenticated;
grant execute on function public.classify_evo_path() to authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
grant execute on function public.require_origin_reassessment_v3(boolean) to service_role;
