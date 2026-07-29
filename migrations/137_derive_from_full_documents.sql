-- 137 — READ THE FIELD THAT WAS ALREADY THERE
--
-- PROP-016 was raised eleven minutes after 135 unblocked it, and the quality
-- gate immediately, correctly, refused to present it as ready for approval:
--
--   "It does not say what will change."
--
-- Except it does. The backlog document behind it carries a fully-formed
-- proposal — problem, recommendation, reasoning, benefits, risks, alternatives,
-- est_days, complexity, affected_screens — and the recommendation is a plain
-- statement of the change:
--
--   "Stand up EAS native builds for iOS and Android, ship TestFlight to the
--    beta group, and keep the PWA as the shareable surface rather than the
--    primary one."
--
-- command_derive_change_summary handled three document shapes: a Dev Lab
-- implementation brief, a product failure signal, and a studio observation. It
-- did not handle the shape a HAND-WRITTEN backlog entry uses, which is the one
-- with the most in it. So the richest documents in the system derived nothing.
--
-- The same function also takes a p_rationale argument and never reads it. That
-- is the last-resort fallback added here.
--
-- SECOND FIX. command_create_proposal set originating_agent from author_key,
-- and command_exec_cycle writes author_key='exec' — an agent archived by
-- migration 130. The gate then looked up requires_review on an archived row.
-- It happened to be correct, by luck. Routing it through command_agent_route
-- makes it correct on purpose.

begin;

create or replace function public.command_derive_change_summary(
  p_doc jsonb, p_title text default '', p_rationale text default '')
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare
  v_file text; v_steps jsonb; v_risk text; v_acc jsonb; v_event text;
  v_summary text := ''; v_areas text[] := '{}'; v_expected text := '';
  v_rec text; v_complexity text;
begin
  p_doc := coalesce(p_doc, '{}'::jsonb);

  -- SHAPE A — a Dev Lab suggestion. {implementation:{file,steps,risk}, acceptance:[…]}
  v_file  := p_doc #>> '{implementation,file}';
  v_steps := p_doc #> '{implementation,steps}';
  v_risk  := lower(coalesce(p_doc #>> '{implementation,risk}', ''));
  v_acc   := p_doc -> 'acceptance';

  if v_file is not null then
    v_areas := array[v_file];
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
      'change_summary', left(v_summary, 900),
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

  -- SHAPE D — A HAND-WRITTEN BACKLOG DOCUMENT. The richest shape in the system
  -- and the one that derived nothing until now. `recommendation` is already a
  -- plain statement of the change; using it is reading a field, not inventing
  -- a sentence.
  v_rec := nullif(trim(coalesce(p_doc ->> 'recommendation', '')), '');
  if v_rec is not null then
    v_complexity := lower(coalesce(p_doc ->> 'complexity', ''));
    select coalesce(array_agg(value), '{}') into v_areas
      from jsonb_array_elements_text(coalesce(p_doc -> 'affected_screens', '[]'::jsonb));
    return jsonb_build_object(
      'change_summary', left(v_rec, 900),
      'affected_areas', to_jsonb(v_areas),
      'expected_result', coalesce(p_doc #>> '{benefits,0}', ''),
      -- complexity is not risk, but on a hand-written entry it is the only
      -- signal present, and "extreme complexity" is never low risk.
      'risk_level', case
        when v_complexity in ('extreme','high') then 'high'
        when v_complexity in ('trivial','low') then 'low'
        else 'medium' end,
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

  -- LAST RESORT — the rationale the backlog row carries. Weaker than any of the
  -- above because a rationale argues for a change rather than stating it, so it
  -- is used only when nothing structured exists, and the UI still labels the
  -- result as derived rather than authored.
  if coalesce(trim(p_rationale), '') <> '' then
    return jsonb_build_object(
      'change_summary', left(trim(p_rationale), 900),
      'affected_areas', '[]'::jsonb,
      'expected_result', '',
      'risk_level', null,
      'source', 'derived');
  end if;

  return jsonb_build_object(
    'change_summary', '', 'affected_areas', '[]'::jsonb,
    'expected_result', '', 'risk_level', null, 'source', 'none');
end $$;

/* ── originating_agent: route it, do not copy it ────────────────────────── */

create or replace function public.command_map_originating_agent()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- 'exec' is archived. Storing it means the gate reads requires_review off an
  -- archived row and the UI names an agent that takes no work.
  if new.originating_agent is not null
     and not exists (select 1 from command_agents a where a.key = new.originating_agent and a.active) then
    new.originating_agent := coalesce(command_agent_route(new.originating_agent), new.originating_agent);
  end if;
  return new;
end $$;

drop trigger if exists command_proposals_map_agent_trg on command_proposals;
create trigger command_proposals_map_agent_trg
  before insert or update of originating_agent on command_proposals
  for each row execute function public.command_map_originating_agent();

update command_proposals p
   set originating_agent = command_agent_route(p.originating_agent)
 where p.originating_agent is not null
   and command_agent_route(p.originating_agent) is not null
   and not exists (select 1 from command_agents a where a.key = p.originating_agent and a.active);

/* ── re-derive everything the old function could not read ───────────────── */

with src as (
  select p.id,
         command_derive_change_summary(coalesce(b.document, '{}'::jsonb), p.title, coalesce(b.rationale,'')) d
    from command_proposals p
    left join command_backlog b on b.proposal_id = p.id
   where p.summary_source in ('none', 'derived')
)
update command_proposals p set
  change_summary  = coalesce(src.d->>'change_summary', ''),
  summary_source  = coalesce(src.d->>'source', 'none'),
  affected_areas  = case when p.affected_areas = '{}' then
                      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(src.d->'affected_areas','[]'::jsonb))), '{}')
                    else p.affected_areas end,
  expected_result = case when p.expected_result = '' then coalesce(src.d->>'expected_result','') else p.expected_result end,
  risk_level      = coalesce(p.risk_level, nullif(src.d->>'risk_level',''))
from src where src.id = p.id;

commit;
