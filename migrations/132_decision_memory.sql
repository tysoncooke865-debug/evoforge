-- 132 — DECISION MEMORY, OUTCOME MEMORY, AND DISAGREEMENT
--
-- The studio has recorded forty agent runs, fifteen proposals and seven lessons,
-- and not one of them can answer the question an agent most needs answered
-- before it proposes anything:
--
--     "Have we tried this before, and what happened?"
--
-- command_audit records that a vote was cast. command_releases records that
-- something shipped. command_lessons records seven hand-written notes. Nothing
-- joins the problem to the evidence to the decision to the result, which means
-- every cycle the studio is equally capable of re-proposing something it already
-- rejected, already shipped, or already proved does not work. PROP-013 was
-- rejected; nothing stops PROP-016 being the same idea in different words.
--
-- WHAT THIS ADDS.
--
--   command_decisions   one durable row per decided proposal: the problem, the
--                       evidence, who was involved, the review, the votes, the
--                       reason, the expected result and the measurement plan.
--   command_outcomes    what actually happened, measured, with the verdict.
--   command_prior_art() the query an agent runs BEFORE writing a proposal.
--   command_disagreements  two specialists differing, stored as two positions
--                       rather than averaged into a mush nobody can act on.
--
-- The decision row is written by trigger, not by an agent remembering to. An
-- agent that has to remember to record its own decision will eventually not.

begin;

/* ── 1. The decision record ─────────────────────────────────────────────── */

create table if not exists command_decisions (
  id              uuid primary key default gen_random_uuid(),
  proposal_id     uuid unique references command_proposals(id) on delete cascade,
  ref             text not null,
  title           text not null,

  -- What was being decided, captured at decision time so a later edit to the
  -- proposal cannot rewrite history.
  problem         text not null default '',
  change_summary  text not null default '',
  affected_areas  text[] not null default '{}',
  evidence        jsonb  not null default '[]'::jsonb,
  agents_involved text[] not null default '{}',
  originating_agent text,

  review_verdict  text,
  review_id       uuid references command_reviews(id),

  votes           jsonb not null default '[]'::jsonb,
  decision        text not null,
  decision_reason text not null default '',
  decided_at      timestamptz not null default now(),

  -- What we said would happen.
  expected_result text not null default '',
  success_metrics jsonb not null default '[]'::jsonb,
  confidence      numeric,
  measurement_window text not null default '',

  -- Where it went.
  work_order_id   uuid references command_work_orders(id),
  release_id      uuid references command_releases(id),
  implemented_at  timestamptz,

  -- What actually happened. Written by the outcome loop, never by hand.
  outcome_verdict text,
  outcome_detail  text not null default '',
  outcome_at      timestamptz,
  unexpected_consequences text[] not null default '{}',
  lessons         text[] not null default '{}',
  follow_up       text not null default '',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint command_decisions_decision_ck check (decision in ('approved','rejected','withdrawn','superseded')),
  constraint command_decisions_outcome_ck check (outcome_verdict is null or outcome_verdict in
    ('validated','inconclusive','failed','harmful','not_measured'))
);

create index if not exists command_decisions_areas_idx on command_decisions using gin (affected_areas);
create index if not exists command_decisions_outcome_idx on command_decisions (outcome_verdict, decided_at desc);

comment on table command_decisions is
  'One durable row per decided proposal. Written by trigger on the deciding vote — an agent that must remember to record its own decision eventually will not.';

/* ── 2. Measurements taken against a decision ───────────────────────────── */

create table if not exists command_outcomes (
  id            bigserial primary key,
  decision_id   uuid not null references command_decisions(id) on delete cascade,
  metric        text not null,
  baseline      numeric,
  observed      numeric,
  target        numeric,
  window_start  timestamptz,
  window_end    timestamptz,
  method        text not null default '',
  -- What else could explain the movement. Not optional: with no feature flags
  -- there is no control group, so every reading has confounders or is a guess.
  confounders   text not null default '',
  available     boolean not null default true,
  unavailable_reason text not null default '',
  measured_by   text not null default 'analytics',
  at            timestamptz not null default now()
);

create index if not exists command_outcomes_decision_idx on command_outcomes (decision_id, at desc);

/* ── 3. Disagreement, kept as two positions ─────────────────────────────── */

