-- EvoForge 181 - THE POOL, PART 2: OPENING ONE, AND JOINING IT.
--
-- 180 built the table and deliberately gave it no insert path, because joining
-- moves coins. This is that path, and the two decisions it encodes are Tyson's
-- (2026-08-09), taken after I put the alternatives to him:
--
--   WHO MAY JOIN     friends of the athlete, and nobody else. The same rule
--                    `callout_create` already applies to the opponent. It keeps a
--                    pool inside a real gym circle, which is the version that can
--                    be defended: "friends backing a mate" rather than "strangers
--                    backing an athlete".
--
--   HOW THEY FIND IT the athlete opens the pool and names who gets asked. There is
--                    NO browsable list of open pools, deliberately. A scrollable
--                    feed of things to put coins on is what a betting lobby looks
--                    like, and `forge_duels_watchable` has no equivalent here on
--                    purpose. Nothing is broadcast.
--
-- BOTH GATES ARE CHECKED AT JOIN TIME, not just at invite time. Friendship can end
-- between the invite and the join, and an invite to a pool that has since settled
-- must not still work.
--
-- ── THE RAMP MUST NOT LEAK, IN EITHER DIRECTION ──
--
-- `forge_trial_allowance` computes the athlete's escalation ceiling from
-- `max(workout_callouts.stake)` over the previous seven days. Two things follow,
-- and both are asserted at the bottom because both are easy to break later:
--
--   1. A JOINER'S STAKE MUST NOT FEED THE ATHLETE'S RAMP. Entries live in a
--      different table, so this holds by construction today - but if settlement or
--      a later migration ever writes a joiner's amount onto the callout row, six
--      friends could quietly ratchet somebody's personal limit upward.
--   2. THE ATHLETE'S RAMP MUST NOT BOUND THE JOINER. A joiner is not doing the
--      training and is not the person the physiotherapist test protects; their
--      own balance and the per-pledge config are their limits.
--
-- NO RAKE. Not here, not at settlement. 164 deleted the duel's platform cut of the
-- losing pool and it does not come back under a new name.

begin;

-- ────────────────────────────────────────── two more notification kinds

alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications add constraint social_notifications_type_check
  check (type = any (array[
    'reaction', 'comment', 'friend_request', 'friend_accepted', 'mention',
    'comment_reaction', 'comment_reply', 'pr_beaten',
    'duel_invite', 'duel_accepted', 'duel_declined', 'duel_raise',
    'duel_raise_accepted', 'duel_raise_declined', 'duel_lead_change',
    'duel_support', 'duel_ending', 'duel_settled',
    'callout_offered', 'callout_accepted', 'callout_declined', 'callout_logged',
    'callout_verified', 'callout_settled',
    -- 181
    'callout_pool_invite', 'callout_pool_joined'
  ]));

-- ─────────────────────────────────────────────────────── the invitations

create table if not exists public.workout_callout_invites (
  callout_id uuid not null references public.workout_callouts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  invited_at timestamptz not null default now(),
  primary key (callout_id, user_id)
);

comment on table public.workout_callout_invites is
  'Who the athlete asked to join a pool (181). Being invited is the ONLY way in: '
  'there is no browsable list of open pools, by design.';

alter table public.workout_callout_invites enable row level security;

-- You can see an invitation addressed to you, and the athlete can see who they
-- asked. Nobody else needs to know who was invited.
drop policy if exists workout_callout_invites_visible on public.workout_callout_invites;
create policy workout_callout_invites_visible on public.workout_callout_invites
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.workout_callouts c
               where c.id = callout_id and c.athlete_id = auth.uid())
  );

-- No write policies, same reasoning as 180: invitations are issued by the athlete
-- through a definer function, never by a client writing a row.

-- ───────────────────────────────────────────── open a pool, and ask people

