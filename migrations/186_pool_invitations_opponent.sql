-- EvoForge 186 - THE PANS NEED BOTH PRINCIPALS, SO THEY NEED THE OPPONENT'S ID.
--
-- Phase 6 renders each side of a pool as a pan of real ingots, one piece per
-- contributor, tinted by owner. The first build showed NOTHING in either pan on a
-- pool with no joiners yet - because the only positions it knew about came from
-- `workout_callout_entries`, and the athlete's stake and the opponent's stake live
-- on the callout row instead.
--
-- So a 50 v 50 pool displayed "50" and "50" above two empty pans. The totals were
-- right and the metal that makes them up was missing, which is precisely the thing
-- §5 asks the scale to show.
--
-- `my_pool_invitations` already returns `athlete_id`. It now returns `opponent_id`
-- too, so the client can synthesise both principals as positions and tint them to
-- their real owners rather than to an anonymous placeholder - "no anonymous tokens"
-- applies to the two people with the most metal in the pool, most of all.

begin;

drop function if exists public.my_pool_invitations();

create function public.my_pool_invitations()
returns table (
  callout_id uuid,
  athlete_id uuid,
  athlete_name text,
  opponent_id uuid,
  exercise text,
  target_label text,
  workout_date date,
  set_no smallint,
  status text,
  expires_at timestamptz,
  back_total int,
  push_total int,
  joiners int,
  my_side text,
  my_stake int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id,
    c.athlete_id,
    coalesce(
      (select pp.display_name from public.public_profile pp where pp.user_id = c.athlete_id),
      'Someone'),
    -- 186: the PUSH pan's anchor. The opponent's stake is on the callout row, not in
    -- the entries table, so without this the pan cannot attribute it to anybody.
    c.opponent_id,
    c.exercise,
    c.target_label,
    c.workout_date,
    c.set_no,
    c.status,
    c.expires_at,
    (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                         where e.callout_id = c.id and e.side = 'back'), 0))::int,
    (c.stake + coalesce((select sum(e.stake)::int from public.workout_callout_entries e
                         where e.callout_id = c.id and e.side = 'push'), 0))::int,
    (select count(*)::int from public.workout_callout_entries e where e.callout_id = c.id),
    (select e.side from public.workout_callout_entries e
      where e.callout_id = c.id and e.user_id = auth.uid()),
    (select e.stake from public.workout_callout_entries e
      where e.callout_id = c.id and e.user_id = auth.uid())
  from public.workout_callouts c
  join public.workout_callout_invites i on i.callout_id = c.id and i.user_id = auth.uid()
  where auth.uid() is not null
    and c.mode = 'pot'
    and c.athlete_id <> auth.uid()
    and c.opponent_id <> auth.uid()
    and (c.status in ('offered', 'accepted', 'awaiting_verification', 'disputed')
         or (c.status = 'settled' and c.settled_at > now() - interval '2 days'))
  order by c.expires_at;
$$;
revoke execute on function public.my_pool_invitations() from public, anon;
grant execute on function public.my_pool_invitations() to authenticated;

do $$
declare d text := pg_get_functiondef('public.my_pool_invitations()'::regprocedure);
begin
  if d not like '%opponent_id uuid%' then
    raise exception 'the opponent id is not returned; the PUSH pan cannot attribute its metal';
  end if;
  -- The invite-only join and the principal exclusions must survive the rewrite.
  if d not like '%workout_callout_invites%' then
    raise exception 'the invitation join went missing';
  end if;
  if d not like '%c.athlete_id <> auth.uid()%' then
    raise exception 'the principal exclusion went missing';
  end if;
end $$;

commit;
