-- EvoForge 125 — every AI proposal was demanding a unanimous vote.
--
-- command_backlog_upsert never wrote the `significance` column. Callers passed
-- it, the function ignored it, and the column fell back to its default of
-- 'major'. command_carry_significance_to_proposal then copied that onto the
-- proposal, so migration 096's rule — minor needs one founder, major needs all
-- three — resolved to "all three" for everything the studio ever raised.
--
-- A one-line fix to a broken lint config was asking Jesse and Charlie to vote.
-- So was a suggestion to move a button. The council queue filled with items
-- that could not clear without three people, the Exec correctly reported
-- "Council queue is full (3/3). Nothing new is rational", and the pipeline
-- stopped — which reads exactly like the studio no longer writing proposals.
--
-- THE FIX IS TO HONOUR WHAT THE CALLER SAID, not to lower the default.
--
--   An explicit significance is written through. Silence still lands on
--   'major', because the conservative default is right for anything nobody
--   thought about — the bug was never the default, it was that the field was
--   silently discarded, so no caller could opt out of it however carefully they
--   filled the payload in.
--
-- FALSIFICATION (in scripts/_falsify125.mjs):
--   1. an item declaring minor stays minor, and its proposal is minor.
--   2. an item declaring nothing is still major.
--   3. an unknown value is refused rather than silently defaulted.
--   4. updating an existing item can change its significance.

/**
 * Built by ADDING to 093's live definition, not rewriting it from memory.
 * The first attempt reconstructed the function and lost the coalesce on
 * founder_unblocks, which is NOT NULL — every insert failed instantly.
 * Rule 5 exists for precisely this, and I broke it.
 */
create or replace function public.command_backlog_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_exec text; v_sig text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  v_key := coalesce(p->>'topic_key', command_slug(p->>'title'));
  if v_key = '' or v_key is null then raise exception 'command: backlog needs a topic_key'; end if;

  -- THE FIELD THAT WAS BEING DROPPED. Callers passed significance, the function
  -- never wrote it, and the column fell back to its default of 'major' — so
  -- migration 096's rule resolved to "all three founders" for every item the
  -- studio ever raised, including a one-line lint config fix.
  v_sig := nullif(p->>'significance', '');
  if v_sig is not null and v_sig not in ('minor','major') then
    raise exception 'command: significance is minor or major — got "%". Guessing here decides how many founders must vote', v_sig;
  end if;

  v_exec := coalesce(p->>'execution', 'engineering');
  if v_exec not in ('engineering', 'founder_action', 'decision_only') then
    raise exception 'command: unknown execution kind %', v_exec;
  end if;
  -- Refuse at the door rather than letting the Exec's cycle discover it later:
  -- a founder action with no steps is a card that cannot say what to do.
  if v_exec = 'founder_action'
     and jsonb_array_length(coalesce(p->'founder_steps', '[]'::jsonb)) = 0 then
    raise exception 'command: a founder_action candidate must carry founder_steps — %', v_key;
  end if;

  insert into command_backlog (topic_key, title, source, category, departments,
                               value_score, effort_score, confidence_score, rationale,
                               document, depends_on, created_by, execution,
                               founder_steps, founder_unblocks, founder_done_when,
                               significance)
  values (v_key, coalesce(p->>'title','Untitled'), coalesce(p->>'source','exec_scan'),
          coalesce(p->>'category','prototype'),
          coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'departments','[]'::jsonb))),'{}'),
          coalesce((p->>'value_score')::int, 5),
          coalesce((p->>'effort_score')::int, 5),
          coalesce((p->>'confidence_score')::int, 5),
          coalesce(p->>'rationale',''),
          coalesce(p->'document','{}'::jsonb),
          coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'depends_on','[]'::jsonb))),'{}'),
          coalesce(p->>'created_by','exec'),
          v_exec,
          coalesce(p->'founder_steps', '[]'::jsonb),
          coalesce(p->>'founder_unblocks', ''),
          coalesce(p->>'founder_done_when', ''),
          -- Explicit intent honoured; silence keeps the conservative default.
          coalesce(v_sig, 'major'))
  on conflict (topic_key) do update set
    title = excluded.title, category = excluded.category, departments = excluded.departments,
    value_score = excluded.value_score, effort_score = excluded.effort_score,
    confidence_score = excluded.confidence_score, rationale = excluded.rationale,
    document = excluded.document, depends_on = excluded.depends_on,
    execution = excluded.execution, founder_steps = excluded.founder_steps,
    founder_unblocks = excluded.founder_unblocks, founder_done_when = excluded.founder_done_when,
    significance = excluded.significance,
    updated_at = now()
  where command_backlog.status = 'candidate'   -- never rewrite a question already asked
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'topic_key', v_key, 'execution', v_exec,
                            'significance', coalesce(v_sig, 'major'));
end $$;

revoke all on function public.command_backlog_upsert(jsonb) from public, anon;
grant execute on function public.command_backlog_upsert(jsonb) to authenticated;

-- Correct the items raised while the field was being dropped. Only the ones
-- whose rationale shows they were small by construction — a UI tweak from the
-- Dev Lab, a lint config, a dead table. Nothing that touches money, ownership
-- or privacy is moved, and those categories carry their own unanimous rule
-- regardless of significance.
update public.command_backlog
   set significance = 'minor', updated_at = now()
 where topic_key in ('command-lint-broken','dead-knowledge-table','browser-journey-runner',
                     'ai-plan-ignores-availability')
    or topic_key like 'ui-screen%';

update public.command_proposals p
   set significance = 'minor'
  from public.command_backlog b
 where b.proposal_id = p.id
   and p.status in ('open','changes_requested')
   and b.significance = 'minor'
   and p.category not in ('monetisation','ownership','privacy');
