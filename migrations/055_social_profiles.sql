-- EvoForge 055 — PUBLIC PROFILES, DISCOVERY + FIELD PRIVACY (Tyson, 2026-07-19).
--
-- The deferred half of Social: tap an athlete → their profile; a Discover list
-- of public athletes to add; and per-field privacy so an athlete controls what
-- a profile viewer sees. Same posture as 036/049 — base tables stay owner-only
-- RLS, every cross-user read goes through a SECURITY DEFINER RPC that enforces
-- visibility. The RPCs run as owner (bypassing RLS) but each one re-derives the
-- viewer with auth.uid() and gates every sensitive field behind an explicit
-- opt-in flag, so the definer privilege can never leak more than intended.
--
-- Privacy model (all on public_profile, which already carries is_public):
--   is_public      — profile viewable by NON-friends (existing; also leaderboard)
--   discoverable   — appears in the Discover athletes list (default OFF)
--   show_evo       — expose Forge Level + Evo pillar scores (default ON: game stats)
--   show_lifts     — expose bench/squat/deadlift e1rm (default OFF: exact weights)
--   show_bodyweight— expose bodyweight (default OFF: sensitive)
-- A profile is viewable when: it's yours, you're friends, OR is_public. Friends
-- always see identity + rival record + your visible posts; the show_* flags gate
-- only the stat blocks, for friends and strangers alike.

alter table public.public_profile add column if not exists discoverable    boolean not null default false;
alter table public.public_profile add column if not exists show_evo        boolean not null default true;
alter table public.public_profile add column if not exists show_lifts       boolean not null default false;
alter table public.public_profile add column if not exists show_bodyweight  boolean not null default false;

-- Rival record for the canonical pair (me, other), mapped to the viewer's side.
-- Returns (my_wins, their_wins, draws). Helper for the profile RPC only.
create or replace function public.rival_record(p_me uuid, p_other uuid)
returns table(my_wins int, their_wins int, draws int)
language sql stable security definer set search_path = public as $$
  select
    case when p_me < p_other then coalesce(r.a_wins,0) else coalesce(r.b_wins,0) end,
    case when p_me < p_other then coalesce(r.b_wins,0) else coalesce(r.a_wins,0) end,
    coalesce(r.draws,0)
  from (select 1) one
  left join rivalries r
    on r.user_a = (public.evo_pair(p_me, p_other))[1]
   and r.user_b = (public.evo_pair(p_me, p_other))[2];
$$;
revoke all on function public.rival_record(uuid, uuid) from public, anon, authenticated;

