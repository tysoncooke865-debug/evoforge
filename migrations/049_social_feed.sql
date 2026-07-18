-- EvoForge 049 — SOCIAL FEED (Tyson, 2026-07-18).
--
-- The feed layer over the friends/rivalry foundation (036). One posts table
-- (typed envelope + per-type payload JSONB), reactions (one per user/post) and
-- comments. Owner-only RLS on the base tables; cross-user reads go through ONE
-- SECURITY DEFINER feed RPC that enforces visibility (own + friends-visible +
-- public) — the same posture as 036's my_friends. Nothing here ships until the
-- client flips socialFeedEnabled; the tab stays COMING SOON until then.

-- ---- posts ----
create table if not exists public.social_posts (
  id                uuid primary key default gen_random_uuid(),
  author_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_type         text not null check (post_type in ('pr','workout','level_up','evo_rating','evolution','rivalry','photo')),
  visibility        text not null default 'friends' check (visibility in ('public','friends','private')),
  caption           text check (caption is null or length(caption) <= 500),
  payload           jsonb not null default '{}'::jsonb,
  -- Linkage kept relational (not buried in payload) so a deleted source can be
  -- detected and the post can deep-link.
  linked_workout_id uuid,
  linked_snapshot_id uuid,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
alter table public.social_posts enable row level security;
-- Base RLS: an author fully controls their own rows. All cross-user reads go
-- through the definer feed RPC (which applies visibility + friendship).
drop policy if exists social_posts_author_all on public.social_posts;
create policy social_posts_author_all on public.social_posts
  for all to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create index if not exists social_posts_author_created on public.social_posts (author_id, created_at desc) where deleted_at is null;
create index if not exists social_posts_created on public.social_posts (created_at desc) where deleted_at is null;

-- ---- reactions (one per user per post; switching updates the kind) ----
create table if not exists public.social_reactions (
  post_id    uuid not null references public.social_posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('hype','respect','beast','inspired')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.social_reactions enable row level security;
drop policy if exists social_reactions_owner on public.social_reactions;
create policy social_reactions_owner on public.social_reactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists social_reactions_post on public.social_reactions (post_id);

-- ---- comments ----
create table if not exists public.social_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.social_posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.social_comments enable row level security;
drop policy if exists social_comments_owner on public.social_comments;
create policy social_comments_owner on public.social_comments
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists social_comments_post on public.social_comments (post_id, created_at) where deleted_at is null;

-- Are two users friends? (canonical pair, reuses 036's friendships + evo_pair.)
create or replace function public.are_friends(p uuid, q uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where user_a = (public.evo_pair(p, q))[1] and user_b = (public.evo_pair(p, q))[2]
  );
$$;

-- THE feed. Own + friends'(friends-visibility) + anyone's(public) posts, newest
-- first, keyset by created_at. p_scope filters: 'following' (friends+me),
-- 'rivals' (only rivalry posts from friends+me), 'discover' (public). Each row
-- carries the public display name, counts, my reaction and the per-kind tally.
create or replace function public.social_feed(p_scope text default 'following', p_before timestamptz default null, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,20),1),40);
begin
  if me is null then raise exception 'social_feed: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select sp.id, sp.author_id,
             coalesce(pp.display_name, 'Athlete') as author_name,
             ap.avatar_stage as author_stage,
             sp.post_type, sp.visibility, sp.caption, sp.payload, sp.created_at,
             (select count(*) from social_reactions r where r.post_id = sp.id) as reaction_count,
             (select count(*) from social_comments c where c.post_id = sp.id and c.deleted_at is null) as comment_count,
             (select r.kind from social_reactions r where r.post_id = sp.id and r.user_id = me) as my_reaction,
             (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
                from (select kind k, count(*) n from social_reactions r where r.post_id = sp.id group by kind) x) as reactions_by_kind
      from social_posts sp
      left join public_profile pp on pp.user_id = sp.author_id
      left join avatar_progression ap on ap.user_id = sp.author_id
      where sp.deleted_at is null
        and (p_before is null or sp.created_at < p_before)
        and (
          case p_scope
            when 'discover' then sp.visibility = 'public'
            when 'rivals'   then sp.post_type = 'rivalry' and (sp.author_id = me or (sp.visibility in ('friends','public') and are_friends(me, sp.author_id)))
            else /* following */ sp.author_id = me or (sp.visibility in ('friends','public') and are_friends(me, sp.author_id))
          end
        )
      order by sp.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;

-- Toggle a reaction: same kind removes it, a new kind replaces it.
create or replace function public.toggle_reaction(p_post uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); existing text;
begin
  if me is null then raise exception 'toggle_reaction: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_kind not in ('hype','respect','beast','inspired') then raise exception 'toggle_reaction: bad kind.'; end if;
  -- Must be able to SEE the post (own, or friends/public via friendship).
  if not exists (
    select 1 from social_posts sp where sp.id = p_post and sp.deleted_at is null and (
      sp.author_id = me or sp.visibility = 'public' or (sp.visibility = 'friends' and are_friends(me, sp.author_id))
    )
  ) then return jsonb_build_object('ok', false, 'reason', 'not_visible'); end if;
  select kind into existing from social_reactions where post_id = p_post and user_id = me;
  if existing = p_kind then
    delete from social_reactions where post_id = p_post and user_id = me;
    return jsonb_build_object('ok', true, 'reaction', null);
  end if;
  insert into social_reactions (post_id, user_id, kind) values (p_post, me, p_kind)
    on conflict (post_id, user_id) do update set kind = excluded.kind, created_at = now();
  return jsonb_build_object('ok', true, 'reaction', p_kind);
end; $$;

-- grants: feed + reaction toggle are client-callable; are_friends is a helper
-- other definer fns call (revoke from clients so it can't be probed for edges).
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;
grant execute on function public.social_feed(text, timestamptz, int) to authenticated;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;
