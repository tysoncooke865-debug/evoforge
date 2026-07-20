-- EvoForge 074 — REAL-TIME LIVE PvP MATCHMAKING (Tyson, 2026-07-20).
-- MULTIPLAYER_ROADMAP.md Phase 4. Replaces "join by code" with online matchmaking:
-- two players queue, get paired, and fight the champion RPG move-by-move in real
-- time over Supabase Realtime — no code to share.
--
-- ARCHITECTURE (why no server referee): the battle-rpg engine is pure and takes an
-- injected rng. Both clients build the SAME canonical battle (seat 1 = "player",
-- seat 2 = "opponent") from the shared `seed` and resolve each turn with a per-turn
-- seeded PRNG (client/src/domain/battle-rpg/prng.ts) — so they compute byte-
-- identical states with NO referee (proven in prng.test.ts). Each client just
-- mirrors the VIEW for its own seat. Casual matches grant NOTHING farmable (the
-- existing versus/challenge posture), so client-authoritative resolution has no
-- exploit surface — only the head-to-head rivalry record moves, via the sanctioned
-- record_rivalry_result seam.
--
-- SECURITY: every table owner/participant-RLS; no client writes rows directly —
-- all mutation via SECURITY DEFINER RPCs. Matchmaking is advisory-locked so two
-- simultaneous enqueues can't double-pair. A move can only be written for YOUR own
-- seat. record_rivalry_result stays client-un-callable; pvp_finish (definer) is the
-- only seam that moves the rivalry here.
--
-- FALSIFICATION (two simulated JWTs A + B):
--  1. A enqueues → waits (matched=false); B enqueues → paired, ONE pvp_matches row,
--     both queue rows gone; A learns via Realtime / pvp_poll.
--  2. both submit_move for turn 0 → two pvp_moves rows; a THIRD submit for the same
--     (turn,seat) is rejected (unique); submitting for the OTHER seat is refused.
--  3. pvp_finish once records the rivalry; a second call is a no-op (idempotent).
--  4. a non-participant cannot select the match, its moves, or finish it.

-- ============================ TABLES ============================

