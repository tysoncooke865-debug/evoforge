-- EvoForge 199 — THE SENDER COULD NOT SEE WHAT THEY HAD ALREADY SENT
-- (2026-08-11).
--
-- THE BUG. Send a friend request and the button still says `+ ADD`. Reopen
-- Social and it still says `+ ADD`. There is no way to tell a request you sent
-- thirty seconds ago from one you never sent, so the only sensible thing to do
-- is tap it again — which the unique index correctly refuses, silently.
--
-- THE CAUSE IS AN ABSENCE, NOT A DEFECT. `my_friend_requests()` returns
-- requests TO me. Nothing has ever returned requests FROM me, so the client
-- has no state to render. `AddFriendButton` shows `…` only while its own
-- mutation is in flight and reverts to `+ ADD` the moment it resolves.
--
-- WHAT WAS ALREADY RIGHT AND IS NOT CHANGED. `friend_requests` already carries
-- a UNIQUE (from_id, to_id), so a duplicate active request was never actually
-- creatable — the failure was that the athlete could not SEE that, and was
-- invited to keep trying. No new uniqueness is needed and none is added.
--
-- ---- WHY THIS IS NOT A COSMETIC FIX ----
--
-- `calloutsAvailable()` gates the pledge control on `friendCount > 0`, and
-- friends means ACCEPTED friends. An athlete stuck believing their request
-- never sent has zero accepted friends, so the Golden Dot never appears in the
-- workout logger — which is reported separately as "the pledge feature is
-- missing". It is not missing. It is correctly hidden behind a friendship that
-- the Social screen made look like it had never been requested.
--
-- ---- CANCEL ----
--
-- A sender who can see a pending request will want to withdraw it, and
-- `respond_friend_request` is the RECIPIENT's verb (accept/decline). Cancelling
-- is the sender's, so it gets its own function rather than a boolean on
-- somebody else's. It DELETES rather than marking cancelled, on purpose: the
-- unique index is on (from_id, to_id) with no status in it, so a tombstone
-- would permanently bar re-asking.
--
-- FALSIFICATION CHECKLIST:
--  1. A sends to B; `my_sent_friend_requests()` as A returns one pending row
--     naming B. As B it returns nothing (it is not B's request to see).
--  2. B still sees it in `my_friend_requests()` — the incoming side is
--     untouched.
--  3. A cancels; both lists are empty and A can send again.
--  4. A cannot cancel a request they did not send.
--  5. Once ACCEPTED, the row leaves the sent-pending list (they are friends
--     now, which is a different state and a different screen).

begin;

/**
 * Requests I have SENT that are still waiting. The mirror of
 * `my_friend_requests()`, which returns the ones sent TO me.
 *
 * `display_name` comes from the same public-profile projection the rest of
 * Social uses, so a private athlete is named exactly as consistently here as
 * anywhere else and this function widens no visibility of its own.
 */
create or replace function public.my_sent_friend_requests()
returns table (id uuid, to_id uuid, display_name text, created_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select r.id,
         r.to_id,
         coalesce(p.display_name, 'Athlete') as display_name,
         r.created_at
    from public.friend_requests r
    left join public.public_profile p on p.user_id = r.to_id
   where r.from_id = auth.uid()
     and r.status = 'pending'
   order by r.created_at desc;
$$;

/**
 * Withdraw a request I sent.
 *
 * DELETES rather than marking cancelled: the unique index is (from_id, to_id)
 * with no status in it, so leaving a tombstone would permanently prevent ever
 * asking that person again. Scoped to the caller's OWN outgoing pending rows,
 * so this cannot be used to clear somebody else's inbox.
 */
create or replace function public.cancel_friend_request(p_request uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  gone int;
begin
  if me is null then
    raise exception 'cancel_friend_request: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  delete from public.friend_requests
   where id = p_request and from_id = me and status = 'pending';
  get diagnostics gone = row_count;
  -- Cancelling something already gone IS cancelled. A double tap on a slow
  -- network must not read as a failure.
  return gone > 0;
end;
$$;

revoke execute on function public.my_sent_friend_requests() from public, anon;
revoke execute on function public.cancel_friend_request(uuid) from public, anon;
grant execute on function public.my_sent_friend_requests() to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

commit;
