-- EvoForge 058 — COMMENT reactions + one-level replies
-- (Tyson's improvement doc §6.1, 2026-07-19).
--
-- "Respond, react and hype up comments in the same way you can the main
-- post." Reactions reuse the 049 four-kind vocabulary on a parallel table
-- (social_reactions is PK'd on (post_id,user_id) — polymorphing it would
-- rewrite the optimistic client); replies are ONE level (parent_id on
-- social_comments, reply-to-reply rejected — compact UI, no thread wells).
--
-- ORDER MATTERS (the 054 lesson): the notifications type CHECK is widened
-- FIRST — a trigger inserting an unlisted type raises inside AFTER INSERT
-- and rolls back the parent row. Both new triggers land only after the
-- domain admits their types.
--
-- FALSIFICATION CHECKLIST (ALPHA/BRAVO, seed → assert → delete):
--  1. reply lands under a parent comment; reply-to-reply rejected.
--  2. BRAVO cannot react to a comment on a post it cannot see.
--  3. toggle: same kind removes, new kind replaces.
--  4. a comment reaction/reply does NOT roll back its own insert
--     (the notification CHECK admits the new types).
--  5. raw insert into social_comment_reactions for someone else's user_id
--     rejected by RLS.
--  6. post_comments returns parent_id, reaction counts and my_reaction.

-- STEP 1 — the notification domain, widened BEFORE any trigger needs it.
alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications
  add constraint social_notifications_type_check
  check (type in ('reaction','comment','friend_request','friend_accepted','mention',
                  'comment_reaction','comment_reply'));

-- 052's inbox peeks at the post caption; comment interactions carry no
-- caption, which is fine — post_peek is already left-joined/nullable.

-- STEP 2 — one-level replies.
alter table public.social_comments
  add column if not exists parent_id uuid references public.social_comments(id) on delete cascade;
create index if not exists social_comments_parent on public.social_comments (parent_id) where parent_id is not null;

create or replace function public.social_comment_depth_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.parent_id is not null then
    -- The parent must be a TOP-LEVEL comment on the same post.
    if not exists (
      select 1 from social_comments p
      where p.id = NEW.parent_id and p.post_id = NEW.post_id and p.parent_id is null and p.deleted_at is null
    ) then
      raise exception 'replies are one level deep and stay on the parent''s post';
    end if;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_comment_depth on public.social_comments;
create trigger trg_comment_depth before insert on public.social_comments
  for each row execute function public.social_comment_depth_guard();

-- STEP 3 — comment reactions (the 049 posture verbatim: owner-only base
-- RLS, one reaction per athlete per comment, definer toggle re-checks
-- visibility of the PARENT POST).
create table if not exists public.social_comment_reactions (
  comment_id uuid not null references public.social_comments(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('hype','respect','beast','inspired')),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.social_comment_reactions enable row level security;
drop policy if exists social_comment_reactions_owner on public.social_comment_reactions;
create policy social_comment_reactions_owner on public.social_comment_reactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.social_comment_reactions to authenticated;

create or replace function public.toggle_comment_reaction(p_comment uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing text; v_post uuid;
begin
  if me is null then raise exception 'toggle_comment_reaction: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_kind not in ('hype','respect','beast','inspired') then raise exception 'toggle_comment_reaction: bad kind.'; end if;
  -- The comment must exist and its POST must be visible to the caller.
  select c.post_id into v_post from social_comments c where c.id = p_comment and c.deleted_at is null;
  if v_post is null then return jsonb_build_object('ok', false, 'reason', 'not_visible'); end if;
  if not exists (
    select 1 from social_posts sp where sp.id = v_post and sp.deleted_at is null and (
      sp.author_id = me or sp.visibility = 'public' or (sp.visibility = 'friends' and are_friends(me, sp.author_id))
    )
  ) then return jsonb_build_object('ok', false, 'reason', 'not_visible'); end if;
  select kind into existing from social_comment_reactions where comment_id = p_comment and user_id = me;
  if existing = p_kind then
    delete from social_comment_reactions where comment_id = p_comment and user_id = me;
    return jsonb_build_object('ok', true, 'reaction', null);
  end if;
  insert into social_comment_reactions (comment_id, user_id, kind) values (p_comment, me, p_kind)
    on conflict (comment_id, user_id) do update set kind = excluded.kind, created_at = now();
  return jsonb_build_object('ok', true, 'reaction', p_kind);
end; $$;
grant execute on function public.toggle_comment_reaction(uuid, text) to authenticated;

-- STEP 4 — notifications (types admitted in STEP 1; never notify yourself).
create or replace function public.notify_on_comment_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into social_notifications (user_id, actor_id, type, post_id)
  select c.user_id, NEW.user_id, 'comment_reaction', c.post_id
  from social_comments c
  where c.id = NEW.comment_id and c.user_id <> NEW.user_id and c.deleted_at is null;
  return NEW;
end; $$;
drop trigger if exists trg_notify_comment_reaction on public.social_comment_reactions;
create trigger trg_notify_comment_reaction after insert on public.social_comment_reactions
  for each row execute function public.notify_on_comment_reaction();

-- A reply notifies the PARENT COMMENT's author; 052's comment trigger
-- already tells the post author about every comment, replies included.
create or replace function public.notify_on_comment_reply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.parent_id is not null then
    insert into social_notifications (user_id, actor_id, type, post_id)
    select p.user_id, NEW.user_id, 'comment_reply', NEW.post_id
    from social_comments p
    where p.id = NEW.parent_id and p.user_id <> NEW.user_id and p.deleted_at is null;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_notify_comment_reply on public.social_comments;
create trigger trg_notify_comment_reply after insert on public.social_comments
  for each row execute function public.notify_on_comment_reply();

-- STEP 5 — post_comments learns parent_id + reaction shape (050 recreated;
-- same visibility gate, same 200-row cap, same author hydration).
create or replace function public.post_comments(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'post_comments: not signed in.' using errcode='insufficient_privilege'; end if;
  if not exists (
    select 1 from social_posts sp where sp.id = p_post and sp.deleted_at is null and (
      sp.author_id = me or sp.visibility = 'public' or (sp.visibility = 'friends' and are_friends(me, sp.author_id))
    )
  ) then return jsonb_build_object('ok', false, 'reason', 'not_visible'); end if;
  return jsonb_build_object('ok', true, 'comments', coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select c.id, c.user_id,
             coalesce(pp.display_name, 'Athlete') as author_name,
             c.body, c.created_at, c.parent_id,
             (c.user_id = me) as mine,
             coalesce((select count(*)::int from social_comment_reactions r where r.comment_id = c.id), 0) as reaction_count,
             (select r.kind from social_comment_reactions r where r.comment_id = c.id and r.user_id = me) as my_reaction
      from social_comments c
      left join public_profile pp on pp.user_id = c.user_id
      where c.post_id = p_post and c.deleted_at is null
      order by c.created_at asc
      limit 200
    ) t
  ), '[]'::jsonb));
end; $$;
grant execute on function public.post_comments(uuid) to authenticated;
