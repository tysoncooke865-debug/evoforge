-- EvoForge 117 — the durable event bus and the versioned knowledge database.
--
-- PHASE 1 OF THE ORGANISATIONAL INTELLIGENCE SYSTEM, AND ONLY PHASE 1.
--
-- Professor, the Academy, the Library, curricula and certifications all sit on
-- top of two things that do not exist yet: events that cannot be lost, and
-- knowledge that cannot be rewritten. Building the upper layers first would
-- mean Professor validating into a store somebody can silently edit afterwards,
-- which is indistinguishable from not validating at all.
--
-- WHAT IS ALREADY HERE AND IS NOT BEING REPLACED
--
--   command_audit      419 rows. Every mutation, written in the same
--                      transaction as the change. It is a RECORD, not a bus —
--                      no processing status, no retries, no idempotency — so it
--                      becomes an event SOURCE rather than being replaced.
--   command_lessons    7 rows, retrieved by command_relevant_lessons(paths,
--                      tags) and already fed to agents by the context compiler.
--                      Left working, untouched. Migrating lessons into
--                      knowledge objects is Phase 3, after Professor exists to
--                      validate them.
--   command_evidence   12 rows, and the rule that a fact needs a source. This
--                      migration copies that rule rather than inventing a new
--                      one.
--
-- WHAT THIS ADDS
--
--   1. command_events            — durable, idempotent, retried, dead-lettered
--   2. command_knowledge_objects — the mutable pointer (current version, status)
--   3. command_knowledge_versions— IMMUTABLE. Enforced by trigger, not by hope
--   4. command_knowledge_edges   — the graph
--   5. command_knowledge_sources — traceability, and it is mandatory
--   6. command_knowledge_candidates — what an event proposes, before validation
--
-- THE TWO RULES EVERYTHING ELSE WILL REST ON
--
--   A published knowledge object must cite at least one source. This is the
--   same rule 099 applied to evidence, and it is the reason the library cannot
--   fill up with plausible statements nobody can check.
--
--   A version, once written, cannot be updated or deleted. Not by an agent, not
--   by a founder, not by Professor. History is what makes "we learned this in
--   July and it was wrong by September" a thing anyone can discover.
--
-- FALSIFICATION CHECKLIST (scripts/_falsify117.mjs):
--   1. the same idempotency key twice produces ONE event.
--   2. a version cannot be updated.
--   3. a version cannot be deleted.
--   4. current_version always matches the newest version — set by trigger.
--   5. a knowledge object cannot be published with no source.
--   6. a candidate cannot become an object without being validated first.
--   7. a failing event retries, then dead-letters — it never disappears.
--   8. superseding records the relationship in both directions.
--   9. an edge to a non-existent object is refused.
--  10. only founders may replay a dead-lettered event.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE DURABLE EVENT BUS
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Every meaningful thing that happens in EvoForge, durably.
 *
 * IDEMPOTENCY IS THE LOAD-BEARING COLUMN. Events arrive from triggers, from the
 * runner, from scripts and from replays, and the same real-world occurrence can
 * be reported twice by two of them. Without a unique key the knowledge system
 * would learn the same lesson repeatedly and each copy would look like
 * independent corroboration — the single most dangerous failure available to a
 * system that assigns confidence by counting evidence.
 *
 * `correlation_id` groups everything caused by one original action;
 * `causation_id` names the single event that caused this one. Together they let
 * "why does the Library say this?" be answered by walking backwards.
 */
create table if not exists public.command_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  schema_version  int  not null default 1,
  source_system   text not null,
  source_entity   text,
  source_entity_id uuid,
  occurred_at     timestamptz not null default now(),
  actor_kind      text not null default 'system' check (actor_kind in ('founder','agent','system')),
  actor_label     text,

  correlation_id  uuid,
  causation_id    uuid references public.command_events(id) on delete set null,
  -- The same occurrence reported twice is ONE event. See the note above.
  idempotency_key text not null unique,

  domains         text[] not null default '{}',
  risk            text not null default 'LOW' check (risk in ('LOW','MEDIUM','HIGH')),
  -- P0 immediate, P1 high, P2 normal, P3 low. Drives claim order, and keeps a
  -- security finding from queueing behind two hundred documentation edits.
  priority        text not null default 'P2' check (priority in ('P0','P1','P2','P3')),
  payload         jsonb not null default '{}'::jsonb,

  status          text not null default 'pending'
                    check (status in ('pending','processing','classified','no_impact','done','failed','dead')),
  classification  text,
  attempts        int  not null default 0,
  max_attempts    int  not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  worker          text,

  candidate_ids   uuid[] not null default '{}',
  version_ids     uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);