create table if not exists command_disagreements (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid references command_proposals(id) on delete cascade,
  subject       text not null,
  agent_a       text not null references command_agents(key),
  position_a    text not null,
  evidence_a    jsonb not null default '[]'::jsonb,
  agent_b       text not null references command_agents(key),
  position_b    text not null,
  evidence_b    jsonb not null default '[]'::jsonb,
  crux          text not null default '',
  resolving_evidence text not null default '',
  escalation    text not null default 'human_review',
  resolved_by   text,
  resolution    text not null default '',
  resolved_at   timestamptz,
  at            timestamptz not null default now(),
  constraint command_disagreements_escalation_ck check (escalation in
    ('deeper_model','human_review','more_evidence','defer'))
);

comment on table command_disagreements is
  'Two specialists differing, stored as two positions. Averaging them into a consensus sentence destroys the only useful information a disagreement carries: what evidence would settle it.';

/* ── 4. Prior art — the query an agent must run before proposing ────────── */

create or replace function public.command_prior_art(
  p_topic text, p_areas text[] default '{}', p_limit int default 8)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare v_terms text; v_out jsonb;
begin
  -- Reduce the topic to a search term. Short words carry no signal and would
  -- match every row, which is worse than matching none: an agent told
  -- "17 similar decisions" stops reading them.
  v_terms := coalesce(nullif(regexp_replace(lower(p_topic), '[^a-z0-9 ]', ' ', 'g'), ''), '');

  select jsonb_build_object(
    'topic', p_topic,

    -- 1. Has this been DECIDED before, and what happened?
    'prior_decisions', coalesce((
      select jsonb_agg(x order by x->>'decided_at' desc) from (
        select jsonb_build_object(
          'ref', d.ref, 'title', d.title, 'decision', d.decision,
          'reason', left(d.decision_reason, 400),
          'decided_at', d.decided_at,
          'outcome', coalesce(d.outcome_verdict, 'not measured'),
          'outcome_detail', left(d.outcome_detail, 400),
          'lessons', to_jsonb(d.lessons)) x
          from command_decisions d
         where d.title % p_topic
            or (p_areas <> '{}' and d.affected_areas && p_areas)
         order by d.decided_at desc limit p_limit) s), '[]'::jsonb),

    -- 2. Is there ACTIVE work already covering it? The duplicate check.
    'active_work', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', w.ref, 'title', w.title, 'status', w.status, 'branch', w.branch))
        from command_work_orders w
       where w.status in ('open','in_progress','blocked')
         and w.title % p_topic), '[]'::jsonb),

    -- 3. Is there an OPEN proposal saying the same thing?
    'open_proposals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', p.ref, 'title', p.title, 'status', p.status,
               'change_summary', left(p.change_summary, 300)))
        from command_proposals p
       where p.status in ('open','changes_requested','draft')
         and p.title % p_topic), '[]'::jsonb),

    -- 4. Did an EXPERIMENT already settle it?
    'experiments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', e.ref, 'name', e.name, 'status', e.status, 'hypothesis', left(e.hypothesis, 300)))
        from command_experiments e
       where e.name % p_topic or e.hypothesis % p_topic), '[]'::jsonb),

    -- 5. What has already SHIPPED near this? "Already implemented" is a real
    --    review verdict and it needs a real source.
    'shipped', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', r.ref, 'title', r.title, 'status', r.status,
               'outcome', r.outcome, 'deployed_at', r.deployed_at))
        from command_releases r
       where r.status in ('deployed','rolled_back')
         and (r.title % p_topic or (p_areas <> '{}' and r.files_changed && p_areas))), '[]'::jsonb),

    -- 6. What did the studio LEARN about these files?
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object('title', l.title, 'detail', left(l.detail, 400)))
        from command_lessons l
       where l.title % p_topic
          or (p_areas <> '{}' and exists (
                select 1 from unnest(p_areas) a where l.detail ilike '%' || a || '%'))
       limit p_limit), '[]'::jsonb)
  ) into v_out;

  return v_out;
end $$;

comment on function public.command_prior_art(text, text[], int) is
  'What the studio already knows about a topic: prior decisions and their outcomes, active work, open proposals, settled experiments, shipped releases and recorded lessons. An agent that proposes without calling this is guessing.';

