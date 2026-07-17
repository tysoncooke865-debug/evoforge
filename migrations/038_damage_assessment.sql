-- EvoForge 038 — DAMAGE ASSESSMENT (Tyson, 2026-07-17, autonomous). Phase 3 of
-- MULTIPLAYER_ROADMAP.md, gated on 036 (friends).
--
-- Between friends: each takes a PRE-pump photo, trains, takes a POST photo.
-- The AI judges whose physique changed the most; the winner takes the
-- assessment + XP. Photos follow the BATTLE_ARENA D2 posture — the ONE
-- sanctioned persistence exception: camera captures only, uploaded by the edge
-- function (service role) into the PRIVATE battle-media bucket, and DELETED in
-- the same invocation that judges. Only scores + a one-line blurb survive.
--
-- State transitions live in the edge function (service role) + definer RPCs.
-- finalize is service_role-ONLY: it writes the verdict, grants the winner
-- idempotent XP through the 033 GUC, and updates the 036 rivalry pair.

create table if not exists public.damage_assessments (
  id            uuid        primary key default gen_random_uuid(),
  challenger_id uuid        not null references auth.users(id) on delete cascade,
  opponent_id   uuid        not null references auth.users(id) on delete cascade,
  status        text        not null default 'open' check (status in ('open','judged','expired')),
  winner_id     uuid        references auth.users(id),
  verdict       jsonb,      -- {challenger:{delta,blurb}, opponent:{delta,blurb}, draw?}
  created_at    timestamptz not null default now(),
  judged_at     timestamptz,
  check (challenger_id <> opponent_id)
);
-- one OPEN assessment per canonical pair at a time
create unique index if not exists da_open_pair_idx on public.damage_assessments
  (least(challenger_id, opponent_id), greatest(challenger_id, opponent_id))
  where status = 'open';

alter table public.damage_assessments enable row level security;
drop policy if exists da_participant_select on public.damage_assessments;
create policy da_participant_select on public.damage_assessments
  for select to authenticated using (challenger_id = auth.uid() or opponent_id = auth.uid());

-- photo bookkeeping: hashes for anti-reuse, storage paths for cleanup. Each
-- athlete sees only their OWN rows; the shared surface is the verdict above.
create table if not exists public.da_photos (
  id            uuid        primary key default gen_random_uuid(),
  assessment_id uuid        not null references public.damage_assessments(id) on delete cascade,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  kind          text        not null check (kind in ('pre','post')),
  sha256        text        not null,
  storage_path  text        not null,
  submitted_at  timestamptz not null default now(),
  unique (assessment_id, user_id, kind),
  unique (user_id, sha256)  -- a photo can never be entered twice, ever
);
alter table public.da_photos enable row level security;
drop policy if exists da_photos_owner_select on public.da_photos;
create policy da_photos_owner_select on public.da_photos
  for select to authenticated using (user_id = auth.uid());

-- challenge a FRIEND to a damage assessment
create or replace function public.create_damage_assessment(p_opponent uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_pair uuid[]; v_id uuid;
begin
  if me is null then raise exception 'create_damage_assessment: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_opponent = me then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  v_pair := evo_pair(me, p_opponent);
  if not exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'not_friends');
  end if;
  if exists (select 1 from damage_assessments
             where status = 'open'
               and least(challenger_id, opponent_id) = v_pair[1]
               and greatest(challenger_id, opponent_id) = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end if;
  insert into damage_assessments (challenger_id, opponent_id) values (me, p_opponent) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- my assessments, with per-side submission flags (never paths or hashes)
create or replace function public.my_damage_assessments() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'my_damage_assessments: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row order by row->>'created_at' desc) from (
      select jsonb_build_object(
        'id', da.id, 'status', da.status, 'created_at', da.created_at,
        'challenger_id', da.challenger_id, 'opponent_id', da.opponent_id,
        'opponent_name', coalesce(pp.display_name, 'Athlete'),
        'i_am_challenger', da.challenger_id = me,
        'winner_id', da.winner_id, 'verdict', da.verdict,
        'my_pre',    exists (select 1 from da_photos p where p.assessment_id = da.id and p.user_id = me and p.kind = 'pre'),
        'my_post',   exists (select 1 from da_photos p where p.assessment_id = da.id and p.user_id = me and p.kind = 'post'),
        'their_pre', exists (select 1 from da_photos p where p.assessment_id = da.id and p.user_id <> me and p.kind = 'pre'),
        'their_post',exists (select 1 from da_photos p where p.assessment_id = da.id and p.user_id <> me and p.kind = 'post')
      ) as row
      from damage_assessments da
      left join public_profile pp
        on pp.user_id = (case when da.challenger_id = me then da.opponent_id else da.challenger_id end)
      where da.challenger_id = me or da.opponent_id = me
      order by da.created_at desc
      limit 20
    ) t
  ), '[]'::jsonb);
