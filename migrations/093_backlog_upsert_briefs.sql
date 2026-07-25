-- EvoForge 093 — the agent write path could not set the fields 091 and 092 added.
--
-- command_backlog_upsert was written in 089, before `execution` and the founder
-- brief existed. It kept silently dropping them, so every candidate an agent
-- wrote came back as 'engineering' with no steps — including the one this
-- session just wrote for the apex-domain problem, which is a founder action.
--
-- The failure mode is the quiet kind: no error, a valid-looking row, and a
-- candidate that would eventually be raised as engineering work no agent can do.
-- Exactly the class of bug 091 was written to eliminate, reintroduced through a
-- function nobody updated.
--
-- Lesson worth keeping: when a migration adds a column that an AGENT is supposed
-- to populate, the agent-facing RPC is part of the migration, not a follow-up.

create or replace function public.command_backlog_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_exec text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  v_key := coalesce(p->>'topic_key', command_slug(p->>'title'));
  if v_key = '' or v_key is null then raise exception 'command: backlog needs a topic_key'; end if;

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
                               founder_steps, founder_unblocks, founder_done_when)
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
          coalesce(p->>'founder_done_when', ''))
  on conflict (topic_key) do update set
    title = excluded.title, category = excluded.category, departments = excluded.departments,
    value_score = excluded.value_score, effort_score = excluded.effort_score,
    confidence_score = excluded.confidence_score, rationale = excluded.rationale,
    document = excluded.document, depends_on = excluded.depends_on,
    execution = excluded.execution, founder_steps = excluded.founder_steps,
    founder_unblocks = excluded.founder_unblocks, founder_done_when = excluded.founder_done_when,
    updated_at = now()
  where command_backlog.status = 'candidate'   -- never rewrite a question already asked
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'topic_key', v_key, 'execution', v_exec);
end $$;
grant execute on function public.command_backlog_upsert(jsonb) to authenticated;

-- Falsify the new guard: this must raise, not insert.
do $$
begin
  begin
    perform command_backlog_upsert(jsonb_build_object(
      'topic_key','__guard_probe__', 'title','probe', 'execution','founder_action'));
    raise exception 'FAIL: a founder_action with no steps was accepted';
  exception when others then
    if position('must carry founder_steps' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from command_backlog where topic_key = '__guard_probe__') then
    raise exception 'FAIL: the probe row was written despite the guard';
  end if;
  raise notice 'guard verified';
end $$;
