-- EvoForge 052 — SOCIAL NOTIFICATIONS (Tyson, 2026-07-19).
--
-- In-app notifications for the moments that matter: someone reacted to or
-- commented on your post, or sent you a friend request. Owner-only RLS; rows
-- are created by SECURITY DEFINER triggers (they run as owner, so they may
-- insert a row for ANOTHER user — the recipient). Reads/unread-count/mark-read
-- go through definer RPCs that hydrate the actor's public name. Native push is
-- a later layer; this is the in-app bell.

create table if not exists public.social_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade, -- recipient
  actor_id   uuid references auth.users(id) on delete cascade,
  type       text not null check (type in ('reaction','comment','friend_request','friend_accepted')),
  post_id    uuid references public.social_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
alter table public.social_notifications enable row level security;
drop policy if exists social_notifications_owner on public.social_notifications;
create policy social_notifications_owner on public.social_notifications
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists social_notifications_inbox on public.social_notifications (user_id, created_at desc);
create index if not exists social_notifications_unread on public.social_notifications (user_id) where read_at is null;

-- reaction → notify the post's author (never yourself)
create or replace function public.notify_on_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into social_notifications (user_id, actor_id, type, post_id)
  select sp.author_id, NEW.user_id, 'reaction', NEW.post_id
  from social_posts sp where sp.id = NEW.post_id and sp.author_id <> NEW.user_id and sp.deleted_at is null;
  return NEW;
end; $$;
drop trigger if exists trg_notify_reaction on public.social_reactions;
create trigger trg_notify_reaction after insert on public.social_reactions
  for each row execute function public.notify_on_reaction();

-- comment → notify the post's author (never yourself)
create or replace function public.notify_on_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into social_notifications (user_id, actor_id, type, post_id)
  select sp.author_id, NEW.user_id, 'comment', NEW.post_id
  from social_posts sp where sp.id = NEW.post_id and sp.author_id <> NEW.user_id and sp.deleted_at is null;
  return NEW;
end; $$;
drop trigger if exists trg_notify_comment on public.social_comments;
create trigger trg_notify_comment after insert on public.social_comments
  for each row execute function public.notify_on_comment();

-- friend request → notify the recipient (only new pending rows)
create or replace function public.notify_on_friend_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'pending' then
    insert into social_notifications (user_id, actor_id, type) values (NEW.to_id, NEW.from_id, 'friend_request');
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notify_friend_request on public.friend_requests;
create trigger trg_notify_friend_request after insert on public.friend_requests
  for each row execute function public.notify_on_friend_request();

-- the inbox: newest first, with the actor's public name + a post caption peek
create or replace function public.my_notifications(p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,30),1),60);
begin
  if me is null then raise exception 'my_notifications: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select n.id, n.type, n.post_id, n.created_at, n.read_at,
             coalesce(pp.display_name, 'Someone') as actor_name,
             left(coalesce(sp.caption, ''), 60) as post_peek
      from social_notifications n
      left join public_profile pp on pp.user_id = n.actor_id
      left join social_posts sp on sp.id = n.post_id
      where n.user_id = me
      order by n.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

create or replace function public.unread_notification_count() returns int
language sql security definer set search_path = public as $$
  select coalesce(count(*), 0)::int from social_notifications where user_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_notifications_read() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'mark_notifications_read: not signed in.' using errcode='insufficient_privilege'; end if;
  update social_notifications set read_at = now() where user_id = auth.uid() and read_at is null;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function public.my_notifications(int) to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