end; $$;

-- either participant may cancel while open (photos are swept by the edge fn)
create or replace function public.cancel_damage_assessment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'cancel_damage_assessment: not signed in.' using errcode='insufficient_privilege'; end if;
  update damage_assessments set status = 'expired'
   where id = p_id and status = 'open' and (challenger_id = me or opponent_id = me);
  return jsonb_build_object('ok', found);
end; $$;

-- SERVICE-ROLE ONLY: write the verdict, grant winner XP (idempotent), update
-- the rivalry pair. Draw: p_winner null — both sides logged, nobody scores.
create or replace function public.finalize_damage_assessment(p_id uuid, p_winner uuid, p_verdict jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare da record; v_pair uuid[]; v_loser uuid;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role' then
    raise exception 'finalize_damage_assessment: server only.' using errcode='insufficient_privilege';
  end if;
  select * into da from damage_assessments where id = p_id and status = 'open';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_open'); end if;
  if p_winner is not null and p_winner not in (da.challenger_id, da.opponent_id) then
    return jsonb_build_object('ok', false, 'reason', 'bad_winner');
  end if;

  update damage_assessments
     set status = 'judged', winner_id = p_winner, verdict = p_verdict, judged_at = now()
   where id = p_id;

  if p_winner is not null then
    -- idempotent XP for the winner (event_key = the assessment id)
    perform set_config('evoforge.xp_authorized', 'server', true);
    insert into xp_ledger (user_id, event_key, event_type, source_id, xp_awarded, metadata)
    values (p_winner, 'da:' || p_id, 'battle_win', p_id::text, 40, jsonb_build_object('mode', 'damage_assessment'))
    on conflict (user_id, event_key) do nothing;

    -- rivalry: winner beats the other participant
    v_loser := case when p_winner = da.challenger_id then da.opponent_id else da.challenger_id end;
    v_pair := evo_pair(p_winner, v_loser);
    insert into rivalries (user_a, user_b, last_contest_at) values (v_pair[1], v_pair[2], now())
      on conflict (user_a, user_b) do nothing;
    update rivalries set
      a_wins = a_wins + (case when p_winner = v_pair[1] then 1 else 0 end),
      b_wins = b_wins + (case when p_winner = v_pair[2] then 1 else 0 end),
      points_a = points_a + (case when p_winner = v_pair[1] then 15 else 0 end),
      points_b = points_b + (case when p_winner = v_pair[2] then 15 else 0 end),
      last_contest_at = now()
    where user_a = v_pair[1] and user_b = v_pair[2];
  else
    v_pair := evo_pair(da.challenger_id, da.opponent_id);
    insert into rivalries (user_a, user_b, draws, last_contest_at) values (v_pair[1], v_pair[2], 1, now())
      on conflict (user_a, user_b) do update set draws = rivalries.draws + 1, last_contest_at = now();
  end if;

  return jsonb_build_object('ok', true);
end; $$;

-- grants (the Supabase default-grant gotcha from 036: revoke anon+authenticated
-- EXPLICITLY on anything clients must not call)
revoke all on function public.create_damage_assessment(uuid) from public, anon, authenticated;
revoke all on function public.my_damage_assessments() from public, anon, authenticated;
revoke all on function public.cancel_damage_assessment(uuid) from public, anon, authenticated;
revoke all on function public.finalize_damage_assessment(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_damage_assessment(uuid) to authenticated;
grant execute on function public.my_damage_assessments() to authenticated;
grant execute on function public.cancel_damage_assessment(uuid) to authenticated;
grant execute on function public.finalize_damage_assessment(uuid, uuid, jsonb) to service_role;
