-- EvoForge 148 — coins are never destroyed by somebody else leaving.
--
-- THE HOLE. `forge_challenges.challenger_id`/`opponent_id` are ON DELETE
-- CASCADE, so an athlete deleting their account takes their duels with them.
-- The duel row goes; the OTHER athlete's negative `challenge_stake` row in
-- coin_events stays. Their coins are gone, there is no pot left to pay them
-- from, and nothing in the app will ever mention it. The same is true of a
-- spectator's support stake.
--
-- The cascade is right — a deleted account should not leave rows pointing at a
-- user who no longer exists — so the fix is a REPAIR, not a different foreign
-- key: when an athlete opens the hub, the sweep refunds any escrow of theirs
-- whose duel has ceased to exist.
--
-- IT IS SELF-CANCELLING, which is what makes it safe to run on every sweep.
-- The refund is filed under the same duel id with an `:orphan` suffix, so the
-- next pass groups it WITH the stake it repaid, the group's net reaches zero,
-- and the `having sum < 0` filter excludes it forever. The ledger's unique
-- index on (user_id, kind, source_id) is the backstop underneath that.
--
-- FALSIFY: escrow a duel, delete the row out from under it, sweep — the
-- survivor is made whole exactly once, and a second sweep pays nothing.

begin;

create or replace function public.forge_duel_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  r record;
  settled int := 0;
  expired int := 0;
  warned int := 0;
  repaired int := 0;
begin
  if me is null then
    raise exception 'forge_duel_sweep: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  with dead as (
    update public.forge_challenges
    set status = 'expired'
    where status = 'pending' and expires_at <= now()
      and (challenger_id = me or opponent_id = me)
    returning 1
  ) select count(*) into expired from dead;

  update public.forge_duel_offers o
  set status = 'expired', responded_at = now()
  from public.forge_challenges c
  where o.challenge_id = c.id and o.status = 'pending' and o.expires_at <= now()
    and (c.challenger_id = me or c.opponent_id = me);

  for r in
    select c.id from public.forge_challenges c
    where (c.challenger_id = me or c.opponent_id = me)
      and c.status in ('active', 'awaiting_settlement')
      and c.ends_at <= now()
      and not exists (select 1 from public.forge_challenge_disputes d
                      where d.challenge_id = c.id and d.status = 'open')
    limit 20
  loop
    begin
      perform public.forge_challenge_settle(r.id);
      settled := settled + 1;
    exception when others then
      -- One stuck duel must never stop the others from settling.
      null;
    end;
  end loop;

  -- ── 148: ORPHANED ESCROW ────────────────────────────────────────────────
  -- Coins this athlete put into a duel that no longer exists. The only way to
  -- reach this state is the other side deleting their account, and the only
  -- honest answer is to give the coins back.
  for r in
    select split_part(ce.source_id, ':', 1) as duel,
           sum(ce.amount)::int as net,
           bool_or(ce.kind like 'duel_support%') as is_support
    from public.coin_events ce
    where ce.user_id = me
      and ce.kind in ('challenge_stake', 'challenge_payout',
                      'duel_support_stake', 'duel_support_payout')
      and ce.source_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      and not exists (
        select 1 from public.forge_challenges c
        where c.id = split_part(ce.source_id, ':', 1)::uuid)
    group by 1
    having sum(ce.amount) < 0
    limit 20
  loop
    begin
      perform set_config('evoforge.challenge_authorized', r.duel || ':orphan', true);
      insert into public.coin_events (user_id, kind, amount, source_id)
      values (me,
              case when r.is_support then 'duel_support_payout' else 'challenge_payout' end,
              -r.net,
              r.duel || ':orphan');
      repaired := repaired + 1;
    exception when unique_violation then
      -- Already repaired by a concurrent sweep. Nothing owed.
      null;
    end;
  end loop;

  for r in
    select c.id, c.challenger_id, c.opponent_id, c.ends_at
    from public.forge_challenges c
    where (c.challenger_id = me or c.opponent_id = me)
      and c.status = 'active'
      and c.ends_at > now() and c.ends_at <= now() + interval '24 hours'
    limit 20
  loop
    if not exists (
      select 1 from public.social_notifications n
      where n.user_id = me and n.type = 'duel_ending'
        and n.detail ->> 'challenge_id' = r.id::text
    ) then
      perform public.forge_duel_notify(
        me,
        case when r.challenger_id = me then r.opponent_id else r.challenger_id end,
        'duel_ending',
        jsonb_build_object('challenge_id', r.id, 'ends_at', r.ends_at));
      warned := warned + 1;
    end if;
  end loop;

  return jsonb_build_object('settled', settled, 'expired', expired,
                            'warned', warned, 'repaired', repaired);
end;
$$;

grant execute on function public.forge_duel_sweep() to authenticated;

commit;
