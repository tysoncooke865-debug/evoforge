-- EvoForge 042 — ORIGIN FROM THE SCAN (Tyson, 2026-07-18): "when EvoGuide is
-- run, the player is given their origin character, and it appears on the home
-- screen." Two changes:
--   1. classify_evo_path falls back to the LATEST physique assessment when the
--      rating's overall confidence is below the gate — the scan the player
--      just took IS the evidence (size/aesthetics from the scan; strength/
--      cardio from whatever training data exists, else the scan mean).
--   2. assign_origin_path now EQUIPS the origin (active_path/active_stage set
--      unconditionally) — Tyson's amendment over the earlier never-auto-equip:
--      the origin champion must appear on the podium immediately.

create or replace function public.classify_evo_path() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r record; a record;
  v_phase text;
  s_size numeric; s_aes numeric; s_str numeric; s_cnd numeric; v_conf int; v_rating int;
  scores jsonb;
  top_path text; top_score numeric; second_path text; second_score numeric;
  spread numeric; requires_choice boolean; choices jsonb;
begin
  if me is null then raise exception 'classify_evo_path: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into r from evo_rating_current where user_id = me;

  if found and coalesce(r.overall_confidence, 0) >= 30 then
    s_size := r.size_score; s_aes := r.aesthetics_score; s_str := r.strength_score; s_cnd := r.cardio_score;
    v_conf := r.overall_confidence; v_rating := r.displayed_rating;
  else
    -- SCAN FALLBACK: the freshest confirmed/pending EvoGuide scan carries the
    -- classification when the rating is not yet confident.
    select * into a from physique_assessments
      where user_id = me and status in ('confirmed', 'pending_confirmation')
      order by assessment_date desc limit 1;
    if not found then
      if r is null then
        return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 2);
      end if;
      return jsonb_build_object('ok', false, 'reason', 'insufficient_data', 'confidence', coalesce(r.overall_confidence,0), 'classification_version', 2);
    end if;
    s_size := a.size_score; s_aes := a.aesthetics_score;
    -- training pillars from the rating when present, else neutral mid.
    s_str := coalesce(r.strength_score, (a.size_score + a.aesthetics_score) / 2);
    s_cnd := coalesce(r.cardio_score, (a.size_score + a.aesthetics_score) / 2);
    v_conf := greatest(coalesce(r.overall_confidence, 0), 30);
    v_rating := coalesce(r.displayed_rating, round((s_size + s_aes) / 2)::int);
  end if;

  select nutrition_phase into v_phase from profile where user_id = me limit 1;

  scores := jsonb_build_object(
    'titan', round(s_str, 1), 'cardio', round(s_cnd, 1),
    'aesthetic', round(s_aes, 1), 'mass', round(s_size, 1)
  );
  select k, v::numeric into top_path, top_score from jsonb_each_text(scores) as t(k, v) order by v::numeric desc, k limit 1;
  select k, v::numeric into second_path, second_score from jsonb_each_text(scores) as t(k, v) order by v::numeric desc, k offset 1 limit 1;
  select max(v::numeric) - min(v::numeric) into spread from jsonb_each_text(scores) as t(k, v);

  if spread <= 8 then
    requires_choice := true;
    choices := (select jsonb_agg(k order by v::numeric desc) from jsonb_each_text(scores) as t(k, v));
  elsif top_score - second_score <= 5 then
    requires_choice := true; choices := jsonb_build_array(top_path, second_path);
  else
    requires_choice := false; choices := jsonb_build_array(top_path);
  end if;

  return jsonb_build_object(
    'ok', true, 'recommended_path', top_path, 'secondary_path', second_path,
    'scores', scores, 'confidence', v_conf, 'requires_choice', requires_choice,
    'choices', choices, 'shredder_eligible', coalesce(v_phase, '') = 'cutting',
    'evo_rating', v_rating, 'classification_version', 2
  );
end; $$;

-- assignment now EQUIPS the origin champion.
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
          cls->>'recommended_path', cls->>'secondary_path', (cls->>'confidence')::int, 2, cls);

  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- EQUIP the origin (Tyson 2026-07-18): the champion appears on the podium.
  update profile set
    origin_path = p_path, origin_assigned_at = now(), origin_assignment_version = 2,
    migration_status = 'classified', active_path = p_path, active_stage = coalesce(v_stage, 1)
  where user_id = me;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, 2, prev, jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path_v2'), 'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1));
end; $$;

revoke all on function public.classify_evo_path() from public, anon, authenticated;
revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
grant execute on function public.classify_evo_path() to authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
