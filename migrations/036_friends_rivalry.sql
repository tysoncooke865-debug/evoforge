-- EvoForge 036 — FRIENDS + RIVALRY foundation (Tyson, 2026-07-17, autonomous).
--
-- The prerequisite for every social feature (ghost battles, damage assessment,
-- live matchmaking — see MULTIPLAYER_ROADMAP.md). Symmetric friend edges stored
-- canonically (user_a < user_b), add-by-code requests, and a per-pair rivalry
-- record. Cross-user reads go through SECURITY DEFINER RPCs (owner-RLS on the
-- tables themselves). Rivalry writes go through ONE definer seam that is NOT
-- granted to clients — only future contest RPCs (also definer) may call it, so
-- a player can never inflate their own record. Same posture as 034.

-- ---- add-codes: a stable, shareable per-user code ----
create table if not exists public.friend_codes (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);
alter table public.friend_codes enable row level security;
drop policy if exists friend_codes_owner on public.friend_codes;
create policy friend_codes_owner on public.friend_codes for select to authenticated using (user_id = auth.uid());

-- ---- requests ----
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_id      uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (from_id, to_id),
  check (from_id <> to_id)
);
alter table public.friend_requests enable row level security;
drop policy if exists friend_requests_participant on public.friend_requests;
create policy friend_requests_participant on public.friend_requests
  for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());

-- ---- friendships (canonical: user_a < user_b, ONE row per pair) ----
create table if not exists public.friendships (
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
alter table public.friendships enable row level security;
drop policy if exists friendships_participant on public.friendships;
create policy friendships_participant on public.friendships
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- ---- rivalries (canonical pair; created lazily on the first contest) ----
create table if not exists public.rivalries (
  user_a          uuid not null references auth.users(id) on delete cascade,
  user_b          uuid not null references auth.users(id) on delete cascade,
  a_wins          int  not null default 0,
  b_wins          int  not null default 0,
  draws           int  not null default 0,
  points_a        int  not null default 0,
  points_b        int  not null default 0,
  last_contest_at timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b)
);
alter table public.rivalries enable row level security;
drop policy if exists rivalries_participant on public.rivalries;
create policy rivalries_participant on public.rivalries
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- canonical pair order helper
create or replace function public.evo_pair(p uuid, q uuid) returns uuid[]
  language sql immutable as $$ select case when p < q then array[p,q] else array[q,p] end $$;

-- the caller's add-code (created on first call)
create or replace function public.my_friend_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_try int := 0;
begin
  if auth.uid() is null then raise exception 'my_friend_code: not signed in.' using errcode='insufficient_privilege'; end if;
  select code into v_code from friend_codes where user_id = auth.uid();
  if v_code is not null then return v_code; end if;
  loop
    v_try := v_try + 1;
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_try::text), 1, 6));
    begin
      insert into friend_codes (user_id, code) values (auth.uid(), v_code);
      return v_code;
    exception when unique_violation then
      if v_try > 8 then raise; end if;
    end;
  end loop;
end; $$;

-- send a request by code (auto-accepts if they already requested me)
create or replace function public.send_friend_request(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_pair uuid[];
begin
  if auth.uid() is null then raise exception 'send_friend_request: not signed in.' using errcode='insufficient_privilege'; end if;
  select user_id into v_to from friend_codes where code = upper(p_code);
  if v_to is null then return jsonb_build_object('ok', false, 'reason', 'unknown_code'); end if;
  if v_to = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  v_pair := evo_pair(auth.uid(), v_to);
  if exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'already_friends');
  end if;
  if exists (select 1 from friend_requests where from_id = v_to and to_id = auth.uid() and status='pending') then
    update friend_requests set status='accepted' where from_id = v_to and to_id = auth.uid();
    insert into friendships (user_a, user_b) values (v_pair[1], v_pair[2]) on conflict do nothing;
    return jsonb_build_object('ok', true, 'accepted', true);
  end if;
  insert into friend_requests (from_id, to_id) values (auth.uid(), v_to)
    on conflict (from_id, to_id) do update set status='pending', created_at=now();
  return jsonb_build_object('ok', true, 'accepted', false);
end; $$;

