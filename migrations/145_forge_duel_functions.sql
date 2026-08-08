-- EvoForge 145 — THE FORGE DUEL: the server that owns the coins.
--
-- Everything that decides money lives here. The client calls these and renders
-- the answer; it never computes a score, names a winner, sets a balance or
-- moves a coin. A tampered client can ask for something it is not entitled to
-- and be refused, and that is the whole of its power.
--
-- THE FIVE PROPERTIES EVERY FUNCTION BELOW HOLDS
--
--   IDEMPOTENT. Each transition locks its row (`for update`) and re-checks the
--   status it is moving FROM. A doubled tap, a retry and a flaky network are
--   the same event, and all three are a no-op the second time.
--
--   ATOMIC. Escrow is coin rows plus a status change in ONE transaction. If the
--   second athlete cannot cover a raise, the first athlete's coins were never
--   taken.
--
--   SERVER-COMPUTED. Balances come from `coin_events`, scores come from
--   `workout_log` / `cardio_log` / `workout_sessions`, and the all-in amount
--   comes from the ledger — never from an argument.
--
--   NON-INFLATIONARY. Every payout is funded by coins escrowed earlier in the
--   same duel. The supporter pool is pari-mutuel, so the losing side's coins
--   are the ONLY source winners are paid from: a duel can never pay out more
--   than it took in, whatever the participants do.
--
--   A NOTIFICATION CANNOT COST A COIN. Every notification insert is wrapped so
--   a failure there can never roll back the payment it was announcing (the
--   054/058 lesson, applied to money instead of a post).

begin;

-- ────────────────────────────────────── notifications learn the duel words

-- Widen the domain FIRST. An unlisted type raises, and a raise inside a
-- transaction that just moved coins would roll the coins back.
alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications
  add constraint social_notifications_type_check
  check (type in ('reaction','comment','friend_request','friend_accepted','mention',
                  'comment_reaction','comment_reply','pr_beaten',
                  'duel_invite','duel_accepted','duel_declined',
                  'duel_raise','duel_raise_accepted','duel_raise_declined',
                  'duel_lead_change','duel_support','duel_ending','duel_settled'));

/**
 * Tell somebody something about a duel — and NEVER at the cost of the thing
 * being announced. The exception block is the point: a full inbox, a dropped
 * constraint or a deadlock must not undo a settled pot.
 */
create or replace function public.forge_duel_notify(
  p_user uuid, p_actor uuid, p_type text, p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  begin
    insert into public.social_notifications (user_id, actor_id, type, detail)
    values (p_user, p_actor, p_type, p_detail);
  exception when others then
    -- Announced or not, the coins are correct. That is the invariant.
    null;
  end;
end;
$$;
revoke execute on function public.forge_duel_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────── small helpers

/** The live ledger balance. Never an argument, never a cached column. */
create or replace function public.forge_duel_balance(p_user uuid)
returns int
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(amount), 0)::int from public.coin_events where user_id = p_user;
$$;
revoke execute on function public.forge_duel_balance(uuid) from public, anon;

/** May this athlete watch this duel? A participant always; a FRIEND of either
 *  side when the participants left spectating on, and never anyone blocked. */
