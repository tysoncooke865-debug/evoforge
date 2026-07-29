-- 131 — A PROPOSAL THAT SAYS WHAT WILL CHANGE
--
-- WHAT WAS WRONG, MEASURED RATHER THAN ASSUMED.
--
--   select ref, problem, recommendation from command_proposals
--    order by created_at desc limit 6;
--
-- Every agent-raised row came back with problem = '', recommendation = '',
-- exec_recommendation = ''. PROP-010 through PROP-015 — the six most recent
-- decisions put in front of the founders — carried a TITLE and nothing else.
--
-- The reason is a seam, not a bug in any one function. command_exec_cycle calls
-- command_create_proposal with `b.document || {title, category, …}`, and
-- command_create_proposal reads `p->>'problem'` and `p->>'recommendation'` from
-- that payload. But the documents the studio actually produces are shaped like
-- the producer, not like the consumer:
--
--   devlab suggestion:  {implementation:{file,steps,risk}, acceptance:[…], model}
--   product scan:       {event, events, athletes, window_days, last_at}
--
-- Neither carries a key called `problem`. So both coalesce to '', and the
-- council page renders a heading over an empty document. "Users have to read
-- paragraphs of AI output to find out what will change" was the wrong diagnosis:
-- there were no paragraphs. There was nothing at all.
--
-- WHAT THIS DOES.
--
--   · Adds the structured fields a decision actually needs, including the one
--     that is mandatory for anything actionable: change_summary.
--   · Adds command_derive_change_summary(), which reads the document shapes the
--     studio really emits and states the change in a sentence — so the six
--     existing empty proposals stop being blank.
--   · Adds command_reviews and command_quality_checks: the independent verdict
--     and the rubric, stored as rows rather than as prose inside a paragraph.
--   · Adds command_proposal_gate(), which answers "may this be shown as ready
--     for approval?" with a list of reasons rather than a boolean.
--   · Teaches command_create_proposal all of it, by extending the definition
--     read from pg_get_functiondef rather than reconstructing it.

begin;

/* ── 1. Maturity, from observation to archived ──────────────────────────── */

create table if not exists command_maturity_stages (
  stage      text primary key,
  ord        int  not null,
  label      text not null,
  advisory   boolean not null,
  meaning    text not null
);

insert into command_maturity_stages (stage, ord, label, advisory, meaning) values
  ('observation',       10, 'Observation',        true,  'Something was noticed. No claim is being made about what to do.'),
  ('hypothesis',        20, 'Hypothesis',         true,  'A possible explanation. Not yet tested against evidence.'),
  ('research_finding',  30, 'Research finding',   true,  'Supported by named evidence. Still not a recommendation.'),
  ('recommendation',    40, 'Recommendation',     true,  'A suggested direction. Nothing is scheduled.'),
  ('draft_proposal',    50, 'Draft proposal',     true,  'A specific change, not yet submitted for review.'),
  ('under_review',      60, 'Under review',       true,  'With the Independent Review Agent. Not visible as a decision yet.'),
  ('revision_required', 70, 'Revision required',  true,  'Review found gaps. Returned to the originating agent.'),
  ('ready_for_approval',80, 'Ready for approval', true,  'Passed review and the quality gate. Waiting on founder votes.'),
  ('approved_task',     90, 'Approved',           false, 'Founders approved it. A work order is open.'),
  ('in_implementation',100, 'In implementation',  false, 'An agent is changing code right now.'),
  ('implemented',      110, 'Implemented',        false, 'The change is built. Not yet known to have helped.'),
  ('measuring_outcome',120, 'Measuring outcome',  false, 'Shipped, with a baseline recorded and a measurement window running.'),
  ('validated',        130, 'Validated',          false, 'The metric moved as predicted. Recorded as a success in decision memory.'),
  ('failed',           140, 'Failed',             false, 'The metric did not move, or moved the wrong way.'),
  ('reverted',         150, 'Reverted',           false, 'Shipped and rolled back.'),
  ('archived',         160, 'Archived',           true,  'Closed without implementation.')
on conflict (stage) do update set
  ord = excluded.ord, label = excluded.label, advisory = excluded.advisory, meaning = excluded.meaning;

/* ── 2. The structured proposal ─────────────────────────────────────────── */

