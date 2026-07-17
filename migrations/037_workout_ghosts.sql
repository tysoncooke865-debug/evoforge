-- EvoForge 037 — GHOST BATTLES (Tyson, 2026-07-17, autonomous). Phase 2 of the
-- social roadmap (MULTIPLAYER_ROADMAP.md), gated on 036 (friends/rivalry).
--
-- When a workout is finished you may PUBLISH it as a "ghost": a snapshot of the
-- session's combat stats + headline numbers (NO body photos — numbers only). A
-- FRIEND loads the ghost and fights an AI opponent driven by that snapshot; the
-- result posts to the rivalry. Cross-user reads go through SECURITY DEFINER RPCs
-- (owner-RLS on the table); the rivalry write happens inside a definer RPC that
-- calls 036's record_rivalry_result (which is NOT client-callable). Same posture
-- as 034/036.

create table if not exists public.workout_ghosts (
  id           uuid        primary key default gen_random_uuid(),
  owner_id     uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  owner_name   text        not null,
  workout      text        not null,
  date         date        not null,
  champion     text        not null check (champion in ('aesthetic','titan','apex','shredded')),
  player_input jsonb       not null,                       -- {size,aes,str,cnd} 0..100
  headline     jsonb       not null default '{}'::jsonb,   -- {sets,volume,prs} display-only
  plays        integer     not null default 0,
  defeats      integer     not null default 0,             -- times the ghost was beaten
  created_at   timestamptz not null default now(),
  unique (owner_id, workout, date)                         -- one ghost per session
);
create index if not exists workout_ghosts_owner_idx on public.workout_ghosts (owner_id, created_at desc);

alter table public.workout_ghosts enable row level security;
drop policy if exists workout_ghosts_owner_select on public.workout_ghosts;
create policy workout_ghosts_owner_select on public.workout_ghosts
  for select to authenticated using (owner_id = auth.uid());

-- publish (or refresh) a ghost for a finished session. Owner only.
create or replace function public.publish_ghost(
  p_workout text, p_date date, p_champion text, p_owner_name text, p_input jsonb, p_headline jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'publish_ghost: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_champion not in ('aesthetic','titan','apex','shredded') then raise exception 'publish_ghost: unknown champion %.', p_champion using errcode='check_violation'; end if;
  insert into workout_ghosts (owner_id, owner_name, workout, date, champion, player_input, headline)
  values (auth.uid(), coalesce(nullif(p_owner_name,''),'Athlete'), p_workout, p_date, p_champion, p_input, coalesce(p_headline,'{}'::jsonb))
  on conflict (owner_id, workout, date)
    do update set champion = excluded.champion, player_input = excluded.player_input,
                  headline = excluded.headline, owner_name = excluded.owner_name, created_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- list my FRIENDS' recent ghosts (the ones I can fight). Never my own.
create or replace function public.list_friend_ghosts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'list_friend_ghosts: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(g order by g.created_at desc) from (
      select wg.id, wg.owner_id, wg.owner_name, wg.workout, wg.date, wg.champion,
             wg.headline, wg.plays, wg.defeats, wg.created_at
      from workout_ghosts wg
      where wg.owner_id in (
        select case when user_a = me then user_b else user_a end
        from friendships where user_a = me or user_b = me
      )
      order by wg.created_at desc
      limit 40
    ) g
  ), '[]'::jsonb);
end; $$;

-- load a ghost to fight — owner OR a friend of the owner only.
create or replace function public.get_ghost(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g record; me uuid := auth.uid(); v_pair uuid[];
begin
  if me is null then raise exception 'get_ghost: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into g from workout_ghosts where id = p_id;
  if not found then return jsonb_build_object('found', false); end if;
  if g.owner_id <> me then
    v_pair := evo_pair(me, g.owner_id);
    if not exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
      return jsonb_build_object('found', false); -- not a friend: as if it does not exist
    end if;
  end if;
  return jsonb_build_object(
    'found', true, 'id', g.id, 'owner_id', g.owner_id, 'owner_name', g.owner_name,
    'workout', g.workout, 'date', g.date, 'champion', g.champion,
    'player_input', g.player_input, 'headline', g.headline,
    'plays', g.plays, 'defeats', g.defeats, 'is_own', g.owner_id = me
  );
end; $$;

-- record a ghost battle result. Caller fought the OWNER's ghost; must be a
-- friend and not the owner. Updates plays/defeats and posts to the rivalry.
create or replace function public.record_ghost_result(p_id uuid, p_won boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g record; me uuid := auth.uid(); v_pair uuid[];
begin
  if me is null then raise exception 'record_ghost_result: not signed in.' using errcode='insufficient_privilege'; end if;
  select * into g from workout_ghosts where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if g.owner_id = me then return jsonb_build_object('ok', true, 'counted', false); end if; -- fighting your own ghost: not counted
  v_pair := evo_pair(me, g.owner_id);
  if not exists (select 1 from friendships where user_a = v_pair[1] and user_b = v_pair[2]) then
    return jsonb_build_object('ok', false, 'reason', 'not_friends');
  end if;
  update workout_ghosts set plays = plays + 1, defeats = defeats + (case when p_won then 1 else 0 end) where id = g.id;
  -- the challenger's outcome vs the ghost's owner feeds the rivalry
  perform record_rivalry_result(g.owner_id, case when p_won then 'win' else 'loss' end, 10);
  return jsonb_build_object('ok', true, 'counted', true);
end; $$;

revoke all on function public.publish_ghost(text, date, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.list_friend_ghosts() from public, anon, authenticated;
revoke all on function public.get_ghost(uuid) from public, anon, authenticated;
revoke all on function public.record_ghost_result(uuid, boolean) from public, anon, authenticated;
grant execute on function public.publish_ghost(text, date, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.list_friend_ghosts() to authenticated;
grant execute on function public.get_ghost(uuid) to authenticated;
grant execute on function public.record_ghost_result(uuid, boolean) to authenticated;
