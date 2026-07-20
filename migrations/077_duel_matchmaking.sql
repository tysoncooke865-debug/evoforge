-- EvoForge 077 — FITNESS-DUEL MATCHMAKING (Tyson, 2026-07-20).
--
-- Last code-based join: the System-A real-workout duel (battle_matches) was set
-- up by minting + sharing a 6-char invite_code. Replace with matchmaking: two
-- players queue for a FORMAT (blitz / volume_duel / heads_or_tails) and get
-- auto-paired into a match, born at status='matched' with invite_code=null. The
-- entire post-pairing flow (battle-ready → rounds → battle-settle) is unchanged —
-- a matchmade match enters exactly where a code-joined one did.
--
-- AUTHORITY: battle_matches/battle_participants have NO client-write policies —
-- only the service role (edge fns) wrote them. A SECURITY DEFINER RPC runs as the
-- table owner and bypasses RLS the same way (like pvp_enqueue in 074), and those
-- two tables carry NO guard triggers (the service_role early-returns live only on
-- battle_events/xp_events), so a definer RPC writes them cleanly. Snapshots are
-- server-CLAMPED (clean_battle_snapshot, the SQL port of the edge fn's
-- cleanSnapshot) and identity comes from public_profile — a client can't inflate
-- its stats or spoof a name. Pairing is advisory-locked per format (no double-pair).
--
-- FALSIFICATION (two JWTs):
--  1. A enqueues blitz → waits; B enqueues blitz → paired: ONE battle_matches row
--     (mode='friendly', format='blitz', status='matched', invite_code NULL) + TWO
--     participants (seat1=A, seat2=B) with clamped snapshots; both queue rows gone.
--  2. a blitz seeker never pairs with a volume_duel seeker (paired by format).
--  3. a client can't inflate: snapshot power/level clamped to scale; name forced.
--  4. cancel removes the queue row; poll returns the caller's fresh matched match.

-- ── the duel queue (mirror pvp_queue; battle_queue from 009 is dead + unfit) ──
create table if not exists public.battle_duel_queue (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  format      text not null check (format in ('blitz','volume_duel','heads_or_tails')),
  snapshot    jsonb not null,
  name        text not null,
  enqueued_at timestamptz not null default now()
);
alter table public.battle_duel_queue enable row level security;
drop policy if exists battle_duel_queue_owner on public.battle_duel_queue;
create policy battle_duel_queue_owner on public.battle_duel_queue
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── snapshot clamp (SQL port of _shared/battle/service.ts::cleanSnapshot) ──
create or replace function public._snap_num(raw jsonb, k text, lo numeric, hi numeric, dflt numeric)
returns int language sql immutable as $$
  select greatest(lo, least(hi, coalesce(
    case when (raw->>k) ~ '^-?[0-9]+(\.[0-9]+)?$' then trunc((raw->>k)::numeric) else dflt end, dflt)))::int;
$$;

create or replace function public.clean_battle_snapshot(raw jsonb, display_name text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'name', display_name,
    'level', public._snap_num(coalesce(raw,'{}'::jsonb),'level',1,100,1),
    'power', public._snap_num(coalesce(raw,'{}'::jsonb),'power',0,999,0),
    'strengthScore', public._snap_num(coalesce(raw,'{}'::jsonb),'strengthScore',0,100,0),
    'conditioningScore', public._snap_num(coalesce(raw,'{}'::jsonb),'conditioningScore',0,100,0),
    'branch', case when coalesce(raw,'{}'::jsonb)->>'branch' in ('aesthetic','mass','hybrid','titan','cardio','shredder')
                   then raw->>'branch' else 'aesthetic' end,
    'stage', public._snap_num(coalesce(raw,'{}'::jsonb),'stage',1,4,1),
    'sex', case when coalesce(raw,'{}'::jsonb)->>'sex' in ('male','female') then raw->>'sex' else 'male' end,
    'characterClass', case when jsonb_typeof(coalesce(raw,'{}'::jsonb)->'characterClass')='string'
                          then left(raw->>'characterClass',40) else 'Rising Aesthetic' end,
    'rating', 1000
  );
$$;

-- ── the matchmaker ──
create or replace function public.battle_matchmake(p_format text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); nm text; opp record; v_match uuid; v_season uuid;
begin
  if me is null then raise exception 'battle_matchmake: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_format not in ('blitz','volume_duel','heads_or_tails') then return jsonb_build_object('ok', false, 'reason', 'bad_format'); end if;
  -- D4 gate: a battle needs the public display name (identity, never body-supplied).
  select display_name into nm from public_profile where user_id = me;
  if nm is null or btrim(nm) = '' then return jsonb_build_object('ok', false, 'reason', 'no_name'); end if;

  perform pg_advisory_xact_lock(hashtext('battle_matchmaking:'||p_format));
  select * into opp from battle_duel_queue where format = p_format and user_id <> me order by enqueued_at asc limit 1;
  if opp.user_id is not null then
    select id into v_season from battle_seasons where is_active order by starts_at desc limit 1;
    insert into battle_matches (season_id, mode, format, status, invite_code)
    values (v_season, 'friendly', p_format, 'matched', null) returning id into v_match;
    insert into battle_participants (match_id, user_id, seat, snapshot)
      values (v_match, opp.user_id, 1, public.clean_battle_snapshot(opp.snapshot, opp.name));
    insert into battle_participants (match_id, user_id, seat, snapshot)
      values (v_match, me, 2, public.clean_battle_snapshot(p_snapshot, nm));
    delete from battle_duel_queue where user_id in (me, opp.user_id);
    return jsonb_build_object('ok', true, 'matched', true, 'match_id', v_match, 'seat', 2);
  end if;
  insert into battle_duel_queue (user_id, format, snapshot, name) values (me, p_format, coalesce(p_snapshot,'{}'::jsonb), nm)
    on conflict (user_id) do update set format = excluded.format, snapshot = excluded.snapshot, name = excluded.name, enqueued_at = now();
  return jsonb_build_object('ok', true, 'matched', false);
end; $$;
grant execute on function public.battle_matchmake(text, jsonb) to authenticated;

-- Realtime fallback: the freshest live match I've been paired into.
create or replace function public.battle_matchmake_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record;
begin
  if me is null then raise exception 'battle_matchmake_poll: not signed in.' using errcode='insufficient_privilege'; end if;
  select bm.id, bp.seat into m
  from battle_matches bm
  join battle_participants bp on bp.match_id = bm.id and bp.user_id = me
  where bm.status in ('matched','active') and bm.mode = 'friendly'
    and bm.created_at > now() - interval '3 minutes'
  order by bm.created_at desc limit 1;
  if m.id is null then return jsonb_build_object('matched', false); end if;
  return jsonb_build_object('matched', true, 'match_id', m.id, 'seat', m.seat);
end; $$;
grant execute on function public.battle_matchmake_poll() to authenticated;

create or replace function public.battle_matchmake_cancel()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'battle_matchmake_cancel: not signed in.' using errcode='insufficient_privilege'; end if;
  delete from battle_duel_queue where user_id = auth.uid();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.battle_matchmake_cancel() to authenticated;