/* ── 5. Writing the decision record, by trigger ─────────────────────────── */

create or replace function public.command_record_decision()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_votes jsonb; v_review record; v_reason text; v_wo uuid;
begin
  -- Only on the transition INTO a decided state.
  if new.status = old.status or new.status not in ('approved','rejected','withdrawn','superseded') then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
           'founder', coalesce(f.name, 'unknown'), 'choice', v.choice,
           'rationale', v.rationale, 'at', v.at))
    into v_votes
    from command_votes v left join command_founders f on f.user_id = v.founder_id
   where v.proposal_id = new.id;

  select * into v_review from command_reviews where proposal_id = new.id order by at desc limit 1;
  select id into v_wo from command_work_orders where proposal_id = new.id limit 1;

  -- The reason, taken from the votes rather than invented. A decision record
  -- whose reason says "approved by the council" teaches nothing.
  v_reason := coalesce(nullif((
    select string_agg(coalesce(f.name,'a founder') || ': ' || nullif(trim(v.rationale), ''), ' | ')
      from command_votes v left join command_founders f on f.user_id = v.founder_id
     where v.proposal_id = new.id and coalesce(trim(v.rationale),'') <> ''), ''),
    'No rationale was written with any vote.');

  insert into command_decisions (
    proposal_id, ref, title, problem, change_summary, affected_areas, evidence,
    agents_involved, originating_agent, review_verdict, review_id, votes,
    decision, decision_reason, decided_at, expected_result, success_metrics,
    confidence, work_order_id)
  values (
    new.id, new.ref, new.title,
    coalesce(nullif(new.problem_statement,''), new.problem, ''),
    new.change_summary, new.affected_areas, new.evidence,
    (select coalesce(array_agg(distinct a), '{}') from unnest(
       coalesce(new.departments,'{}') || array[coalesce(new.originating_agent, new.author_key, 'unknown')]) a
      where a is not null),
    new.originating_agent,
    v_review.verdict, v_review.id, coalesce(v_votes, '[]'::jsonb),
    new.status, v_reason, coalesce(new.decided_at, now()),
    new.expected_result, new.success_metrics, new.confidence, v_wo)
  on conflict (proposal_id) do update set
    decision = excluded.decision, decision_reason = excluded.decision_reason,
    votes = excluded.votes, decided_at = excluded.decided_at,
    review_verdict = excluded.review_verdict, review_id = excluded.review_id,
    work_order_id = coalesce(excluded.work_order_id, command_decisions.work_order_id),
    updated_at = now();

  return new;
end $$;

drop trigger if exists command_proposals_decision_trg on command_proposals;
create trigger command_proposals_decision_trg
  after update of status on command_proposals
  for each row execute function public.command_record_decision();

/* ── 6. Shipping creates a measurement task, automatically ──────────────── */

-- §16: "After a proposal is implemented, automatically create a measurement
-- task." Without this the outcome column stays null forever and the memory is
-- a record of intentions rather than of results.
create or replace function public.command_open_measurement()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_dec record; v_window text;
begin
  if new.status <> 'deployed' or coalesce(old.status,'') = 'deployed' then return new; end if;

  select d.* into v_dec from command_decisions d
    join command_work_orders w on w.id = d.work_order_id
   where w.id = new.work_order_id limit 1;
  if v_dec is null then return new; end if;

  v_window := coalesce(nullif(v_dec.measurement_window, ''), '14 days');

  update command_decisions
     set release_id = new.id, implemented_at = coalesce(new.deployed_at, now()),
         measurement_window = v_window, updated_at = now()
   where id = v_dec.id;

  update command_proposals set maturity_stage = 'measuring_outcome'
   where id = v_dec.proposal_id and maturity_stage in ('approved_task','in_implementation','implemented');

  -- A real queued job on the analytics agent, not a note. The whole point is
  -- that something claims it and reports a number.
  insert into command_lab_jobs (kind, subject, payload, status, priority)
  values ('measure_outcome',
          v_dec.ref || ' — did it work?',
          jsonb_build_object('decision_id', v_dec.id, 'release_ref', new.ref,
                             'metric', v_dec.success_metrics, 'window', v_window,
                             'expected', v_dec.expected_result),
          'pending', 40);

  perform command_log('measurement_opened', 'release', new.id, new.ref,
                      'Shipped. A measurement job was queued against ' || v_dec.ref ||
                      ' — shipped is not the same as helped.',
                      jsonb_build_object('decision', v_dec.id, 'window', v_window),
                      'system', 'outcome loop');
  return new;
