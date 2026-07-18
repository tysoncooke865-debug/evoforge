-- EvoForge 051 — SOCIAL MEDIA storage (Tyson, 2026-07-19).
--
-- A PRIVATE bucket for workout/photo-post images. These are user-CHOSEN shares
-- (unlike the house rule on solo physique scans, which are still never stored).
-- Objects live under {auth.uid()}/{uuid}.jpg — a user writes only their own
-- folder; any authenticated user may READ (paths are unguessable uuids and are
-- only ever handed out by social_feed to viewers who can already see the post),
-- and the client serves them as short-lived SIGNED URLs, so a link is never a
-- permanent public handle (the spec: private media not exposed publicly).

insert into storage.buckets (id, name, public)
values ('social-media', 'social-media', false)
on conflict (id) do nothing;

-- write/delete only inside your own uid folder
drop policy if exists social_media_insert_own on storage.objects;
create policy social_media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'social-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists social_media_delete_own on storage.objects;
create policy social_media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'social-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- read: any authenticated caller may sign an object (distribution is controlled
-- by social_feed, which only returns a post's paths to authorised viewers).
drop policy if exists social_media_read on storage.objects;
create policy social_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'social-media');
