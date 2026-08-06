-- EvoForge 141 — the create policy asks a question the caller is allowed to ask.
--
-- 139's insert policy called `are_friends(auth.uid(), opponent_id)`, and an
-- RLS policy runs as the CALLING role — so `authenticated` needed EXECUTE on
-- it, and the first real insert died with "permission denied for function
-- are_friends".
--
-- The obvious fix (grant execute on are_friends to authenticated) is the wrong
-- one: `are_friends(p, q)` takes TWO arbitrary users, so granting it lets any
-- signed-in athlete probe whether any two strangers are friends. Small leak,
-- permanent, and granted for the sake of a policy that only ever asks about
-- the caller.
--
-- So: a helper that can only ask about YOU. Same answer, no new surface.

begin;

create or replace function public.forge_can_challenge(p_opponent uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Deliberately self-scoped: the caller is always auth.uid(), so this cannot
  -- be used to inspect anybody else's friendships.
  select auth.uid() is not null
     and p_opponent is not null
     and p_opponent <> auth.uid()
     and public.are_friends(auth.uid(), p_opponent);
$$;

grant execute on function public.forge_can_challenge(uuid) to authenticated;

drop policy if exists forge_challenges_challenger_insert on public.forge_challenges;
create policy forge_challenges_challenger_insert on public.forge_challenges
  for insert with check (
    challenger_id = auth.uid()
    and opponent_id <> auth.uid()
    and public.forge_can_challenge(opponent_id)
    and status = 'pending'
    and accepted_at is null
    and winner_id is null
    and outcome is null
  );

commit;
