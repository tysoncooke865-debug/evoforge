-- EvoForge 046 — ORIGIN CHOICE (the raw ±5 rule) + THE ORIGIN LOCK
-- (Tyson, 2026-07-17, live feedback on 045): "i somehow got given Titan, but
-- my stats are size 57, aesthetics 58, strength 56, cardio 44 — if the top
-- stat is within ±5 of another stat, allow the player to make a decision on
-- who they pick as origin. Ensure the only character that remains equipable
-- from that point is the origin character."
--
-- 1. classify_evo_path v4: the CHOICE test moves to the RAW scores — the
--    numbers the player actually sees. Any evidenced pillar whose raw score
--    sits within 5 points of the evidenced raw maximum joins the choice set
--    (ordered by affinity, the affinity top always included), and a set of
--    more than one is ALWAYS the player's decision. The recommendation and
--    ranking still ride the calibrated affinities of 045 — the variety fix
--    stays; the player just gets the final say whenever their stats are
--    close in their own units. Tyson's own row (58/57/56/44) now offers
--    aesthetic + mass + titan instead of quietly awarding Titan.
-- 2. set_active_champion: ORIGIN LOCKED — once an origin is assigned, the
--    active champion can never be set to a different path. The client locks
--    every equip surface (customise roster, battle select, ghosts, versus
--    snapshots) through the same rule; this seam is the backstop.
-- 3. assign_origin_path stamps the classifier's own version (no hardcode).
-- 4. Accounts that claimed an origin under the 045 margins are reset (run
--    require_origin_reassessment_v3 after applying) so they re-choose under
--    the raw ±5 rule.

create or replace function public.classify_evo_path_for(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; a record;
  v_phase text; v_sex text;
  v_bf numeric; v_bf_date date;
  s_size numeric; s_aes numeric; s_str numeric; s_cnd numeric;
  c_size int; c_aes int; c_str int; c_cnd int;
  v_conf int; v_rating int;
  scores jsonb; affinities jsonb;
  cands jsonb := '[]'::jsonb;
  ranking jsonb; top_raw numeric;
  top_path text; second_path text;
  requires_choice boolean; choices jsonb;
  shredder_auto boolean := false; shredder_eligible boolean := false;
  n_candidates int;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 4);
  end if;

  select * into r from evo_rating_current where user_id = p_user;

  if found and coalesce(r.overall_confidence, 0) >= 30 then
    s_size := r.size_score;     c_size := coalesce(r.size_confidence, 0);
    s_aes  := r.aesthetics_score; c_aes := coalesce(r.aesthetics_confidence, 0);
    s_str  := r.strength_score; c_str  := coalesce(r.strength_confidence, 0);
    s_cnd  := r.cardio_score;   c_cnd  := coalesce(r.cardio_confidence, 0);
    v_conf := r.overall_confidence; v_rating := r.displayed_rating;
  else
    -- SCAN FALLBACK (042/045): the freshest confirmed/pending EvoGuide scan
    -- carries size/aesthetics; strength/cardio ride the rating row's own
    -- confidences — the evidence gate keeps unevidenced pillars out.
    select * into a from physique_assessments
      where user_id = p_user and status in ('confirmed', 'pending_confirmation')
      order by assessment_date desc limit 1;
    if not found then
      if r is null then
        return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 4);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'insufficient_data',
        'confidence', coalesce(r.overall_confidence, 0), 'classification_version', 4);
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

  -- Shredder (045): high body fat + cutting = the journey IS the character.
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
  -- The evidence gate (045): confidence >= 25 or the pillar cannot compete.
  if c_str >= 25 then cands := cands || jsonb_build_array(jsonb_build_object('p', 'titan', 'raw', round(s_str, 1), 'aff', round(s_str - 50, 1))); end if;
  if c_cnd >= 25 then cands := cands || jsonb_build_array(jsonb_build_object('p', 'cardio', 'raw', round(s_cnd, 1), 'aff', round(s_cnd - 48, 1))); end if;
  if c_aes >= 25 then cands := cands || jsonb_build_array(jsonb_build_object('p', 'aesthetic', 'raw', round(s_aes, 1), 'aff', round(s_aes - 60, 1))); end if;
  if c_size >= 25 then cands := cands || jsonb_build_array(jsonb_build_object('p', 'mass', 'raw', round(s_size, 1), 'aff', round(s_size - 52, 1))); end if;

  select count(*) into n_candidates from jsonb_array_elements(cands);
  if n_candidates = 0 and not shredder_auto then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_data',
      'confidence', v_conf, 'classification_version', 4);
  end if;

  select jsonb_agg(e->>'p' order by (e->>'aff')::numeric desc, e->>'p') into ranking
    from jsonb_array_elements(cands) e;

  if shredder_auto then
    top_path := 'shredder';
    requires_choice := false;
    choices := jsonb_build_array('shredder');
    select e->>'p' into second_path from jsonb_array_elements(cands) e
      order by (e->>'aff')::numeric desc, e->>'p' limit 1;
  else
    -- Recommended: the affinity top (the 045 variety fix).
    select e->>'p' into top_path from jsonb_array_elements(cands) e
      order by (e->>'aff')::numeric desc, e->>'p' limit 1;
    select e->>'p' into second_path from jsonb_array_elements(cands) e
      order by (e->>'aff')::numeric desc, e->>'p' offset 1 limit 1;
    -- THE RAW ±5 RULE: every evidenced pillar within 5 raw points of the
    -- evidenced raw maximum joins the choice set (the affinity top always
    -- does). More than one member -> the PLAYER decides.
    select max((e->>'raw')::numeric) into top_raw from jsonb_array_elements(cands) e;
    select jsonb_agg(p order by aff desc, p) into choices from (
      select distinct e->>'p' as p, (e->>'aff')::numeric as aff
        from jsonb_array_elements(cands) e
        where (e->>'raw')::numeric >= top_raw - 5 or e->>'p' = top_path
    ) t;
    requires_choice := jsonb_array_length(choices) > 1;
  end if;

  return jsonb_build_object(
    'ok', true, 'recommended_path', top_path, 'secondary_path', second_path,
    'scores', scores, 'affinities', affinities, 'ranking', coalesce(ranking, '[]'::jsonb),
    'confidence', v_conf, 'requires_choice', requires_choice, 'choices', choices,
    'shredder_eligible', shredder_eligible, 'shredder_auto', shredder_auto,
    'evo_rating', v_rating, 'classification_version', 4
  );
