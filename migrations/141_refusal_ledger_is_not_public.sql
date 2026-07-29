-- 141 — ANYONE WITH THE PUBLISHABLE KEY COULD WRITE THE REFUSAL LEDGER
--
-- WHAT WAS WRONG
--
--   Every other command_sandbox_* function opens `if not is_founder() then
--   raise`. command_sandbox_record_refusal deliberately does NOT, because the
--   thing that calls it is the sandbox proxy — a local node process, not a
--   signed-in founder.
--
--   But "no founder check" plus PostgREST's default grants means anon can call
--   it. Verified:
--
--     select has_function_privilege('anon',
--            'command_sandbox_record_refusal(jsonb)', 'execute');   -->  true
--
--   The publishable key is in every shipped bundle by design, so that is a
--   public write endpoint into a founder-only table. It cannot read anything
--   back (RLS on command_sandbox_refusals is founder-select-only) and it cannot
--   reach any other table, so the blast radius is junk rows in a ledger — but a
--   ledger whose entries might be fabricated is not evidence, and this ledger's
--   entire job is to be evidence about what a sandbox tried to write.
--
--   The right fix is not to add is_founder(): that would break the caller,
--   which has no founder identity. It is to stop granting execute to the roles
--   that should never call it. service_role keeps it, and the proxy already
--   holds the service key locally.
--
-- THE GENERAL RULE
--
--   A SECURITY DEFINER function with no in-body authorisation check is public
--   unless its grants say otherwise. "It has no guard because only our worker
--   calls it" is an assumption about callers, and PostgREST does not share it.
--
-- Not destructive: revoking execute removes no data and no column.

begin;

revoke execute on function command_sandbox_record_refusal(jsonb) from anon;
revoke execute on function command_sandbox_record_refusal(jsonb) from authenticated;
revoke execute on function command_sandbox_record_refusal(jsonb) from public;

-- The proxy runs on the runner machine and already loads SUPABASE_SERVICE_KEY.
grant execute on function command_sandbox_record_refusal(jsonb) to service_role;

commit;