create or replace function public.forge_duel_can_watch(p_challenge uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare c public.forge_challenges%rowtype;
begin
  select * into c from public.forge_challenges where id = p_challenge;
  if not found or p_user is null then return false; end if;
  if c.challenger_id = p_user or c.opponent_id = p_user then return true; end if;
  if not c.spectators_enabled then return false; end if;
  -- A duel is only watchable once it is real. A pending invite is a private
  -- conversation between two people.
  if c.status not in ('active', 'awaiting_settlement', 'disputed', 'settled') then return false; end if;
  if public.is_blocked(p_user, c.challenger_id) or public.is_blocked(p_user, c.opponent_id) then
    return false;
  end if;
  return public.are_friends(p_user, c.challenger_id) or public.are_friends(p_user, c.opponent_id);
end;
$$;
revoke execute on function public.forge_duel_can_watch(uuid, uuid) from public, anon;
grant execute on function public.forge_duel_can_watch(uuid, uuid) to authenticated;

/**
 * IS A RAISE AVAILABLE? The rule, in one sentence the UI can print:
 * BOTH athletes must have logged a qualifying session since the last accepted
 * raise (or since acceptance, if there has not been one).
 *
 * This is what ties the wager to the training. A raise is not a button you can
 * spam between sessions; it is something the duel earns.
 */
create or replace function public.forge_duel_raise_state(p_challenge uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  cfg public.forge_duel_config;
  since timestamptz;
  a_ok boolean;
  b_ok boolean;
  blocked uuid;
begin
  select * into c from public.forge_challenges where id = p_challenge;
  if not found or c.status not in ('active', 'awaiting_settlement') then
    return jsonb_build_object('unlocked', false, 'reason', 'not_active');
  end if;
  select * into cfg from public.forge_duel_config where id;
  if c.raises_accepted >= cfg.max_raises then
    return jsonb_build_object('unlocked', false, 'reason', 'max_raises',
                              'max_raises', cfg.max_raises);
  end if;

  since := coalesce(c.last_raise_at, c.accepted_at);
  select coalesce(p.last_qualifying_at, '-infinity'::timestamptz) > since into a_ok
    from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.challenger_id;
  select coalesce(p.last_qualifying_at, '-infinity'::timestamptz) > since into b_ok
    from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.opponent_id;

  if coalesce(a_ok, false) and coalesce(b_ok, false) then
    return jsonb_build_object('unlocked', true, 'reason', 'ready');
  end if;
  -- Name ONE athlete the UI can wait on. When both are outstanding, the
  -- reader's own name is the honest one to show first: it is the half they
  -- can do something about.
  blocked := case when not coalesce(a_ok, false) then c.challenger_id else c.opponent_id end;
  return jsonb_build_object('unlocked', false, 'reason', 'needs_session',
                            'waiting_on', blocked,
                            'waiting_on_name',
                            coalesce((select pp.display_name from public.public_profile pp
                                      where pp.user_id = blocked), 'Your rival'));
end;
$$;
revoke execute on function public.forge_duel_raise_state(uuid) from public, anon;
grant execute on function public.forge_duel_raise_state(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────── accept v3

/**
 * ACCEPT — the only place a duel's opening coins enter escrow.
 *
 * 143's body, plus the duel's own clocks: the live stake starts at the opening
 * one, and the SUPPORT WINDOW is fixed here, from the config, at a fraction of
 * the duel's length. Fixed at acceptance and frozen by the lock guard, because
 * a support window a participant could move after seeing the score is not a
 * window, it is a lever.
 *
 * The baselines are no longer copied into the event detail: they live in
 * forge_challenge_participants, and the timeline is shown to SPECTATORS.
 */
create or replace function public.forge_challenge_accept(
  p_challenge uuid,
  p_local_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  cfg public.forge_duel_config;
  me uuid := auth.uid();
  bal_a int;
  bal_b int;
  t_start date;
  t_end date;
  base_a jsonb;
  base_b jsonb;
  utc_today date := (now() at time zone 'UTC')::date;
  window_end timestamptz;
  close_at timestamptz;
begin
  if me is null then
    raise exception 'forge_challenge_accept: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_challenge_accept: no such challenge.' using errcode = 'no_data_found';
  end if;
  if c.opponent_id <> me then
    raise exception 'forge_challenge_accept: only the invited athlete may accept.'
      using errcode = 'insufficient_privilege';
  end if;

  if c.status <> 'pending' then
    return jsonb_build_object('status', c.status, 'already', true, 'challenge_id', c.id);
  end if;
  if c.expires_at <= now() then
    update public.forge_challenges set status = 'expired' where id = c.id;
    return jsonb_build_object('status', 'expired', 'already', false, 'challenge_id', c.id);
  end if;
  if not public.are_friends(c.challenger_id, c.opponent_id) then
    raise exception 'forge_challenge_accept: you are no longer friends.' using errcode = 'check_violation';
  end if;

  bal_a := public.forge_duel_balance(c.challenger_id);
  bal_b := public.forge_duel_balance(c.opponent_id);
  if bal_a < c.stake then
    raise exception 'forge_challenge_accept: the challenger no longer has % coins.', c.stake
      using errcode = 'check_violation';
  end if;
  if bal_b < c.stake then
    raise exception 'forge_challenge_accept: you need % coins to accept (you have %).', c.stake, bal_b
      using errcode = 'check_violation';
  end if;

  -- 143: the window runs on the ACCEPTING athlete's calendar, validated. Any
  -- real timezone is within a day of UTC; a wider gap is an attempt to move
  -- the window onto training that already happened.
  t_start := coalesce(p_local_date, utc_today);
  if abs(t_start - utc_today) > 1 then
    t_start := utc_today;
  end if;
  t_end := t_start + (c.duration_days - 1);
  window_end := (t_end + 1)::timestamptz - interval '1 second';

  select * into cfg from public.forge_duel_config where id;
  -- The support window closes a configured fraction of the way through, from
  -- NOW rather than from the window's start: a duel accepted at 11pm has
  -- almost no day one, and a backer should get the same share of the real
  -- contest whenever it began.
  close_at := now() + ((window_end - now()) * cfg.support_close_pct / 100.0);

  if c.challenge_type = 'most_improved_lift' then
    base_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
    base_b := public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                                            '1900-01-01'::date, t_start - 1);
  else
    base_a := jsonb_build_object('value', 0, 'measured', true);
    base_b := base_a;
  end if;

  -- ESCROW. Negative rows: coin_total() is sum(amount), so these coins leave
  -- the balance and cannot be staked again anywhere else.
  perform set_config('evoforge.challenge_authorized', c.id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (c.challenger_id, 'challenge_stake', -c.stake, c.id::text),
         (c.opponent_id,   'challenge_stake', -c.stake, c.id::text);

  insert into public.forge_challenge_participants (challenge_id, user_id, baseline, baseline_detail, escrowed)
  values (c.id, c.challenger_id, (base_a ->> 'value')::numeric, base_a, c.stake),
         (c.id, c.opponent_id,   (base_b ->> 'value')::numeric, base_b, c.stake)
  on conflict (challenge_id, user_id) do update
    set baseline = excluded.baseline, baseline_detail = excluded.baseline_detail,
        escrowed = excluded.escrowed;

  update public.forge_challenges
  set status = 'active', accepted_at = now(),
      starts_at = t_start::timestamptz, ends_at = window_end,
      current_stake = c.stake,
      support_closes_at = close_at
  where id = c.id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'accepted',
          jsonb_build_object('stake', c.stake, 'pot', c.stake * 2,
                             'start', t_start, 'end', t_end));

  perform public.forge_duel_notify(
    c.challenger_id, me, 'duel_accepted',
    jsonb_build_object('challenge_id', c.id, 'stake', c.stake, 'pot', c.stake * 2));

  return jsonb_build_object('status', 'active', 'already', false, 'challenge_id', c.id,
                            'escrow', c.stake * 2, 'pot', c.stake * 2,
                            'start', t_start, 'end', t_end,
                            'support_closes_at', close_at);
end;
$$;

-- ─────────────────────────────────────────────────── propose / respond

/**
 * PROPOSE — a raise, an all-in, or a counter-stake on an invite.
 *
 * NOTHING MOVES HERE. The row is an offer; the coins wait for the other
 * athlete. `p_counter_of` supersedes the offer it answers in the SAME
 * transaction, which is what makes "accepting an old raise after a
 * counteroffer" impossible rather than merely unlikely — the partial unique
 * index would refuse two live offers even if this body forgot.
 *
 * ALL-IN'S AMOUNT IS COMPUTED, NOT SENT. It is the proposer's entire ledger
 * balance at this instant; a client-supplied number would be a claim about
 * somebody's wallet, which is exactly the class of number this system never
 * accepts.
 */
create or replace function public.forge_duel_propose(
  p_challenge uuid,
  p_kind text,
  p_amount int default null,
  p_counter_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  cfg public.forge_duel_config;
  me uuid := auth.uid();
  other uuid;
  amount int;
  bal int;
  other_bal int;
  raise_state jsonb;
  new_id uuid;
  prior public.forge_duel_offers%rowtype;
begin
  if me is null then
    raise exception 'forge_duel_propose: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('raise', 'all_in', 'counter_stake') then
    raise exception 'forge_duel_propose: unknown offer kind %.', p_kind using errcode = 'check_violation';
  end if;

  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_duel_propose: no such duel.' using errcode = 'no_data_found';
  end if;
  if c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'forge_duel_propose: not your duel.' using errcode = 'insufficient_privilege';
  end if;
  other := case when c.challenger_id = me then c.opponent_id else c.challenger_id end;
  select * into cfg from public.forge_duel_config where id;

  -- Clear anything that died waiting, so a forgotten offer cannot hold the
  -- duel's one pending slot forever.
  update public.forge_duel_offers
  set status = 'expired', responded_at = now()
  where challenge_id = c.id and status = 'pending' and expires_at <= now();

  -- A COUNTER REPLACES WHAT IT ANSWERS. Same transaction, so there is never an
  -- instant with two live proposals — and the superseded one can never be
  -- accepted afterwards, because `respond` re-checks status under a lock.
  if p_counter_of is not null then
    select * into prior from public.forge_duel_offers where id = p_counter_of for update;
    if not found or prior.challenge_id <> c.id then
      raise exception 'forge_duel_propose: no such offer to counter.' using errcode = 'no_data_found';
    end if;
    if prior.status <> 'pending' then
      raise exception 'forge_duel_propose: that offer is already %.', prior.status
        using errcode = 'check_violation';
    end if;
    if prior.proposer_id = me then
      raise exception 'forge_duel_propose: you cannot counter your own offer.'
        using errcode = 'check_violation';
    end if;
    update public.forge_duel_offers
    set status = 'superseded', responded_by = me, responded_at = now()
    where id = prior.id;
  end if;

  if p_kind = 'counter_stake' then
    -- BEFORE ACCEPTANCE ONLY. This is the one moment the opening stake may
    -- change, and only the invited athlete may ask for it.
    if c.status <> 'pending' then
      raise exception 'forge_duel_propose: the stake is locked once the duel starts.'
        using errcode = 'check_violation';
    end if;
    if c.opponent_id <> me then
      raise exception 'forge_duel_propose: only the invited athlete may counter the stake.'
        using errcode = 'insufficient_privilege';
    end if;
    amount := p_amount;
    if amount is null or amount < cfg.min_stake or amount > cfg.max_stake then
      raise exception 'A stake must be between % and % coins.', cfg.min_stake, cfg.max_stake
        using errcode = 'check_violation';
    end if;
    if public.forge_duel_balance(me) < amount then
      raise exception 'You only have % coins.', public.forge_duel_balance(me)
        using errcode = 'check_violation';
    end if;
  else
    if c.status <> 'active' then
      raise exception 'forge_duel_propose: the duel is %.', c.status using errcode = 'check_violation';
    end if;
    if now() >= c.ends_at then
      raise exception 'forge_duel_propose: this duel has finished.' using errcode = 'check_violation';
    end if;
    if c.raises_accepted >= cfg.max_raises then
      raise exception 'This duel has used all % raises.', cfg.max_raises using errcode = 'check_violation';
    end if;
    -- THE ELIGIBILITY RULE, enforced where it matters. A counter to a live
    -- offer is exempt: the duel already earned this negotiation, and forcing
    -- the responder to train again before answering would make COUNTER
    -- unreachable.
    if p_counter_of is null then
      raise_state := public.forge_duel_raise_state(c.id);
      if not (raise_state ->> 'unlocked')::boolean then
        raise exception 'A raise unlocks once you have both trained since the last one.'
          using errcode = 'check_violation';
      end if;
    end if;

    bal := public.forge_duel_balance(me);
    other_bal := public.forge_duel_balance(other);

    if p_kind = 'all_in' then
      -- THE WHOLE WALLET, as the ledger sees it right now.
      amount := bal;
      if amount <= 0 then
        raise exception 'You have no coins to put in.' using errcode = 'check_violation';
      end if;
    else
      amount := p_amount;
      if amount is null or amount <= 0 then
        raise exception 'forge_duel_propose: a raise needs an amount.' using errcode = 'check_violation';
      end if;
      if amount > cfg.max_raise then
        raise exception 'A single raise is capped at % coins.', cfg.max_raise using errcode = 'check_violation';
      end if;
      if amount > bal then
        raise exception 'You have % coins and this raise adds %.', bal, amount
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  insert into public.forge_duel_offers (challenge_id, proposer_id, kind, amount, counter_of, expires_at)
  values (c.id, me, p_kind, amount, p_counter_of,
          least(now() + make_interval(hours => cfg.offer_expiry_hours),
                coalesce(c.ends_at, now() + make_interval(hours => cfg.offer_expiry_hours))))
  returning id into new_id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me,
          case p_kind when 'all_in' then 'all_in_proposed'
                      when 'counter_stake' then 'counter_stake_proposed'
                      else 'raise_proposed' end,
          jsonb_build_object('offer_id', new_id, 'amount', amount,
                             'pot_if_accepted',
                             case when p_kind = 'counter_stake' then amount * 2
                                  else (c.current_stake + amount) * 2 end,
                             'countered', p_counter_of is not null));

  perform public.forge_duel_notify(other, me,
    case p_kind when 'counter_stake' then 'duel_raise' else 'duel_raise' end,
    jsonb_build_object('challenge_id', c.id, 'offer_id', new_id, 'kind', p_kind,
                       'amount', amount,
                       'pot_if_accepted',
                       case when p_kind = 'counter_stake' then amount * 2
                            else (c.current_stake + amount) * 2 end));

  return jsonb_build_object(
    'offer_id', new_id, 'kind', p_kind, 'amount', amount,
    'pot_if_accepted', case when p_kind = 'counter_stake' then amount * 2
                            else (c.current_stake + amount) * 2 end,
    -- So the proposer's screen can say "they cannot match this" honestly.
    'opponent_can_match', case when p_kind = 'counter_stake' then null
                               else public.forge_duel_balance(other) >= amount end);
end;
$$;

/**
 * RESPOND — accept or decline. THE ONLY PLACE A RAISE'S COINS MOVE.
 *
 * Declining does NOT cancel the duel and does NOT touch the existing escrow.
 * That is the brief's rule and it is also the honest one: an athlete who
 * agreed to 25 agreed to 25, and saying no to 100 must not cost them the
 * contest they are already in.
 */
create or replace function public.forge_duel_respond(p_offer uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o public.forge_duel_offers%rowtype;
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  bal_me int;
  bal_them int;
  src text;
  new_stake int;
begin
  if me is null then
    raise exception 'forge_duel_respond: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into o from public.forge_duel_offers where id = p_offer for update;
  if not found then
    raise exception 'forge_duel_respond: no such offer.' using errcode = 'no_data_found';
  end if;
  select * into c from public.forge_challenges where id = o.challenge_id for update;

  if c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'forge_duel_respond: not your duel.' using errcode = 'insufficient_privilege';
  end if;
  if o.proposer_id = me then
    raise exception 'forge_duel_respond: you cannot answer your own offer.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ALREADY ANSWERED = SUCCESS. A second tap wanted what the first achieved,
  -- and saying so is what makes a doubled tap and a retry safe.
  if o.status in ('accepted', 'declined') then
    return jsonb_build_object('status', o.status, 'already', true, 'offer_id', o.id);
  end if;

  -- REPLACED, WITHDRAWN OR DEAD IS NOT "ALREADY DONE" — and the difference is
  -- the whole point. An athlete whose screen still shows the offer their rival
  -- countered a second ago taps ACCEPT and must be told the terms changed, not
  -- congratulated on a raise that never happened. Nothing moved either way;
  -- this is about what the caller is allowed to believe.
  if o.status <> 'pending' then
    return jsonb_build_object(
      'status', o.status, 'already', false, 'refused', true, 'offer_id', o.id,
      'reason', case o.status
                  when 'superseded' then 'That offer was replaced by a counteroffer.'
                  when 'withdrawn'  then 'They took that offer back.'
                  else 'That offer expired.' end);
  end if;
  if o.expires_at <= now() then
    update public.forge_duel_offers set status = 'expired', responded_at = now() where id = o.id;
    insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
    values (c.id, me, 'raise_expired', jsonb_build_object('offer_id', o.id, 'amount', o.amount));
    return jsonb_build_object('status', 'expired', 'already', false, 'refused', true,
                              'offer_id', o.id, 'reason', 'That offer expired.');
  end if;

  if not p_accept then
    update public.forge_duel_offers
    set status = 'declined', responded_by = me, responded_at = now() where id = o.id;
    insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
    values (c.id, me,
            case o.kind when 'counter_stake' then 'counter_stake_declined'
                        when 'all_in' then 'all_in_declined'
                        else 'raise_declined' end,
            jsonb_build_object('offer_id', o.id, 'amount', o.amount));
    perform public.forge_duel_notify(o.proposer_id, me, 'duel_raise_declined',
      jsonb_build_object('challenge_id', c.id, 'amount', o.amount, 'kind', o.kind));
    -- THE DUEL IS UNCHANGED. Said explicitly because it is the reassurance
    -- that makes declining a real option rather than a bluff.
    return jsonb_build_object('status', 'declined', 'already', false, 'offer_id', o.id,
                              'pot', c.current_stake * 2, 'duel_status', c.status);
  end if;

  -- ── ACCEPTING A COUNTER-STAKE: rewrite the invite, escrow nothing yet. ──
  if o.kind = 'counter_stake' then
    if c.status <> 'pending' then
      raise exception 'forge_duel_respond: this duel has already started.' using errcode = 'check_violation';
    end if;
    if public.forge_duel_balance(me) < o.amount then
      raise exception 'You have % coins and this stakes %.',
        public.forge_duel_balance(me), o.amount using errcode = 'check_violation';
    end if;
    update public.forge_challenges
    set stake = o.amount, current_stake = o.amount where id = c.id;
    update public.forge_duel_offers
    set status = 'accepted', responded_by = me, responded_at = now() where id = o.id;
    insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
    values (c.id, me, 'counter_stake_accepted',
            jsonb_build_object('offer_id', o.id, 'stake', o.amount, 'pot', o.amount * 2));
    perform public.forge_duel_notify(o.proposer_id, me, 'duel_raise_accepted',
      jsonb_build_object('challenge_id', c.id, 'stake', o.amount, 'kind', 'counter_stake'));
    return jsonb_build_object('status', 'accepted', 'already', false, 'offer_id', o.id,
                              'stake', o.amount, 'pot', o.amount * 2, 'duel_status', 'pending');
  end if;

  -- ── ACCEPTING A RAISE OR ALL-IN: both athletes pay, atomically. ──
  if c.status <> 'active' then
    raise exception 'forge_duel_respond: the duel is %.', c.status using errcode = 'check_violation';
  end if;
  if now() >= c.ends_at then
    raise exception 'forge_duel_respond: this duel has finished.' using errcode = 'check_violation';
  end if;

  bal_me := public.forge_duel_balance(me);
  bal_them := public.forge_duel_balance(o.proposer_id);
  if bal_me < o.amount then
    raise exception 'You need % coins to match this (you have %).', o.amount, bal_me
      using errcode = 'check_violation';
  end if;
  if bal_them < o.amount then
    -- The proposer's wallet moved after they offered. Refusing is the only
    -- honest answer: half a raise is not a raise.
    raise exception 'They no longer have % coins to put in.', o.amount
      using errcode = 'check_violation';
  end if;

  -- The ledger's unique index is (user_id, kind, source_id), so a raise needs
  -- a source of its OWN — a second stake row against the bare challenge id
  -- would collide with the opening one. The offer id is that source, and it
  -- makes double-charging a raise impossible at the storage layer.
  src := c.id::text || ':' || o.id::text;
  perform set_config('evoforge.challenge_authorized', src, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (me,             'challenge_stake', -o.amount, src),
         (o.proposer_id,  'challenge_stake', -o.amount, src);

  update public.forge_challenge_participants
  set escrowed = escrowed + o.amount
  where challenge_id = c.id;

  new_stake := c.current_stake + o.amount;
  update public.forge_challenges
  set current_stake = new_stake,
      raises_accepted = c.raises_accepted + 1,
      last_raise_at = now()
  where id = c.id;

  update public.forge_duel_offers
  set status = 'accepted', responded_by = me, responded_at = now() where id = o.id;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me,
          case o.kind when 'all_in' then 'all_in_accepted' else 'raise_accepted' end,
          jsonb_build_object('offer_id', o.id, 'amount', o.amount,
                             'stake', new_stake, 'pot', new_stake * 2));

  perform public.forge_duel_notify(o.proposer_id, me, 'duel_raise_accepted',
    jsonb_build_object('challenge_id', c.id, 'amount', o.amount,
                       'pot', new_stake * 2, 'kind', o.kind));

  return jsonb_build_object('status', 'accepted', 'already', false, 'offer_id', o.id,
                            'amount', o.amount, 'stake', new_stake, 'pot', new_stake * 2,
                            'duel_status', 'active');
end;
$$;

/** WITHDRAW — the proposer takes their own offer back. Nothing moved, so
 *  nothing is refunded; the slot is simply free again. */
create or replace function public.forge_duel_withdraw_offer(p_offer uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare o public.forge_duel_offers%rowtype; me uuid := auth.uid();
begin
  select * into o from public.forge_duel_offers where id = p_offer for update;
  if not found then raise exception 'no such offer.' using errcode = 'no_data_found'; end if;
  if o.proposer_id <> me then
    raise exception 'only the proposer may withdraw it.' using errcode = 'insufficient_privilege';
  end if;
  if o.status <> 'pending' then
    return jsonb_build_object('status', o.status, 'already', true);
  end if;
  update public.forge_duel_offers set status = 'withdrawn', responded_at = now() where id = o.id;
  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (o.challenge_id, me, 'raise_withdrawn', jsonb_build_object('offer_id', o.id, 'amount', o.amount));
  return jsonb_build_object('status', 'withdrawn', 'already', false);
end;
$$;

-- ────────────────────────────────────────────────────────────── support

/**
 * BACK A SIDE. A friend's coins go into a pool that is settled SEPARATELY from
 * the participants' escrow and can never touch it.
 *
 * Refusals, all of them deliberate:
 *   - a participant may not back their own duel (they already have a position,
 *     and one that they control);
 *   - support closes at `support_closes_at` — money that arrives after seeing
 *     most of the contest is not a prediction;
 *   - one position per duel, no top-ups, no hedging both sides.
 */
create or replace function public.forge_duel_support(
  p_challenge uuid, p_backed uuid, p_amount int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  cfg public.forge_duel_config;
  me uuid := auth.uid();
  bal int;
  new_id uuid;
begin
  if me is null then
    raise exception 'forge_duel_support: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_duel_support: no such duel.' using errcode = 'no_data_found';
  end if;
  if c.challenger_id = me or c.opponent_id = me then
    raise exception 'You are in this duel. Raise the stakes instead.'
      using errcode = 'check_violation';
  end if;
  if not public.forge_duel_can_watch(c.id, me) then
    raise exception 'This duel is not open to you.' using errcode = 'insufficient_privilege';
  end if;
  if p_backed is distinct from c.challenger_id and p_backed is distinct from c.opponent_id then
    raise exception 'forge_duel_support: back one of the two athletes.' using errcode = 'check_violation';
  end if;
  if c.status <> 'active' then
    raise exception 'Support is closed — this duel is %.', c.status using errcode = 'check_violation';
  end if;
  if c.support_closes_at is not null and now() >= c.support_closes_at then
    raise exception 'Support closed for this duel.' using errcode = 'check_violation';
  end if;

  select * into cfg from public.forge_duel_config where id;
  if p_amount is null or p_amount <= 0 or p_amount > cfg.max_support then
    raise exception 'Back between 1 and % coins.', cfg.max_support using errcode = 'check_violation';
  end if;
  bal := public.forge_duel_balance(me);
  if bal < p_amount then
    raise exception 'You have % coins and this backs %.', bal, p_amount using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.forge_duel_support s
             where s.challenge_id = c.id and s.supporter_id = me) then
    raise exception 'You have already backed this duel.' using errcode = 'unique_violation';
  end if;

  insert into public.forge_duel_support (challenge_id, supporter_id, backed_id, amount)
  values (c.id, me, p_backed, p_amount)
  returning id into new_id;

  -- The coins LEAVE the wallet now. A pledge that is only collected on a loss
  -- is not a stake, and would let a supporter promise what they had spent.
  perform set_config('evoforge.challenge_authorized', c.id::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (me, 'duel_support_stake', -p_amount, c.id::text);

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'support_placed',
          jsonb_build_object('backed_id', p_backed, 'amount', p_amount));

  perform public.forge_duel_notify(p_backed, me, 'duel_support',
    jsonb_build_object('challenge_id', c.id, 'amount', p_amount));

  return jsonb_build_object('ok', true, 'support_id', new_id,
                            'backed_id', p_backed, 'amount', p_amount);
end;
$$;

-- ──────────────────────────────────────────────────────────── reactions

/** Toggle one of five reactions. A fixed vocabulary needs no moderation, and
 *  the primary key caps a single athlete at five rows however fast they tap. */
create or replace function public.forge_duel_react(
  p_challenge uuid, p_emoji text, p_on boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'forge_duel_react: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if not public.forge_duel_can_watch(p_challenge, me) then
    raise exception 'This duel is not open to you.' using errcode = 'insufficient_privilege';
  end if;
  if p_on then
    insert into public.forge_duel_reactions (challenge_id, user_id, emoji)
    values (p_challenge, me, p_emoji)
    on conflict (challenge_id, user_id, emoji) do nothing;
  else
    delete from public.forge_duel_reactions
    where challenge_id = p_challenge and user_id = me and emoji = p_emoji;
  end if;
  return jsonb_build_object('ok', true, 'emoji', p_emoji, 'on', p_on);
end;
$$;

-- ────────────────────────────────────── settlement: the supporter pool

/**
 * PARI-MUTUEL, and nothing else.
 *
 * The winning side's supporters take their own stake back plus a share of the
 * LOSING side's pool, in proportion to what they put in. There is no odds
 * table, no multiplier and no house float — which is the only construction
 * where the pool provably cannot pay out more than it took in, whatever
 * anybody stakes.
 *
 * The edges, all of which are real:
 *   DRAW / CANCEL / no winner   → everyone is refunded exactly.
 *   NOBODY BACKED THE WINNER    → everyone is refunded. Distributing a pool
 *                                 with no winners to divide it would be a pure
 *                                 burn dressed up as a payout.
 *   NOBODY BACKED THE LOSER     → winners get their stake back and no more.
 *                                 There is nothing to win; saying so is honest.
 *   ROUNDING                    → shares floor, and the few coins that cannot
 *                                 be split are recorded as `burned` rather than
 *                                 quietly handed to whoever sorted first.
 */
create or replace function public.forge_duel_settle_support(
  p_challenge uuid, p_winner uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  cfg public.forge_duel_config;
  pool_win int;
  pool_lose int;
  rake int;
  distributable int;
  paid int := 0;
  r record;
  share int;
  refund_all boolean;
begin
  if exists (select 1 from public.forge_challenges c
             where c.id = p_challenge and c.support_settled_at is not null) then
    return jsonb_build_object('already', true);
  end if;

  select * into cfg from public.forge_duel_config where id;
  select coalesce(sum(amount), 0)::int into pool_win
    from public.forge_duel_support where challenge_id = p_challenge and backed_id = p_winner;
  select coalesce(sum(amount), 0)::int into pool_lose
    from public.forge_duel_support where challenge_id = p_challenge and backed_id is distinct from p_winner;

  if pool_win = 0 and pool_lose = 0 then
    update public.forge_challenges set support_settled_at = now() where id = p_challenge;
    return jsonb_build_object('already', false, 'supporters', 0, 'pool', 0);
  end if;

  refund_all := p_winner is null or pool_win = 0;
  rake := case when refund_all then 0 else (pool_lose * cfg.support_rake_bp) / 10000 end;
  distributable := case when refund_all then 0 else pool_lose - rake end;

  perform set_config('evoforge.challenge_authorized', p_challenge::text, true);
  for r in
    select * from public.forge_duel_support where challenge_id = p_challenge order by created_at
  loop
    if refund_all then
      share := r.amount;
    elsif r.backed_id = p_winner then
      share := r.amount + (r.amount::bigint * distributable / pool_win)::int;
    else
      share := 0;
    end if;

    update public.forge_duel_support
    set payout = share, settled_at = now() where id = r.id;

    if share > 0 then
      insert into public.coin_events (user_id, kind, amount, source_id)
      values (r.supporter_id, 'duel_support_payout', share, p_challenge::text);
      paid := paid + share;
    end if;
  end loop;

  update public.forge_challenges set support_settled_at = now() where id = p_challenge;

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (p_challenge, null, 'support_settled',
          jsonb_build_object('pool_winner', pool_win, 'pool_loser', pool_lose,
                             'paid', paid, 'rake', rake,
                             'burned', (pool_win + pool_lose) - paid - rake,
                             'refunded', refund_all));

  return jsonb_build_object('already', false, 'pool_winner', pool_win, 'pool_loser', pool_lose,
                            'paid', paid, 'rake', rake, 'refunded', refund_all);
end;
$$;
revoke execute on function public.forge_duel_settle_support(uuid, uuid) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────── settle v2

/**
 * SETTLE — compute both finals from the athletes' own rows, decide, pay both
 * pools.
 *
 * 140's body with three changes: the payout is the ESCROW ACTUALLY HELD (which
 * raises have grown), the supporter pool settles in the same transaction, and
 * both athletes get told. The escrow is read from forge_challenge_participants
 * rather than recomputed from `stake`, because that column is the record of
 * what was taken — and paying out anything else would either mint or burn.
 */
create or replace function public.forge_challenge_settle(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  t_start date;
  t_end date;
  fin_a jsonb;
  fin_b jsonb;
  score_a numeric;
  score_b numeric;
  base_a numeric;
  base_b numeric;
  esc_a int;
  esc_b int;
  v_winner uuid;
  v_outcome text;
  v_note text;
  sup jsonb;
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then
    raise exception 'forge_challenge_settle: no such challenge.' using errcode = 'no_data_found';
  end if;
  if me is not null and c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'forge_challenge_settle: not your challenge.' using errcode = 'insufficient_privilege';
  end if;

  if c.status = 'settled' then
    return jsonb_build_object('status', 'settled', 'already', true, 'challenge_id', c.id,
                              'winner_id', c.winner_id, 'outcome', c.outcome);
  end if;
  if c.status = 'disputed' then
    return jsonb_build_object('status', 'disputed', 'already', true, 'challenge_id', c.id,
                              'note', 'Settlement is paused while the dispute is open.');
  end if;
  if c.status <> 'active' and c.status <> 'awaiting_settlement' then
    raise exception 'forge_challenge_settle: challenge is %.', c.status using errcode = 'check_violation';
  end if;
  if now() < c.ends_at then
    raise exception 'forge_challenge_settle: the challenge has not finished yet.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.forge_challenge_disputes d
             where d.challenge_id = c.id and d.status = 'open') then
    update public.forge_challenges set status = 'disputed' where id = c.id;
    return jsonb_build_object('status', 'disputed', 'already', false, 'challenge_id', c.id);
  end if;

  -- Any offer still hanging dies with the duel; it can never be accepted now.
  update public.forge_duel_offers set status = 'expired', responded_at = now()
  where challenge_id = c.id and status = 'pending';

  t_start := (c.starts_at at time zone 'UTC')::date;
  t_end := (c.ends_at at time zone 'UTC')::date;

  fin_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key, t_start, t_end);
  fin_b := public.forge_challenge_metric(c.opponent_id,   c.challenge_type, c.metric_key, t_start, t_end);

  select p.baseline, p.escrowed into base_a, esc_a from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.challenger_id;
  select p.baseline, p.escrowed into base_b, esc_b from public.forge_challenge_participants p
    where p.challenge_id = c.id and p.user_id = c.opponent_id;
  esc_a := coalesce(esc_a, c.stake);
  esc_b := coalesce(esc_b, c.stake);

  if c.challenge_type = 'most_improved_lift' then
    score_a := case when coalesce(base_a, 0) > 0
                    then ((fin_a ->> 'value')::numeric - base_a) / base_a * 100 else 0 end;
    score_b := case when coalesce(base_b, 0) > 0
                    then ((fin_b ->> 'value')::numeric - base_b) / base_b * 100 else 0 end;
    score_a := round(score_a, 2);
    score_b := round(score_b, 2);
  else
    score_a := (fin_a ->> 'value')::numeric;
    score_b := (fin_b ->> 'value')::numeric;
  end if;

  if score_a > score_b then
    v_winner := c.challenger_id; v_outcome := 'winner';
  elsif score_b > score_a then
    v_winner := c.opponent_id; v_outcome := 'winner';
  else
    v_winner := null; v_outcome := 'draw';
  end if;
  v_note := format('%s vs %s', score_a, score_b);

  -- PAY THE PARTICIPANTS. A win takes the whole escrow that was actually held;
  -- a draw returns each athlete exactly what they put in, raises included.
  perform set_config('evoforge.challenge_authorized', c.id::text, true);
  if v_outcome = 'winner' then
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (v_winner, 'challenge_payout', esc_a + esc_b, c.id::text);
  else
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.challenger_id, 'challenge_payout', esc_a, c.id::text),
           (c.opponent_id,   'challenge_payout', esc_b, c.id::text);
  end if;

  update public.forge_challenge_participants
  set final_value = case when user_id = c.challenger_id then score_a else score_b end,
      final_detail = case when user_id = c.challenger_id then fin_a else fin_b end
  where challenge_id = c.id;

  update public.forge_challenges
  set status = 'settled', settled_at = now(), winner_id = v_winner,
      outcome = v_outcome, result_note = v_note, leader_id = v_winner
  where id = c.id;

  -- THE SEPARATE POOL, settled in the same transaction so a duel is never half
  -- finished — but by its own function, out of its own coins.
  sup := public.forge_duel_settle_support(c.id, v_winner);

  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'settled',
          jsonb_build_object('outcome', v_outcome, 'winner_id', v_winner,
                             'score_challenger', score_a, 'score_opponent', score_b,
                             'final_challenger', fin_a, 'final_opponent', fin_b,
                             'pot', esc_a + esc_b));

  perform public.forge_duel_notify(c.challenger_id, c.opponent_id, 'duel_settled',
    jsonb_build_object('challenge_id', c.id, 'outcome', v_outcome, 'winner_id', v_winner,
                       'pot', esc_a + esc_b, 'won', v_winner = c.challenger_id));
  perform public.forge_duel_notify(c.opponent_id, c.challenger_id, 'duel_settled',
    jsonb_build_object('challenge_id', c.id, 'outcome', v_outcome, 'winner_id', v_winner,
                       'pot', esc_a + esc_b, 'won', v_winner = c.opponent_id));

  return jsonb_build_object('status', 'settled', 'already', false, 'challenge_id', c.id,
                            'winner_id', v_winner, 'outcome', v_outcome,
                            'score_challenger', score_a, 'score_opponent', score_b,
                            'pot', esc_a + esc_b, 'support', sup);
end;
$$;

/**
 * CANCEL v2 — withdraw. Before acceptance either side may; after it, this
 * refunds the escrow ACTUALLY HELD (raises included) and refunds every
 * supporter in full, because a contest nobody completed must not take
 * anybody's coins.
 */
create or replace function public.forge_challenge_cancel(p_challenge uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  esc_a int;
  esc_b int;
begin
  select * into c from public.forge_challenges where id = p_challenge for update;
  if not found then raise exception 'no such challenge.' using errcode = 'no_data_found'; end if;
  if c.challenger_id <> me and c.opponent_id <> me then
    raise exception 'not your challenge.' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('cancelled', 'declined', 'expired', 'settled') then
    return jsonb_build_object('status', c.status, 'already', true);
  end if;

  update public.forge_duel_offers set status = 'expired', responded_at = now()
  where challenge_id = c.id and status = 'pending';

  if c.status = 'active' or c.status = 'awaiting_settlement' then
    select coalesce(p.escrowed, c.stake) into esc_a from public.forge_challenge_participants p
      where p.challenge_id = c.id and p.user_id = c.challenger_id;
    select coalesce(p.escrowed, c.stake) into esc_b from public.forge_challenge_participants p
      where p.challenge_id = c.id and p.user_id = c.opponent_id;
    esc_a := coalesce(esc_a, c.stake);
    esc_b := coalesce(esc_b, c.stake);
    -- REFUND, once. The status guard above is what stops a second call paying
    -- a second time; the ledger's unique index is the backstop under it.
    perform set_config('evoforge.challenge_authorized', c.id::text, true);
    insert into public.coin_events (user_id, kind, amount, source_id)
    values (c.challenger_id, 'challenge_payout', esc_a, c.id::text),
           (c.opponent_id,   'challenge_payout', esc_b, c.id::text);
    -- Supporters backed a contest that will not happen. Full refund, no rake.
    perform public.forge_duel_settle_support(c.id, null);
  end if;

  update public.forge_challenges
  set status = 'cancelled', outcome = 'refund', settled_at = now() where id = c.id;
  insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
  values (c.id, me, 'cancelled', jsonb_build_object('refunded', coalesce(esc_a, 0)));
  return jsonb_build_object('status', 'cancelled', 'already', false,
                            'refunded', coalesce(esc_a, 0));
end;
$$;

/**
 * THE SWEEP — housekeeping the athlete should never have to ask for.
 *
 * Expires dead invites and dead offers, then settles every duel of mine whose
 * window has closed. Called once when the hub opens, which is why a duel that
 * ended overnight is already settled by the time it is looked at. Each
 * settlement is the same idempotent function a manual tap would call.
 */
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

  return jsonb_build_object('settled', settled, 'expired', expired);
end;
$$;

-- ───────────────────────────────────────────────────────────── the reads

/**
 * MY DUELS — everything the athlete participates in, with both sides' live
 * numbers, the live pot, the pending offer and the supporter shape.
 *
 * Definer because it reads the opponent's rows to score them. It returns the
 * challenge metric and a display name and NOTHING ELSE: no measurements, no
 * physique data, no workout rows ever cross.
 */
create or replace function public.my_forge_challenges()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'my_forge_challenges: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        c.id, c.challenge_type, c.metric_key, c.duration_days, c.stake, c.status,
        c.created_at, c.expires_at, c.accepted_at, c.starts_at, c.ends_at,
        c.settled_at, c.winner_id, c.outcome, c.result_note, c.rematch_of,
        c.challenger_id, c.opponent_id,
        -- 144: the live economy.
        coalesce(c.current_stake, c.stake) as current_stake,
        coalesce(c.current_stake, c.stake) * 2 as pot,
        c.raises_accepted, c.last_raise_at, c.leader_id,
        c.support_closes_at, c.spectators_enabled,
        (c.challenger_id = me) as i_am_challenger,
        coalesce(ppc.display_name, 'Athlete') as challenger_name,
        coalesce(ppo.display_name, 'Athlete') as opponent_name,
        pc.baseline as challenger_baseline,
        po.baseline as opponent_baseline,
        coalesce(pc.escrowed, 0) as challenger_escrowed,
        coalesce(po.escrowed, 0) as opponent_escrowed,
        pc.last_qualifying_at as challenger_last_session,
        po.last_qualifying_at as opponent_last_session,
        case when c.status = 'settled' then pc.final_detail
             when c.starts_at is null then null
             else public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                    (c.starts_at at time zone 'UTC')::date,
                    least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date))
        end as challenger_current,
        case when c.status = 'settled' then po.final_detail
             when c.starts_at is null then null
             else public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                    (c.starts_at at time zone 'UTC')::date,
                    least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date))
        end as opponent_current,
        exists (select 1 from public.forge_challenge_disputes d
                where d.challenge_id = c.id and d.status = 'open') as disputed,
        -- THE ONE LIVE OFFER, if there is one. Shaped for the card that has to
        -- render either "they want to raise" or "waiting on them".
        (select jsonb_build_object(
                  'id', o.id, 'kind', o.kind, 'amount', o.amount,
                  'proposer_id', o.proposer_id, 'mine', o.proposer_id = me,
                  'created_at', o.created_at, 'expires_at', o.expires_at,
                  'counter_of', o.counter_of,
                  'pot_if_accepted',
                  case when o.kind = 'counter_stake' then o.amount * 2
                       else (coalesce(c.current_stake, c.stake) + o.amount) * 2 end)
         from public.forge_duel_offers o
         where o.challenge_id = c.id and o.status = 'pending' and o.expires_at > now()
         order by o.created_at desc limit 1) as pending_offer,
        public.forge_duel_raise_state(c.id) as raise_state,
        -- The supporter SHAPE, never the individual positions.
        (select coalesce(sum(s.amount), 0)::int from public.forge_duel_support s
         where s.challenge_id = c.id and s.backed_id = c.challenger_id) as support_challenger,
        (select coalesce(sum(s.amount), 0)::int from public.forge_duel_support s
         where s.challenge_id = c.id and s.backed_id = c.opponent_id) as support_opponent,
        (select count(*)::int from public.forge_duel_support s
         where s.challenge_id = c.id) as supporter_count
      from public.forge_challenges c
      left join public.forge_challenge_participants pc on pc.challenge_id = c.id and pc.user_id = c.challenger_id
      left join public.forge_challenge_participants po on po.challenge_id = c.id and po.user_id = c.opponent_id
      left join public.public_profile ppc on ppc.user_id = c.challenger_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where c.challenger_id = me or c.opponent_id = me
    ) x
  ), '[]'::jsonb);
