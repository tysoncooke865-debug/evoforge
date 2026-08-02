-- EvoForge 132 — the `evolution_path_beta` flag, on the EXISTING framework.
--
-- Migration 104 already shipped a real flag system: command_flags (enabled,
-- rollout_pct, sticky assignments) plus command_assign_variant(), which is
-- already granted to `authenticated`. This file seeds one row and adds the
-- one thing the athlete-facing app was missing: a way to ask "is this flag
-- on for ME?" without being able to read the flag table (command_* is
-- founder-only RLS, and that stays true).
--
-- No second flag system. The build-constant kill switch in
-- client/src/data/progression/features.ts is the OTHER half — it can pull
-- the UI without a database round trip if the remote layer ever misbehaves.
--
-- Requires 104, 130, 131.

begin;

-- VARIANTS MATTER HERE. The table default is [{"key":"control","weight":100}],
-- so a flag left on the default assigns literally everyone "control" and can
-- never read as on. This flag is a plain boolean rollout: one variant, "beta".
insert into public.command_flags (key, label, description, enabled, rollout_pct, variants, owner, internal_only)
values (
  'evolution_path_beta',
  'Origin Evolution Path (beta)',
  'The Origin Evolution Path replaces the skill tree. OFF and at 0% on purpose: grant it to named beta athletes first, then raise the rollout.',
  false, 0, '[{"key":"beta","weight":100}]'::jsonb, 'product', false)
on conflict (key) do update set
  variants = '[{"key":"beta","weight":100}]'::jsonb,
  description = excluded.description;

/**
 * Is a flag on for the CALLING athlete?
 *
 * Definer, so an athlete never needs read access to command_flags (those
 * tables stay founder-only RLS).
 *
 * ORDER IS THE WHOLE DESIGN:
 *   1. `enabled` is the kill switch. Disabling the flag turns it off for
 *      everyone INCLUDING named testers — otherwise "turn it off" would be a
 *      lie for exactly the people most likely to be mid-session.
 *   2. An explicit sticky assignment wins next. command_assign_variant()
 *      RE-BUCKETS on every call and does not read existing assignments, so
 *      naming a beta cohort has to be honoured here or the grant would be
 *      silently ignored at rollout_pct = 0.
 *   3. Otherwise, normal percentage bucketing.
 *
 * Unknown flag, disabled flag and "no row" all return false: a feature must
 * never appear because a seed was forgotten.
 */
create or replace function public.app_flag_enabled(p_key text)
returns boolean
language plpgsql security definer set search_path = public
stable as $$
declare
  v_user    uuid := auth.uid();
  v_enabled boolean;
  v_variant text;
  v_assign  jsonb;
begin
  if v_user is null then return false; end if;

  select enabled into v_enabled from public.command_flags where key = p_key;
  if not coalesce(v_enabled, false) then return false; end if;

  select variant into v_variant from public.command_flag_assignments
   where flag_key = p_key and subject_kind = 'user' and subject_id = v_user::text;
  if v_variant is not null then return v_variant <> 'control'; end if;

  v_assign := public.command_assign_variant(p_key, v_user::text);
  return coalesce((v_assign ->> 'in_experiment')::boolean, false)
     and coalesce(v_assign ->> 'variant', 'control') <> 'control';
end $$;
grant execute on function public.app_flag_enabled(text) to authenticated;

/**
 * Turn the Evolution Path on for one athlete by email — the beta-cohort
 * tool. Admin-gated, and it writes a sticky assignment rather than raising
 * the rollout percentage, so naming ten testers never exposes an eleventh.
 */
create or replace function public.evolution_path_grant_beta(p_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  if not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;
  select id into v_target from auth.users where lower(email) = lower(p_email);
  if v_target is null then return jsonb_build_object('ok', false, 'reason', 'no_such_user'); end if;

  update public.command_flags set enabled = true, updated_at = now()
   where key = 'evolution_path_beta';

  insert into public.command_flag_assignments (flag_key, subject_kind, subject_id, variant)
  values ('evolution_path_beta', 'user', v_target::text, 'beta')
  on conflict (flag_key, subject_kind, subject_id) do update set variant = 'beta';

  return jsonb_build_object('ok', true, 'user_id', v_target);
end $$;
grant execute on function public.evolution_path_grant_beta(text) to authenticated;

commit;
