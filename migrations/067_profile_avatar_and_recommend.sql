-- EvoForge 067 — another athlete's AVATAR + RECOMMENDED athletes
--
-- Two additive social changes:
--
-- (1) public_athlete_profile() gains the two fields the avatar renderer needs
--     that 063 didn't return: the athlete's active_stage (1–4 sprite stage)
--     and sex (which sprite set). Both ride INSIDE the show_evo-gated `evo`
--     block (same visibility as `path`/`active_path` already there), so a
--     private athlete still exposes nothing. With path+stage+sex the client
--     can draw their champion instead of a letter tile. Everything else is
--     063's body verbatim.
--
-- (2) recommended_athletes() — "suggested friends", ranked by MUTUAL FRIEND
--     count (how many of your friends are also theirs), then recency. Same
--     candidate gate as discover_athletes (public + discoverable + not you +
--     not already a friend), same show_evo gating on rank/forge. Definer, so
--     it may read the owner-only friendships table cross-user; the friend
--     graph itself is never exposed — only a count.
--
-- Falsification (as ALPHA/BRAVO in the app):
--   (a) opening a public athlete who shows Evo draws their avatar (path+stage+
--       sex present); a show_evo=false athlete still shows the letter tile.
--   (b) recommended_athletes ranks an athlete sharing more mutual friends above
--       one sharing fewer; already-friends and private accounts never appear.

create or replace function public.public_athlete_profile(p_user uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    return jsonb_build_object('ok', true, 'can_view', false, 'is_self', false,
      'are_friends', false, 'display_name', coalesce(pp.display_name, 'Athlete'));
  end if;

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
    -- 067: stage + sex added so the client can draw their avatar champion.
    'evo', case when coalesce(pp.show_evo, true) or v_self then jsonb_build_object(
        'rank', evo.displayed_rating,
        'class', evo.evo_class,
        'path', pr.active_path,
        'stage', pr.active_stage,
        'sex', pr.sex,
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
    'privacy', case when v_self then jsonb_build_object(
        'is_public', v_public,
        'discoverable', coalesce(pp.discoverable, false),
        'show_evo', coalesce(pp.show_evo, true),
        'show_lifts', coalesce(pp.show_lifts, false),
        'show_bodyweight', coalesce(pp.show_bodyweight, false)
      ) else null end
  );
end; $function$;

-- (2) Suggested friends, ranked by mutual-friend count then recency.
create or replace function public.recommended_athletes(p_limit integer default 20)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if me is null then raise exception 'recommended_athletes: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      with my_friends as (
        select case when user_a = me then user_b else user_a end as fid
        from friendships where user_a = me or user_b = me
      ),
      candidates as (
        select pp.user_id, pp.display_name, pp.updated_at,
               case when pp.show_evo then public.forge_level_for_xp(coalesce(up.lifetime_xp, 0)) else null end as forge_level,
               case when pp.show_evo then evo.displayed_rating else null end as rank
        from public_profile pp
        left join user_progression up on up.user_id = pp.user_id
        left join evo_rating_current evo on evo.user_id = pp.user_id
        where pp.is_public = true
          and pp.discoverable = true
          and pp.user_id <> me
          and not public.are_friends(me, pp.user_id)
      )
      select c.user_id, c.display_name, c.forge_level, c.rank,
             (select count(*) from friendships f
                join my_friends mf
                  on mf.fid = case when f.user_a = c.user_id then f.user_b else f.user_a end
               where f.user_a = c.user_id or f.user_b = c.user_id) as mutual_count
      from candidates c
      order by (select count(*) from friendships f
                join my_friends mf
                  on mf.fid = case when f.user_a = c.user_id then f.user_b else f.user_a end
               where f.user_a = c.user_id or f.user_b = c.user_id) desc,
               c.updated_at desc nulls last
      limit lim
    ) t
  ), '[]'::jsonb);
end; $function$;

grant execute on function public.recommended_athletes(integer) to authenticated;