end;
$$;

/**
 * THE TIMELINE — what happened, in order, with the actor's public name.
 *
 * Redacted by the same rule for everyone who is allowed to see it: the events
 * carry amounts, scores and names, and never a baseline, a measurement or a
 * workout row. That is why a spectator and a participant can be served by one
 * function — there is nothing in here that only one of them may read.
 */
create or replace function public.forge_duel_timeline(p_challenge uuid, p_limit int default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  if not public.forge_duel_can_watch(p_challenge, me) then
    raise exception 'forge_duel_timeline: this duel is not open to you.'
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb) from (
      select e.id, e.kind, e.created_at, e.actor_id,
             coalesce(pp.display_name, 'Athlete') as actor_name,
             -- The whitelist IS the privacy model. A key that is not named
             -- here cannot reach a screen, whoever adds it to an event later.
             (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
              from jsonb_each(e.detail) as kv(k, v)
              where k in ('amount', 'stake', 'pot', 'pot_if_accepted', 'outcome',
                          'winner_id', 'backed_id', 'score_challenger', 'score_opponent',
                          'value', 'delta', 'unit', 'exercise', 'countered',
                          'pool_winner', 'pool_loser', 'paid', 'refunded',
                          'start', 'end', 'refunded_coins', 'leader_id')) as detail
      from public.forge_challenge_events e
      left join public.public_profile pp on pp.user_id = e.actor_id
      where e.challenge_id = p_challenge
      order by e.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end;
$$;

/**
 * WATCH — the spectator's view of somebody else's duel.
 *
 * Everything a friend needs to care about it and nothing that belongs to the
 * two athletes: names, the duel metric, the scoreline, the pot, the clock, the
 * supporter shape and the caller's own position. Deliberately NOT the
 * baselines, the escrow split or any training row.
 */
create or replace function public.forge_duel_watch(p_challenge uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c public.forge_challenges%rowtype;
  me uuid := auth.uid();
  fin_a jsonb;
  fin_b jsonb;
begin
  if not public.forge_duel_can_watch(p_challenge, me) then
    raise exception 'forge_duel_watch: this duel is not open to you.'
      using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.forge_challenges where id = p_challenge;

  if c.status = 'settled' then
    select p.final_detail into fin_a from public.forge_challenge_participants p
      where p.challenge_id = c.id and p.user_id = c.challenger_id;
    select p.final_detail into fin_b from public.forge_challenge_participants p
      where p.challenge_id = c.id and p.user_id = c.opponent_id;
  else
    fin_a := public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
              (c.starts_at at time zone 'UTC')::date,
              least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date));
    fin_b := public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
              (c.starts_at at time zone 'UTC')::date,
              least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date));
  end if;

  return jsonb_build_object(
    'id', c.id,
    'challenge_type', c.challenge_type,
    'metric_key', c.metric_key,
    'duration_days', c.duration_days,
    'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at, 'settled_at', c.settled_at,
    'support_closes_at', c.support_closes_at,
    'challenger_id', c.challenger_id, 'opponent_id', c.opponent_id,
    'challenger_name', coalesce((select display_name from public.public_profile where user_id = c.challenger_id), 'Athlete'),
    'opponent_name', coalesce((select display_name from public.public_profile where user_id = c.opponent_id), 'Athlete'),
    'challenger_baseline', (select baseline from public.forge_challenge_participants
                            where challenge_id = c.id and user_id = c.challenger_id),
    'opponent_baseline', (select baseline from public.forge_challenge_participants
                          where challenge_id = c.id and user_id = c.opponent_id),
    'challenger_current', fin_a, 'opponent_current', fin_b,
    'leader_id', c.leader_id, 'winner_id', c.winner_id, 'outcome', c.outcome,
    'pot', coalesce(c.current_stake, c.stake) * 2,
    'support_challenger', (select coalesce(sum(amount), 0)::int from public.forge_duel_support
                           where challenge_id = c.id and backed_id = c.challenger_id),
    'support_opponent', (select coalesce(sum(amount), 0)::int from public.forge_duel_support
                         where challenge_id = c.id and backed_id = c.opponent_id),
    'supporter_count', (select count(*)::int from public.forge_duel_support where challenge_id = c.id),
    'my_support', (select jsonb_build_object('backed_id', s.backed_id, 'amount', s.amount,
                                             'payout', s.payout, 'settled_at', s.settled_at)
                   from public.forge_duel_support s
                   where s.challenge_id = c.id and s.supporter_id = me),
    'my_reactions', coalesce((select jsonb_agg(emoji) from public.forge_duel_reactions
                              where challenge_id = c.id and user_id = me), '[]'::jsonb),
    'reactions', coalesce((select jsonb_object_agg(emoji, n) from (
                             select emoji, count(*)::int as n from public.forge_duel_reactions
                             where challenge_id = c.id group by emoji) r), '{}'::jsonb),
    'i_am_participant', c.challenger_id = me or c.opponent_id = me
  );
