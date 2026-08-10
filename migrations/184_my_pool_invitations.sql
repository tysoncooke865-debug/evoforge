-- EvoForge 184 - THE JOINER'S INBOX.
--
-- 180-183 built the whole pool and left one thing impossible: a joiner cannot SEE
-- a pool they have been invited to. `my_workout_callouts()` filters on
-- `athlete_id = me or opponent_id = me`, and an invitee is neither. The invitation
-- notification names a call out the client then has no way to read.
--
-- This is the same class of gap as 174 (a column nothing could set) and the
-- per-set reward (a guard nothing ever called): the enforcement was real and the
-- path to it was missing. Three times now, so it is worth naming the pattern —
-- BUILD THE READ PATH IN THE SAME MIGRATION AS THE WRITE PATH, or the feature is
-- provably correct and unreachable.
--
-- ONE FUNCTION, TWO AUDIENCES, deliberately: somebody who has been invited and not
-- yet joined, and somebody who is already in. They want the same facts - the
-- proposition, who is asking, what each side holds - and splitting them would mean
-- two queries that must agree about a pool.
--
-- NOT A DISCOVERY FEED. It returns only pools this athlete was PERSONALLY invited
-- to, by the athlete doing the training. There is no browsing, no "open pools near
-- you", no ranking by size. That was Tyson's decision on 2026-08-09 and 182
-- asserts no browsable equivalent exists.

begin;

create or replace function public.my_pool_invitations()
returns table (
  callout_id uuid,
  athlete_id uuid,
  athlete_name text,
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
    -- `display_name` lives on `public_profile`, not `profile` — the latter has only
    -- `user_id` and `first_workout_name`. Enumerated from information_schema after
    -- guessing wrong, which is the standing rule in this repo for a reason.
    coalesce(
      (select pp.display_name from public.public_profile pp where pp.user_id = c.athlete_id),
      'Someone'),
    c.exercise,
    c.target_label,
    c.workout_date,
    c.set_no,
    c.status,
    c.expires_at,
    -- The athlete is always BACK; the opponent always PUSH. Same arithmetic as
    -- `callout_pool`, which is the single definition everything else reads.
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
    -- A principal is never an invitee; belt and braces, because `callout_pool_open`
    -- skips them and this must not surface one if that ever changes.
    and c.athlete_id <> auth.uid()
    and c.opponent_id <> auth.uid()
    -- Live, or settled recently enough to see what happened to your own position.
    and (c.status in ('offered', 'accepted', 'awaiting_verification', 'disputed')
         or (c.status = 'settled' and c.settled_at > now() - interval '2 days'))
  order by c.expires_at;
$$;
revoke execute on function public.my_pool_invitations() from public, anon;
grant execute on function public.my_pool_invitations() to authenticated;

-- ─────────── PROVEN: an invitee sees it, a stranger does not

do $$
declare
  ath uuid; opp uuid; mate uuid; cid uuid; n int;
begin
  select athlete_id, opponent_id into ath, opp
  from public.workout_callouts order by created_at desc limit 1;
  if ath is null then raise notice 'no call outs - skipping'; return; end if;

  select u.id into mate from auth.users u
   where u.id not in (ath, opp) and public.are_friends(ath, u.id) limit 1;
  if mate is null then raise notice 'no friend of the athlete - skipping'; return; end if;

  -- The 163/174 eligibility guard refuses a workout that is not on the athlete's
  -- plan for today, and it only stands down for service_role. The probe is about
  -- VISIBILITY, not eligibility, so it announces itself rather than inventing a
  -- schedule for somebody.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.workout_callouts (
    athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
    set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
    status, expires_at, mode)
  values (ath, opp, ath, current_date, 'Invite Probe', 'Invite Lift', 7, 5,
          'external', 60, '60 x 5', 25, 'accepted', now() + interval '1 hour', 'pot')
  returning id into cid;
  insert into public.workout_callout_invites (callout_id, user_id) values (cid, mate);

  -- The invitee sees exactly this one.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', mate), true);
  select count(*) into n from public.my_pool_invitations() where callout_id = cid;
  if n <> 1 then raise exception 'the invitee cannot see their invitation (% rows)', n; end if;

  -- The athlete does NOT see it here; this is the joiner's inbox, not theirs.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', ath), true);
  select count(*) into n from public.my_pool_invitations() where callout_id = cid;
  if n <> 0 then raise exception 'the athlete is being shown their own pool as an invitation'; end if;

  -- And somebody who was never invited sees nothing.
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', opp), true);
  select count(*) into n from public.my_pool_invitations() where callout_id = cid;
  if n <> 0 then raise exception 'an uninvited athlete can see the pool'; end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  delete from public.workout_callout_invites where callout_id = cid;
  delete from public.workout_callouts where id = cid;
  perform set_config('request.jwt.claims', '', true);
end $$;

commit;
