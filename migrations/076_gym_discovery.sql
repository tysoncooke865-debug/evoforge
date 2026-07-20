-- EvoForge 076 — GYMS: retire join-by-code → ONLINE DISCOVERY (Tyson, 2026-07-20).
--
-- Last code-based join in the app. Same conversion as friends (073): drop the
-- 6-char join_code; gyms are found by BROWSE/SEARCH (discover_gyms) and joined by
-- id, or via a shareable gym LINK (share_token) for private crews. Gym-vs-gym
-- battles pick the opponent by id (from the browse list), not a code.
--
-- Privacy: gyms gain `is_public` DEFAULT TRUE — unlike profiles (private by
-- default), a gym is a group people are meant to find, and today gyms have no
-- privacy concept, so nothing regresses. A private crew flips it off and shares
-- the link (the token authorises the join, like 073's request_friend token).
--
-- FALSIFICATION:
--  1. create_gym returns a share_token, no join_code; the column is gone.
--  2. discover_gyms lists PUBLIC gyms by name; a private gym never appears.
--  3. join_gym_by_id: public gym joins; private gym joins ONLY with its token.
--  4. join_gym(text) and the legacy gym_battle(uuid,text) no longer exist.

alter table public.gyms add column if not exists is_public   boolean not null default true;
alter table public.gyms add column if not exists share_token uuid    not null default gen_random_uuid();

-- create: no code any more; hand back the share token for the invite link.
create or replace function public.create_gym(p_name text, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nm text := btrim(coalesce(p_name,'')); gid uuid; tok uuid;
begin
  if me is null then raise exception 'create_gym: not signed in.' using errcode='insufficient_privilege'; end if;
  if char_length(nm) < 3 or char_length(nm) > 30 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  if (select count(*) from gyms where owner_id = me) >= 3 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  insert into gyms(name, description, owner_id) values (nm, nullif(btrim(coalesce(p_description,'')),''), me)
    returning id, share_token into gid, tok;
  insert into gym_members(gym_id, user_id, role) values (gid, me, 'owner');
  return jsonb_build_object('ok', true, 'gym_id', gid, 'share_token', tok::text);
end; $$;

-- join by ID. Joinable if the gym is PUBLIC, or the caller presents its share
-- token (they opened its link). Keeps the 30-member cap + already-member shortcut.
create or replace function public.join_gym_by_id(p_gym uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g gyms%rowtype;
begin
  if me is null then raise exception 'join_gym_by_id: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into g from gyms where id = p_gym;
  if g.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public.is_gym_member(p_gym, me) then return jsonb_build_object('ok', true, 'gym_id', p_gym, 'already', true); end if;
  if not (g.is_public or (p_token is not null and g.share_token::text = p_token)) then
    return jsonb_build_object('ok', false, 'reason', 'not_addressable');
  end if;
  if (select count(*) from gym_members where gym_id = p_gym) >= 30 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into gym_members(gym_id, user_id, role) values (p_gym, me, 'member') on conflict do nothing;
  return jsonb_build_object('ok', true, 'gym_id', p_gym);
end; $$;
grant execute on function public.join_gym_by_id(uuid, text) to authenticated;

-- browse/search PUBLIC gyms (the discovery surface). Game-safe fields only —
-- strictly less than gym_detail exposes to members; owner NAME is already public.
create or replace function public.discover_gyms(p_query text default '', p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := lower(btrim(coalesce(p_query,''))); lim int := least(greatest(coalesce(p_limit,20),1),40);
begin
  if me is null then raise exception 'discover_gyms: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select g.id as gym_id, g.name, g.description,
             coalesce(pp.display_name, 'Athlete') as owner_name,
             (select count(*) from gym_members m where m.gym_id = g.id) as member_count,
             (select count(*) from gym_members m where m.gym_id = g.id) >= 30 as is_full,
             public.is_gym_member(g.id, me) as is_member,
             (select coalesce(sum(coalesce(evo.displayed_rating,0)),0) from gym_members m
                left join evo_rating_current evo on evo.user_id = m.user_id where m.gym_id = g.id) as roster_power
      from gyms g left join public_profile pp on pp.user_id = g.owner_id
      where g.is_public and (q = '' or lower(g.name) like '%'||q||'%')
      order by (select count(*) from gym_members m where m.gym_id = g.id) desc, g.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.discover_gyms(text, int) to authenticated;

-- owner toggles gym visibility (public = browsable; private = link-only).
create or replace function public.set_gym_public(p_gym uuid, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_owner uuid;
begin
  if me is null then raise exception 'set_gym_public: not signed in.' using errcode='insufficient_privilege'; end if;
  select owner_id into v_owner from gyms where id = p_gym;
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_owner <> me then return jsonb_build_object('ok', false, 'reason', 'not_owner'); end if;
  update gyms set is_public = coalesce(p_public, is_public) where id = p_gym;
  return jsonb_build_object('ok', true, 'is_public', p_public);
end; $$;
grant execute on function public.set_gym_public(uuid, boolean) to authenticated;

-- the caller's gym share token (members only) for building the invite link.
create or replace function public.my_gym_share_token(p_gym uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); tok uuid;
begin
  if me is null then raise exception 'my_gym_share_token: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_gym, me) then return null; end if;
  select share_token into tok from gyms where id = p_gym;
  return tok::text;
end; $$;
grant execute on function public.my_gym_share_token(uuid) to authenticated;

-- my_gyms + gym_detail: drop join_code, expose is_public (owner toggle later).
create or replace function public.my_gyms()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_gyms: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select g.id as gym_id, g.name, g.description, g.is_public, g.created_at, gm.role as my_role,
             (select count(*) from gym_members m where m.gym_id = g.id) as member_count
      from gyms g join gym_members gm on gm.gym_id = g.id and gm.user_id = me
    ) t
  ), '[]'::jsonb);
end; $$;

create or replace function public.gym_detail(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g gyms%rowtype; my_role text;
begin
  if me is null then raise exception 'gym_detail: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_gym, me) then return jsonb_build_object('ok', true, 'can_view', false); end if;
  select * into g from gyms where id = p_gym;
  select role into my_role from gym_members where gym_id = p_gym and user_id = me;
  return jsonb_build_object(
    'ok', true, 'can_view', true,
    'gym', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'is_public', g.is_public, 'my_role', my_role,
      'roster_power', (select coalesce(sum(coalesce(evo.displayed_rating,0)),0) from gym_members m left join evo_rating_current evo on evo.user_id = m.user_id where m.gym_id = p_gym)),
    'members', coalesce((
      select jsonb_agg(row_to_json(t) order by t.role desc, t.forge_level desc nulls last) from (
        select m.user_id, coalesce(pp.display_name, 'Athlete') as display_name, m.role,
               public.forge_level_for_xp(coalesce(up.lifetime_xp,0)) as forge_level,
               case when coalesce(pp.show_evo, true) then evo.displayed_rating else null end as evo_rating
        from gym_members m
        left join public_profile pp on pp.user_id = m.user_id
        left join user_progression up on up.user_id = m.user_id
        left join evo_rating_current evo on evo.user_id = m.user_id
        where m.gym_id = p_gym
      ) t
    ), '[]'::jsonb),
    'battles', coalesce((
      select jsonb_agg(row_to_json(b) order by b.created_at desc) from (
        select gb.id, gb.a_gym, gb.b_gym, gb.a_score, gb.b_score, gb.winner_gym, gb.created_at,
               ga.name as a_name, gbn.name as b_name
        from gym_battles gb join gyms ga on ga.id = gb.a_gym join gyms gbn on gbn.id = gb.b_gym
        where gb.a_gym = p_gym or gb.b_gym = p_gym
        order by gb.created_at desc limit 10
      ) b
    ), '[]'::jsonb)
  );
end; $$;

-- gym-vs-gym battle: opponent BY ID (from the browse list), not a code.
create or replace function public.gym_battle_prepare(p_my_gym uuid, p_opponent uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); opp_name text; my_name text;
begin
  if me is null then raise exception 'gym_battle_prepare: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_my_gym, me) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  select name into opp_name from gyms where id = p_opponent;
  if opp_name is null then return jsonb_build_object('ok', false, 'reason', 'opponent_not_found'); end if;
  if p_opponent = p_my_gym then return jsonb_build_object('ok', false, 'reason', 'same_gym'); end if;
  if (select count(*) from gym_battles where a_gym = p_my_gym and created_at > now() - interval '30 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select name into my_name from gyms where id = p_my_gym;
  return jsonb_build_object(
    'ok', true, 'opponent_gym', p_opponent, 'opponent_name', opp_name, 'my_name', my_name,
    'seed', (floor(random() * 2000000000))::bigint,
    'my_roster', public.gym_roster_combat(p_my_gym),
    'opp_roster', public.gym_roster_combat(p_opponent)
  );
end; $$;
grant execute on function public.gym_battle_prepare(uuid, uuid) to authenticated;

-- Retire the code paths (now that nothing references join_code).
drop function if exists public.join_gym(text);
drop function if exists public.gym_battle(uuid, text);          -- legacy, superseded by prepare/record
drop function if exists public.gym_battle_prepare(uuid, text);  -- old by-code signature
alter table public.gyms drop column if exists join_code;