create index if not exists command_events_queue_idx
  on public.command_events(status, priority, next_attempt_at)
  where status in ('pending','failed');
create index if not exists command_events_corr_idx on public.command_events(correlation_id);
create index if not exists command_events_type_idx on public.command_events(event_type, occurred_at desc);

/**
 * Emit an event. Safe to call twice.
 *
 * Returns `duplicate: true` rather than raising, because the callers are
 * triggers and retry loops where a duplicate is expected and normal. Raising
 * would turn a correctly-deduplicated event into a failed transaction and roll
 * back the real work that caused it.
 */
create or replace function public.command_emit_event(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_existing uuid;
begin
  v_key := coalesce(
    p->>'idempotency_key',
    -- A deterministic default: same type, same entity, same instant is the same
    -- event. Callers with a better natural key should pass one.
    md5(concat_ws('|', p->>'event_type', p->>'source_entity_id', p->>'occurred_at', p->>'source_system'))
  );

  select id into v_existing from command_events where idempotency_key = v_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'id', v_existing, 'duplicate', true);
  end if;

  insert into command_events (
    event_type, schema_version, source_system, source_entity, source_entity_id,
    occurred_at, actor_kind, actor_label, correlation_id, causation_id,
    idempotency_key, domains, risk, priority, payload)
  values (
    p->>'event_type', coalesce((p->>'schema_version')::int, 1),
    coalesce(p->>'source_system','command'), p->>'source_entity',
    nullif(p->>'source_entity_id','')::uuid,
    coalesce((p->>'occurred_at')::timestamptz, now()),
    coalesce(p->>'actor_kind','system'), p->>'actor_label',
    nullif(p->>'correlation_id','')::uuid, nullif(p->>'causation_id','')::uuid,
    v_key,
    coalesce(array(select jsonb_array_elements_text(p->'domains')), '{}'),
    coalesce(p->>'risk','LOW'), coalesce(p->>'priority','P2'),
    coalesce(p->'payload','{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false);
end $$;

/** Claim events for processing. P0 first, then oldest. */
create or replace function public.command_claim_events(p_worker text, p_limit int default 10)
returns setof public.command_events language plpgsql security definer set search_path = public as $$
begin
  return query
  with picked as (
    select id from command_events
     where status in ('pending','failed')
       and next_attempt_at <= now()
       and attempts < max_attempts
     order by priority, occurred_at
     for update skip locked
     limit greatest(1, least(100, p_limit))
  )
  update command_events e
     set status = 'processing', worker = p_worker, attempts = e.attempts + 1
    from picked
   where e.id = picked.id
  returning e.*;
end $$;

create or replace function public.command_finish_event(
  p_event uuid, p_status text, p_classification text default null,
  p_candidates uuid[] default '{}', p_versions uuid[] default '{}'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('done','no_impact','classified') then
    raise exception 'command: an event finishes as done, no_impact or classified — got %', p_status;
  end if;
  update command_events
     set status = p_status, classification = p_classification,
         candidate_ids = p_candidates, version_ids = p_versions,
         processed_at = now(), last_error = null
   where id = p_event;
end $$;

/**
 * Record a failure, and schedule the retry.
 *
 * AN EVENT NEVER DISAPPEARS. On the last permitted attempt it becomes 'dead'
 * rather than being dropped, because the dangerous state is not "processing
 * failed" — it is "processing failed and the agents carried on with knowledge
 * that silently never updated". A dead event is a visible statement that
 * something may be stale.
 *
 * Backoff is exponential on the attempt count so a systemic outage does not
 * become a tight loop against the database.
 */
create or replace function public.command_fail_event(p_event uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e command_events; v_dead boolean;
begin
  select * into e from command_events where id = p_event;
  if e.id is null then raise exception 'command: no such event'; end if;

  v_dead := e.attempts >= e.max_attempts;

  update command_events
     set status = case when v_dead then 'dead' else 'failed' end,
         last_error = left(coalesce(p_error, 'unknown'), 2000),
         next_attempt_at = now() + (interval '30 seconds' * power(3, least(e.attempts, 5))),
         processed_at = case when v_dead then now() else null end
   where id = p_event;

  if v_dead then
    perform command_log('event_dead_lettered', 'settings', e.id, e.event_type,
      format('%s failed %s times and was dead-lettered — anything it would have taught is NOT in the knowledge base. %s',
             e.event_type, e.attempts, left(coalesce(p_error,''), 200)),
      jsonb_build_object('event_type', e.event_type, 'attempts', e.attempts), 'system', 'event-bus');
  end if;

  return jsonb_build_object('ok', true, 'dead', v_dead, 'attempts', e.attempts);
end $$;

/** Put a dead event back in the queue. Founder-only, audited, reason required. */
create or replace function public.command_replay_event(p_event uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e command_events; v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say what was fixed. Replaying an event that failed for an unresolved reason just fails it again';
  end if;

  select * into e from command_events where id = p_event;
  if e.id is null then raise exception 'command: no such event'; end if;

  select name into v_name from command_founders where user_id = auth.uid();

  update command_events
     set status = 'pending', attempts = 0, next_attempt_at = now(),
         last_error = null, worker = null
   where id = p_event;

  perform command_log('event_replayed', 'settings', e.id, e.event_type,
    format('%s replayed %s — %s', coalesce(v_name,'a founder'), e.event_type, p_reason),
    jsonb_build_object('reason', p_reason, 'previous_error', e.last_error));

  return jsonb_build_object('ok', true, 'event_type', e.event_type);
end $$;
revoke all on function public.command_replay_event(uuid, text) from public, anon;
grant execute on function public.command_replay_event(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE VERSIONED KNOWLEDGE DATABASE
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.command_knowledge_objects (
  id              uuid primary key default gen_random_uuid(),
  -- A stable human key, so a rule can be cited in a prompt, a commit message
  -- and a document without carrying a uuid around.
  key             text unique not null,
  type            text not null check (type in (
                    'concept','product_rule','business_rule','architecture_rule','security_rule',
                    'design_principle','feature','system','workflow','procedure','skill','lesson',
                    'failure','experiment_result','decision','architecture_decision','metric_definition',
                    'data_contract','prompt','agent','benchmark','certification','constraint',
                    'dependency','anti_pattern','best_practice','unresolved_question')),
  title           text not null,
  summary         text not null,
  domain          text not null default 'general',
  tags            text[] not null default '{}',
  owner           text,
  importance      int  not null default 3 check (importance between 1 and 5),
  confidence      numeric(3,2) not null default 0.5 check (confidence between 0 and 1),
  validation_status text not null default 'draft'
                    check (validation_status in ('draft','validated','rejected','needs_review')),
  -- Freshness is a DATE, not a boolean. "Still true?" has an answer that decays,
  -- and a rule with no review date is a rule nobody will ever re-examine.
  effective_from  timestamptz not null default now(),
  review_by       timestamptz,
  deprecated      boolean not null default false,
  deprecated_reason text,
  superseded_by   uuid references public.command_knowledge_objects(id) on delete set null,
  current_version int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists command_ko_domain_idx on public.command_knowledge_objects(domain, type);
create index if not exists command_ko_tags_idx on public.command_knowledge_objects using gin(tags);
create index if not exists command_ko_review_idx on public.command_knowledge_objects(review_by)
  where not deprecated;

/**
 * The immutable record. THIS is the source of truth; the object row above is a
 * pointer and a set of mutable flags.
 *
 * There is no update path and no delete path. Correcting knowledge means adding
 * a version that says something different and explains why, which is also the
 * only way "when did we start believing this, and what changed our mind" stays
 * answerable.
 */
create table if not exists public.command_knowledge_versions (
  id              uuid primary key default gen_random_uuid(),
  object_id       uuid not null references public.command_knowledge_objects(id) on delete cascade,
  version         int  not null,
  previous_version int,
  title           text not null,
  summary         text not null,
  body            text not null,
  confidence      numeric(3,2) not null default 0.5,
  -- WHY this version exists. Same rule as prompt versions and lab variants: an
  -- unexplained change is a diff nobody can evaluate later.
  reason          text not null,
  author          text not null,
  author_kind     text not null default 'agent' check (author_kind in ('founder','agent','system')),
  changed_fields  text[] not null default '{}',
  source_event_ids uuid[] not null default '{}',
  validation      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (object_id, version)
);

create index if not exists command_kv_object_idx
  on public.command_knowledge_versions(object_id, version desc);

/**
 * IMMUTABILITY, ENFORCED.
 *
 * A comment saying "do not edit these" is a request. This is the guarantee. It
 * refuses the service role as well as founders — the whole point is that no
 * actor in the system can quietly change what was believed last month.
 */
create or replace function public.command_versions_are_immutable()
returns trigger language plpgsql as $$
begin
  raise exception
    'command: knowledge version %.v% is immutable. Correct it by publishing a NEW version with a stated reason — '
    'rewriting history is how a knowledge base stops being able to answer "what changed our mind".',
    old.object_id, old.version;
end $$;

drop trigger if exists command_kv_no_update on public.command_knowledge_versions;
create trigger command_kv_no_update before update on public.command_knowledge_versions
  for each row execute function public.command_versions_are_immutable();

drop trigger if exists command_kv_no_delete on public.command_knowledge_versions;
create trigger command_kv_no_delete before delete on public.command_knowledge_versions
  for each row execute function public.command_versions_are_immutable();

/** The object's current_version pointer is derived, never set by a caller. */
create or replace function public.command_kv_advance_pointer()
returns trigger language plpgsql set search_path = public as $$
begin
  update command_knowledge_objects
     set current_version = new.version,
         title = new.title,
         summary = new.summary,
         confidence = new.confidence,
         updated_at = now()
   where id = new.object_id;
  return new;
end $$;

drop trigger if exists command_kv_pointer on public.command_knowledge_versions;
create trigger command_kv_pointer after insert on public.command_knowledge_versions
  for each row execute function public.command_kv_advance_pointer();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRACEABILITY — mandatory
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_knowledge_sources (
  id          uuid primary key default gen_random_uuid(),
  object_id   uuid not null references public.command_knowledge_objects(id) on delete cascade,
  version     int,
  kind        text not null check (kind in (
                'document','commit','pull_request','work_order','release','experiment',
                'event','evidence','founder','agent_run','external','manual')),
  ref         text not null,
  excerpt     text,
  -- External research is UNTRUSTED until a human or a second source confirms it.
  -- Marked here rather than remembered, because "where did we get this?" is the
  -- first question asked about any claim that turns out to be wrong.
  trusted     boolean not null default true,
  captured_at timestamptz not null default now()
);

create index if not exists command_ks_object_idx on public.command_knowledge_sources(object_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE GRAPH
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_knowledge_edges (
  id          uuid primary key default gen_random_uuid(),
  from_id     uuid not null references public.command_knowledge_objects(id) on delete cascade,
  to_id       uuid not null references public.command_knowledge_objects(id) on delete cascade,
  rel         text not null check (rel in (
                'depends_on','implements','governed_by','measured_by','tested_by','changed_by',
                'caused_by','resolved_by','supersedes','contradicts','supports','weakens',
                'learned_from','relevant_to','required_by','owned_by','studied_by','certified_for',
                'part_of')),
  note        text,
  created_at  timestamptz not null default now(),
  unique (from_id, to_id, rel)
);

-- A relationship from a thing to itself is always a mistake, and it makes graph
-- traversal loop forever.
do $$ begin
  alter table public.command_knowledge_edges add constraint command_edge_not_self
    check (from_id <> to_id);
exception when duplicate_object then null; end $$;

create index if not exists command_ke_from_idx on public.command_knowledge_edges(from_id, rel);
create index if not exists command_ke_to_idx   on public.command_knowledge_edges(to_id, rel);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CANDIDATES — what an event proposes, before anyone believes it
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_knowledge_candidates (
  id              uuid primary key default gen_random_uuid(),
  source_event_ids uuid[] not null default '{}',
  proposed_type   text not null,
  title           text not null,
  statement       text not null,
  evidence        text,
  -- The distinction 099 already enforces on evidence, applied here: a fact is
  -- something that happened; an interpretation is what somebody thinks it means.
  -- Conflating them is how one bad afternoon becomes a permanent rule.
  claim_kind      text not null default 'interpretation'
                    check (claim_kind in ('fact','interpretation','hypothesis')),
  affected_objects uuid[] not null default '{}',
  affected_agents text[] not null default '{}',
  novelty         numeric(3,2),
  severity        int check (severity is null or severity between 1 and 5),
  confidence      numeric(3,2),
  proposed_review_days int,
  state           text not null default 'detected' check (state in (
                    'detected','classified','awaiting_validation','validating',
                    'approved','rejected','merged','published','superseded')),
  decision_reason text,
  decided_by      text,
  decided_at      timestamptz,
  object_id       uuid references public.command_knowledge_objects(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists command_kc_state_idx on public.command_knowledge_candidates(state, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PUBLISHING — the only way knowledge enters the base
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or update a knowledge object by writing a new immutable version.
 *
 * REFUSES WITHOUT A SOURCE. This is migration 099's rule — a fact with no
 * source_ref is refused — applied to the knowledge base. It is the single
 * property that stops the Library filling with statements that read as
 * authoritative and cannot be checked by anyone.
 *
 * Version numbers are assigned here, never by the caller.
 */
create or replace function public.command_knowledge_publish(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key text := p->>'key';
  v_obj command_knowledge_objects;
  v_id uuid; v_version int; v_vid uuid; v_author text;
  v_sources jsonb := coalesce(p->'sources', '[]'::jsonb);
  s jsonb;
begin
  if jsonb_array_length(v_sources) = 0 then
    raise exception
      'command: "%" cites no source. Knowledge with nothing behind it is a plausible sentence, '
      'and a library of those is worse than an empty one — pass sources[] naming a document, '
      'commit, work order, experiment, event or evidence row.', coalesce(p->>'title','(untitled)');
  end if;
  if coalesce(trim(p->>'reason'),'') = '' then
    raise exception 'command: say why this version exists — an unexplained change cannot be evaluated later';
  end if;
  if coalesce(trim(p->>'body'),'') = '' then
    raise exception 'command: a knowledge version needs a body';
  end if;

  v_author := coalesce(p->>'author',
                       (select name from command_founders where user_id = auth.uid()),
                       'professor');

  select * into v_obj from command_knowledge_objects where key = v_key;

  if v_obj.id is null then
    insert into command_knowledge_objects (key, type, title, summary, domain, tags, owner,
                                           importance, confidence, validation_status, review_by)
    values (v_key, p->>'type', p->>'title', p->>'summary',
            coalesce(p->>'domain','general'),
            coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}'),
            p->>'owner',
            coalesce((p->>'importance')::int, 3),
            coalesce((p->>'confidence')::numeric, 0.5),
            coalesce(p->>'validation_status','draft'),
            case when (p->>'review_days') is not null
                 then now() + make_interval(days => (p->>'review_days')::int) end)
    returning * into v_obj;
    v_version := 1;
  else
    if v_obj.deprecated then
      raise exception 'command: % is deprecated (%). Publish under a new key, or un-deprecate it deliberately',
        v_key, coalesce(v_obj.deprecated_reason, 'no reason recorded');
    end if;
    v_version := v_obj.current_version + 1;
  end if;

  v_id := v_obj.id;

  insert into command_knowledge_versions (
    object_id, version, previous_version, title, summary, body, confidence,
    reason, author, author_kind, changed_fields, source_event_ids, validation)
  values (
    v_id, v_version, nullif(v_version - 1, 0),
    p->>'title', p->>'summary', p->>'body',
    coalesce((p->>'confidence')::numeric, 0.5),
    p->>'reason', v_author, coalesce(p->>'author_kind','agent'),
    coalesce(array(select jsonb_array_elements_text(p->'changed_fields')), '{}'),
    coalesce(array(select (jsonb_array_elements_text(p->'source_event_ids'))::uuid), '{}'),
    coalesce(p->'validation','{}'::jsonb))
  returning id into v_vid;

  for s in select * from jsonb_array_elements(v_sources) loop
    insert into command_knowledge_sources (object_id, version, kind, ref, excerpt, trusted)
    values (v_id, v_version, s->>'kind', s->>'ref', s->>'excerpt',
            coalesce((s->>'trusted')::boolean, true));
  end loop;

  perform command_log('knowledge_published', 'settings', v_id, v_key,
    format('%s v%s — %s (%s source%s, confidence %s)',
           v_key, v_version, p->>'reason', jsonb_array_length(v_sources),
           case when jsonb_array_length(v_sources) = 1 then '' else 's' end,
           coalesce(p->>'confidence','0.5')),
    jsonb_build_object('type', p->>'type', 'version', v_version));

  return jsonb_build_object('ok', true, 'id', v_id, 'key', v_key,
                            'version', v_version, 'version_id', v_vid);
end $$;
revoke all on function public.command_knowledge_publish(jsonb) from public, anon;
grant execute on function public.command_knowledge_publish(jsonb) to authenticated;

/** Relate two objects. The graph edge is the claim, `note` is the argument. */
create or replace function public.command_knowledge_relate(
  p_from text, p_to text, p_rel text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a uuid; b uuid;
begin
  select id into a from command_knowledge_objects where key = p_from;
  select id into b from command_knowledge_objects where key = p_to;
  if a is null then raise exception 'command: no knowledge object %', p_from; end if;
  if b is null then raise exception 'command: no knowledge object %', p_to; end if;

  insert into command_knowledge_edges (from_id, to_id, rel, note)
  values (a, b, p_rel, p_note)
  on conflict (from_id, to_id, rel) do update set note = coalesce(excluded.note, command_knowledge_edges.note);

  return jsonb_build_object('ok', true);
end $$;

/**
 * Supersede one object with another.
 *
 * Records BOTH directions: the pointer on the old object and a `supersedes`
 * edge on the new one. A single direction means one of the two questions —
 * "what replaced this?" and "what did this replace?" — has no answer, and it is
 * always the one being asked.
 */
create or replace function public.command_knowledge_supersede(
  p_old text, p_new text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a command_knowledge_objects; b command_knowledge_objects;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say why. Superseding knowledge without a reason loses the only thing that made it worth recording';
  end if;

  select * into a from command_knowledge_objects where key = p_old;
  select * into b from command_knowledge_objects where key = p_new;
  if a.id is null then raise exception 'command: no knowledge object %', p_old; end if;
  if b.id is null then raise exception 'command: no knowledge object %', p_new; end if;
  if a.id = b.id then raise exception 'command: an object cannot supersede itself'; end if;

  update command_knowledge_objects
     set superseded_by = b.id, deprecated = true, deprecated_reason = p_reason, updated_at = now()
   where id = a.id;

  insert into command_knowledge_edges (from_id, to_id, rel, note)
  values (b.id, a.id, 'supersedes', p_reason)
  on conflict do nothing;

  perform command_log('knowledge_superseded', 'settings', a.id, p_old,
    format('%s superseded by %s — %s', p_old, p_new, p_reason), '{}'::jsonb);

  return jsonb_build_object('ok', true, 'old', p_old, 'new', p_new);
end $$;
revoke all on function public.command_knowledge_supersede(text, text, text) from public, anon;
grant execute on function public.command_knowledge_supersede(text, text, text) to authenticated;

/**
 * Publish a candidate. THE ONLY ROUTE from a candidate to a knowledge object.
 *
 * Refuses anything not already approved. An event proposing a lesson and that
 * lesson becoming organisational truth must remain two separate acts with a
 * validation between them, or the "Professor validates" layer is decorative.
 */
create or replace function public.command_candidate_publish(p_candidate uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c command_knowledge_candidates; v_res jsonb;
begin
  select * into c from command_knowledge_candidates where id = p_candidate;
  if c.id is null then raise exception 'command: no such candidate'; end if;
  if c.state <> 'approved' then
    raise exception
      'command: candidate "%" is %, not approved. A candidate becomes knowledge only after validation — '
      'that gap is the entire difference between a system that learns and one that repeats what it heard.',
      c.title, c.state;
  end if;

  v_res := command_knowledge_publish(
    p || jsonb_build_object('source_event_ids', to_jsonb(c.source_event_ids)));

  update command_knowledge_candidates
     set state = 'published', object_id = (v_res->>'id')::uuid
   where id = p_candidate;

  return v_res;
end $$;
revoke all on function public.command_candidate_publish(uuid, jsonb) from public, anon;
grant execute on function public.command_candidate_publish(uuid, jsonb) to authenticated;

/** Record a validation decision on a candidate. Rejections are KEPT. */
create or replace function public.command_candidate_decide(
  p_candidate uuid, p_state text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if p_state not in ('approved','rejected','awaiting_validation','merged') then
    raise exception 'command: a decision is approved, rejected, awaiting_validation or merged';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: state the reason — a rejected candidate with no reason will be proposed again next week';
  end if;

  select name into v_name from command_founders where user_id = auth.uid();

  update command_knowledge_candidates
     set state = p_state, decision_reason = p_reason,
         decided_by = coalesce(v_name, 'founder'), decided_at = now()
   where id = p_candidate;

  return jsonb_build_object('ok', true, 'state', p_state);
end $$;
revoke all on function public.command_candidate_decide(uuid, text, text) from public, anon;
grant execute on function public.command_candidate_decide(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE FIRST EVENT SOURCE — the audit log we already have
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Every audited mutation becomes an event.
 *
 * command_audit already records every governance action in the same transaction
 * as the change, which makes it the most trustworthy event source available and
 * the one that needs no new plumbing at any call site.
 *
 * NOT EVERY ACTION IS WORTH REASONING ABOUT. Routine reads and progress ticks
 * are emitted at P3 and will be filtered deterministically in Tier 1; the
 * decisions, corrections, releases and security actions arrive at P1. Emitting
 * everything at the same priority would put a founder correction behind two
 * hundred lab job updates.
 */
create or replace function public.command_audit_to_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_priority text; v_domains text[]; v_risk text := 'LOW';
begin
  v_priority := case
    when new.action in ('release_rolled_back','event_dead_lettered','halt_set',
                        'sentinel_verdict','security_finding') then 'P0'
    when new.action in ('founder_correction','release_approved','release_deployed',
                        'experiment_decided','prompt_promoted','autonomy_set',
                        'proposal_approved','proposal_rejected','knowledge_superseded',
                        'release_held_by_sentinel') then 'P1'
    when new.action like 'lab_job%' or new.action in ('task_progress','runner_desired_set') then 'P3'
    else 'P2' end;

  v_domains := case
    when new.action like 'release%' or new.action like 'sentinel%' then array['release']
    when new.action like 'experiment%' then array['experiment']
    when new.action like 'prompt%' or new.action like 'lab%' then array['ai']
    when new.action like 'proposal%' or new.action like 'vote%' then array['governance']
    when new.action like 'knowledge%' then array['knowledge']
    else array['general'] end;

  if v_priority = 'P0' then v_risk := 'HIGH';
  elsif v_priority = 'P1' then v_risk := 'MEDIUM'; end if;

  -- THE BUS MUST NEVER ROLL BACK THE WORK THAT FED IT.
  --
  -- This trigger runs inside the same transaction as the governance action that
  -- wrote the audit row — a vote, a release approval, a deploy. If emitting an
  -- event raised, that transaction would roll back and a founder's vote would
  -- fail because the LEARNING system had a problem. That trade is never worth
  -- making: the worst case for a lost event is knowledge that lags, and the
  -- worst case for a lost vote is governance that silently did not happen.
  --
  -- The failure is logged as a warning so it appears in the Postgres log rather
  -- than vanishing, and an event missed here is recoverable — command_audit
  -- still holds the row, keyed by an id this function derives deterministically.
  begin
    perform command_emit_event(jsonb_build_object(
    'event_type', 'audit.' || new.action,
    'source_system', 'command_audit',
    'source_entity', new.entity_kind,
    'source_entity_id', new.entity_id,
    'occurred_at', new.at,
    'actor_kind', new.actor_kind,
    'actor_label', new.actor_label,
    -- The audit row id IS the natural key: one audit row, one event, forever.
    'idempotency_key', 'audit:' || new.id::text,
    'domains', to_jsonb(v_domains),
    'risk', v_risk,
    'priority', v_priority,
      'payload', jsonb_build_object(
        'action', new.action, 'entity_ref', new.entity_ref,
        'summary', new.summary, 'detail', new.detail)));
  exception when others then
    raise warning 'command: event emission failed for audit row % (%) — the audited action stands, the event was not recorded: %',
      new.id, new.action, sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists command_audit_emits_event on public.command_audit;
create trigger command_audit_emits_event after insert on public.command_audit
  for each row execute function public.command_audit_to_event();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. READ MODELS
-- ─────────────────────────────────────────────────────────────────────────────

/** Health of the knowledge base and the bus, in one call. */
create or replace function public.command_knowledge_health()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'objects', (select count(*) from command_knowledge_objects where not deprecated),
    'deprecated', (select count(*) from command_knowledge_objects where deprecated),
    'validated', (select count(*) from command_knowledge_objects
                   where validation_status = 'validated' and not deprecated),
    'draft', (select count(*) from command_knowledge_objects
               where validation_status = 'draft' and not deprecated),
    'stale', (select count(*) from command_knowledge_objects
               where review_by is not null and review_by < now() and not deprecated),
    'versions', (select count(*) from command_knowledge_versions),
    'edges', (select count(*) from command_knowledge_edges),
    'sources', (select count(*) from command_knowledge_sources),
    'untrusted_sources', (select count(*) from command_knowledge_sources where not trusted),
    'by_domain', (select coalesce(jsonb_object_agg(domain, n), '{}'::jsonb)
                    from (select domain, count(*) n from command_knowledge_objects
                           where not deprecated group by domain) d),
    'candidates', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
                     from (select state, count(*) n from command_knowledge_candidates group by state) c),
    'events', jsonb_build_object(
      'total', (select count(*) from command_events),
      'pending', (select count(*) from command_events where status = 'pending'),
      'processing', (select count(*) from command_events where status = 'processing'),
      'failed', (select count(*) from command_events where status = 'failed'),
      'dead', (select count(*) from command_events where status = 'dead'),
      'no_impact', (select count(*) from command_events where status = 'no_impact'),
      'done', (select count(*) from command_events where status = 'done'),
      'by_priority', (select coalesce(jsonb_object_agg(priority, n), '{}'::jsonb)
                        from (select priority, count(*) n from command_events
                               where status in ('pending','failed') group by priority) p)),
    -- Stated rather than implied: this phase builds the store, not the teacher.
    'phase', '1 — event bus and versioned knowledge database. Professor, Library, Academy and Context Compiler integration are not built yet.'
  );
$$;
grant execute on function public.command_knowledge_health() to authenticated;

/** One object with its full history, sources and edges. */
create or replace function public.command_knowledge_detail(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'object', (select to_jsonb(o) from command_knowledge_objects o where o.key = p_key),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version desc), '[]'::jsonb)
                   from command_knowledge_versions v
                   join command_knowledge_objects o on o.id = v.object_id
                  where o.key = p_key),
    'sources', (select coalesce(jsonb_agg(to_jsonb(s) order by s.captured_at), '[]'::jsonb)
                  from command_knowledge_sources s
                  join command_knowledge_objects o on o.id = s.object_id
                 where o.key = p_key),
    'edges', (select coalesce(jsonb_agg(jsonb_build_object(
                'rel', e.rel, 'direction', 'out', 'key', t.key, 'title', t.title, 'note', e.note)), '[]'::jsonb)
                from command_knowledge_edges e
                join command_knowledge_objects o on o.id = e.from_id
                join command_knowledge_objects t on t.id = e.to_id
               where o.key = p_key)
             || (select coalesce(jsonb_agg(jsonb_build_object(
                'rel', e.rel, 'direction', 'in', 'key', f.key, 'title', f.title, 'note', e.note)), '[]'::jsonb)
                from command_knowledge_edges e
                join command_knowledge_objects o on o.id = e.to_id
                join command_knowledge_objects f on f.id = e.from_id
               where o.key = p_key));
$$;
grant execute on function public.command_knowledge_detail(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — founders read; every write goes through a definer function
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'command_events','command_knowledge_objects','command_knowledge_versions',
    'command_knowledge_sources','command_knowledge_edges','command_knowledge_candidates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

revoke all on function public.command_claim_events(text, int) from public, anon, authenticated;
revoke all on function public.command_finish_event(uuid, text, text, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.command_fail_event(uuid, text) from public, anon, authenticated;
grant execute on function public.command_knowledge_relate(text, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. REGISTRY — what is live, and what is honestly not built yet
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('knowledge_event_bus','Durable event bus','knowledge','live',
   'command_events: idempotent by unique key, claimed with skip-locked, retried with exponential backoff, dead-lettered after 5 attempts rather than dropped. Every command_audit row emits one event via trigger, so the source needs no new plumbing at any call site.',
   'A worker to drain the queue is Phase 3 — until then events accumulate as an honest backlog rather than being silently discarded.'),
  ('knowledge_versioned_db','Versioned knowledge database','knowledge','live',
   'Immutable versions enforced by trigger against every actor including the service role. Publishing refuses an object citing no source. Supersession records both directions. Graph edges across 19 relationship types.',
   'None.'),
  ('knowledge_professor','Professor — Chief Learning Officer','knowledge','planned',
   'The validation layer. Candidates can be recorded and decided on today, but nothing yet classifies events into candidates automatically — that is Phase 3, and it depends on this foundation existing first.',
   'Phase 3.'),
  ('knowledge_library','The EvoForge Library','knowledge','planned',
   'Volumes, books, chapters and Markdown rendering. Deliberately not started: rendering a library from a knowledge base with 0 validated objects would produce a convincing shell with nothing in it.',
   'Phase 2, after knowledge objects exist.'),
  ('knowledge_academy','Knowledge Academy','knowledge','planned',
   'Curricula, learning modules, certifications. The benchmark and evaluation substrate already exists (command_bench_cases, command_runs, command_agents.autonomy_level) and will be reused rather than duplicated.',
   'Phase 4.')
on conflict (key) do update set status=excluded.status, label=excluded.label,
  detail=excluded.detail, setup_required=excluded.setup_required, updated_at=now();