end;
$$;

/** THE DUELS I CAN WATCH — my friends' live contests, newest first. Never
 *  my own: those are on the hub already, and repeating them is clutter. */
create or replace function public.forge_duels_watchable(p_limit int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit, 12), 1), 30);
begin
  if me is null then
    raise exception 'forge_duels_watchable: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.ends_at) from (
      select c.id, c.challenge_type, c.metric_key, c.status, c.ends_at, c.support_closes_at,
             coalesce(c.current_stake, c.stake) * 2 as pot,
             c.challenger_id, c.opponent_id, c.leader_id,
             coalesce(ppc.display_name, 'Athlete') as challenger_name,
             coalesce(ppo.display_name, 'Athlete') as opponent_name,
             (select count(*)::int from public.forge_duel_support s where s.challenge_id = c.id) as supporter_count,
             (select s.backed_id from public.forge_duel_support s
              where s.challenge_id = c.id and s.supporter_id = me) as my_backed_id
      from public.forge_challenges c
      left join public.public_profile ppc on ppc.user_id = c.challenger_id
      left join public.public_profile ppo on ppo.user_id = c.opponent_id
      where c.status = 'active'
        and c.spectators_enabled
        and c.challenger_id <> me and c.opponent_id <> me
        and (public.are_friends(me, c.challenger_id) or public.are_friends(me, c.opponent_id))
        and not public.is_blocked(me, c.challenger_id)
        and not public.is_blocked(me, c.opponent_id)
      order by c.ends_at
      limit lim
    ) t
  ), '[]'::jsonb);
