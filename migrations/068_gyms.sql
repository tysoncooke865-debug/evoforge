-- EvoForge 068 — GYMS: player groups with private chat + gym-vs-gym battles
--
-- A "gym" is a group your friends and rivals join by code. Members share a
-- private group chat, and a gym can BATTLE another gym: the aggregate of each
-- roster's Evo Rating decides it (roster strength — the honest, already-earned
-- number). NOTE the naming collision to avoid: migration 032's `gym_progress`
-- / battle mode 'gym' is a SINGLE-PLAYER PvE boss-clear — unrelated. These are
-- social groups and get their own tables.
--
-- SECURITY POSTURE (the house doctrine): every table has RLS ENABLED with NO
-- client policies — direct `authenticated` access returns nothing. ALL access
-- goes through the SECURITY DEFINER RPCs below, which re-derive the caller via
-- auth.uid() and gate every read on membership. Cross-user roster reads expose
-- only game stats (name / forge / evo), never body data. Battle results are
-- written ONLY by the definer gym_battle() seam — a client can't fabricate one.

create table if not exists public.gyms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  join_code   text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.gym_members (
  gym_id    uuid not null references public.gyms(id) on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (gym_id, user_id)
);
create index if not exists gym_members_user_idx on public.gym_members(user_id);

create table if not exists public.gym_messages (
  id         uuid primary key default gen_random_uuid(),
  gym_id     uuid not null references public.gyms(id) on delete cascade,
  author_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists gym_messages_gym_idx on public.gym_messages(gym_id, created_at desc);

create table if not exists public.gym_battles (
  id           uuid primary key default gen_random_uuid(),
  a_gym        uuid not null references public.gyms(id) on delete cascade,
  b_gym        uuid not null references public.gyms(id) on delete cascade,
  a_score      integer not null,
  b_score      integer not null,
  winner_gym   uuid references public.gyms(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists gym_battles_a_idx on public.gym_battles(a_gym, created_at desc);
create index if not exists gym_battles_b_idx on public.gym_battles(b_gym, created_at desc);

alter table public.gyms         enable row level security;
alter table public.gym_members  enable row level security;
alter table public.gym_messages enable row level security;
alter table public.gym_battles  enable row level security;
-- No policies on purpose: all access is through the definer RPCs below.

-- ── helpers ──────────────────────────────────────────────────────────────
create or replace function public.is_gym_member(p_gym uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(select 1 from gym_members where gym_id = p_gym and user_id = p_user);
$$;

-- ── create ───────────────────────────────────────────────────────────────
create or replace function public.create_gym(p_name text, p_description text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nm text := btrim(coalesce(p_name,'')); code text; gid uuid; tries int := 0;
begin
  if me is null then raise exception 'create_gym: not signed in.' using errcode='insufficient_privilege'; end if;
  if char_length(nm) < 3 or char_length(nm) > 30 then return jsonb_build_object('ok', false, 'reason', 'bad_name'); end if;
  -- a member may own at most 3 gyms (anti-spam).
  if (select count(*) from gyms where owner_id = me) >= 3 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  loop
    -- 6 hex chars from a random uuid (pgcrypto's gen_random_bytes isn't enabled).
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists(select 1 from gyms where join_code = code);
    tries := tries + 1; if tries > 10 then raise exception 'create_gym: code gen failed'; end if;
  end loop;
  insert into gyms(name, description, owner_id, join_code) values (nm, nullif(btrim(coalesce(p_description,'')),''), me, code) returning id into gid;
  insert into gym_members(gym_id, user_id, role) values (gid, me, 'owner');
  return jsonb_build_object('ok', true, 'gym_id', gid, 'join_code', code);
end; $$;

-- ── join ─────────────────────────────────────────────────────────────────
create or replace function public.join_gym(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid;
begin
  if me is null then raise exception 'join_gym: not signed in.' using errcode='insufficient_privilege'; end if;
  select id into gid from gyms where join_code = upper(btrim(coalesce(p_code,'')));
  if gid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public.is_gym_member(gid, me) then return jsonb_build_object('ok', true, 'gym_id', gid, 'already', true); end if;
  if (select count(*) from gym_members where gym_id = gid) >= 30 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into gym_members(gym_id, user_id, role) values (gid, me, 'member') on conflict do nothing;
  return jsonb_build_object('ok', true, 'gym_id', gid);
end; $$;

-- ── leave ────────────────────────────────────────────────────────────────
create or replace function public.leave_gym(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_role text; heir uuid; remaining int;
begin
  if me is null then raise exception 'leave_gym: not signed in.' using errcode='insufficient_privilege'; end if;
  select role into my_role from gym_members where gym_id = p_gym and user_id = me;
  if my_role is null then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  delete from gym_members where gym_id = p_gym and user_id = me;
  select count(*) into remaining from gym_members where gym_id = p_gym;
  if remaining = 0 then
    delete from gyms where id = p_gym;  -- last one out disbands it
    return jsonb_build_object('ok', true, 'disbanded', true);
  end if;
  if my_role = 'owner' then
    -- hand ownership to the earliest-joined remaining member.
    select user_id into heir from gym_members where gym_id = p_gym order by joined_at asc limit 1;
    update gym_members set role = 'owner' where gym_id = p_gym and user_id = heir;
    update gyms set owner_id = heir where id = p_gym;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- ── my gyms ──────────────────────────────────────────────────────────────
create or replace function public.my_gyms()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_gyms: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at desc) from (
      select g.id as gym_id, g.name, g.description, g.join_code, g.created_at, gm.role as my_role,
             (select count(*) from gym_members m where m.gym_id = g.id) as member_count
      from gyms g join gym_members gm on gm.gym_id = g.id and gm.user_id = me
    ) t
  ), '[]'::jsonb);
end; $$;

-- ── detail (roster + recent battles) ─────────────────────────────────────
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
    'gym', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'join_code', g.join_code, 'my_role', my_role,
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

-- ── chat ─────────────────────────────────────────────────────────────────
create or replace function public.post_gym_message(p_gym uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); msg text := btrim(coalesce(p_body,'')); mid uuid;
begin
  if me is null then raise exception 'post_gym_message: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_gym, me) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  if char_length(msg) = 0 or char_length(msg) > 500 then return jsonb_build_object('ok', false, 'reason', 'bad_body'); end if;
  insert into gym_messages(gym_id, author_id, body) values (p_gym, me, msg) returning id into mid;
  return jsonb_build_object('ok', true, 'id', mid);
end; $$;

create or replace function public.gym_messages(p_gym uuid, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,50),1),100);
begin
  if me is null then raise exception 'gym_messages: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_gym, me) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t) order by t.created_at asc) from (
      select gm.id, gm.author_id, coalesce(pp.display_name,'Athlete') as author_name, gm.body, gm.created_at
      from gym_messages gm left join public_profile pp on pp.user_id = gm.author_id
      where gm.gym_id = p_gym
      order by gm.created_at desc limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

-- ── battle another gym (aggregate Evo of the rosters) ────────────────────
create or replace function public.gym_battle(p_my_gym uuid, p_opponent_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); opp uuid; a_score int; b_score int; win uuid; opp_name text;
begin
  if me is null then raise exception 'gym_battle: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_my_gym, me) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  select id, name into opp, opp_name from gyms where join_code = upper(btrim(coalesce(p_opponent_code,'')));
  if opp is null then return jsonb_build_object('ok', false, 'reason', 'opponent_not_found'); end if;
  if opp = p_my_gym then return jsonb_build_object('ok', false, 'reason', 'same_gym'); end if;
  select coalesce(sum(coalesce(evo.displayed_rating,0)),0)::int into a_score
    from gym_members m left join evo_rating_current evo on evo.user_id = m.user_id where m.gym_id = p_my_gym;
  select coalesce(sum(coalesce(evo.displayed_rating,0)),0)::int into b_score
    from gym_members m left join evo_rating_current evo on evo.user_id = m.user_id where m.gym_id = opp;
  win := case when a_score > b_score then p_my_gym when b_score > a_score then opp else null end;
  insert into gym_battles(a_gym, b_gym, a_score, b_score, winner_gym) values (p_my_gym, opp, a_score, b_score, win);
  return jsonb_build_object('ok', true, 'my_score', a_score, 'their_score', b_score,
    'result', case when win = p_my_gym then 'win' when win is null then 'draw' else 'loss' end, 'opponent_name', opp_name);
end; $$;

grant execute on function public.create_gym(text, text)         to authenticated;
grant execute on function public.join_gym(text)                 to authenticated;
grant execute on function public.leave_gym(uuid)                to authenticated;
grant execute on function public.my_gyms()                      to authenticated;
grant execute on function public.gym_detail(uuid)               to authenticated;
grant execute on function public.post_gym_message(uuid, text)   to authenticated;
grant execute on function public.gym_messages(uuid, integer)    to authenticated;
grant execute on function public.gym_battle(uuid, text)         to authenticated;
-- is_gym_member is an internal helper — not granted to clients.
revoke execute on function public.is_gym_member(uuid, uuid) from public, anon, authenticated;
