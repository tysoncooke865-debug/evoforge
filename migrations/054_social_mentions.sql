-- EvoForge 054 — MENTION notifications (Tyson, 2026-07-19).
--
-- Tagging friends in a post → a 'mention' notification (+ the client fires the
-- push twin). Only FRIENDS of the author are notified even if the payload names
-- others, so tagging can't spam strangers (are_friends from 049). 'mention' is
-- The 052 CHECK constraint did NOT list 'mention' (or 'friend_accepted'). A
-- 'mention' insert from the trigger below therefore violated the CHECK, which
-- raised inside an AFTER INSERT trigger on social_posts and ROLLED BACK the
-- whole post insert — tagging silently broke post creation. Widen the type
-- domain first so the trigger can land its rows.

alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications
  add constraint social_notifications_type_check
  check (type in ('reaction','comment','friend_request','friend_accepted','mention'));

create or replace function public.notify_on_mention() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into social_notifications (user_id, actor_id, type, post_id)
  select (t->>'id')::uuid, NEW.author_id, 'mention', NEW.id
  from jsonb_array_elements(coalesce(NEW.payload->'tagged', '[]'::jsonb)) t
  where (t->>'id') ~ '^[0-9a-fA-F-]{36}$'
    and (t->>'id')::uuid <> NEW.author_id
    and are_friends(NEW.author_id, (t->>'id')::uuid);
  return NEW;
end; $$;
drop trigger if exists trg_notify_mention on public.social_posts;
create trigger trg_notify_mention after insert on public.social_posts
  for each row execute function public.notify_on_mention();