alter table command_proposals
  -- MANDATORY for anything actionable. One or two sentences, concrete.
  add column if not exists change_summary      text not null default '',
  add column if not exists summary_source      text not null default 'none',
  add column if not exists problem_statement   text not null default '',
  add column if not exists user_impact         text not null default '',
  add column if not exists strategic_rationale text not null default '',
  add column if not exists expected_result     text not null default '',
  add column if not exists affected_areas      text[] not null default '{}',
  add column if not exists success_metrics     jsonb  not null default '[]'::jsonb,
  add column if not exists evidence            jsonb  not null default '[]'::jsonb,
  add column if not exists assumptions         text[] not null default '{}',
  add column if not exists unknowns            text[] not null default '{}',
  add column if not exists confidence          numeric,
  add column if not exists confidence_reason   text not null default '',
  add column if not exists risk_level          text,
  add column if not exists risk_note           text not null default '',
  add column if not exists reversibility       text,
  add column if not exists rollback_plan       text not null default '',
  add column if not exists estimated_effort    text,
  add column if not exists proposal_type       text,
  add column if not exists originating_agent   text,
  add column if not exists maturity_stage      text not null default 'ready_for_approval',
  add column if not exists quality_score       numeric,
  add column if not exists detailed_analysis   text not null default '',
  add column if not exists raw_output          text not null default '';

alter table command_proposals drop constraint if exists command_proposals_risk_level_ck;
alter table command_proposals add constraint command_proposals_risk_level_ck
  check (risk_level is null or risk_level in ('low','medium','high'));

alter table command_proposals drop constraint if exists command_proposals_reversibility_ck;
alter table command_proposals add constraint command_proposals_reversibility_ck
  check (reversibility is null or reversibility in ('automatic','manual','difficult'));

alter table command_proposals drop constraint if exists command_proposals_effort_ck;
alter table command_proposals add constraint command_proposals_effort_ck
  check (estimated_effort is null or estimated_effort in ('small','medium','large'));

alter table command_proposals drop constraint if exists command_proposals_type_ck;
alter table command_proposals add constraint command_proposals_type_ck
  check (proposal_type is null or proposal_type in
    ('product','research','analytics','experiment','engineering','operations'));

alter table command_proposals drop constraint if exists command_proposals_summary_source_ck;
alter table command_proposals add constraint command_proposals_summary_source_ck
  check (summary_source in ('none','authored','derived'));

alter table command_proposals drop constraint if exists command_proposals_maturity_ck;
alter table command_proposals add constraint command_proposals_maturity_ck
  foreign key (maturity_stage) references command_maturity_stages(stage);

-- Confidence is a real number in a real range or it is absent. A confidence of
-- 0.85 that nothing computed is worse than no number, because it gets quoted.
alter table command_proposals drop constraint if exists command_proposals_confidence_ck;
alter table command_proposals add constraint command_proposals_confidence_ck
  check (confidence is null or (confidence >= 0 and confidence <= 1));

comment on column command_proposals.change_summary is
  'What will change, in one or two concrete sentences. Mandatory before a proposal may be presented as ready for approval — see command_proposal_gate().';
comment on column command_proposals.summary_source is
  'authored = an agent wrote it. derived = command_derive_change_summary() read it out of the document. none = nobody could say, and the gate refuses it.';

/* ── 3. Deriving a change summary from the documents we really emit ─────── */

create or replace function public.command_derive_change_summary(
  p_doc jsonb, p_title text default '', p_rationale text default '')
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  v_file text; v_steps jsonb; v_risk text; v_acc jsonb; v_event text;
  v_summary text := ''; v_areas text[] := '{}'; v_expected text := '';