end;
$$;

/**
 * THE RIVALRY — head-to-head against one other athlete, computed rather than
 * stored.
 *
 * A stored tally is a second copy of the truth, and second copies drift. This
 * reads the duels themselves, so it cannot disagree with the history it
 * summarises. Every number here is derived from settled duels only.
 */
create or replace function public.forge_rivalry(p_other uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  wins int; losses int; draws int;
  biggest int; coins int; streak int := 0; total int;
  r record;
begin
  if me is null then
    raise exception 'forge_rivalry: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  select
    count(*) filter (where c.winner_id = me),
    count(*) filter (where c.winner_id = p_other),
    count(*) filter (where c.outcome = 'draw'),
    coalesce(max(coalesce(c.current_stake, c.stake) * 2), 0),
    coalesce(sum(case when c.winner_id = me then coalesce(c.current_stake, c.stake)
                      when c.winner_id = p_other then -coalesce(c.current_stake, c.stake)
                      else 0 end), 0),
    count(*)
  into wins, losses, draws, biggest, coins, total
  from public.forge_challenges c
  where c.status = 'settled'
    and ((c.challenger_id = me and c.opponent_id = p_other)
      or (c.challenger_id = p_other and c.opponent_id = me));

  -- THE CURRENT RUN, most recent first. A DRAW DOES NOT BREAK IT (139's rule):
  -- punishing an even contest teaches athletes to avoid the matchups worth
  -- having. Only a loss resets.
  for r in
    select c.winner_id, c.outcome from public.forge_challenges c
    where c.status = 'settled'
      and ((c.challenger_id = me and c.opponent_id = p_other)
        or (c.challenger_id = p_other and c.opponent_id = me))
    order by c.settled_at desc
  loop
    if r.winner_id = me then streak := streak + 1;
    elsif r.outcome = 'draw' then null;
    else exit;
    end if;
  end loop;

  return jsonb_build_object(
    'other_id', p_other,
    'other_name', coalesce((select display_name from public.public_profile where user_id = p_other), 'Athlete'),
    'wins', wins, 'losses', losses, 'draws', draws,
    'total', total, 'streak', streak,
    'biggest_pot', biggest, 'net_coins', coins,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id,
               'result', case when z.winner_id = me then 'won'
                              when z.outcome = 'draw' then 'drew' else 'lost' end,
               'pot', coalesce(z.current_stake, z.stake) * 2,
               'settled_at', z.settled_at))
      from (
        select c.id, c.winner_id, c.outcome, c.current_stake, c.stake, c.settled_at
        from public.forge_challenges c
        where c.status = 'settled'
          and ((c.challenger_id = me and c.opponent_id = p_other)
            or (c.challenger_id = p_other and c.opponent_id = me))
        order by c.settled_at desc limit 5
      ) z), '[]'::jsonb)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────── grants

grant execute on function public.forge_duel_propose(uuid, text, int, uuid) to authenticated;
grant execute on function public.forge_duel_respond(uuid, boolean) to authenticated;
grant execute on function public.forge_duel_withdraw_offer(uuid) to authenticated;
grant execute on function public.forge_duel_support(uuid, uuid, int) to authenticated;
grant execute on function public.forge_duel_react(uuid, text, boolean) to authenticated;
grant execute on function public.forge_duel_sweep() to authenticated;
grant execute on function public.forge_duel_timeline(uuid, int) to authenticated;
grant execute on function public.forge_duel_watch(uuid) to authenticated;
grant execute on function public.forge_duels_watchable(int) to authenticated;
grant execute on function public.forge_rivalry(uuid) to authenticated;
grant execute on function public.forge_challenge_accept(uuid, date) to authenticated;
grant execute on function public.forge_challenge_settle(uuid) to authenticated;
grant execute on function public.forge_challenge_cancel(uuid) to authenticated;
grant execute on function public.my_forge_challenges() to authenticated;

commit;
