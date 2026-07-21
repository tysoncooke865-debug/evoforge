-- 081 — Harden round-3 physique photo reveal (D2 first-mover leak).
--
-- The battle-media storage read policy gated ONLY on match participation
-- (009), so a participant could lift the OPPONENT's storage_path from the
-- battle_media bundle and createSignedUrl() it BEFORE both verdicts were
-- final. The "both final" timing was enforced only in the client
-- (data/battle/physique-reveal.ts::revealReady) — a malicious client bypasses
-- it. This moves the timing gate to the server, where it belongs.
--
-- Fail-safe by design: your OWN photo stays readable at all times; only the
-- opponent's object is gated on reveal-readiness, so a too-strict predicate can
-- at worst delay a reveal, never lock an athlete out of their own data.

create or replace function public.battle_physique_reveal_ready(p_match uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with parts as (
    select user_id from public.battle_participants where match_id = p_match
  ),
  finality as (
    select
      p.user_id,
      (select count(*) from public.battle_media m
        where m.match_id = p_match and m.user_id = p.user_id
          and m.round_no = 3) as n,
      coalesce((
        select lower(coalesce(m.confidence, 'low')) <> 'low'
          from public.battle_media m
         where m.match_id = p_match and m.user_id = p.user_id
           and m.round_no = 3
         order by m.created_at desc
         limit 1
      ), false) as last_not_low
    from parts p
  )
  -- revealReady(): round scored, OR BOTH sides final. isFinal(): last verdict
  -- not 'low', or 2 attempts used. Verbatim in spirit with battle-settle.
  select
    exists (
      select 1 from public.battle_rounds r
      where r.match_id = p_match and r.round_no = 3 and r.status = 'scored'
    )
    or (
      (select count(*) from parts) = 2
      and (select bool_and(n >= 2 or last_not_low) from finality) is true
    );
$$;

revoke all on function public.battle_physique_reveal_ready(uuid) from anon;
grant execute on function public.battle_physique_reveal_ready(uuid) to authenticated;

-- Read: your OWN photo any time (path segment [2] = you); the opponent's only
-- once the reveal is ready. Write/delete stays service-key only.
drop policy if exists battle_media_participant_read on storage.objects;
create policy battle_media_participant_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'battle-media'
    and public.is_battle_participant(((storage.foldername(name))[1])::uuid)
    and (
      ((storage.foldername(name))[2])::uuid = auth.uid()
      or public.battle_physique_reveal_ready(((storage.foldername(name))[1])::uuid)
    )
  );
