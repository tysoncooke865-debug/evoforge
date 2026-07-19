-- EvoForge 071 — FINDABLE BY NAME: fix "add a friend" (Tyson, 2026-07-20).
--
-- THE COMPLAINT: "the add/invite by username feature isn't very good — I want to
-- just type someone's display name and have them come up." The plumbing existed
-- (060 search_athletes + the friends typeahead) but its gate was
-- `is_public AND discoverable`, and `discoverable` DEFAULTS OFF (055) with almost
-- nobody flipping it on — so search found nobody and the feature read as broken.
--
-- THE FIX: the real "I am findable" opt-in is `is_public` (004 — it already gates
-- the leaderboard and whether a non-friend can view your profile). Drop the
-- `discoverable` requirement from BOTH the search gate and the request_friend
-- add gate: if you are public you are on the leaderboard, findable by name, and
-- addable (the recipient still accepts or declines). `discoverable` now means
-- ONLY "also surface me in the passive Discover / Suggested lists" — the narrower
-- control it always should have been. A private athlete (is_public = false) stays
-- invisible to search and unaddressable except via an existing reciprocal invite
-- or the 036 friend code, exactly as before.
--
-- Also modernises the forge_level / rank projection. 060 still read the RETIRED
-- avatar_progression table (the 023–029 progression overhaul moved the truth to
-- user_progression / evo_rating_current), so a hit's LV was stale or null. This
-- mirrors 067's discover/recommend exactly: forge_level_for_xp(lifetime_xp) and
-- evo_rating_current.displayed_rating, both still gated behind show_evo.
--
-- FALSIFICATION (as ALPHA / BRAVO smoke accounts):
--  1. a PUBLIC, NON-discoverable athlete's name now HITS search AND request_friend
--     succeeds (was: nothing surfaced, add refused with not_addressable).
--  2. a PRIVATE athlete (is_public=false): exact name returns [] and request_friend
--     returns not_addressable — unchanged.
--  3. a 1-char query returns []; the caller never appears in their own search.
--  4. a show_evo=false hit returns null forge_level / rank.

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
             case when pp.show_evo then public.forge_level_for_xp(coalesce(up.lifetime_xp, 0)) else null end as forge_level,
             case when pp.show_evo then evo.displayed_rating else null end as rank,
             public.are_friends(me, pp.user_id) as is_friend
      from public_profile pp
      left join user_progression up on up.user_id = pp.user_id
      left join evo_rating_current evo on evo.user_id = pp.user_id
      where pp.is_public and pp.user_id <> me
        and pp.display_name is not null
        and lower(pp.display_name) like '%' || q || '%'
      order by (lower(pp.display_name) like q || '%') desc, lower(pp.display_name) asc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

grant execute on function public.search_athletes(text, int) to authenticated;

-- request_friend: addressable when the target is PUBLIC (findable by name / on
-- the leaderboard), or has already invited me. `discoverable` no longer gates it.
-- Body is 055's verbatim except the addressability probe on line marked below.
create or replace function public.request_friend(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_pair uuid[]; v_ok boolean;
begin
  if me is null then raise exception 'request_friend: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_user is null or p_user = me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  v_pair := evo_pair(me, p_user);
  if exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'already_friends');
  end if;
  -- 071: PUBLIC is the add gate (was is_public AND discoverable). A public athlete
  -- is findable + on the leaderboard, so addressable; the invite still needs accept.
  select coalesce((select is_public from public_profile where user_id = p_user), false)
      or exists (select 1 from friend_requests where from_id = p_user and to_id = me and status='pending')
    into v_ok;
  if not v_ok then return jsonb_build_object('ok', false, 'reason', 'not_addressable'); end if;
  if exists (select 1 from friend_requests where from_id = p_user and to_id = me and status='pending') then
    update friend_requests set status='accepted' where from_id = p_user and to_id = me;
    insert into friendships (user_a, user_b) values (v_pair[1], v_pair[2]) on conflict do nothing;
    return jsonb_build_object('ok', true, 'accepted', true);
  end if;
  insert into friend_requests (from_id, to_id) values (me, p_user)
    on conflict (from_id, to_id) do update set status='pending', created_at=now();
  return jsonb_build_object('ok', true, 'accepted', false);
end; $$;

grant execute on function public.request_friend(uuid) to authenticated;
