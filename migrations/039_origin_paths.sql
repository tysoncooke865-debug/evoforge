-- EvoForge 039 — ORIGIN PATH foundation (Tyson's spec, 2026-07-17).
-- Release 1 of ORIGIN_PATH_PLAN.md: the data model + the two server seams
-- (classify + atomic award). NO UI change, NO backfill, NO behaviour change
-- for existing users — their loadout keeps reading the legacy fields until
-- Release 2/3. Path ids are the existing SkinLine slugs so art, customise
-- gates and battle sprites keep keying on the same vocabulary.

-- ---- paths (seed, slug-keyed) ----
create table if not exists public.paths (
  slug             text primary key check (slug in ('aesthetic','mass','titan','cardio','shredder')),
  display_name     text not null,
  fitness_category text not null,
  is_active        boolean not null default true
);
insert into public.paths (slug, display_name, fitness_category) values
  ('aesthetic', 'Elite Aesthetic', 'aesthetics'),
  ('mass',      'Mass Monster',    'size'),
  ('titan',     'Titan',           'strength'),
  ('cardio',    'Apex Engine',     'cardio'),
  ('shredder',  'Shredder',        'fat_loss')
on conflict (slug) do update set display_name = excluded.display_name, fitness_category = excluded.fitness_category;

alter table public.paths enable row level security;
drop policy if exists paths_read on public.paths;
create policy paths_read on public.paths for select to authenticated using (true);

-- ---- user_paths: the source of truth for ownership + per-path progression ----
create table if not exists public.user_paths (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path          text not null references public.paths(slug),
  is_unlocked   boolean not null default true,
  unlocked_at   timestamptz not null default now(),
  unlock_source text not null check (unlock_source in ('evo_assessment','legacy_migration','path_quest','admin_grant','purchase','promotion')),
  current_stage integer not null default 1 check (current_stage between 1 and 4),
  path_xp       integer not null default 0,
  skill_points  integer not null default 0,
  is_origin     boolean not null default false,
  updated_at    timestamptz not null default now(),
  unique (user_id, path)
);
create index if not exists user_paths_user_idx on public.user_paths (user_id);
alter table public.user_paths enable row level security;
drop policy if exists user_paths_owner_select on public.user_paths;
create policy user_paths_owner_select on public.user_paths for select to authenticated using (user_id = auth.uid());
-- writes ONLY through definer RPCs (no insert/update policies)

-- ---- evo_assessments: every classified result, never overwritten ----
create table if not exists public.evo_assessments (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  overall_evo_rating     integer,
  strength_score         numeric(8,4),
  cardio_score           numeric(8,4),
  aesthetics_score       numeric(8,4),
  size_score             numeric(8,4),
  recommended_path       text references public.paths(slug),
  secondary_path         text references public.paths(slug),
  confidence             integer,
  classification_version integer not null,
  raw_input_snapshot     jsonb,
  completed_at           timestamptz not null default now()
);
create index if not exists evo_assessments_user_idx on public.evo_assessments (user_id, completed_at desc);
alter table public.evo_assessments enable row level security;
drop policy if exists evo_assessments_owner_select on public.evo_assessments;
create policy evo_assessments_owner_select on public.evo_assessments for select to authenticated using (user_id = auth.uid());

-- ---- migration audit log (per-account repair without a global rollback) ----
create table if not exists public.user_path_migration_log (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  migration_version integer not null,
  previous_state    jsonb,
  new_state         jsonb,
  status            text not null,
  error_message     text,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index if not exists upml_user_idx on public.user_path_migration_log (user_id);
alter table public.user_path_migration_log enable row level security;
drop policy if exists upml_owner_select on public.user_path_migration_log;
create policy upml_owner_select on public.user_path_migration_log for select to authenticated using (user_id = auth.uid());

-- ---- profile columns (legacy loadout stays authoritative until Release 2/3) ----
alter table public.profile add column if not exists origin_path text references public.paths(slug);
alter table public.profile add column if not exists active_path text references public.paths(slug);
alter table public.profile add column if not exists active_stage integer not null default 1;
alter table public.profile add column if not exists origin_assigned_at timestamptz;
alter table public.profile add column if not exists origin_assignment_version integer;
alter table public.profile add column if not exists migration_status text not null default 'pending'
  check (migration_status in ('pending','classified','needs_assessment','migrated','review_required'));

-- ---- classify_evo_path(): THE one deterministic classification (v1) ----
-- Reads evo_rating_current for the caller. Constants per ORIGIN_PATH_PLAN.md:
-- CHOICE_MARGIN 5 · BALANCED_SPREAD 8 · MIN_CONFIDENCE 30. Hybrid is gone —
-- balanced results OFFER A CHOICE. Shredder is goal-eligibility only.
create or replace function public.classify_evo_path() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  r record;
  v_phase text;
  scores jsonb;
  ranked record;
  top_path text; top_score numeric; second_path text; second_score numeric;
  spread numeric; requires_choice boolean; choices jsonb;
begin
  if me is null then raise exception 'classify_evo_path: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into r from evo_rating_current where user_id = me;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_assessment', 'classification_version', 1);
  end if;
  if coalesce(r.overall_confidence, 0) < 30 then
    return jsonb_build_object('ok', false, 'reason', 'insufficient_data', 'confidence', coalesce(r.overall_confidence,0), 'classification_version', 1);
  end if;

  select nutrition_phase into v_phase from profile where user_id = me limit 1;

  scores := jsonb_build_object(
    'titan',     round(r.strength_score, 1),
    'cardio',    round(r.cardio_score, 1),
    'aesthetic', round(r.aesthetics_score, 1),
    'mass',      round(r.size_score, 1)
  );

  select k, v::numeric into top_path, top_score
    from jsonb_each_text(scores) as t(k, v) order by v::numeric desc, k limit 1;
  select k, v::numeric into second_path, second_score
    from jsonb_each_text(scores) as t(k, v) order by v::numeric desc, k offset 1 limit 1;

  select max(v::numeric) - min(v::numeric) into spread from jsonb_each_text(scores) as t(k, v);

  if spread <= 8 then
    requires_choice := true;
    choices := (select jsonb_agg(k order by v::numeric desc) from jsonb_each_text(scores) as t(k, v));
  elsif top_score - second_score <= 5 then
    requires_choice := true;
    choices := jsonb_build_array(top_path, second_path);
  else
    requires_choice := false;
    choices := jsonb_build_array(top_path);
  end if;

  return jsonb_build_object(
    'ok', true,
    'recommended_path', top_path,
    'secondary_path', second_path,
    'scores', scores,
    'confidence', r.overall_confidence,
    'requires_choice', requires_choice,
    'choices', choices,
    'shredder_eligible', coalesce(v_phase, '') = 'cutting',
    'evo_rating', r.displayed_rating,
    'classification_version', 1
  );
end; $$;

-- ---- assign_origin_path(p_path): the ATOMIC award ----
-- Validates the pick against a FRESH classification (recommendation, offered
-- choices, or shredder eligibility). Records the assessment, upserts
-- user_paths (min stage 1, never lowers, is_origin), sets profile origin +
-- active-if-missing, audit-logs. Idempotent: origin already set → no-op.
-- THE ORIGIN NEVER CHANGES.
create or replace function public.assign_origin_path(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cls jsonb; allowed boolean; prev jsonb; existing_origin text;
begin
  if me is null then raise exception 'assign_origin_path: not signed in.' using errcode='insufficient_privilege'; end if;

  select origin_path into existing_origin from profile where user_id = me limit 1;
  if existing_origin is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_assigned', 'origin_path', existing_origin);
  end if;

  cls := classify_evo_path();
  if not (cls->>'ok')::boolean then return jsonb_build_object('ok', false, 'reason', cls->>'reason'); end if;

  allowed := (cls->'choices') ? p_path
             or (p_path = 'shredder' and (cls->>'shredder_eligible')::boolean);
  if not allowed then
    return jsonb_build_object('ok', false, 'reason', 'not_offered', 'choices', cls->'choices');
  end if;

  select jsonb_build_object('origin_path', origin_path, 'active_path', active_path, 'migration_status', migration_status)
    into prev from profile where user_id = me limit 1;

  insert into evo_assessments (user_id, overall_evo_rating, strength_score, cardio_score, aesthetics_score, size_score,
                               recommended_path, secondary_path, confidence, classification_version, raw_input_snapshot)
  values (me, (cls->>'evo_rating')::int,
          (cls->'scores'->>'titan')::numeric, (cls->'scores'->>'cardio')::numeric,
          (cls->'scores'->>'aesthetic')::numeric, (cls->'scores'->>'mass')::numeric,
          cls->>'recommended_path', cls->>'secondary_path', (cls->>'confidence')::int, 1, cls);

  -- min stage 1, NEVER lowers an existing stage (preserve-higher)
  insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
  values (me, p_path, 'evo_assessment', 1, true)
  on conflict (user_id, path) do update
    set is_origin = true, is_unlocked = true, updated_at = now(),
        current_stage = greatest(user_paths.current_stage, 1);

  -- THE DEFAULT IS NOT KEPT (Tyson 2026-07-17, overriding the generic spec's
  -- "never re-lock Elite Aesthetic"): "if their new formula says Titan, they
  -- must lose aesthetic." The old Elite Aesthetic default was a placeholder,
  -- not an earned unlock — origin assignment grants ONLY the assessed path.
  -- EARNED aesthetic progress (stages actually reached, purchases) is still
  -- copied by the Release 3 backfill; the un-earned default grant is not.

  update profile set
    origin_path = p_path,
    origin_assigned_at = now(),
    origin_assignment_version = 1,
    migration_status = 'classified',
    active_path = coalesce(active_path, p_path),
    active_stage = case when active_path is null then 1 else active_stage end
  where user_id = me;

  insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
  values (me, 1, prev, jsonb_build_object('origin_path', p_path, 'via', 'assign_origin_path'), 'ok', now());

  return jsonb_build_object('ok', true, 'origin_path', p_path);
end; $$;

-- grants (the 036 lesson: revoke anon+authenticated EXPLICITLY, then grant back)
revoke all on function public.classify_evo_path() from public, anon, authenticated;
revoke all on function public.assign_origin_path(text) from public, anon, authenticated;
grant execute on function public.classify_evo_path() to authenticated;
grant execute on function public.assign_origin_path(text) to authenticated;