-- accept/decline a pending incoming request
create or replace function public.respond_friend_request(p_request uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_pair uuid[];
begin
  if auth.uid() is null then raise exception 'respond_friend_request: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into r from friend_requests where id = p_request and to_id = auth.uid() and status='pending';
  if not found then return jsonb_build_object('ok', false); end if;
  if p_accept then
    update friend_requests set status='accepted' where id = p_request;
    v_pair := evo_pair(r.from_id, r.to_id);
    insert into friendships (user_a, user_b) values (v_pair[1], v_pair[2]) on conflict do nothing;
  else
    update friend_requests set status='declined' where id = p_request;
  end if;
  return jsonb_build_object('ok', true);
end; $$;

-- my friends (+ head-to-head record + public display name; NEVER body data)
create or replace function public.my_friends() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_friends: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.fid,
      'display_name', coalesce(pp.display_name, 'Athlete'),
      'my_wins',   case when me < f.fid then coalesce(rv.a_wins,0) else coalesce(rv.b_wins,0) end,
      'their_wins',case when me < f.fid then coalesce(rv.b_wins,0) else coalesce(rv.a_wins,0) end,
      'draws',     coalesce(rv.draws,0)
    ))
    from (select case when user_a = me then user_b else user_a end as fid
          from friendships where user_a = me or user_b = me) f
    left join public_profile pp on pp.user_id = f.fid
    left join rivalries rv on rv.user_a = least(me, f.fid) and rv.user_b = greatest(me, f.fid)
  ), '[]'::jsonb);
end; $$;

-- my pending incoming requests
create or replace function public.my_friend_requests() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_friend_requests: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', fr.id, 'from_id', fr.from_id,
             'display_name', coalesce(pp.display_name, 'Athlete')))
    from friend_requests fr left join public_profile pp on pp.user_id = fr.from_id
    where fr.to_id = me and fr.status = 'pending'
  ), '[]'::jsonb);
end; $$;

-- THE rivalry write seam. Only ever called by future contest RPCs (also
-- SECURITY DEFINER — they run as the owner, so they may call this even though
-- it is NOT granted to authenticated). Guards: must be friends; canonical pair.
create or replace function public.record_rivalry_result(p_opponent uuid, p_outcome text, p_points int default 10) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_pair uuid[]; i_am_a boolean;
begin
  if me is null then raise exception 'record_rivalry_result: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_outcome not in ('win','loss','draw') then raise exception 'record_rivalry_result: bad outcome.'; end if;
  v_pair := evo_pair(me, p_opponent);
  if not exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'not_friends');
  end if;
  i_am_a := (me = v_pair[1]);
  insert into rivalries (user_a, user_b, last_contest_at) values (v_pair[1], v_pair[2], now())
    on conflict (user_a, user_b) do nothing;
  update rivalries set
    a_wins   = a_wins   + (case when (p_outcome='win' and i_am_a) or (p_outcome='loss' and not i_am_a) then 1 else 0 end),
    b_wins   = b_wins   + (case when (p_outcome='win' and not i_am_a) or (p_outcome='loss' and i_am_a) then 1 else 0 end),
    draws    = draws    + (case when p_outcome='draw' then 1 else 0 end),
    points_a = points_a + (case when i_am_a and p_outcome='win' then greatest(0,p_points) else 0 end),
    points_b = points_b + (case when not i_am_a and p_outcome='win' then greatest(0,p_points) else 0 end),
    last_contest_at = now()
  where user_a = v_pair[1] and user_b = v_pair[2];
  return jsonb_build_object('ok', true);
end; $$;

-- grants: the friend RPCs are client-callable; record_rivalry_result is NOT.
-- SUPABASE gotcha: default privileges auto-grant EXECUTE to anon+authenticated
-- on every new function in `public`, so `revoke from public` is NOT enough —
-- the cheat seam must be revoked from anon+authenticated EXPLICITLY (falsified:
-- without this, a client could call record_rivalry_result and inflate its own
-- record). Definer contest RPCs run as owner, so they can still call it.
revoke all on function public.record_rivalry_result(uuid, text, int) from public, anon, authenticated;
grant execute on function public.my_friend_code() to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.my_friends() to authenticated;
grant execute on function public.my_friend_requests() to authenticated;
