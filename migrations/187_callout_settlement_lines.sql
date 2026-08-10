-- EvoForge 187 - WHO ENDED UP WHERE, PER PERSON.
--
-- §5 asks settlement to show per-person ledger lines - "Sarah +37", "Marcus -50" -
-- rather than ingots sweeping to a winner. A pool has up to eight people in it and
-- "the winner took 150" tells none of them what happened to their own coins.
--
-- ── THE NET COMES FROM THE LEDGER, NOT FROM THE ENTRIES TABLE ──
--
-- `workout_callout_entries.payout` exists and is written at settlement, but it only
-- covers JOINERS - the two principals have no entry row, and they are usually the
-- largest positions in the pool. Reading payouts from there would produce a
-- settlement screen missing the athlete.
--
-- `sum(coin_events.amount)` for the call out is the whole truth for everybody: a
-- stake is negative, a payout positive, and the sum is exactly what that person is
-- up or down. It is the same realisation that fixed `callout_refund_both` in 182 -
-- stop naming participants, ask the ledger who it moved coins for.
--
-- It is also self-checking by construction: the lines must sum to ZERO on a settled
-- pool, because nothing is minted and nothing is taken. The verification below
-- asserts that against real settled rows.
--
-- SIDES ARE REPORTED, NOT INFERRED FROM THE SIGN. A backer who won and a pusher who
-- won look identical in the ledger; the screen needs to say which pan somebody was
-- standing in, and on a draw or a refund nobody's sign says anything at all.

begin;

create or replace function public.callout_settlement(p_callout uuid)
returns table (
  user_id uuid,
  display_name text,
  side text,
  staked int,
  net int
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with c as (
    select * from public.workout_callouts where id = p_callout
  ),
  -- Everybody with a position: the two principals, then the joiners.
  people as (
    select c.athlete_id as uid, 'back'::text as side, c.stake as staked from c
    union all
    select c.opponent_id, 'push', c.stake from c
    union all
    select e.user_id, e.side, e.stake
      from public.workout_callout_entries e, c where e.callout_id = c.id
  )
  select
    p.uid,
    coalesce((select pp.display_name from public.public_profile pp where pp.user_id = p.uid),
             'Athlete'),
    p.side,
    p.staked::int,
    -- THE LEDGER'S ANSWER. Negative stake plus positive payout; the sum is what
    -- this person actually gained or lost on this call out.
    coalesce((select sum(ce.amount)::int from public.coin_events ce
              where ce.source_id = p_callout::text
                and ce.kind in ('callout_stake', 'callout_payout')
                and ce.user_id = p.uid), 0)
  from people p, c
  -- Only people in the pool may read the pool. Same rule as `callout_pool`.
  where public.is_callout_participant(p_callout, auth.uid())
  order by
    -- Winners first, largest first, then the losers. A settlement screen should
    -- lead with what happened rather than with an arbitrary join order.
    coalesce((select sum(ce.amount)::int from public.coin_events ce
              where ce.source_id = p_callout::text
                and ce.kind in ('callout_stake', 'callout_payout')
                and ce.user_id = p.uid), 0) desc,
    p.staked desc;
$$;
revoke execute on function public.callout_settlement(uuid) from public, anon;
grant execute on function public.callout_settlement(uuid) to authenticated;

-- ─────────── PROVEN: the lines sum to zero on every settled pool

do $$
declare
  r record;
  total int;
  n int := 0;
begin
  for r in
    select c.id, c.athlete_id
    from public.workout_callouts c
    where c.status = 'settled'
      and exists (select 1 from public.coin_events ce
                  where ce.source_id = c.id::text and ce.kind = 'callout_payout')
    order by c.settled_at desc nulls last
    limit 5
  loop
    -- Read as a participant, because the function refuses anybody else.
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', r.athlete_id), true);
    select coalesce(sum(s.net), 0) into total from public.callout_settlement(r.id) s;
    if total <> 0 then
      raise exception 'settled call out % does not balance: the lines sum to %', r.id, total;
    end if;
    -- And every participant appears; a settlement missing somebody is the bug this
    -- function exists to prevent.
    select count(*) into n from public.callout_settlement(r.id);
    if n < 2 then
      raise exception 'call out % reported % lines; both principals must appear', r.id, n;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  -- And a stranger gets nothing at all.
  select c.id into r from public.workout_callouts c limit 1;
  if r.id is not null then
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-4000-8000-00000000dead","role":"authenticated"}', true);
    select count(*) into n from public.callout_settlement(r.id);
    if n <> 0 then
      raise exception 'a stranger can read a settlement (% lines)', n;
    end if;
    perform set_config('request.jwt.claims', '', true);
  end if;
end $$;

commit;