end $$;

drop trigger if exists command_releases_measure_trg on command_releases;
create trigger command_releases_measure_trg
  after update of status on command_releases
  for each row execute function public.command_open_measurement();

/* ── 7. Reading the memory ──────────────────────────────────────────────── */

create or replace function public.command_decision_memory(p_limit int default 40)
returns jsonb language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'generated_at', now(),
    'counts', jsonb_build_object(
      'decisions', (select count(*) from command_decisions),
      'measured',  (select count(*) from command_decisions where outcome_verdict is not null),
      'validated', (select count(*) from command_decisions where outcome_verdict = 'validated'),
      'failed',    (select count(*) from command_decisions where outcome_verdict in ('failed','harmful')),
      'awaiting',  (select count(*) from command_decisions
                     where decision = 'approved' and outcome_verdict is null)),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', d.ref, 'title', d.title, 'decision', d.decision,
               'change_summary', d.change_summary, 'reason', d.decision_reason,
               'decided_at', d.decided_at, 'originating_agent', d.originating_agent,
               'review_verdict', d.review_verdict, 'confidence', d.confidence,
               'outcome', d.outcome_verdict, 'outcome_detail', d.outcome_detail,
               'lessons', to_jsonb(d.lessons), 'areas', to_jsonb(d.affected_areas))
             order by d.decided_at desc)
        from (select * from command_decisions order by decided_at desc limit p_limit) d), '[]'::jsonb))
$$;

grant execute on function public.command_prior_art(text, text[], int) to authenticated, service_role;
grant execute on function public.command_decision_memory(int) to authenticated, service_role;

alter table command_decisions   enable row level security;
alter table command_outcomes    enable row level security;
alter table command_disagreements enable row level security;

drop policy if exists command_decisions_read on command_decisions;
create policy command_decisions_read on command_decisions for select using (is_founder());
drop policy if exists command_outcomes_read on command_outcomes;
create policy command_outcomes_read on command_outcomes for select using (is_founder());
drop policy if exists command_disagreements_read on command_disagreements;
create policy command_disagreements_read on command_disagreements for select using (is_founder());

/* ── 8. Backfill: every proposal already decided ────────────────────────── */

insert into command_decisions (
  proposal_id, ref, title, problem, change_summary, affected_areas, evidence,
  agents_involved, originating_agent, votes, decision, decision_reason,
  decided_at, expected_result, success_metrics, confidence, work_order_id)
select
  p.id, p.ref, p.title,
  coalesce(nullif(p.problem_statement,''), p.problem, ''),
  p.change_summary, p.affected_areas, p.evidence,
  (select coalesce(array_agg(distinct a), '{}') from unnest(
     coalesce(p.departments,'{}') || array[coalesce(p.originating_agent, p.author_key, 'unknown')]) a
    where a is not null),
  p.originating_agent,
  coalesce((select jsonb_agg(jsonb_build_object(
              'founder', coalesce(f.name,'unknown'), 'choice', v.choice,
              'rationale', v.rationale, 'at', v.at))
            from command_votes v left join command_founders f on f.user_id = v.founder_id
           where v.proposal_id = p.id), '[]'::jsonb),
  p.status,
  coalesce(nullif((select string_agg(coalesce(f.name,'a founder') || ': ' || nullif(trim(v.rationale),''), ' | ')
                     from command_votes v left join command_founders f on f.user_id = v.founder_id
                    where v.proposal_id = p.id and coalesce(trim(v.rationale),'') <> ''), ''),
    'Backfilled from history — no rationale was recorded with the votes.'),
  coalesce(p.decided_at, p.created_at),
  p.expected_result, p.success_metrics, p.confidence,
  (select w.id from command_work_orders w where w.proposal_id = p.id limit 1)
from command_proposals p
where p.status in ('approved','rejected','withdrawn','superseded')
on conflict (proposal_id) do nothing;

commit;
