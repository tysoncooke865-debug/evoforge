-- EvoForge 070 — real gym battles (engine inputs) + M1 social-media read RLS
--
-- (A) FULL GYM BATTLES: the 068 gym_battle summed roster Evo. This adds the
--     server seams for a REAL turn-based fight run through the RPG combat
--     engine (the same engine champion battles use): gym_battle_prepare()
--     hands the client both rosters' COMBAT INPUTS (champion path + the four
--     Evo pillars, show_evo-gated) plus a server seed; the client runs each
--     member-vs-member duel deterministically; record_gym_battle() stores the
--     tally + a per-duel log. Gym battles grant NOTHING farmable (win/loss
--     record only), so a client-run engine has no exploit surface — the honest
--     trade for reusing the client-only RPG engine without mirroring it.
--     Both RPCs are membership-gated + rate-limited.
--
-- (B) M1 — the social-media bucket read policy let ANY authenticated user read
--     ANY object (security-by-unguessable-path). Tighten it to the post's
--     visibility, routed through a definer helper (an RLS policy can't call the
--     client-revoked are_friends directly). Images are served by CALLER-signed
--     URLs, so every legitimate viewer (owner / public / friend — exactly who
--     the feed hands the path to) still signs successfully; only people who
--     never had the path lose a capability they couldn't use anyway.

-- ── (A) gym battle engine seams ──────────────────────────────────────────
alter table public.gym_battles add column if not exists detail jsonb;

-- Build one roster's combat inputs. show_evo hides a member's real numbers →
-- neutral defaults (40) so they still field a fighter, never a wall.
create or replace function public.gym_roster_combat(p_gym uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'name', coalesce(pp.display_name, 'Athlete'),
    'path', case when coalesce(pp.show_evo, true) then pr.active_path else null end,
    'size', case when coalesce(pp.show_evo, true) then coalesce(evo.size_score, 40) else 40 end,
    'aes',  case when coalesce(pp.show_evo, true) then coalesce(evo.aesthetics_score, 40) else 40 end,
    'str',  case when coalesce(pp.show_evo, true) then coalesce(evo.strength_score, 40) else 40 end,
    'cnd',  case when coalesce(pp.show_evo, true) then coalesce(evo.cardio_score, 40) else 40 end
  ) order by evo.displayed_rating desc nulls last), '[]'::jsonb)
  from gym_members m
  left join public_profile pp on pp.user_id = m.user_id
  left join profile pr on pr.user_id = m.user_id
  left join evo_rating_current evo on evo.user_id = m.user_id
  where m.gym_id = p_gym;
$$;
revoke execute on function public.gym_roster_combat(uuid) from public, anon, authenticated;

create or replace function public.gym_battle_prepare(p_my_gym uuid, p_opponent_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); opp uuid; opp_name text; my_name text;
begin
  if me is null then raise exception 'gym_battle_prepare: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_my_gym, me) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  select id, name into opp, opp_name from gyms where join_code = upper(btrim(coalesce(p_opponent_code, '')));
  if opp is null then return jsonb_build_object('ok', false, 'reason', 'opponent_not_found'); end if;
  if opp = p_my_gym then return jsonb_build_object('ok', false, 'reason', 'same_gym'); end if;
  -- rate limit: at most 5 battles initiated per gym per 30s.
  if (select count(*) from gym_battles where a_gym = p_my_gym and created_at > now() - interval '30 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  select name into my_name from gyms where id = p_my_gym;
  return jsonb_build_object(
    'ok', true,
    'opponent_gym', opp,
    'opponent_name', opp_name,
    'my_name', my_name,
    -- a server-chosen seed makes the client's deterministic sim reproducible.
    'seed', (floor(random() * 2000000000))::bigint,
    'my_roster', public.gym_roster_combat(p_my_gym),
    'opp_roster', public.gym_roster_combat(opp)
  );
end; $$;
grant execute on function public.gym_battle_prepare(uuid, text) to authenticated;

create or replace function public.record_gym_battle(p_my_gym uuid, p_opponent uuid, p_a_score integer, p_b_score integer, p_detail jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); a int := greatest(0, coalesce(p_a_score, 0)); b int := greatest(0, coalesce(p_b_score, 0)); win uuid;
begin
  if me is null then raise exception 'record_gym_battle: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_my_gym, me) then return jsonb_build_object('ok', false, 'reason', 'not_member'); end if;
  if p_opponent is null or not exists(select 1 from gyms where id = p_opponent) then
    return jsonb_build_object('ok', false, 'reason', 'opponent_not_found');
  end if;
  if p_opponent = p_my_gym then return jsonb_build_object('ok', false, 'reason', 'same_gym'); end if;
  if (select count(*) from gym_battles where a_gym = p_my_gym and created_at > now() - interval '30 seconds') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  win := case when a > b then p_my_gym when b > a then p_opponent else null end;
  insert into gym_battles(a_gym, b_gym, a_score, b_score, winner_gym, detail)
  values (p_my_gym, p_opponent, a, b, win, p_detail);
  return jsonb_build_object('ok', true, 'result', case when win = p_my_gym then 'win' when win is null then 'draw' else 'loss' end);
end; $$;
grant execute on function public.record_gym_battle(uuid, uuid, integer, integer, jsonb) to authenticated;

-- ── (B) M1: gate social-media reads by post visibility ───────────────────
create or replace function public.can_read_social_object(p_name text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    split_part(p_name, '/', 1) = auth.uid()::text  -- your own uploads
    or exists (
      select 1 from social_posts sp
      where sp.deleted_at is null
        and sp.payload->'photo_urls' ? p_name
        and (
          sp.visibility = 'public'
          or (sp.visibility = 'friends' and public.are_friends(auth.uid(), sp.author_id))
        )
    );
$$;
revoke all on function public.can_read_social_object(text) from public, anon;
grant execute on function public.can_read_social_object(text) to authenticated;

drop policy if exists social_media_read on storage.objects;
create policy social_media_read on storage.objects
  for select to authenticated
  using (bucket_id = 'social-media' and public.can_read_social_object(name));

create index if not exists social_posts_photo_urls_gin
  on public.social_posts using gin ((payload->'photo_urls'))
  where deleted_at is null;
