-- EvoForge 149 — the sweep says WHICH duels it settled.
--
-- 148's sweep settles every due duel silently and returns a count. The in-app
-- notification is written inside `forge_challenge_settle` for both athletes, so
-- the bell is already correct — but the PHONE twin is fired by the client, and
-- a client handed `{settled: 2}` has nothing to address it to.
--
-- "You won 450 Forge Coins" is the single most motivating message this feature
-- can send, and before this it only reached a phone when somebody happened to
-- tap SETTLE by hand — which, now that the hub settles on open, almost nobody
-- does. Returning the ids costs one array and closes that.
--
-- Everything else is 148's body, verbatim.

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
  settled_ids uuid[] := '{}';
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
      settled_ids := settled_ids || r.id;
    exception when others then
      -- One stuck duel must never stop the others from settling.
      null;
    end;
  end loop;

  -- 148: ORPHANED ESCROW. Coins put into a duel that no longer exists — the
  -- only way to reach that state is the other side deleting their account.
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
                            'warned', warned, 'repaired', repaired,
                            'settled_ids', to_jsonb(settled_ids));
end;
$$;

grant execute on function public.forge_duel_sweep() to authenticated;

commit;