-- The waiting room: at most one row per user (re-enqueue replaces).
create table if not exists public.pvp_queue (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  champion     text not null,
  player_input jsonb not null,
  enqueued_at  timestamptz not null default now()
);
alter table public.pvp_queue enable row level security;
drop policy if exists pvp_queue_owner on public.pvp_queue;
create policy pvp_queue_owner on public.pvp_queue
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A paired match. seat1/seat2 are the two players; the canonical battle is
-- seat1-as-player vs seat2-as-opponent, built identically on both devices.
create table if not exists public.pvp_matches (
  id          uuid primary key default gen_random_uuid(),
  seat1       uuid not null references auth.users(id) on delete cascade,
  seat2       uuid not null references auth.users(id) on delete cascade,
  seed        text not null,
  champion1   text not null,
  champion2   text not null,
  input1      jsonb not null,
  input2      jsonb not null,
  status      text not null default 'active' check (status in ('active','finished','abandoned')),
  winner_seat int check (winner_seat in (1,2)),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.pvp_matches enable row level security;
drop policy if exists pvp_matches_participant on public.pvp_matches;
create policy pvp_matches_participant on public.pvp_matches
  for select to authenticated using (seat1 = auth.uid() or seat2 = auth.uid());
create index if not exists pvp_matches_seat1 on public.pvp_matches (seat1) where status = 'active';
create index if not exists pvp_matches_seat2 on public.pvp_matches (seat2) where status = 'active';

-- The append-only move log. One move per (match, turn, seat). Both clients react
-- to the Realtime insert and resolve the turn once both seats' moves are in.
create table if not exists public.pvp_moves (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.pvp_matches(id) on delete cascade,
  turn       int not null,
  seat       int not null check (seat in (1,2)),
  move_id    text not null,
  created_at timestamptz not null default now(),
  unique (match_id, turn, seat)
);
alter table public.pvp_moves enable row level security;
drop policy if exists pvp_moves_participant on public.pvp_moves;
create policy pvp_moves_participant on public.pvp_moves
  for select to authenticated using (
    exists (select 1 from public.pvp_matches m
            where m.id = match_id and (m.seat1 = auth.uid() or m.seat2 = auth.uid())));

-- ============================ RPCs ============================

-- Enqueue + try to pair atomically. Advisory-locked so concurrent enqueues serialise
-- (no double-pairing). If a DIFFERENT waiting player exists, create the match, clear
-- both from the queue, and return the new match. Otherwise wait.
create or replace function public.pvp_enqueue(p_champion text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); opp record; v_id uuid; v_seed text;
begin
  if me is null then raise exception 'pvp_enqueue: not signed in.' using errcode='insufficient_privilege'; end if;
  perform pg_advisory_xact_lock(hashtext('pvp_matchmaking'));
  -- Oldest waiting opponent that isn't me.
  select * into opp from pvp_queue where user_id <> me order by enqueued_at asc limit 1;
  if opp.user_id is not null then
    v_seed := md5(random()::text || clock_timestamp()::text || me::text);
    insert into pvp_matches (seat1, seat2, seed, champion1, champion2, input1, input2)
    values (opp.user_id, me, v_seed, opp.champion, p_champion, opp.player_input, p_input)
    returning id into v_id;
    delete from pvp_queue where user_id in (me, opp.user_id);
    return jsonb_build_object('matched', true, 'match_id', v_id, 'seat', 2);
  end if;
  -- No opponent: (re)join the queue.
  insert into pvp_queue (user_id, champion, player_input) values (me, p_champion, p_input)
    on conflict (user_id) do update set champion = excluded.champion, player_input = excluded.player_input, enqueued_at = now();
  return jsonb_build_object('matched', false);
end; $$;
grant execute on function public.pvp_enqueue(text, jsonb) to authenticated;

-- A waiting client's fallback to Realtime: has someone paired with me? Returns the
-- active match I'm in (if any), so a missed socket event still lands the match.
create or replace function public.pvp_poll()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record;
begin
  if me is null then raise exception 'pvp_poll: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into m from pvp_matches
    where status = 'active' and (seat1 = me or seat2 = me)
    order by created_at desc limit 1;
  if m.id is null then return jsonb_build_object('matched', false); end if;
  return jsonb_build_object('matched', true, 'match_id', m.id, 'seat', case when m.seat1 = me then 1 else 2 end);
end; $$;
grant execute on function public.pvp_poll() to authenticated;

-- Leave the queue (cancel searching).
create or replace function public.pvp_cancel_queue()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'pvp_cancel_queue: not signed in.' using errcode='insufficient_privilege'; end if;
  delete from pvp_queue where user_id = me;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.pvp_cancel_queue() to authenticated;

-- Submit MY move for a turn. I can only write my OWN seat; a duplicate (turn,seat)
-- is a no-op (the unique index absorbs a retry). Legality (stamina/cooldown) is
-- checked identically on both clients from the deterministic state — nothing
-- farmable rides on it, so the server just enforces seat ownership + one-per-turn.
create or replace function public.pvp_submit_move(p_match uuid, p_turn int, p_move text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record; v_seat int;
begin
  if me is null then raise exception 'pvp_submit_move: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into m from pvp_matches where id = p_match;
  if m.id is null then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.seat1 = me then v_seat := 1; elsif m.seat2 = me then v_seat := 2;
  else return jsonb_build_object('ok', false, 'reason', 'not_participant'); end if;
  if m.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_active'); end if;
  insert into pvp_moves (match_id, turn, seat, move_id) values (p_match, p_turn, v_seat, p_move)
    on conflict (match_id, turn, seat) do nothing;
  return jsonb_build_object('ok', true, 'seat', v_seat);
end; $$;
grant execute on function public.pvp_submit_move(uuid, int, text) to authenticated;

-- End the match. The caller reports whether THEY won (both clients agree via the
-- deterministic engine). Idempotent: the first report finalises it and moves the
-- rivalry from that caller's correct perspective; later calls no-op.
create or replace function public.pvp_finish(p_match uuid, p_i_won boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record; v_seat int; v_other uuid; v_rows int;
begin
  if me is null then raise exception 'pvp_finish: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into m from pvp_matches where id = p_match;
  if m.id is null then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.seat1 = me then v_seat := 1; v_other := m.seat2;
  elsif m.seat2 = me then v_seat := 2; v_other := m.seat1;
  else return jsonb_build_object('ok', false, 'reason', 'not_participant'); end if;
  update pvp_matches set status = 'finished', finished_at = now(),
    winner_seat = case when p_i_won then v_seat else (3 - v_seat) end
    where id = p_match and status = 'active';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', true, 'already', true); end if;
  perform record_rivalry_result(v_other, case when p_i_won then 'win' else 'loss' end, 10);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.pvp_finish(uuid, boolean) to authenticated;

-- Voluntary quit / disconnect: I bail → the OTHER seat wins. Idempotent.
create or replace function public.pvp_forfeit(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m record; v_seat int; v_other uuid; v_rows int;
begin
  if me is null then raise exception 'pvp_forfeit: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into m from pvp_matches where id = p_match;
  if m.id is null then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.seat1 = me then v_seat := 1; v_other := m.seat2;
  elsif m.seat2 = me then v_seat := 2; v_other := m.seat1;
  else return jsonb_build_object('ok', false, 'reason', 'not_participant'); end if;
  update pvp_matches set status = 'abandoned', finished_at = now(), winner_seat = 3 - v_seat
    where id = p_match and status = 'active';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', true, 'already', true); end if;
  perform record_rivalry_result(v_other, 'loss', 10);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.pvp_forfeit(uuid) to authenticated;

-- ============================ REALTIME ============================
-- Clients subscribe to postgres_changes on these; RLS delivers only the caller's
-- own matches/moves. (idempotent add — ignore "already member" on re-run.)
do $$ begin
  alter publication supabase_realtime add table public.pvp_matches;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.pvp_moves;
exception when duplicate_object then null; end $$;
