-- EvoForge 073 — RETIRE FRIEND CODES, add shareable INVITE LINKS (Tyson, 2026-07-20).
--
-- "Remove join-by-code, replace with a fully online system." Friending is now:
--   • find anyone PUBLIC by display name (071 search_athletes) → request_friend, and
--   • a shareable PROFILE LINK for the rest — evoforge://athlete/<id>?invite=<token>.
--
-- The 6-char friend code (036: friend_codes + my_friend_code + send_friend_request)
-- is dropped. THE GAP it leaves: a private (is_public=false) athlete could only be
-- cold-added via their code — name search and request_friend both refuse private
-- targets. The invite LINK closes it WITHOUT re-inventing a manual code: each
-- athlete has a stable opaque `share_token`; request_friend accepts a request to a
-- private target IFF the caller presents that athlete's token (i.e. the athlete
-- deliberately shared their link). No token, not public → still refused, so cold
-- spam stays impossible.
--
-- FALSIFICATION:
--  1. my_friend_code / send_friend_request no longer exist (dropped).
--  2. request_friend to a PRIVATE athlete with the RIGHT token succeeds; with a
--     wrong/absent token → not_addressable.
--  3. request_friend to a PUBLIC athlete still works with no token (unchanged).
--  4. every athlete has a non-null share_token; my_share_token returns the caller's.

-- (1) Drop the code system. send_friend_request depends on friend_codes, so it
--     goes first. (These are the only two objects touching friend_codes — 036.)
drop function if exists public.send_friend_request(text);
drop function if exists public.my_friend_code();
drop table if exists public.friend_codes;

-- (2) A stable, opaque per-athlete invite handle. Adding a column with a default
--     backfills every existing row with its own uuid (PG 11+). Owner-only RLS on
--     public_profile already applies; the token is only ever exposed to its owner
--     (my_share_token) and checked inside the definer request_friend.
alter table public.public_profile add column if not exists share_token uuid not null default gen_random_uuid();

-- (3) The caller's own share token, for building their invite link. Creates the
--     profile row if somehow absent so a brand-new user can still share.
create or replace function public.my_share_token() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v text;
begin
  if me is null then raise exception 'my_share_token: not signed in.' using errcode='insufficient_privilege'; end if;
  insert into public_profile (user_id) values (me) on conflict (user_id) do nothing;
  select share_token::text into v from public_profile where user_id = me;
  return v;
end; $$;
grant execute on function public.my_share_token() to authenticated;

-- (4) request_friend gains an optional invite token. Addressable when the target
--     is PUBLIC, has already invited me, OR I hold their share token (link invite).
--     Body is 071's verbatim except the widened addressability probe.
create or replace function public.request_friend(p_user uuid, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_pair uuid[]; v_ok boolean;
begin
  if me is null then raise exception 'request_friend: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_user is null or p_user = me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  v_pair := evo_pair(me, p_user);
  if exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'already_friends');
  end if;
  -- Addressable if PUBLIC (071), OR already invited me, OR I present their invite
  -- token (they shared their link — consent to a cold add without going public).
  select coalesce((select is_public from public_profile where user_id = p_user), false)
      or exists (select 1 from friend_requests where from_id = p_user and to_id = me and status='pending')
      or (p_token is not null and exists (
            select 1 from public_profile where user_id = p_user and share_token::text = p_token))
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
grant execute on function public.request_friend(uuid, text) to authenticated;

-- Drop the old single-arg overload so PostgREST resolves the new signature
-- unambiguously (the client will always send p_user, optionally p_token).
drop function if exists public.request_friend(uuid);
