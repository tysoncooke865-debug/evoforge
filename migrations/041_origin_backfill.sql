-- EvoForge 041 — ORIGIN PATH Release 3: the existing-user backfill (2026-07-17).
--
-- Idempotent, dry-runnable, admin-only. For every account with no origin yet:
--   confidence >= 30 → auto-assign the TOP-SCORING path as Origin (the spec's
--     existing-user branch assigns the recommendation outright — no choice
--     dialog in a batch), grant Stage 1 preserve-higher, record the
--     assessment, mark 'migrated', audit-log.
--   otherwise → migration_status = 'needs_assessment' (never guess) — the
--     client shows the discover-your-origin banner (Release 5).
-- NEVER touches existing user_paths stages (preserve-higher upsert), never
-- changes an already-set origin, never equips anything (active_path only set
-- if null). Per Tyson's amendment the un-earned aesthetic default is NOT
-- granted alongside a non-aesthetic origin.

create or replace function public.backfill_origin_paths(p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  u record;
  top_path text;
  n_migrated int := 0; n_needs int := 0; n_skipped int := 0;
  by_path jsonb := '{}'::jsonb;
begin
  -- Admin contexts only: a direct DB connection (management API / SQL editor,
  -- no JWT) or service_role. Client JWTs are refused.
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'backfill_origin_paths: admin only.' using errcode='insufficient_privilege';
  end if;

  for u in
    select p.user_id, e.overall_confidence,
           e.strength_score, e.cardio_score, e.aesthetics_score, e.size_score, e.displayed_rating
    from profile p
    left join evo_rating_current e on e.user_id = p.user_id
    where p.origin_path is null
      and p.migration_status in ('pending', 'needs_assessment')
  loop
    if u.overall_confidence is null or u.overall_confidence < 30 then
      n_needs := n_needs + 1;
      if not p_dry_run then
        update profile set migration_status = 'needs_assessment'
          where user_id = u.user_id and migration_status <> 'needs_assessment';
      end if;
      continue;
    end if;

    -- top scorer, deterministic tie-break by slug
    select k into top_path from (values
      ('titan', u.strength_score), ('cardio', u.cardio_score),
      ('aesthetic', u.aesthetics_score), ('mass', u.size_score)
    ) as t(k, v) order by v desc, k limit 1;

    n_migrated := n_migrated + 1;
    by_path := jsonb_set(by_path, array[top_path], to_jsonb(coalesce((by_path->>top_path)::int, 0) + 1));

    if not p_dry_run then
      insert into evo_assessments (user_id, overall_evo_rating, strength_score, cardio_score,
                                   aesthetics_score, size_score, recommended_path, confidence,
                                   classification_version, raw_input_snapshot)
      values (u.user_id, u.displayed_rating, u.strength_score, u.cardio_score,
              u.aesthetics_score, u.size_score, top_path, u.overall_confidence, 1,
              jsonb_build_object('via', 'backfill_v1'));

      insert into user_paths (user_id, path, unlock_source, current_stage, is_origin)
      values (u.user_id, top_path, 'legacy_migration', 1, true)
      on conflict (user_id, path) do update
        set is_origin = true, is_unlocked = true, updated_at = now(),
            current_stage = greatest(user_paths.current_stage, 1);

      update profile set
        origin_path = top_path, origin_assigned_at = now(), origin_assignment_version = 1,
        migration_status = 'migrated',
        active_path = coalesce(active_path, top_path),
        active_stage = case when active_path is null then 1 else active_stage end
      where user_id = u.user_id;

      insert into user_path_migration_log (user_id, migration_version, previous_state, new_state, status, completed_at)
      values (u.user_id, 1, jsonb_build_object('origin_path', null),
              jsonb_build_object('origin_path', top_path, 'via', 'backfill_v1'), 'ok', now());
    end if;
  end loop;

  select count(*) into n_skipped from profile where origin_path is not null or migration_status = 'migrated';

  return jsonb_build_object(
    'dry_run', p_dry_run, 'migrated', n_migrated, 'needs_assessment', n_needs,
    'already_done', n_skipped, 'by_path', by_path
  );
end; $$;

revoke all on function public.backfill_origin_paths(boolean) from public, anon, authenticated;
grant execute on function public.backfill_origin_paths(boolean) to service_role;
