-- 047_origin_onboarding.sql — the Origin-in-onboarding program (candidate model v5).
--
-- Docs: docs/ORIGIN_ONBOARDING_SPEC.md · docs/ORIGIN_CALIBRATION_SPEC.md ·
-- docs/ORIGIN_DATA_MODEL.md. Previously deployed migrations are never
-- rewritten; v4 (classify_evo_path / the legacy reveal) stays live beside v5.
--
-- What ships here:
--   1. profile: primary_goal · battle_style · onboarding_flow_version ·
--      firstbound_origin · reforge_granted_at · reforge_used_at (+ write-once guard).
--   2. user_paths monotonic guard (path_xp / current_stage never decrease).
--   3. user_champion_bond (owner SELECT only; definer RPCs are the only writers).
--   4. origin_candidates_compute(jsonb) — the PURE v5 engine, a line-by-line
--      SQL twin of client/src/domain/origin/candidates.ts. Golden fixtures in
--      contracts/fixtures/origin_candidates.json pin the two.
--   5. origin_candidates_for(uuid) — composes the canonical inputs from the
--      SAME rows the Evo Rating consumes (no second assessment system) and
--      calls the pure engine. origin_candidates() is the auth'd wrapper.
--   6. assign_origin_path v5 — advisory-locked, validates against a FRESH
--      server-side candidate generation (or the v4 choice set for legacy
--      callers), and awards atomically: user_paths (preserve-higher),
--      champion bond seed, firstbound (write-once), evo_assessments v5
--      snapshot with followed_recommendation, audit log.
--   7. claim_free_reforge / reforge_origin — one free re-choice after 3
--      valid post-binding workout days, server-proved, never client-counted.
--
-- Rounding: JS Math.round(x) === floor(x + 0.5) (round-half-UP, not
-- half-away-from-zero). Every rounded value below uses floor(x+0.5) so the
-- twins cannot drift on .5 boundaries.

-- ----------------------------------------------------------------------
-- 1. profile columns (all nullable: zero-downtime, no rewrite)
-- ----------------------------------------------------------------------

alter table public.profile
  add column if not exists primary_goal text
    check (primary_goal in ('strength','muscle_gain','fat_loss','cardio','aesthetics')),
  add column if not exists battle_style text
    check (battle_style in ('force','form','flow')),
  add column if not exists onboarding_flow_version integer,
  add column if not exists firstbound_origin text references public.paths(slug),
  add column if not exists reforge_granted_at timestamptz,
  add column if not exists reforge_used_at timestamptz;

-- firstbound + reforge timestamps are WRITE-ONCE regardless of writer
-- (profile is client-writable; the 024 clamp style, not current_user —
-- inside a definer that check is always the owner, the 030 lesson).
create or replace function public.profile_origin_guard()
returns trigger
language plpgsql
as $$
begin
  if old.firstbound_origin is not null then
    new.firstbound_origin := old.firstbound_origin;
  end if;
  if old.reforge_granted_at is not null then
    new.reforge_granted_at := old.reforge_granted_at;
  end if;
  if old.reforge_used_at is not null then
    new.reforge_used_at := old.reforge_used_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_origin_guard_trigger on public.profile;
create trigger profile_origin_guard_trigger
  before update on public.profile
  for each row execute function public.profile_origin_guard();

-- ----------------------------------------------------------------------
-- 2. Origin Mastery monotonic guard (mastery = user_paths.path_xp)
-- ----------------------------------------------------------------------

create or replace function public.user_paths_guard()
returns trigger
language plpgsql
as $$
begin
  new.path_xp := greatest(coalesce(old.path_xp, 0), coalesce(new.path_xp, 0));
  new.current_stage := greatest(coalesce(old.current_stage, 1), coalesce(new.current_stage, 1));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_paths_guard_trigger on public.user_paths;
create trigger user_paths_guard_trigger
  before update on public.user_paths
  for each row execute function public.user_paths_guard();

-- ----------------------------------------------------------------------
-- 3. Champion Bond (permanent, per champion, never decreases)
-- ----------------------------------------------------------------------

