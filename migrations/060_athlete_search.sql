-- EvoForge 060 — ATHLETE SEARCH by username
-- (Tyson's improvement doc §6.3, 2026-07-19).
--
-- The username IS public_profile.display_name (unique per 004's
-- case-insensitive index). Search mirrors discover_athletes' exposure rule
-- EXACTLY: `is_public AND discoverable` — the same gate request_friend
-- enforces, so search can never surface an athlete the ADD button then
-- refuses, and a private athlete never leaks through a probe. Prefix
-- matches rank first, then alphabetical; result shape = discover_athletes
-- so the client renders both with one row component.
--
-- FALSIFICATION CHECKLIST:
--  1. searching a known public+discoverable name (prefix + substring) hits.
--  2. a PRIVATE athlete's exact name returns nothing.
--  3. a 1-char query returns [] (min length 2).
--  4. the caller themselves never appear.

create or replace function public.search_athletes(p_query text, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  q text := lower(trim(coalesce(p_query, '')));
  lim int := least(greatest(coalesce(p_limit, 20), 1), 30);
begin
  if me is null then raise exception 'search_athletes: not signed in.' using errcode='insufficient_privilege'; end if;
  if char_length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select pp.user_id, pp.display_name,
             case when pp.show_evo then coalesce(ap.level, pr.base_level) else null end as forge_level,
             case when pp.show_evo then ap.rank else null end as rank,
             public.are_friends(me, pp.user_id) as is_friend
      from public_profile pp
      left join lateral (
        select level, rank from avatar_progression a
        where a.user_id = pp.user_id order by a."timestamp" desc nulls last, a.id desc limit 1
      ) ap on true
      left join profile pr on pr.user_id = pp.user_id
      where pp.is_public and pp.discoverable and pp.user_id <> me
        and pp.display_name is not null
        and lower(pp.display_name) like '%' || q || '%'
      order by (lower(pp.display_name) like q || '%') desc, lower(pp.display_name) asc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

grant execute on function public.search_athletes(text, int) to authenticated;