begin
  p_doc := coalesce(p_doc, '{}'::jsonb);

  -- SHAPE A — a Dev Lab suggestion. {implementation:{file,steps,risk}, acceptance:[…]}
  v_file  := p_doc #>> '{implementation,file}';
  v_steps := p_doc #> '{implementation,steps}';
  v_risk  := lower(coalesce(p_doc #>> '{implementation,risk}', ''));
  v_acc   := p_doc -> 'acceptance';

  if v_file is not null then
    v_areas := array[v_file];
    -- ACCEPTANCE FIRST, NOT STEPS. steps[0] is an instruction to the engineer —
    -- "Locate the component that renders the CTA…" — which describes what
    -- somebody will DO, not what will be different afterwards. The first
    -- acceptance criterion is the checkable end state, which is the thing a
    -- founder is actually approving. Falling back to steps[0] only when there
    -- are no criteria at all.
    v_summary := 'Changes ' || v_file || '. ' ||
      case
        when jsonb_array_length(coalesce(v_acc, '[]'::jsonb)) > 0
          then 'When done: ' || (v_acc ->> 0)
        when jsonb_array_length(coalesce(v_steps, '[]'::jsonb)) > 0
          then 'Planned work: ' || (v_steps ->> 0)
        else coalesce(nullif(p_title, ''), 'No further detail was recorded.')
      end ||
      case when jsonb_array_length(coalesce(v_acc, '[]'::jsonb)) > 1
           then ' (' || (jsonb_array_length(v_acc) - 1) || ' further acceptance criteri' ||
                case when jsonb_array_length(v_acc) = 2 then 'on' else 'a' end || ')'
           else '' end;
    if jsonb_array_length(coalesce(v_acc, '[]'::jsonb)) > 1 then
      v_expected := v_acc ->> 1;
    end if;
    return jsonb_build_object(
      'change_summary', left(v_summary, 600),
      'affected_areas', to_jsonb(v_areas),
      'expected_result', coalesce(v_expected, ''),
      'risk_level', case when v_risk in ('low','medium','high') then v_risk else 'medium' end,
      'source', 'derived');
  end if;

  -- SHAPE B — a product failure signal. {event, events, athletes, window_days}
  v_event := p_doc ->> 'event';
  if v_event is not null then
    return jsonb_build_object(
      'change_summary',
        'Find and fix whatever makes the product emit ' || v_event || ' — it fired ' ||
        coalesce(p_doc ->> 'events', '?') || ' times across ' ||
        coalesce(p_doc ->> 'athletes', '?') || ' athlete(s) in the last ' ||
        coalesce(p_doc ->> 'window_days', '?') || ' days. The failing path is changed; nothing else is.',
      'affected_areas', to_jsonb(array['the code path that emits ' || v_event]),
      'expected_result', v_event || ' stops being emitted, or its rate falls to near zero for the affected athletes.',
      'risk_level', 'medium',
      'source', 'derived');
  end if;

  -- SHAPE C — a studio-internal observation. {surface, superseded_by}
  if p_doc ? 'surface' then
    return jsonb_build_object(
      'change_summary',
        coalesce(nullif(p_title, ''), 'A studio change') || ' — affects ' || (p_doc ->> 'surface') ||
        case when p_doc ? 'superseded_by' then ', which is superseded by ' || (p_doc ->> 'superseded_by') || '.' else '.' end,
      'affected_areas', to_jsonb(array[p_doc ->> 'surface']),
      'expected_result', '',
      'risk_level', 'low',
      'source', 'derived');
  end if;

  -- NOTHING DERIVABLE. Return source='none' rather than a plausible sentence.
  -- A generated summary that was not read out of anything is exactly the
  -- confident-and-baseless output this whole migration exists to stop.
  return jsonb_build_object(
    'change_summary', '',
    'affected_areas', '[]'::jsonb,
    'expected_result', '',
    'risk_level', null,
    'source', 'none');
end $$;

/* ── 4. Independent review, stored as rows ──────────────────────────────── */

create table if not exists command_reviews (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid references command_proposals(id) on delete cascade,
  subject_kind    text not null default 'proposal',
  subject_id      uuid,
  reviewer_agent  text not null default 'reviewer' references command_agents(key),
  verdict         text not null,
  confidence      numeric,
  -- What survived the challenge, and what did not. Separate arrays because
  -- "strengths and weaknesses" collapsed into one paragraph is how a review
  -- becomes unreadable.
  validated_strengths text[] not null default '{}',
  unsupported_claims  text[] not null default '{}',
  missing_evidence    text[] not null default '{}',
  alternative_explanations text[] not null default '{}',
  cheaper_alternatives     text[] not null default '{}',
  unidentified_risks       text[] not null default '{}',
  required_revisions       text[] not null default '{}',
  duplicate_of    uuid references command_proposals(id),
  model           text,
  cost_usd        numeric,
  notes           text not null default '',
  raw_output      text not null default '',
  at              timestamptz not null default now(),
  constraint command_reviews_verdict_ck check (verdict in
    ('supported','supported_with_revisions','more_evidence_required',
     'rejected','duplicate','already_implemented','strategically_misaligned')),
  constraint command_reviews_confidence_ck check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists command_reviews_proposal_idx on command_reviews (proposal_id, at desc);

comment on table command_reviews is
  'One row per independent challenge. The reviewer runs on an isolated context so it cannot inherit the reasoning it is meant to disprove.';

/* ── 5. The quality gate, as checks rather than as a vibe ───────────────── */

create table if not exists command_quality_checks (
  id           bigserial primary key,
  proposal_id  uuid not null references command_proposals(id) on delete cascade,
  check_key    text not null,
  passed       boolean not null,
  severity     text not null default 'block',
  detail       text not null default '',
  at           timestamptz not null default now(),
  constraint command_quality_checks_sev_ck check (severity in ('block','warn'))
);

create index if not exists command_quality_checks_proposal_idx on command_quality_checks (proposal_id, at desc);

-- The rubric, named so the UI and the runtime read the same list.
create table if not exists command_quality_rubric (
  check_key text primary key,
  label     text not null,
  severity  text not null default 'block',
  question  text not null,
  ord       int not null default 100
);

insert into command_quality_rubric (check_key, label, severity, question, ord) values
  ('states_change',      'States what will change',   'block',
   'Is there a concrete change summary naming what will be different afterwards?', 10),
  ('has_evidence',       'Has supporting evidence',   'block',
   'Is at least one evidence item attached, with a source?', 20),
  ('names_area',         'Names the affected area',   'block',
   'Does it identify which part of EvoForge changes — a file, a screen, a table or a journey?', 30),
  ('has_success_metric', 'Defines a success metric',  'block',
   'Is there a named metric and a measurement method, so the result can be checked later?', 40),
  ('not_duplicate',      'Not a duplicate',           'block',
   'Is there no open proposal or active work order covering the same change?', 50),
  ('not_already_done',   'Not already implemented',   'block',
   'Has this not already shipped in a previous release?', 60),
  ('specific_to_evoforge','Specific to EvoForge',     'block',
   'Would this advice be false or meaningless for a different fitness app? Generic advice fails here.', 70),
  ('claims_supported',   'Claims match the evidence', 'block',
   'Does every factual claim trace to an attached evidence item?', 80),
  ('confidence_justified','Confidence is justified',  'warn',
   'Is the stated confidence explained by the amount, quality and recency of the evidence?', 90),
  ('risk_acknowledged',  'Acknowledges cost and risk','warn',
   'Are the obvious costs, risks and affected user groups named rather than skipped?', 100),
  ('no_filler',          'No roleplay or filler',     'warn',
   'Is the output free of preamble, praise, dramatic language and restated summaries?', 110)
on conflict (check_key) do update set
  label = excluded.label, severity = excluded.severity,
  question = excluded.question, ord = excluded.ord;

/* ── 6. The gate: may this be shown as ready for approval? ──────────────── */

-- Returns REASONS, not a boolean. "Blocked" with no explanation is the failure
-- this system exists to remove, and the UI renders this list verbatim.
create or replace function public.command_proposal_gate(p_id uuid)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare pr record; v_blocks text[] := '{}'; v_warns text[] := '{}'; v_review record; v_needs_review boolean;
begin
  select * into pr from command_proposals where id = p_id;
  if pr is null then return jsonb_build_object('ok', false, 'reasons', to_jsonb(array['no such proposal'])); end if;

  if coalesce(nullif(trim(pr.change_summary), ''), '') = '' then
    v_blocks := array_append(v_blocks, 'It does not say what will change. An agent that cannot describe the change cannot have it approved.');
  end if;
  if coalesce(array_length(pr.affected_areas, 1), 0) = 0
     and coalesce(array_length(pr.affected_screens, 1), 0) = 0 then
    v_warns := array_append(v_warns, 'No affected area is named, so nobody can tell which part of EvoForge this touches.');
  end if;
  if jsonb_array_length(coalesce(pr.success_metrics, '[]'::jsonb)) = 0 then
    v_warns := array_append(v_warns, 'No success metric, so the result cannot be checked after it ships.');
  end if;
  if jsonb_array_length(coalesce(pr.evidence, '[]'::jsonb)) = 0 then
    v_warns := array_append(v_warns, 'No evidence is attached — this rests on assertion.');
  end if;

  -- Review obligation. Read from the ORIGINATING AGENT's row, so raising the
  -- bar for one agent does not require touching every proposal.
  select requires_review into v_needs_review from command_agents where key = pr.originating_agent;
  v_needs_review := coalesce(v_needs_review, false);

  select * into v_review from command_reviews
   where proposal_id = p_id order by at desc limit 1;

  if v_needs_review and v_review is null then
    v_blocks := array_append(v_blocks, 'It has not been independently reviewed, and its originating agent requires review.');
  elsif v_review.verdict in ('rejected','duplicate','already_implemented','strategically_misaligned') then
    v_blocks := array_append(v_blocks, ('Independent review returned "' || replace(v_review.verdict, '_', ' ') || '".'));
  elsif v_review.verdict = 'more_evidence_required' then
    v_blocks := array_append(v_blocks, 'Independent review asked for more evidence before a decision is taken.');
  elsif v_review.verdict = 'supported_with_revisions'
        and coalesce(array_length(v_review.required_revisions, 1), 0) > 0 then
    v_warns := array_append(v_warns, (array_length(v_review.required_revisions, 1) || ' revision(s) were requested by review.'));
  end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_blocks, 1), 0) = 0,
    'blocks', to_jsonb(v_blocks),
    'warnings', to_jsonb(v_warns),
    'review_verdict', v_review.verdict,
    'reviewed_at', v_review.at);