create table if not exists public.user_champion_bond (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  champion   text not null
             check (champion in ('aesthetic','titan','apex','shredded','gymerica')),
  bond_xp    integer not null default 0 check (bond_xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, champion)
);

alter table public.user_champion_bond enable row level security;

drop policy if exists user_champion_bond_select_own on public.user_champion_bond;
create policy user_champion_bond_select_own on public.user_champion_bond
  for select using (user_id = auth.uid());
-- NO client insert/update/delete policies: definer RPCs are the only writers
-- (the 030/031 shop pattern).

create or replace function public.user_champion_bond_guard()
returns trigger
language plpgsql
as $$
begin
  new.bond_xp := greatest(coalesce(old.bond_xp, 0), coalesce(new.bond_xp, 0));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_champion_bond_guard_trigger on public.user_champion_bond;
create trigger user_champion_bond_guard_trigger
  before update on public.user_champion_bond
  for each row execute function public.user_champion_bond_guard();

-- ----------------------------------------------------------------------
-- 4. The pure v5 engine — SQL twin of domain/origin/candidates.ts
-- ----------------------------------------------------------------------

create or replace function public.origin_candidates_compute(p_input jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_sex text := case when p_input->>'sex' = 'female' then 'female' else 'male' end;
  v_h numeric; v_bw numeric;
  v_bench numeric; v_squat numeric; v_dead numeric;
  v_bf numeric; v_bf_age numeric;
  v_phase text; v_goal text; v_style text;
  v_phase_goal text;
  v_goal_origin text; v_destined_reason text;
  v_adj text[];
  affs jsonb := '[]'::jsonb;
  ranked jsonb := '[]'::jsonb;
  v_ranked_count int := 0;
  k text; base numeric; ps numeric; pc numeric;
  v_ratio numeric; v_aff numeric; v_bfv numeric; v_ffmi numeric;
  v_shredder_auto boolean := false;
  v_resonant text; v_resonant_reason text; v_resonant_source text;
  v_resonant_aff numeric;
  v_destined text;
  v_anomaly text; v_anomaly_reason text; v_anomaly_aff numeric;
  v_taken text[];
  v_e jsonb;
  v_candidates jsonb;
  v_recommended text;
  v_second jsonb;
  v_style_list text[];
  v_ladder text[] := array['cardio','shredder','mass','titan','aesthetic'];
  pick text;
begin
  -- ---- normalisation (spec §9): invalid values become absent ----------
  v_h     := case when jsonb_typeof(p_input->'heightCm') = 'number'
                  and (p_input->>'heightCm')::numeric > 0
                  then (p_input->>'heightCm')::numeric end;
  v_bw    := case when jsonb_typeof(p_input->'bodyweightKg') = 'number'
                  and (p_input->>'bodyweightKg')::numeric > 0
                  then (p_input->>'bodyweightKg')::numeric end;
  v_bench := case when jsonb_typeof(p_input->'benchE1rm') = 'number'
                  and (p_input->>'benchE1rm')::numeric > 0
                  then (p_input->>'benchE1rm')::numeric end;
  v_squat := case when jsonb_typeof(p_input->'squatE1rm') = 'number'
                  and (p_input->>'squatE1rm')::numeric > 0
                  then (p_input->>'squatE1rm')::numeric end;
  v_dead  := case when jsonb_typeof(p_input->'deadliftE1rm') = 'number'
                  and (p_input->>'deadliftE1rm')::numeric > 0
                  then (p_input->>'deadliftE1rm')::numeric end;
  v_bf    := case when jsonb_typeof(p_input->'bfMid') = 'number'
                  and (p_input->>'bfMid')::numeric > 0
                  and (p_input->>'bfMid')::numeric <= 75
                  then (p_input->>'bfMid')::numeric end;
  v_bf_age := case when jsonb_typeof(p_input->'bfAgeDays') = 'number'
                   and (p_input->>'bfAgeDays')::numeric >= 0
                   then (p_input->>'bfAgeDays')::numeric end;
  v_phase := case when p_input->>'nutritionPhase' in ('cutting','maintaining','bulking','flexible')
                  then p_input->>'nutritionPhase' end;
  v_goal  := case when p_input->>'primaryGoal' in ('strength','muscle_gain','fat_loss','cardio','aesthetics')
                  then p_input->>'primaryGoal' end;
  v_style := case when p_input->>'battleStyle' in ('force','form','flow')
                  then p_input->>'battleStyle' end;

  -- ---- resonance affinities (spec §3): tier E then tier S -------------
  foreach k in array array['titan','cardio','aesthetic','mass'] loop
    base := case k when 'titan' then 50 when 'cardio' then 48
                   when 'aesthetic' then 60 when 'mass' then 52 end;
    ps := case when jsonb_typeof(p_input->'pillars'->k->'score') = 'number'
               then (p_input->'pillars'->k->>'score')::numeric end;
    pc := case when jsonb_typeof(p_input->'pillars'->k->'confidence') = 'number'
               then (p_input->'pillars'->k->>'confidence')::numeric end;
    if ps is not null and ps between 1 and 100
       and pc is not null and pc >= 25 and pc <= 100 then
      affs := affs || jsonb_build_array(
        jsonb_build_object('p', k, 'aff', ps - base, 'src', 'evidence'));
    elsif k = 'titan' and v_bw is not null
          and (v_bench is not null or v_squat is not null or v_dead is not null) then
      select max(r) into v_ratio from (values
        (case when v_bench is not null then v_bench / (v_bw * 1.0) end),
        (case when v_squat is not null then v_squat / (v_bw * 1.4) end),
        (case when v_dead  is not null then v_dead  / (v_bw * 1.6) end)) as t(r)
        where r is not null;
      v_aff := least(20, greatest(-20, (v_ratio - 1.0) * 25));
      affs := affs || jsonb_build_array(
        jsonb_build_object('p', 'titan', 'aff', v_aff, 'src', 'self_report'));
    elsif k = 'mass' and v_h is not null and v_bw is not null then
      v_bfv := coalesce(v_bf,
        (case v_phase when 'cutting' then 22 when 'bulking' then 18 else 20 end)
        + case when v_sex = 'female' then 8 else 0 end);
      -- normalisedFfmi: lean/h² + 6.1·(1.8 − h), the deployed formula.
      v_ffmi := (v_bw * (1 - v_bfv / 100)) / power(v_h / 100, 2)
                + 6.1 * (1.8 - v_h / 100);
      v_aff := least(20, greatest(-20,
        (v_ffmi - case when v_sex = 'female' then 17 else 20 end) * 4));
      affs := affs || jsonb_build_array(
        jsonb_build_object('p', 'mass', 'aff', v_aff, 'src', 'self_report'));
    end if;
    -- cardio and aesthetic have NO self-report tier (spec §3).
  end loop;

  select coalesce(jsonb_agg(e order by (e->>'aff')::numeric desc, e->>'p'), '[]'::jsonb),
         count(*)
    into ranked, v_ranked_count
    from jsonb_array_elements(affs) e;

  -- ---- shredder auto-resonance (v4 rule, unchanged) -------------------
  if v_phase = 'cutting' and v_bf is not null and v_bf_age is not null
     and v_bf_age <= 90
     and v_bf >= (case when v_sex = 'female' then 28 else 20 end) then
    v_shredder_auto := true;
  end if;

  -- ---- 1. RESONANT (spec §4.1) ----------------------------------------
  if v_shredder_auto then
    v_resonant := 'shredder'; v_resonant_reason := 'CUTTING_PHASE_HIGH_BF';
    v_resonant_source := 'rule'; v_resonant_aff := null;
  elsif v_ranked_count > 0 then
    v_e := ranked->0;
    v_resonant := v_e->>'p';
    v_resonant_reason := case v_e->>'p'
      when 'titan' then 'HIGH_RELATIVE_STRENGTH'
      when 'mass' then 'HIGH_MUSCLE_SIZE'
      when 'cardio' then 'HIGH_CARDIO_CAPACITY'
      when 'aesthetic' then 'HIGH_AESTHETIC_BALANCE' end;
    v_resonant_source := v_e->>'src';
    v_resonant_aff := (v_e->>'aff')::numeric;
  else
    v_resonant := case
      when v_goal is not null then
        case v_goal when 'strength' then 'titan' when 'muscle_gain' then 'mass'
                    when 'fat_loss' then 'shredder' when 'cardio' then 'cardio'
                    when 'aesthetics' then 'aesthetic' end
      when v_phase = 'cutting' then 'shredder'
      when v_phase = 'bulking' then 'mass'
      else 'aesthetic' end;
    v_resonant_reason := 'BALANCED_ATHLETE';
    v_resonant_source := 'fallback'; v_resonant_aff := null;
  end if;

  -- ---- 2. DESTINED (spec §4.2) ----------------------------------------
  v_phase_goal := case when v_goal is null then
    case v_phase when 'cutting' then 'fat_loss' when 'bulking' then 'muscle_gain'
                 else 'aesthetics' end end;
  v_goal_origin := case coalesce(v_goal, v_phase_goal)
    when 'strength' then 'titan' when 'muscle_gain' then 'mass'
    when 'fat_loss' then 'shredder' when 'cardio' then 'cardio'
    when 'aesthetics' then 'aesthetic' end;
  v_destined_reason := case when v_goal is not null then
    case v_goal when 'strength' then 'STRENGTH_PRIMARY_GOAL'
                when 'muscle_gain' then 'MUSCLE_GAIN_PRIMARY_GOAL'
                when 'fat_loss' then 'FAT_LOSS_PRIMARY_GOAL'
                when 'cardio' then 'CARDIO_PRIMARY_GOAL'
                when 'aesthetics' then 'AESTHETIC_PRIMARY_GOAL' end
    else 'PHASE_INFERRED_GOAL' end;
  v_adj := case coalesce(v_goal, v_phase_goal, 'aesthetics')
    when 'strength' then array['titan','mass','aesthetic']
    when 'muscle_gain' then array['mass','titan','aesthetic']
    when 'fat_loss' then array['shredder','cardio','aesthetic']
    when 'cardio' then array['cardio','shredder','titan']
    else array['aesthetic','shredder','mass'] end;
  select x into v_destined from unnest(v_adj) x where x <> v_resonant limit 1;

  -- ---- 3. ANOMALY (spec §4.3) ------------------------------------------
  v_taken := array[v_resonant, v_destined];
  v_anomaly := null; v_anomaly_aff := null;
  -- (a) the second-highest tier E/S affinity
  select value into v_second from jsonb_array_elements(ranked)
    where not (value->>'p' = any(v_taken)) limit 1;
  if v_second is not null then
    v_anomaly := v_second->>'p';
    v_anomaly_reason := case v_second->>'p'
      when 'titan' then 'UNTAPPED_STRENGTH'
      when 'mass' then 'UNTAPPED_SIZE'
      when 'cardio' then 'UNTAPPED_CARDIO'
      when 'aesthetic' then 'UNTAPPED_AESTHETICS' end;
    v_anomaly_aff := (v_second->>'aff')::numeric;
  end if;
  -- (b) the stated battle-style preference
  if v_anomaly is null and v_style is not null then
    v_style_list := case v_style
      when 'force' then array['titan','mass']
      when 'form' then array['aesthetic']
      when 'flow' then array['cardio','shredder'] end;
    select x into pick from unnest(v_style_list) x where not (x = any(v_taken)) limit 1;
    if pick is not null then
      v_anomaly := pick;
      v_anomaly_reason := case v_style when 'force' then 'POWER_PLAYSTYLE'
        when 'form' then 'PRECISION_PLAYSTYLE' when 'flow' then 'TEMPO_PLAYSTYLE' end;
    end if;
  end if;
  -- (c) the static diversity ladder — always terminates (5 ≥ 3)
  if v_anomaly is null then
    select x into v_anomaly from unnest(v_ladder) x where not (x = any(v_taken)) limit 1;
    v_anomaly_reason := 'CONTRAST_PATH';
  end if;

  -- ---- payload (spec §6) ------------------------------------------------
  -- score: affinity, one decimal, JS round semantics = floor(x + 0.5).
  -- currentStrengthMatch: floor(50 + aff·2.5 + 0.5) clamped 0..100.
  with vals as (
    select * from (values
      ('resonant', v_resonant, v_resonant_reason, v_resonant_aff),
      ('destined', v_destined, v_destined_reason, null::numeric),
      ('anomaly',  v_anomaly,  v_anomaly_reason,  v_anomaly_aff)
    ) as t(recommendation_type, origin_id, reason, aff)
  )
  select jsonb_agg(jsonb_build_object(
      'originId', origin_id,
      'recommendationType', recommendation_type,
      'score', case when aff is not null then floor(aff * 10 + 0.5) / 10 else 0 end,
      'reasonCodes', jsonb_build_array(reason),
      'currentStrengthMatch', case when aff is not null
        then least(100, greatest(0, floor(50 + aff * 2.5 + 0.5)::int)) else 50 end,
      'goalAlignment', case
        when coalesce(v_goal, v_phase_goal) is null then 50
        when origin_id = v_goal_origin then 100
        when origin_id = any(v_adj[2:3]) then 60
        else 30 end,
      'playstyleAlignment', case
        when v_style is null then 50
        when array_position(case v_style
              when 'force' then array['titan','mass']
              when 'form' then array['aesthetic']
              when 'flow' then array['cardio','shredder'] end, origin_id) = 1 then 100
        when array_position(case v_style
              when 'force' then array['titan','mass']
              when 'form' then array['aesthetic']
              when 'flow' then array['cardio','shredder'] end, origin_id) is not null then 80
        else 40 end
    ) order by case recommendation_type
      when 'resonant' then 1 when 'destined' then 2 else 3 end)
    into v_candidates
    from vals;

  v_recommended := case when v_resonant_source = 'evidence' then v_resonant else v_destined end;

  return jsonb_build_object(
    'version', 5,
    'candidates', v_candidates,
    'recommendedOrigin', v_recommended,
    'requiresChoice', true,
    'resonantSource', v_resonant_source
  );
end;
$$;

-- ----------------------------------------------------------------------
-- 5. Input composition + the auth'd wrapper
-- ----------------------------------------------------------------------

create or replace function public.origin_candidates_for(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record; a record; pr record;
  v_input jsonb;
  v_pillars jsonb := '{}'::jsonb;
  v_bf numeric; v_bf_age int;
  v_result jsonb;
  v_kind text;
  v_scores jsonb;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user', 'candidate_model_version', 5);
  end if;

  select sex, height_cm, bodyweight_kg, bench_e1rm, squat_e1rm, deadlift_e1rm,
         nutrition_phase, primary_goal, battle_style
    into pr from profile where user_id = p_user limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile', 'candidate_model_version', 5);
  end if;

  -- Rating pillars (tier E) — the same row the Evo Rating persists.
  select * into r from evo_rating_current where user_id = p_user;
  if found then
    if r.strength_score is not null then
      v_pillars := v_pillars || jsonb_build_object('titan',
        jsonb_build_object('score', r.strength_score, 'confidence', coalesce(r.strength_confidence, 0)));
    end if;
    if r.cardio_score is not null then
      v_pillars := v_pillars || jsonb_build_object('cardio',
        jsonb_build_object('score', r.cardio_score, 'confidence', coalesce(r.cardio_confidence, 0)));
    end if;
    if r.aesthetics_score is not null then
      v_pillars := v_pillars || jsonb_build_object('aesthetic',
        jsonb_build_object('score', r.aesthetics_score, 'confidence', coalesce(r.aesthetics_confidence, 0)));
    end if;
    if r.size_score is not null then
      v_pillars := v_pillars || jsonb_build_object('mass',
        jsonb_build_object('score', r.size_score, 'confidence', coalesce(r.size_confidence, 0)));
    end if;
  end if;

  -- Scan injection (the 042/046 fallback semantics): a fresh confirmed or
  -- pending scan supplies size/aesthetics when the rating pillar cannot
  -- compete (confidence < 25), at confidence greatest(scan.confidence, 30).
  select * into a from physique_assessments
    where user_id = p_user and status in ('confirmed', 'pending_confirmation')
    order by assessment_date desc limit 1;
  if found then
    if a.size_score is not null
       and coalesce((v_pillars->'mass'->>'confidence')::numeric, 0) < 25 then
      v_pillars := v_pillars || jsonb_build_object('mass',
        jsonb_build_object('score', a.size_score, 'confidence', greatest(coalesce(a.confidence, 30), 30)));
    end if;
    if a.aesthetics_score is not null
       and coalesce((v_pillars->'aesthetic'->>'confidence')::numeric, 0) < 25 then
      v_pillars := v_pillars || jsonb_build_object('aesthetic',
        jsonb_build_object('score', a.aesthetics_score, 'confidence', greatest(coalesce(a.confidence, 30), 30)));
    end if;
  end if;

  -- Body-fat mid + freshness (the shredder rule's source, 046).
  select coalesce(bf_mid, (bf_low + bf_high) / 2),
         current_date - coalesce(date, current_date)
    into v_bf, v_bf_age
    from bodyfat_log
    where user_id = p_user and (bf_mid is not null or (bf_low is not null and bf_high is not null))
    order by "timestamp" desc limit 1;

  v_input := jsonb_build_object(
    'sex', pr.sex,
    'heightCm', pr.height_cm,
    'bodyweightKg', pr.bodyweight_kg,
    'benchE1rm', pr.bench_e1rm,
    'squatE1rm', pr.squat_e1rm,
    'deadliftE1rm', pr.deadlift_e1rm,
    'bfMid', v_bf,
    'bfAgeDays', v_bf_age,
    'nutritionPhase', pr.nutrition_phase,
    'primaryGoal', pr.primary_goal,
    'battleStyle', pr.battle_style,
    'pillars', v_pillars
  );

  v_result := public.origin_candidates_compute(v_input);

  v_kind := case v_result->>'resonantSource'
    when 'evidence' then 'evidence'
    when 'self_report' then 'self_report'
    else case when v_pillars <> '{}'::jsonb then 'mixed' else 'self_report' end end;

  v_scores := jsonb_build_object(
    'titan', case when r is not null then round(coalesce(r.strength_score, 0), 1) end,
    'cardio', case when r is not null then round(coalesce(r.cardio_score, 0), 1) end,
    'aesthetic', case when r is not null then round(coalesce(r.aesthetics_score, 0), 1) end,
    'mass', case when r is not null then round(coalesce(r.size_score, 0), 1) end
  );

  return v_result || jsonb_build_object(
    'ok', true,
    'candidate_model_version', 5,
    'recommended_origin', v_result->>'recommendedOrigin',
    'evo_rating', case when r is not null then r.displayed_rating end,
    'scores', v_scores,
    'input_snapshot_kind', v_kind
  );
end;
$$;

create or replace function public.origin_candidates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'origin_candidates: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return public.origin_candidates_for(me);
end;
$$;

-- ----------------------------------------------------------------------
-- 6. assign_origin_path v5 — atomic, idempotent, advisory-locked
-- ----------------------------------------------------------------------

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

  -- Serialises double-taps and two-device races (the 030/031/044 pattern).
  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path into existing_origin from profile where user_id = me limit 1;
  if existing_origin is not null then
    -- Success-shaped no-op: a retry after a landed bind is a bind.
    return jsonb_build_object('ok', false, 'reason', 'already_assigned', 'origin_path', existing_origin);
  end if;

  -- Validate against a FRESH server-side generation (never the client's
  -- stale render): the v5 candidate set, or the v4 choice set for the
  -- legacy reveal while it survives, or the v4 shredder allowance.
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
    into prev from profile where user_id = me limit 1;

  -- The auditable record (classification_version stamped, never hardcoded).
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

  -- Stage 1 ownership + evolution unlock: preserve-higher, never lower.
  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  -- Champion Bond seed (idempotent).
  insert into user_champion_bond (user_id, champion)
  values (me, v_champion)
  on conflict (user_id, champion) do nothing;

  -- Equip the origin (042 semantics) + Firstbound, written ONCE.
  update profile set
    origin_path = p_path, origin_assigned_at = now(), origin_assignment_version = v_ver,
    migration_status = 'classified', active_path = p_path, active_stage = coalesce(v_stage, 1),
    firstbound_origin = coalesce(firstbound_origin, p_path)
  where user_id = me
  returning firstbound_origin into v_firstbound;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, v_ver, prev,
          jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path_v5',
                             'champion', v_champion, 'followed_recommendation', v_followed),
          'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1),
                            'champion', v_champion, 'firstbound', v_firstbound,
                            'followed_recommendation', v_followed);
end;
$$;

-- ----------------------------------------------------------------------
-- 7. Free Reforge — one re-choice after 3 valid post-binding workout days
-- ----------------------------------------------------------------------

create or replace function public.claim_free_reforge()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_origin text; v_assigned timestamptz; v_granted timestamptz; v_used timestamptz;
  v_days int;
begin
  if me is null then
    raise exception 'claim_free_reforge: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext(me::text));

  select origin_path, origin_assigned_at, reforge_granted_at, reforge_used_at
    into v_origin, v_assigned, v_granted, v_used
    from profile where user_id = me limit 1;
  if v_origin is null then
    return jsonb_build_object('ok', false, 'reason', 'no_origin');
  end if;
  if v_granted is not null then
    return jsonb_build_object('ok', true, 'already_granted', true,
                              'granted_at', v_granted, 'used', v_used is not null);
  end if;

  -- Server-proved: distinct workout days with ≥1 valid set, strictly after
  -- the binding moment. Never client-counted.
  select count(distinct w.date) into v_days
    from workout_log w
    where w.user_id = me and w.weight > 0 and w.reps > 0
      and w."timestamp" > v_assigned;

  if v_days >= 3 then
    update profile set reforge_granted_at = now() where user_id = me;
    return jsonb_build_object('ok', true, 'granted', true, 'days', v_days);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_eligible',
                            'days', v_days, 'days_remaining', 3 - v_days);
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
    from profile where user_id = me limit 1;
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
    -- Keeping your origin never consumes the credit ("keep" is a dismiss).
    return jsonb_build_object('ok', false, 'reason', 'same_origin');
  end if;

  -- Regenerate candidates (now evidence-rich) and validate membership.
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
    into prev from profile where user_id = me limit 1;

  -- The old origin stays collected: its row keeps stage/xp/unlocked.
  update user_paths set is_origin = false, updated_at = now()
   where user_id = me and path = v_origin;
  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);
  select current_stage into v_stage from user_paths where user_id = me and path = p_path;

  insert into user_champion_bond (user_id, champion)
  values (me, v_champion)
  on conflict (user_id, champion) do nothing;

  -- firstbound_origin is untouched (the guard trigger enforces it anyway).
  update profile set
    origin_path = p_path, active_path = p_path, active_stage = coalesce(v_stage, 1),
    origin_assignment_version = 5, migration_status = 'classified',
    reforge_used_at = now()
  where user_id = me;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, 5, prev,
          jsonb_build_object('origin_path', p_path, 'via', 'reforge_origin',
                             'previous_origin', v_origin, 'champion', v_champion),
          'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path, 'stage', coalesce(v_stage, 1),
                            'champion', v_champion, 'previous_origin', v_origin,
                            'firstbound', (select firstbound_origin from profile where user_id = me));
end;
$$;

-- ----------------------------------------------------------------------
-- Grants (the house posture: nothing for public/anon, authenticated only)
-- ----------------------------------------------------------------------

revoke all on function public.origin_candidates_compute(jsonb) from public, anon, authenticated;
revoke all on function public.origin_candidates_for(uuid) from public, anon, authenticated;
revoke all on function public.origin_candidates() from public, anon, authenticated;
revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
revoke all on function public.claim_free_reforge() from public, anon, authenticated;
revoke all on function public.reforge_origin(text) from public, anon, authenticated;
grant execute on function public.origin_candidates() to authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
grant execute on function public.claim_free_reforge() to authenticated;
grant execute on function public.reforge_origin(text) to authenticated;
