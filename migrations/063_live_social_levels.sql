-- EvoForge 063 — LIVE LEVELS on every social surface
-- (audit A1, Tyson's call: "efficient and actually live", 2026-07-19).
--
-- The social RPCs showed other athletes' levels from avatar_progression —
-- a snapshot table NOTHING writes any more (verified: zero client writes;
-- its only mention is the data-export list). Every viewer saw a level
-- frozen at onboarding. The LIVE sources, already server-maintained:
--
--   forge_level → forge_level_for_xp(user_progression.lifetime_xp),
--                 computed AT READ TIME with 023's pinned SQL curve twin.
--                 NOT the forge_level COLUMN: that cache ratchets via
--                 greatest() and still holds pre-033-exploit inflation
--                 (ALPHA: column 38 vs honest 2) — the falsification of
--                 this very migration caught it.
--   evo rank/class/pillars → evo_rating_current (the review pipeline's
--                 mutable output, peak-ratchet-guarded)
--
-- The profile card's pillar vocabulary moves from the legacy five
-- avatar-stats labels to the four LIVE Evo pillars (the client renders
-- label/value generically; the athlete screen already speaks Evo).
-- avatar_progression itself is untouched (historical rows).
--
-- FALSIFICATION CHECKLIST:
--  1. ALPHA's RPC forge_level == the on-screen forgeProgressFromRow level.
--  2. grant XP (a set) → the RPC value moves WITHOUT any client write.
--  3. BRAVO's discover/search rows show the same live number.
--  4. show_evo=false still nulls rank/level in discover/search.

CREATE OR REPLACE FUNCTION public.public_athlete_profile(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := auth.uid();
  v_friends boolean;
  v_self boolean;
  v_public boolean;
  v_can boolean;
  pp public_profile%rowtype;
  up user_progression%rowtype;
  evo evo_rating_current%rowtype;
  pr profile%rowtype;
  rec record;
begin
  if me is null then raise exception 'public_athlete_profile: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'no_user'); end if;

  v_self := (p_user = me);
  select * into pp from public_profile where user_id = p_user;
  v_public := coalesce(pp.is_public, false);
  v_friends := public.are_friends(me, p_user);
  v_can := v_self or v_friends or v_public;

  if not v_can then
    -- Exists-but-private: report identity-less so the client shows a locked card.
    return jsonb_build_object('ok', true, 'can_view', false, 'is_self', false,
      'are_friends', false, 'display_name', coalesce(pp.display_name, 'Athlete'));
  end if;

  -- 063: LIVE sources. user_progression.forge_level is trigger-recomputed
  -- on every XP grant; evo_rating_current is the review pipeline's live
  -- output. The old avatar_progression snapshot froze levels.
  select * into up from user_progression where user_id = p_user;
  select * into evo from evo_rating_current where user_id = p_user;
  select * into pr from profile where user_id = p_user;
  select * into rec from public.rival_record(me, p_user);

  return jsonb_build_object(
    'ok', true,
    'can_view', true,
    'user_id', p_user,
    'is_self', v_self,
    'are_friends', v_friends,
    'is_public', v_public,
    'display_name', coalesce(pp.display_name, 'Athlete'),
    'member_since', pr.created_at,
    'forge_level', public.forge_level_for_xp(coalesce(up.lifetime_xp, 0)),
    'rival', jsonb_build_object('my_wins', rec.my_wins, 'their_wins', rec.their_wins, 'draws', rec.draws),
    'post_count', (
      select count(*) from social_posts sp
      where sp.author_id = p_user and sp.deleted_at is null
        and (sp.author_id = me or sp.visibility = 'public'
             or (sp.visibility = 'friends' and v_friends))
    ),
    -- Gated stat blocks: null unless the owner opted in (or it's your own profile).
    'evo', case when coalesce(pp.show_evo, true) or v_self then jsonb_build_object(
        'rank', evo.displayed_rating,
        'class', evo.evo_class,
        'path', pr.active_path,
        'pillars', jsonb_build_array(
          jsonb_build_object('label','SIZE','value', coalesce(evo.size_score,0)),
          jsonb_build_object('label','AESTHETICS','value', coalesce(evo.aesthetics_score,0)),
          jsonb_build_object('label','STRENGTH','value', coalesce(evo.strength_score,0)),
          jsonb_build_object('label','CARDIO','value', coalesce(evo.cardio_score,0))
        )
      ) else null end,
    'lifts', case when coalesce(pp.show_lifts, false) or v_self then jsonb_build_object(
        'bench', pr.bench_e1rm, 'squat', pr.squat_e1rm, 'deadlift', pr.deadlift_e1rm, 'unit', 'kg'
      ) else null end,
    'bodyweight', case when coalesce(pp.show_bodyweight, false) or v_self then pr.bodyweight_kg else null end,
    -- The owner's own flags travel back so the profile screen can render the
    -- privacy editor without a second round-trip.
    'privacy', case when v_self then jsonb_build_object(
        'is_public', v_public,
        'discoverable', coalesce(pp.discoverable, false),
        'show_evo', coalesce(pp.show_evo, true),
        'show_lifts', coalesce(pp.show_lifts, false),
        'show_bodyweight', coalesce(pp.show_bodyweight, false)
      ) else null end
  );
end; $function$;

CREATE OR REPLACE FUNCTION public.discover_athletes(p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,30),1),50);
begin
  if me is null then raise exception 'discover_athletes: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select pp.user_id, pp.display_name,
             case when pp.show_evo then public.forge_level_for_xp(coalesce(up.lifetime_xp, 0)) else null end as forge_level,
             case when pp.show_evo then evo.displayed_rating else null end as rank
      from public_profile pp
      left join user_progression up on up.user_id = pp.user_id
      left join evo_rating_current evo on evo.user_id = pp.user_id
      left join profile pr on pr.user_id = pp.user_id
      where pp.is_public and pp.discoverable and pp.user_id <> me
        and not public.are_friends(me, pp.user_id)
      order by pp.updated_at desc nulls last
      limit lim
    ) t
  ), '[]'::jsonb);
end; $function$;

CREATE OR REPLACE FUNCTION public.search_athletes(p_query text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      left join profile pr on pr.user_id = pp.user_id
      where pp.is_public and pp.discoverable and pp.user_id <> me
        and pp.display_name is not null
        and lower(pp.display_name) like '%' || q || '%'
      order by (lower(pp.display_name) like q || '%') desc, lower(pp.display_name) asc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $function$;