end $$;

grant execute on function public.command_proposal_gate(uuid) to authenticated, service_role;
grant execute on function public.command_derive_change_summary(jsonb, text, text) to authenticated, service_role;

/* ── 7. Teach command_create_proposal the structure ─────────────────────── */

-- Extended from pg_get_functiondef. The original body is unchanged except for
-- the new column list; the derivation runs only when the caller said nothing,
-- so an agent that DOES write a summary always wins over the deriver.
create or replace function public.command_create_proposal(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ref text; v_id uuid; v_default text; v_policy text; v_exec text;
  v_derived jsonb; v_summary text; v_source text; v_areas text[]; v_expected text; v_risk text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  select (value)#>>'{}' into v_default from command_settings where key = 'default_deploy_policy';
  v_exec := coalesce(p->>'execution', 'engineering');
  v_policy := case when v_exec <> 'engineering' then 'gated'
                   else coalesce(p->>'deploy_policy', v_default, 'gated') end;

  -- THE SEAM THIS MIGRATION EXISTS TO CLOSE. The caller's own words first;
  -- only when it said nothing do we read the document it did send.
  v_summary := nullif(trim(coalesce(p->>'change_summary', '')), '');
  if v_summary is not null then
    v_source   := 'authored';
    v_areas    := coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'affected_areas','[]'::jsonb))), '{}');
    v_expected := coalesce(p->>'expected_result', '');
    v_risk     := nullif(lower(coalesce(p->>'risk_level','')), '');
  else
    v_derived  := command_derive_change_summary(p, coalesce(p->>'title',''), coalesce(p->>'rationale',''));
    v_summary  := nullif(v_derived->>'change_summary', '');
    v_source   := v_derived->>'source';
    v_areas    := coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(v_derived->'affected_areas','[]'::jsonb))), '{}');
    v_expected := coalesce(v_derived->>'expected_result', '');
    v_risk     := v_derived->>'risk_level';
  end if;

  v_ref := 'PROP-' || lpad(nextval('command_proposal_seq')::text, 3, '0');
  insert into command_proposals (
    ref, title, category, problem, recommendation, reasoning, benefits, risks,
    alternatives, complexity, departments, est_days, affected_screens, dependencies,
    exec_recommendation, documents, author_kind, author_key, author_id, status,
    opened_at, execution, deploy_policy, founder_steps, founder_unblocks, founder_done_when,
    change_summary, summary_source, problem_statement, user_impact, strategic_rationale,
    expected_result, affected_areas, success_metrics, evidence, assumptions, unknowns,
    confidence, confidence_reason, risk_level, risk_note, reversibility, rollback_plan,
    estimated_effort, proposal_type, originating_agent, maturity_stage,
    detailed_analysis, raw_output)
  values (
    v_ref,
    coalesce(p->>'title', 'Untitled'), coalesce(p->>'category', 'prototype'),
    coalesce(p->>'problem', ''), coalesce(p->>'recommendation', ''), coalesce(p->>'reasoning', ''),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'benefits','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'risks','[]'::jsonb))), '{}'),
    coalesce(p->'alternatives', '[]'::jsonb),
    coalesce(p->>'complexity', 'medium'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'departments','[]'::jsonb))), '{}'),
    nullif(p->>'est_days','')::numeric,
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'affected_screens','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'dependencies','[]'::jsonb))), '{}'),
    coalesce(p->>'exec_recommendation', ''), coalesce(p->'documents', '[]'::jsonb),
    coalesce(p->>'author_kind', case when auth.uid() is null then 'agent' else 'founder' end),
    p->>'author_key', auth.uid(),
    case when coalesce(p->>'status','open') = 'draft' then 'draft' else 'open' end,
    case when coalesce(p->>'status','open') = 'draft' then null else now() end,
    v_exec, v_policy,
    coalesce(p->'founder_steps', '[]'::jsonb),
    coalesce(p->>'founder_unblocks', ''),
    coalesce(p->>'founder_done_when', ''),
    coalesce(v_summary, ''), coalesce(v_source, 'none'),
    coalesce(p->>'problem_statement', p->>'problem', ''),
    coalesce(p->>'user_impact', ''),
    coalesce(p->>'strategic_rationale', ''),
    v_expected, v_areas,
    coalesce(p->'success_metrics', '[]'::jsonb),
    coalesce(p->'evidence', '[]'::jsonb),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'assumptions','[]'::jsonb))), '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'unknowns','[]'::jsonb))), '{}'),
    nullif(p->>'confidence','')::numeric,
    coalesce(p->>'confidence_reason', ''),
    v_risk,
    coalesce(p->>'risk_note', ''),
    nullif(p->>'reversibility',''),
    coalesce(p->>'rollback_plan', ''),
    nullif(p->>'estimated_effort',''),
    nullif(p->>'proposal_type',''),
    coalesce(p->>'originating_agent', p->>'author_key'),
    coalesce(nullif(p->>'maturity_stage',''), 'ready_for_approval'),
    coalesce(p->>'detailed_analysis', ''),
    coalesce(p->>'raw_output', ''))
  returning id into v_id;

  perform command_log('proposal_created', 'proposal', v_id, v_ref,
                      coalesce(p->>'title','Untitled'),
                      jsonb_build_object('category', coalesce(p->>'category','prototype'),
                                         'execution', v_exec, 'deploy_policy', v_policy,
                                         'summary_source', coalesce(v_source,'none')),
                      case when auth.uid() is null then 'agent' else 'founder' end,
                      coalesce(p->>'author_key', (select name from command_founders where user_id = auth.uid()), 'system'));
  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref,
                            'change_summary', coalesce(v_summary,''), 'summary_source', coalesce(v_source,'none'));
