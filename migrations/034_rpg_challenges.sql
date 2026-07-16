-- EvoForge 034 — RPG BATTLE CHALLENGES (Tyson: "VS join by code", 2026-07-16).
--
-- Async friend battles WITHOUT real-time networking: you build a champion and
-- CREATE a challenge → get a 6-char code → share it. A friend JOINS by code
-- from their own device and battles YOUR champion (driven by AI from your
-- saved build). Wins/losses post back so you can see how your champion fares.
-- (Live move-by-move PvP is the documented next step; this ships tonight.)
--
-- Reads-by-code cross users, so joining goes through a SECURITY DEFINER RPC
-- (owner-RLS on the table itself). Same posture as the leaderboard reads.

create table if not exists public.rpg_challenges (
  id           uuid        primary key default gen_random_uuid(),
  code         text        not null unique check (code ~ '^[A-Z0-9]{6}$'),
  owner_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  owner_name   text        not null,
  champion     text        not null check (champion in ('aesthetic', 'titan', 'apex', 'shredded')),
  -- The challenger's real combat stats {size,aes,str,cnd}, 0..100 each.
  player_input jsonb       not null,
  plays        integer     not null default 0,
  defeats      integer     not null default 0, -- times the champion was beaten
  created_at   timestamptz not null default now()
);
create index if not exists rpg_challenges_owner_idx on public.rpg_challenges (owner_id, created_at desc);

alter table public.rpg_challenges enable row level security;
-- Owners read/insert their own; cross-user joining is via get_rpg_challenge.
drop policy if exists rpg_challenges_owner_select on public.rpg_challenges;
create policy rpg_challenges_owner_select on public.rpg_challenges for select to authenticated using (owner_id = auth.uid());
drop policy if exists rpg_challenges_owner_insert on public.rpg_challenges;
create policy rpg_challenges_owner_insert on public.rpg_challenges for insert to authenticated with check (owner_id = auth.uid());

-- Create a challenge, generating a unique code (retry on collision).
create or replace function public.create_rpg_challenge(p_champion text, p_owner_name text, p_player_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try int := 0;
begin
  if auth.uid() is null then
    raise exception 'create_rpg_challenge: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_champion not in ('aesthetic', 'titan', 'apex', 'shredded') then
    raise exception 'create_rpg_challenge: unknown champion %.', p_champion using errcode = 'check_violation';
  end if;
  loop
    v_try := v_try + 1;
    -- 6-char code from an md5 hex digest (0-9A-F satisfies the A-Z0-9 check).
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_try::text), 1, 6));
    begin
      insert into public.rpg_challenges (code, owner_name, champion, player_input)
      values (v_code, coalesce(nullif(p_owner_name, ''), 'Challenger'), p_champion, p_player_input);
      return jsonb_build_object('code', v_code);
    exception when unique_violation then
      if v_try > 8 then raise; end if;
    end;
  end loop;
end;
$$;

-- Fetch a challenge to JOIN (any signed-in user, by code).
create or replace function public.get_rpg_challenge(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if auth.uid() is null then
    raise exception 'get_rpg_challenge: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.rpg_challenges where code = upper(p_code);
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'code', c.code,
    'owner_name', c.owner_name,
    'champion', c.champion,
    'player_input', c.player_input,
    'plays', c.plays,
    'defeats', c.defeats,
    'is_own', c.owner_id = auth.uid()
  );
end;
$$;

-- Post a join result back to the challenge (increments plays; defeats if the
-- joiner beat the champion). Idempotency is best-effort (casual mode).
create or replace function public.record_rpg_challenge_result(p_code text, p_joiner_won boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if auth.uid() is null then
    raise exception 'record_rpg_challenge_result: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.rpg_challenges where code = upper(p_code);
  if not found then return jsonb_build_object('ok', false); end if;
  -- Don't count the owner testing their own challenge.
  if c.owner_id = auth.uid() then return jsonb_build_object('ok', true, 'counted', false); end if;
  update public.rpg_challenges
    set plays = plays + 1, defeats = defeats + (case when p_joiner_won then 1 else 0 end)
    where id = c.id;
  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

revoke all on function public.create_rpg_challenge(text, text, jsonb) from public;
revoke all on function public.get_rpg_challenge(text) from public;
revoke all on function public.record_rpg_challenge_result(text, boolean) from public;
grant execute on function public.create_rpg_challenge(text, text, jsonb) to authenticated;
grant execute on function public.get_rpg_challenge(text) to authenticated;
grant execute on function public.record_rpg_challenge_result(text, boolean) to authenticated;
