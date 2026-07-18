-- EvoForge 050 — SOCIAL post creation + comments read (Tyson, 2026-07-18).
--
-- Post CREATION and comment INSERT already work through 049's base RLS (author
-- inserts own rows). This migration adds the two missing pieces: a text-only
-- 'status' post type, and a definer RPC to READ a post's comments (base RLS on
-- social_comments is owner-only, so cross-user comment reads need a seam that
-- also checks the post is visible to the caller — the 049 posture).

-- Allow plain text status updates (the composer's "general update").
alter table public.social_posts drop constraint if exists social_posts_post_type_check;
alter table public.social_posts add constraint social_posts_post_type_check
  check (post_type in ('pr','workout','level_up','evo_rating','evolution','rivalry','photo','status'));

-- A post's comments, oldest first — only if the caller can see the post
-- (own / public / friends-visible). Each carries the commenter's public name.
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
             c.body, c.created_at,
             (c.user_id = me) as mine
      from social_comments c
      left join public_profile pp on pp.user_id = c.user_id
      where c.post_id = p_post and c.deleted_at is null
      order by c.created_at asc
      limit 200
    ) t
  ), '[]'::jsonb));
end; $$;

grant execute on function public.post_comments(uuid) to authenticated;
