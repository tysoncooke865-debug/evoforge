-- EvoForge 069 — SECURITY OVERHAUL: block users, widen moderation, rate-limit
--
-- App-Store compliance + abuse-seam hardening (no functionality removed):
--   H2  BLOCK USERS (Apple 1.2)   — blocked_users + block/unblock RPCs, a
--       friend-request block trigger, and client-side hiding hooks read from
--       my_blocks(). A blocked user can't friend-request you and is hidden
--       from your discover/search/suggested lists and feeds.
--   H3  MODERATION COVERAGE (1.2) — a generic content_reports table + a
--       report_content() RPC so comments, gym-chat messages and profiles are
--       reportable, not just posts (which keep social_reports).
--   M3  RATE LIMITS               — triggers cap friend-request and gym-chat
--       spam (the AI functions already have an hourly limiter; social seams
--       had none).
--
-- All base tables are owner-RLS; cross-user reads/writes go through the
-- security-definer RPCs, per doctrine. is_blocked() is definer + revoked from
-- clients (an internal guard, like is_gym_member).

-- ── blocked_users ─────────────────────────────────────────────────────────
create table if not exists public.blocked_users (
  blocker_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocked_users enable row level security;
-- The owner may read + write ONLY their own block rows.
drop policy if exists blocked_users_owner on public.blocked_users;
create policy blocked_users_owner on public.blocked_users
  for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- Either-direction block test (definer so a trigger/RPC can consult it
-- regardless of whose rows they are). Internal — never granted to clients.
create or replace function public.is_blocked(p_a uuid, p_b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from blocked_users
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;
revoke execute on function public.is_blocked(uuid, uuid) from public, anon, authenticated;

create or replace function public.block_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'block_user: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_user is null or p_user = me then return jsonb_build_object('ok', false, 'reason', 'bad_target'); end if;
  insert into blocked_users(blocker_id, blocked_id) values (me, p_user) on conflict do nothing;
  -- Blocking severs any friendship + pending requests both ways (you asked not
  -- to see them; a lingering friend row would keep their content visible).
  delete from friendships where (user_a = me and user_b = p_user) or (user_a = p_user and user_b = me);
  delete from friend_requests where (from_id = me and to_id = p_user) or (from_id = p_user and to_id = me);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.unblock_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unblock_user: not signed in.' using errcode='insufficient_privilege'; end if;
  delete from blocked_users where blocker_id = me and blocked_id = p_user;
  return jsonb_build_object('ok', true);
end; $$;

-- The caller's block list (ids only) so the client can hide blocked users
-- everywhere (feed, comments, chat, discover) without leaking who blocked whom.
create or replace function public.my_blocks()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_blocks: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(blocked_id) from blocked_users where blocker_id = me), '[]'::jsonb);
end; $$;

grant execute on function public.block_user(uuid)   to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.my_blocks()        to authenticated;

-- ── friend-request block + rate-limit trigger ────────────────────────────
create or replace function public.friend_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked(new.from_id, new.to_id) then
    raise exception 'friend request blocked' using errcode='check_violation';
  end if;
  -- M3: no more than 30 requests initiated in the last hour (spam guard).
  if (select count(*) from friend_requests
      where from_id = new.from_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many friend requests — slow down' using errcode='check_violation';
  end if;
  return new;
end; $$;
drop trigger if exists friend_request_guard_trg on public.friend_requests;
create trigger friend_request_guard_trg before insert on public.friend_requests
  for each row execute function public.friend_request_guard();

-- ── gym-chat rate-limit trigger (M3) ─────────────────────────────────────
create or replace function public.gym_message_rate_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from gym_messages
      where author_id = new.author_id and created_at > now() - interval '10 seconds') >= 8 then
    raise exception 'slow down — too many messages' using errcode='check_violation';
  end if;
  return new;
end; $$;
drop trigger if exists gym_message_rate_guard_trg on public.gym_messages;
create trigger gym_message_rate_guard_trg before insert on public.gym_messages
  for each row execute function public.gym_message_rate_guard();

-- ── H3: generic content reports (comments / gym messages / profiles) ─────
create table if not exists public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('comment','gym_message','profile')),
  target_id   uuid not null,
  reason      text not null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.content_reports enable row level security;
-- The reporter may see their own reports; the row is written only via the RPC.
drop policy if exists content_reports_owner on public.content_reports;
create policy content_reports_owner on public.content_reports
  for select to authenticated using (reporter_id = auth.uid());

create or replace function public.report_content(p_type text, p_id uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'report_content: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_type not in ('comment','gym_message','profile') or p_id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_target');
  end if;
  -- M3: cap report spam (30/hour).
  if (select count(*) from content_reports where reporter_id = me and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  insert into content_reports(reporter_id, target_type, target_id, reason, note)
  values (me, p_type, p_id, coalesce(nullif(btrim(p_reason),''),'unspecified'), nullif(btrim(coalesce(p_note,'')),''));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.report_content(text, uuid, text, text) to authenticated;