/**
 * TURN A CALL OUT INTO A POOL AND ASK SOME FRIENDS.
 *
 * The athlete only, on their own live call out. Idempotent: opening an already
 * open pool just adds whoever is new to the invitation list, so a double tap does
 * not error and does not notify twice.
 */
create or replace function public.callout_pool_open(p_callout uuid, p_invitees uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  c public.workout_callouts;
  invitee uuid;
  added int := 0;
  skipped int := 0;
begin
  if me is null then
    raise exception 'callout_pool_open: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.workout_callouts where id = p_callout;
  if c.id is null then
    raise exception 'callout_pool_open: no such call out.' using errcode = 'no_data_found';
  end if;
  if c.athlete_id <> me then
    raise exception 'callout_pool_open: only the athlete can open their own set to a pool.'
      using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('offered', 'accepted') then
    raise exception 'callout_pool_open: this call out is % - too late.', c.status
      using errcode = 'check_violation';
  end if;

  update public.workout_callouts set mode = 'pot' where id = p_callout and mode <> 'pot';

  foreach invitee in array coalesce(p_invitees, '{}'::uuid[]) loop
    -- The principals are already in; inviting them is a no-op rather than an error.
    if invitee = c.athlete_id or invitee = c.opponent_id then
      skipped := skipped + 1;
      continue;
    end if;
    -- FRIENDS ONLY, checked here AND again at join time.
    if not public.are_friends(me, invitee) then
      skipped := skipped + 1;
      continue;
    end if;
    insert into public.workout_callout_invites (callout_id, user_id)
    values (p_callout, invitee)
    on conflict (callout_id, user_id) do nothing;
    if found then
      added := added + 1;
      perform public.forge_duel_notify(
        invitee, me, 'callout_pool_invite',
        jsonb_build_object('callout_id', c.id, 'exercise', c.exercise,
                           'target', c.target_label, 'amount', c.stake));
    end if;
  end loop;

  return jsonb_build_object('mode', 'pot', 'invited', added, 'skipped', skipped);
end;
$$;
revoke execute on function public.callout_pool_open(uuid, uuid[]) from public, anon;
grant execute on function public.callout_pool_open(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────── join one

/**
 * BACK THE ATHLETE, OR PUSH AGAINST THEM.
 *
 * One position, one call out, coins escrowed on the spot. Everything structural is
 * already enforced by `callout_entry_guard` (180) - pot mode, not a principal, not
 * a finished set, eight people maximum, one position each. What is added here is
 * the part that needs a definer: eligibility and money.
 *
 * THE ADVISORY LOCK is per (callout, joiner) rather than per callout. Two friends
 * joining at the same moment is normal and must not serialise; the same friend
 * double-tapping is what has to be stopped, and the unique index would stop it
 * anyway - the lock just turns a constraint violation into a clean answer.
 */
create or replace function public.callout_pool_join(p_callout uuid, p_side text, p_stake int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  c public.workout_callouts;
  cfg public.workout_callout_config;
  bal int;
  pool jsonb;
begin
  if me is null then
    raise exception 'callout_pool_join: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  if p_side not in ('back', 'push') then
    raise exception 'callout_pool_join: pick a side - back or push.' using errcode = 'check_violation';
  end if;

  select * into c from public.workout_callouts where id = p_callout;
  if c.id is null then
    raise exception 'callout_pool_join: no such call out.' using errcode = 'no_data_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_callout::text || me::text, 0));

  -- ALREADY IN? Answer, do not fail. A double tap should read as "you are in",
  -- not as an error the athlete has to interpret.
  if exists (select 1 from public.workout_callout_entries e
             where e.callout_id = p_callout and e.user_id = me) then
    return jsonb_build_object('joined', true, 'already', true, 'pool', public.callout_pool(p_callout));
  end if;

  -- 1. INVITED. The only way in - there is no browsable list of open pools.
  if not exists (select 1 from public.workout_callout_invites i
                 where i.callout_id = p_callout and i.user_id = me) then
    raise exception 'callout_pool_join: this pool is invitation only.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 2. STILL FRIENDS WITH THE ATHLETE. Re-checked here because friendship can end
  --    between the invitation and the join.
  if not public.are_friends(c.athlete_id, me) then
    raise exception 'callout_pool_join: you can only back a friend.'
      using errcode = 'insufficient_privilege';
  end if;

  -- 3. THE AMOUNT. The joiner's OWN limits: their balance and the per-pledge
  --    config. Deliberately NOT the athlete's escalation ramp - a joiner is not
  --    doing the training, and the ramp exists to bound the person who is.
  select * into cfg from public.workout_callout_config where id;
  if p_stake < cfg.min_stake or p_stake > cfg.max_stake then
    raise exception 'callout_pool_join: pledge between % and %.', cfg.min_stake, cfg.max_stake
      using errcode = 'check_violation';
  end if;
  bal := public.forge_duel_balance(me);
  if bal < p_stake then
    raise exception 'callout_pool_join: you have % coins, not %.', bal, p_stake
      using errcode = 'check_violation';
  end if;

  -- 4. THE POSITION. `callout_entry_guard` re-proves every structural rule.
  insert into public.workout_callout_entries (callout_id, user_id, side, stake)
  values (p_callout, me, p_side, p_stake);

  -- 5. ESCROW, the same shape as `callout_respond`. A negative row, so the coins
  --    genuinely leave the balance and cannot be pledged anywhere else.
  perform set_config('evoforge.callout_authorized', p_callout::text, true);
  insert into public.coin_events (user_id, kind, amount, source_id)
  values (me, 'callout_stake', -p_stake, p_callout::text);

  pool := public.callout_pool(p_callout);
  perform public.forge_duel_notify(
    c.athlete_id, me, 'callout_pool_joined',
    jsonb_build_object('callout_id', c.id, 'side', p_side, 'amount', p_stake,
                       'exercise', c.exercise));

  return jsonb_build_object('joined', true, 'already', false, 'side', p_side,
                            'amount', p_stake, 'pool', pool);
end;
$$;
revoke execute on function public.callout_pool_join(uuid, text, int) from public, anon;
grant execute on function public.callout_pool_join(uuid, text, int) to authenticated;

-- ─────────── PROVEN: the ramp does not leak, in either direction

do $$
declare
  d text;
begin
  -- THE ATHLETE'S RAMP READS ONLY THE CALLOUT ROW. If a later migration teaches
  -- `forge_trial_allowance` to read entries, six friends could ratchet somebody
  -- else's personal limit upward without doing any training.
  d := pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure);
  if d like '%workout_callout_entries%' then
    raise exception 'the escalation ramp now reads pool entries - a joiner can raise the athlete''s limit';
  end if;

  -- AND THE JOIN PATH DOES NOT CONSULT THE RAMP. A joiner is bounded by their own
  -- balance and the config, not by how much the athlete has been pledging.
  d := pg_get_functiondef('public.callout_pool_join(uuid,text,int)'::regprocedure);
  if d like '%forge_trial_allowance%' then
    raise exception 'a joiner is being bounded by the athlete''s escalation ramp';
  end if;

  -- NO RAKE ANYWHERE IN THE POOL PATH. 164 deleted the duel's cut; it does not
  -- reappear here under another name.
  if d ilike '%rake%' or d ilike '%margin%' or d ilike '%commission%' then
    raise exception 'the pool join path mentions a cut of the money';
  end if;

  -- INVITE-ONLY IS ENFORCED IN SQL, not merely in the UI.
  if d not like '%workout_callout_invites%' then
    raise exception 'joining does not check the invitation list';
  end if;
  if d not like '%are_friends%' then
    raise exception 'joining does not re-check friendship';
  end if;

  -- AND THERE IS STILL NO BROWSABLE LIST OF OPEN POOLS.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname like '%callout%watchable%') then
    raise exception 'a browsable pool feed exists - that was explicitly not the design';
  end if;
end $$;

commit;