end $$;

/* ── 8. Backfill: the six blank proposals ───────────────────────────────── */

-- Derive from the backlog document that raised each one. Where nothing is
-- derivable the row keeps summary_source='none' and the gate says so — which is
-- the honest outcome, not a failure of this migration.
with src as (
  select p.id,
         command_derive_change_summary(coalesce(b.document, '{}'::jsonb), p.title, coalesce(b.rationale,'')) d,
         b.rationale, b.source
    from command_proposals p
    left join command_backlog b on b.proposal_id = p.id
   -- Re-derivable, never overwriting an authored summary. Re-applying this
   -- migration after improving the deriver corrects every derived row and
   -- leaves anything an agent actually wrote alone.
   where p.summary_source in ('none', 'derived')
)
update command_proposals p set
  change_summary  = coalesce(src.d->>'change_summary', ''),
  summary_source  = coalesce(src.d->>'source', 'none'),
  affected_areas  = case when p.affected_areas = '{}' then
                      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(src.d->'affected_areas','[]'::jsonb))), '{}')
                    else p.affected_areas end,
  expected_result = case when p.expected_result = '' then coalesce(src.d->>'expected_result','') else p.expected_result end,
  risk_level      = coalesce(p.risk_level, nullif(src.d->>'risk_level','')),
  problem_statement = case when p.problem_statement = ''
                           then coalesce(nullif(p.problem,''), left(coalesce(src.rationale,''), 2000))
                           else p.problem_statement end,
  originating_agent = coalesce(p.originating_agent,
                        case when p.author_key = 'exec' then 'orchestrator' else p.author_key end)
from src where src.id = p.id;

-- Existing decided proposals are not "ready for approval" — they are further
-- along. Set the maturity stage from the status that is already recorded.
update command_proposals set maturity_stage = case
    when status = 'draft'              then 'draft_proposal'
    when status = 'changes_requested'  then 'revision_required'
    when status = 'approved'           then 'approved_task'
    when status in ('rejected','withdrawn','superseded') then 'archived'
    else 'ready_for_approval' end
where maturity_stage = 'ready_for_approval'
  and status <> 'open';

commit;
