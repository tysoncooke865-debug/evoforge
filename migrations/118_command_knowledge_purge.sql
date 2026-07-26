-- EvoForge 118 — the one loud, audited way to destroy knowledge.
--
-- 117 made versions immutable against UPDATE and DELETE, and that trigger also
-- refuses the cascade when the parent object is deleted. The consequence, found
-- by trying to clean up after the falsification script: a knowledge object, once
-- it has a version, could never be removed by anyone, for any reason.
--
-- That is too strong, and it is strong in the wrong direction. Immutability
-- exists so history cannot be changed QUIETLY — so that "we believed this in
-- July and it was wrong by September" stays discoverable. It was never meant to
-- mean a mistake can never be undone, and there are two cases where "never" is
-- actively harmful:
--
--   • an object created in error, or by a test, permanently polluting the base
--     that every future agent reads;
--   • an object containing personal or secret data, which must be removable on
--     request and is a legal obligation rather than a preference.
--
-- So: deprecation remains the normal path and should be used for essentially
-- everything. Purge is the exception — founder-only, reason required, and it
-- writes what it destroyed to command_audit BEFORE destroying it, so the FACT
-- of the purge outlives the content. You cannot make knowledge disappear
-- quietly; you can only make it disappear loudly.
--
-- FALSIFICATION (in scripts/_falsify118.mjs):
--   1. a version still cannot be deleted directly.
--   2. deleting an object still cascades into the immutability guard.
--   3. purge requires a founder and a reason.
--   4. purge records what it destroyed before destroying it.
--   5. the purge permit is scoped to ONE object and does not survive it.

/**
 * Allow the cascade only for the object currently being purged.
 *
 * The permit is a transaction-local setting holding a single object id. It
 * cannot leak to another connection, it disappears at commit, and it authorises
 * exactly one object — so a purge of A can never take B's history with it.
 */
create or replace function public.command_versions_are_immutable()
returns trigger language plpgsql set search_path = public as $$
declare v_permit text;
begin
  if tg_op = 'DELETE' then
    v_permit := current_setting('command.purging_object', true);
    if v_permit is not null and v_permit = old.object_id::text then
      return old;
    end if;
  end if;

  raise exception
    'command: knowledge version %.v% is immutable. Correct it by publishing a NEW version with a stated reason — '
    'rewriting history is how a knowledge base stops being able to answer "what changed our mind". '
    'To destroy it deliberately, a founder may call command_knowledge_purge(key, reason), which is audited.',
    old.object_id, old.version;
end $$;

/**
 * Destroy a knowledge object and its history. The exception, not the rule.
 *
 * Deprecation (command_knowledge_supersede, or setting deprecated) is what
 * should happen to knowledge that stopped being true — it keeps the history
 * that makes the change instructive. Purge is for knowledge that should never
 * have existed: a test fixture, a mistake, or content that must be removed.
 *
 * The audit record is written FIRST and deliberately captures the title, type,
 * version count and reason. After this returns, that record is the only trace —
 * which is the point: the content is gone, the fact that it was removed is not.
 */
create or replace function public.command_knowledge_purge(p_key text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o command_knowledge_objects; v_versions int; v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception
      'command: say why. Purging destroys history permanently — if the knowledge merely stopped being true, '
      'deprecate it instead so the change stays instructive';
  end if;

  select * into o from command_knowledge_objects where key = p_key;
  if o.id is null then raise exception 'command: no knowledge object %', p_key; end if;

  select count(*) into v_versions from command_knowledge_versions where object_id = o.id;
  select name into v_name from command_founders where user_id = auth.uid();

  -- Written BEFORE the delete. This survives; the content does not.
  perform command_log('knowledge_purged', 'settings', o.id, p_key,
    format('%s purged %s ("%s", %s, %s version(s)) — %s',
           coalesce(v_name,'a founder'), p_key, o.title, o.type, v_versions, p_reason),
    jsonb_build_object('key', p_key, 'title', o.title, 'type', o.type,
                       'domain', o.domain, 'versions', v_versions,
                       'created_at', o.created_at, 'reason', p_reason));

  -- The permit: transaction-local, one object, gone at commit.
  perform set_config('command.purging_object', o.id::text, true);
  delete from command_knowledge_objects where id = o.id;
  perform set_config('command.purging_object', '', true);

  return jsonb_build_object('ok', true, 'key', p_key, 'versions_destroyed', v_versions);
end $$;
revoke all on function public.command_knowledge_purge(text, text) from public, anon;
grant execute on function public.command_knowledge_purge(text, text) to authenticated;