end; $$;

-- assign_origin_path: stamp the classifier's version, keep 042/045 semantics.
create or replace function public.assign_origin_path(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cls jsonb; allowed boolean; prev jsonb; existing_origin text; v_stage int; v_ver int;
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
  v_ver := coalesce((cls->>'classification_version')::int, 4);

  select jsonb_build_object('origin_path', origin_path, 'active_path', active_path, 'migration_status', migration_status)
    into prev from profile where user_id = me limit 1;

  insert into evo_assessments (user_id, overall_evo_rating, strength_score, cardio_score, aesthetics_score, size_score,
                               recommended_path, secondary_path, confidence, classification_version, raw_input_snapshot)
  values (me, (cls->>'evo_rating')::int, (cls->'scores'->>'titan')::numeric, (cls->'scores'->>'cardio')::numeric,
          (cls->'scores'->>'aesthetic')::numeric, (cls->'scores'->>'mass')::numeric,
          cls->>'recommended_path', cls->>'secondary_path', (cls->>'confidence')::int, v_ver, cls);

  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- EQUIP the origin (042): the champion appears on the podium.
  update profile set
    origin_path = p_path, origin_assigned_at = now(), origin_assignment_version = v_ver,
    migration_status = 'classified', active_path = p_path, active_stage = coalesce(v_stage, 1)
  where user_id = me;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, v_ver, prev, jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path_v4'), 'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1));
end; $$;

-- THE ORIGIN LOCK: the active champion can never leave the origin path.
create or replace function public.set_active_champion(p_path text, p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_max int; v_origin text;
begin
  if me is null then raise exception 'set_active_champion: not signed in.' using errcode='insufficient_privilege'; end if;
  select origin_path into v_origin from profile where user_id = me limit 1;
  if v_origin is not null and p_path <> v_origin then
    return jsonb_build_object('ok', false, 'reason', 'origin_locked', 'origin_path', v_origin);
  end if;
  select current_stage into v_max from user_paths where user_id = me and path = p_path and is_unlocked;
  if v_max is null then return jsonb_build_object('ok', false, 'reason', 'path_not_unlocked'); end if;
  update profile set active_path = p_path, active_stage = least(greatest(p_stage, 1), v_max)
   where user_id = me;
  return jsonb_build_object('ok', true, 'active_path', p_path, 'active_stage', least(greatest(p_stage, 1), v_max));
end; $$;

revoke all on function public.classify_evo_path_for(uuid) from public, anon, authenticated;
revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
revoke all on function public.set_active_champion(text, int) from public, anon, authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
grant execute on function public.set_active_champion(text, int) to authenticated;
