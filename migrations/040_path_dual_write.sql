-- EvoForge 040 — ORIGIN PATH Release 2: dual-write seams (2026-07-17).
--
-- Today a path's stage is DERIVED client-side (level + body fat →
-- currentStageFor). Release 2 mirrors that derived truth into user_paths so
-- the new schema accumulates real state while legacy stays the read path
-- (ORIGIN_PATH_PLAN.md). Writes are MONOTONIC (never lower a stage) and
-- bounded (1..4, known path), so the client mirror cannot regress anything
-- and adds no new attack surface — the client already fully controls its own
-- displayed stage today; Release 3's backfill recomputes from real data.

-- Mirror the caller's CURRENT derived stage for a path they are playing.
create or replace function public.record_path_progress(p_path text, p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'record_path_progress: not signed in.' using errcode='insufficient_privilege'; end if;
  if not exists (select 1 from paths where slug = p_path and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_path');
  end if;
  if p_stage < 1 or p_stage > 4 then
    return jsonb_build_object('ok', false, 'reason', 'bad_stage');
  end if;
  insert into user_paths (user_id, path, unlock_source, current_stage)
  values (me, p_path, 'legacy_migration', p_stage)
  on conflict (user_id, path) do update
    set current_stage = greatest(user_paths.current_stage, excluded.current_stage),
        is_unlocked = true,
        updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- Mirror the equipped champion (path + stage) onto the profile. The stage is
-- clamped to what user_paths holds for that path (record progress first).
create or replace function public.set_active_champion(p_path text, p_stage int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_max int;
begin
  if me is null then raise exception 'set_active_champion: not signed in.' using errcode='insufficient_privilege'; end if;
  select current_stage into v_max from user_paths where user_id = me and path = p_path and is_unlocked;
  if v_max is null then return jsonb_build_object('ok', false, 'reason', 'path_not_unlocked'); end if;
  update profile set active_path = p_path, active_stage = least(greatest(p_stage, 1), v_max)
   where user_id = me;
  return jsonb_build_object('ok', true, 'active_path', p_path, 'active_stage', least(greatest(p_stage, 1), v_max));
end; $$;

revoke all on function public.record_path_progress(text, int) from public, anon, authenticated;
revoke all on function public.set_active_champion(text, int) from public, anon, authenticated;
grant execute on function public.record_path_progress(text, int) to authenticated;
grant execute on function public.set_active_champion(text, int) to authenticated;