-- An athlete's public profile as the viewer is allowed to see it. Every stat
-- block is null unless the owner opted in; `can_view` is false (with identity
-- withheld) when the viewer may not see the profile at all.
create or replace function public.public_athlete_profile(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v_friends boolean;
  v_self boolean;
  v_public boolean;
  v_can boolean;
  pp public_profile%rowtype;
  ap avatar_progression%rowtype;
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

  -- Latest progression snapshot (owner-only table; definer bypasses RLS).
  select * into ap from avatar_progression where user_id = p_user
    order by "timestamp" desc nulls last, id desc limit 1;
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
    'forge_level', coalesce(ap.level, pr.base_level),
    'rival', jsonb_build_object('my_wins', rec.my_wins, 'their_wins', rec.their_wins, 'draws', rec.draws),
    'post_count', (
      select count(*) from social_posts sp
      where sp.author_id = p_user and sp.deleted_at is null
        and (sp.author_id = me or sp.visibility = 'public'
             or (sp.visibility = 'friends' and v_friends))
    ),
    -- Gated stat blocks: null unless the owner opted in (or it's your own profile).
    'evo', case when coalesce(pp.show_evo, true) or v_self then jsonb_build_object(
        'rank', ap.rank,
        'class', ap.character_class,
        'path', pr.active_path,
        'pillars', jsonb_build_array(
          jsonb_build_object('label','STRENGTH','value', coalesce(ap.strength_score,0)),
          jsonb_build_object('label','SIZE','value', coalesce(ap.size_score,0)),
          jsonb_build_object('label','CONDITION','value', coalesce(ap.conditioning_score,0)),
          jsonb_build_object('label','LEANNESS','value', coalesce(ap.leanness_score,0)),
          jsonb_build_object('label','AESTHETIC','value', coalesce(ap.aesthetic_score,0))
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
end; $$;

-- One athlete's posts the viewer may see (own + friends-visible + public),
-- newest first, keyset by created_at — the social_feed row shape, one author.
create or replace function public.athlete_posts(p_user uuid, p_before timestamptz default null, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,20),1),40); v_friends boolean;
begin
  if me is null then raise exception 'athlete_posts: not signed in.' using errcode='insufficient_privilege'; end if;
  v_friends := public.are_friends(me, p_user);
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select sp.id, sp.author_id,
             coalesce(pp.display_name, 'Athlete') as author_name,
             null::int as author_stage,
             sp.post_type, sp.visibility, sp.caption, sp.payload, sp.created_at,
             (select count(*) from social_reactions r where r.post_id = sp.id) as reaction_count,
             (select count(*) from social_comments c where c.post_id = sp.id and c.deleted_at is null) as comment_count,
             (select r.kind from social_reactions r where r.post_id = sp.id and r.user_id = me) as my_reaction,
             (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                from (select kind k, count(*) n from social_reactions r where r.post_id = sp.id group by kind) x) as reactions_by_kind
      from social_posts sp
      left join public_profile pp on pp.user_id = sp.author_id
      where sp.author_id = p_user and sp.deleted_at is null
        and (p_before is null or sp.created_at < p_before)
        and (sp.author_id = me or sp.visibility = 'public' or (sp.visibility = 'friends' and v_friends))
      order by sp.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

-- Discover: public + discoverable athletes the viewer isn't already friends with
-- (and isn't themselves). Newest-active first. Evo rank/level shown when opted in.
create or replace function public.discover_athletes(p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,30),1),50);
begin
  if me is null then raise exception 'discover_athletes: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select pp.user_id, pp.display_name,
             case when pp.show_evo then coalesce(ap.level, pr.base_level) else null end as forge_level,
             case when pp.show_evo then ap.rank else null end as rank
      from public_profile pp
      left join lateral (
        select level, rank from avatar_progression a
        where a.user_id = pp.user_id order by a."timestamp" desc nulls last, a.id desc limit 1
      ) ap on true
      left join profile pr on pr.user_id = pp.user_id
      where pp.is_public and pp.discoverable and pp.user_id <> me
        and not public.are_friends(me, pp.user_id)
      order by pp.updated_at desc nulls last
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

-- Owner reads / updates their own privacy flags. NULLs leave a field unchanged.
create or replace function public.set_privacy(
  p_is_public boolean default null, p_discoverable boolean default null,
  p_show_evo boolean default null, p_show_lifts boolean default null, p_show_bodyweight boolean default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'set_privacy: not signed in.' using errcode='insufficient_privilege'; end if;
  insert into public_profile (user_id) values (me) on conflict (user_id) do nothing;
  update public_profile set
    is_public       = coalesce(p_is_public, is_public),
    discoverable    = coalesce(p_discoverable, discoverable),
    show_evo        = coalesce(p_show_evo, show_evo),
    show_lifts      = coalesce(p_show_lifts, show_lifts),
    show_bodyweight = coalesce(p_show_bodyweight, show_bodyweight),
    updated_at      = now()
  where user_id = me;
  return (select jsonb_build_object('ok', true, 'is_public', is_public, 'discoverable', discoverable,
    'show_evo', show_evo, 'show_lifts', show_lifts, 'show_bodyweight', show_bodyweight)
    from public_profile where user_id = me);
end; $$;

-- Friend request BY USER ID (the code path is 036's send_friend_request; this
-- is the discovery/profile path — you already see the athlete, so the id is a
-- fair handle). Auto-accepts a reciprocal pending request; guards self and
-- existing friendship. Only PUBLIC/discoverable OR already-pending targets are
-- addressable, so a stranger's id can't be probed into a spam channel.
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
  -- Addressable only if the target is publicly discoverable, or already invited me.
  select coalesce((select is_public and discoverable from public_profile where user_id = p_user), false)
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

grant execute on function public.public_athlete_profile(uuid) to authenticated;
grant execute on function public.athlete_posts(uuid, timestamptz, int) to authenticated;
grant execute on function public.discover_athletes(int) to authenticated;
grant execute on function public.set_privacy(boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.request_friend(uuid) to authenticated;
