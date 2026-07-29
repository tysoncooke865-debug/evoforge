-- 133 — THE PIPELINE, THE JOB CONTRACT, AND MODEL ROUTING
--
-- FIRST, A BUG THIS MIGRATION FIXES IN THE ONE BEFORE IT.
--
-- 132's command_open_measurement() inserts into command_lab_jobs using columns
-- I wrote from memory rather than from the table:
--
--     insert into command_lab_jobs (kind, subject, payload, status, priority)
--     values ('measure_outcome', …, 'pending', 40)
--
-- There is no `subject` column and no `priority` column — they are `label` and
-- nothing. `status` is constrained to queued/running/done/failed/cancelled, so
-- 'pending' would have been rejected. And `kind` has a CHECK listing fourteen
-- values, none of them 'measure_outcome'.
--
-- Every one of those is a runtime error inside an AFTER UPDATE trigger, which
-- means the failure mode was not "measurement does not happen". It was "marking
-- a release deployed raises an exception and the deploy cannot be recorded at
-- all". That is the exact class of error the handoff doc warns about twice, and
-- I made it anyway; it is caught here rather than at 2am by a founder trying to
-- record a deployment.
--
-- WHAT THIS ADDS.
--
--   · The evidence-first pipeline as rows: a run, its steps, and where it is.
--   · The job contract from §17 — every scheduled agent must declare its
--     trigger, its threshold, its duplicate rule, its frequency cap and its
--     cost cap before it is allowed to run at all.
--   · Model routing as data, with a logged reason per decision, so "why did
--     that cost $4" has an answer.

begin;

/* ── 0. Fix the 132 trigger against the real table ──────────────────────── */

alter table command_lab_jobs drop constraint if exists command_lab_jobs_kind_check;
alter table command_lab_jobs add constraint command_lab_jobs_kind_check
  check (kind in ('bench','judge','capture','perf','generate','simulate','arena','predict',
                  'import','edit','transcribe','research','suggest','shoot',
                  -- the agent runtime's kinds
                  'measure_outcome','agent_run','review','evidence_sweep'));

create or replace function public.command_open_measurement()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_dec record; v_window text;
begin
  if new.status <> 'deployed' or coalesce(old.status,'') = 'deployed' then return new; end if;

  select d.* into v_dec from command_decisions d
   where d.work_order_id = new.work_order_id limit 1;
  if v_dec is null then return new; end if;

  v_window := coalesce(nullif(v_dec.measurement_window, ''), '14 days');

  update command_decisions
     set release_id = new.id, implemented_at = coalesce(new.deployed_at, now()),
         measurement_window = v_window, updated_at = now()
   where id = v_dec.id;

  update command_proposals set maturity_stage = 'measuring_outcome'
   where id = v_dec.proposal_id and maturity_stage in ('approved_task','in_implementation','implemented');

  -- Real columns this time: label, not subject; queued, not pending; no
  -- priority column exists.
  insert into command_lab_jobs (kind, label, payload, status, requested_by)
  values ('measure_outcome',
          v_dec.ref || ' — did it work?',
          jsonb_build_object('decision_id', v_dec.id, 'release_ref', new.ref,
                             'metrics', v_dec.success_metrics, 'window', v_window,
                             'expected', v_dec.expected_result),
          'queued', 'outcome loop');

  perform command_log('measurement_opened', 'release', new.id, new.ref,
                      'Shipped. A measurement job was queued against ' || v_dec.ref ||
                      ' — shipped is not the same as helped.',
                      jsonb_build_object('decision', v_dec.id, 'window', v_window),
                      'system', 'outcome loop');
  return new;
end $$;

/* ── 1. The pipeline, as rows ───────────────────────────────────────────── */

create table if not exists command_pipeline_runs (
  id            uuid primary key default gen_random_uuid(),
  topic         text not null,
  trigger_kind  text not null,
  trigger_detail jsonb not null default '{}'::jsonb,
  stage         text not null default 'evidence',
  status        text not null default 'running',
  proposal_id   uuid references command_proposals(id) on delete set null,
  -- Duplicate prevention lives here, not in a prompt: one open run per topic.
  topic_key     text,
  cost_usd      numeric not null default 0,
  cost_cap_usd  numeric,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  outcome       text not null default '',
  constraint command_pipeline_runs_status_ck check (status in ('running','done','failed','abandoned','quiet')),
  constraint command_pipeline_runs_stage_ck check (stage in
    ('trigger','evidence','analysis','proposal','review','revision','approval',
     'execution','measurement','learning'))
);

-- One live run per topic. The duplicate-prevention rule §17 demands, expressed
-- as an index rather than as a check an agent has to remember.
create unique index if not exists command_pipeline_open_topic_idx
  on command_pipeline_runs (topic_key) where status = 'running';

create table if not exists command_pipeline_steps (
  id           bigserial primary key,
  run_id       uuid not null references command_pipeline_runs(id) on delete cascade,
  ord          int not null,
  stage        text not null,
  agent_key    text references command_agents(key),
  status       text not null default 'running',
  model        text,
  model_reason text not null default '',
  cost_usd     numeric,
  latency_ms   int,
  input_summary  text not null default '',
  output         jsonb,
  quality_passed boolean,
  quality_detail jsonb not null default '[]'::jsonb,
  error        text not null default '',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  constraint command_pipeline_steps_status_ck check (status in ('running','done','failed','skipped','rejected'))
);

create index if not exists command_pipeline_steps_run_idx on command_pipeline_steps (run_id, ord);

comment on table command_pipeline_runs is
  'One evidence-first pipeline run: trigger -> evidence -> analysis -> proposal -> review -> revision -> approval -> execution -> measurement -> learning. status=quiet means the run completed and correctly produced nothing.';

/* ── 2. The job contract ────────────────────────────────────────────────── */

-- §17: an agent may not be scheduled until it has declared what would make its
-- run worth doing. A job with no threshold and no duplicate rule is a content
-- generator, and this table has no column in which to omit either.
create table if not exists command_agent_jobs (
  key             text primary key,
  label           text not null,
  agent_key       text not null references command_agents(key),
  trigger_kind    text not null,
  trigger_detail  text not null,
  data_sources    text[] not null,
  expected_output text not null,
  quality_threshold text not null,
  duplicate_rule  text not null,
  escalation_rule text not null,
  notify_rule     text not null default 'never',
  max_per_day     int not null default 4,
  cost_cap_usd    numeric not null default 2.00,
  failure_rule    text not null default 'record and retry on the next trigger',
  enabled         boolean not null default true,
  last_run_at     timestamptz,
  last_result     text not null default '',
  runs_today      int not null default 0,
  constraint command_agent_jobs_trigger_ck check (trigger_kind in ('schedule','event','manual')),
  constraint command_agent_jobs_notify_ck check (notify_rule in ('never','on_proposal','on_failure','always'))
);

insert into command_agent_jobs
  (key, label, agent_key, trigger_kind, trigger_detail, data_sources, expected_output,
   quality_threshold, duplicate_rule, escalation_rule, notify_rule, max_per_day, cost_cap_usd)
values
('analytics_funnel_watch', 'Watch the activation funnel', 'analytics', 'schedule',
 'Hourly. Runs the funnel and failure query; produces an observation only when a step moved materially or a failure event crossed its threshold.',
 array['analytics_events_real','command_metric_defs'],
 'A finding with a confidence band and named data-quality gaps, or a quiet check.',
 'A step must have moved by more than 20% relative, or a failure event must exceed 10 events across 2+ athletes.',
 'No new observation if an open proposal or work order already names the same event or funnel step.',
 'Escalate to human review when a step drops to zero after being non-zero.',
 'on_proposal', 24, 0.50),

('research_feedback_batch', 'Cluster new user feedback', 'research', 'event',
 'When 5 or more unprocessed feedback items accumulate, or one complaint recurs 3 times.',
 array['command_evidence','analytics_events_real'],
 'Problem statements with frequency, severity, affected segment and direct quotes.',
 'At least 3 independent sources before a problem statement may be raised above hypothesis.',
 'Merge into an existing problem statement rather than raising a second one for the same complaint.',
 'Escalate when severity is high and analytics cannot corroborate the behaviour.',
 'on_proposal', 6, 1.00),

('market_competitor_review', 'Scheduled competitor review', 'market', 'schedule',
 'Weekly, plus on demand when a tracked competitor is known to have shipped.',
 array['command_competitors','command_competitor_observations'],
 'Dated, sourced observations with a relevance statement and a recommended response.',
 'Every claim must carry a fetched source URL and an observation date. Unsourced claims are discarded, not downgraded.',
 'Skip a competitor reviewed within the last 6 days unless explicitly asked.',
 'Escalate when a competitor ships something that invalidates an EvoForge differentiator.',
 'on_proposal', 2, 2.00),

('strategy_backlog_cycle', 'Score the backlog and propose', 'strategy', 'schedule',
 'Every 10 minutes, but proposes only when the top candidate clears the quality gate and the council queue has room.',
 array['command_backlog','command_evidence','command_decisions','command_outcomes'],
 'One proposal with a change summary, success metric, effort, confidence and evidence.',
 'Must pass every blocking check in command_quality_rubric before it may be raised.',
 'command_prior_art must return no active work order and no open proposal on the same topic.',
 'Escalate to the deep model when review and strategy disagree twice on the same topic.',
 'on_proposal', 12, 3.00),

('review_queue', 'Independently review pending proposals', 'reviewer', 'event',
 'When a proposal reaches maturity stage under_review.',
 array['command_proposals','command_evidence','command_decisions','command_work_orders'],
 'A verdict with unsupported claims named individually.',
 'A verdict of supported requires every factual claim to trace to an attached evidence item.',
 'One review per proposal revision. Re-review only after the proposal changes.',
 'Escalate to a founder when the reviewer rejects a proposal the strategy agent re-raises unchanged.',
 'never', 24, 3.00),

('outcome_measurement', 'Measure shipped releases', 'analytics', 'event',
 'When a release is marked deployed and its measurement window closes.',
 array['analytics_events_real','command_decisions','command_releases'],
 'A verdict of validated / inconclusive / failed / harmful, with confounders named.',
 'A verdict other than not_measured requires a recorded baseline and a closed window.',
 'One measurement per decision per window.',
 'Escalate when the observed effect is opposite to the predicted direction.',
 'always', 8, 1.00)
on conflict (key) do update set
  label = excluded.label, agent_key = excluded.agent_key,
  trigger_kind = excluded.trigger_kind, trigger_detail = excluded.trigger_detail,
  data_sources = excluded.data_sources, expected_output = excluded.expected_output,
  quality_threshold = excluded.quality_threshold, duplicate_rule = excluded.duplicate_rule,
  escalation_rule = excluded.escalation_rule, notify_rule = excluded.notify_rule,
  max_per_day = excluded.max_per_day, cost_cap_usd = excluded.cost_cap_usd;

/* ── 3. Model routing, as data with a recorded reason ───────────────────── */

create table if not exists command_model_routes (
  key        text primary key,
  model      text not null,
  effort     text,
  tier       text not null,
  why        text not null,
  ord        int not null default 100,
  constraint command_model_routes_tier_ck check (tier in ('fast','standard','deep'))
);

-- Model ids are Claude 5 family. Recorded here rather than hardcoded in six
-- scripts, so a model change is one UPDATE and every routing decision already
-- logged still says which model it actually used.
insert into command_model_routes (key, model, effort, tier, why, ord) values
  ('irreversible',   'claude-opus-5',   'xhigh',  'deep',
   'A change that cannot be undone gets the strongest reasoning available, whatever it costs.', 10),
  ('independent_review','claude-opus-5','high',   'deep',
   'Review is the only thing standing between a plausible recommendation and a founder vote. It is never the place to save money.', 20),
  ('conflicting_evidence','claude-opus-5','high', 'deep',
   'Two sources disagreeing is precisely where a cheaper model picks one and sounds confident.', 30),
  ('architecture',   'claude-opus-5',   'high',   'deep',
   'Schema, auth and API contracts are unforgiving and expensive to reverse.', 40),
  ('high_risk',      'claude-opus-5',   'high',   'deep',
   'Auth, migrations, payments and privacy.', 50),
  ('recovery',       'claude-opus-5',   'high',   'deep',
   'A retry after a failure is exactly when a cheap model loops on the same mistake.', 60),
  ('strategy',       'claude-opus-5',   'high',   'deep',
   'Deciding what to build is the highest-leverage judgement the studio makes.', 70),
  ('implementation', 'claude-sonnet-5', 'medium', 'standard',
   'A contained change in a known area, against written acceptance criteria.', 80),
  ('analysis',       'claude-sonnet-5', 'medium', 'standard',
   'Reading a funnel and reporting it is mechanical once the query exists.', 90),
  ('research',       'claude-sonnet-5', 'medium', 'standard',
   'Collecting and dating sources. The judgement is in the citation rule, not the model.', 100),
  ('classification', 'claude-haiku-4-5-20251001', null, 'fast',
   'Tagging, deduplication and routing. Wrong answers here are cheap and visible.', 110),
  ('summarise',      'claude-haiku-4-5-20251001', null, 'fast',
   'Reformatting something already decided.', 120),
  ('vision',         'gpt-5.1',         null,     'standard',
   'Screenshot reasoning. This is the one place the studio deliberately leaves the Claude family, and it is recorded rather than assumed.', 130)
on conflict (key) do update set
  model = excluded.model, effort = excluded.effort, tier = excluded.tier,
  why = excluded.why, ord = excluded.ord;

create table if not exists command_model_decisions (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  agent_key   text,
  task_kind   text not null,
  route_key   text not null,
  model       text not null,
  effort      text,
  why         text not null,
  factors     jsonb not null default '{}'::jsonb,
  cost_usd    numeric,
  outcome     text not null default ''
);

create index if not exists command_model_decisions_at_idx on command_model_decisions (at desc);

-- The router. Order matters and is the whole design: a retry on an irreversible
-- change must not be routed DOWN because it also matches a cheaper rule.
create or replace function public.command_route_model(
  p_agent text default null,
  p_kind  text default 'analysis',
  p_risk  text default 'medium',
  p_attempt int default 1,
  p_reversibility text default 'manual',
  p_conflicting boolean default false)
returns jsonb language plpgsql stable set search_path to 'public' as $$
declare v_key text; v_r record; v_tier text;
begin
  select model_tier into v_tier from command_agents where key = p_agent;

  v_key := case
    when p_reversibility = 'difficult'          then 'irreversible'
    when p_kind = 'review'                      then 'independent_review'
    when p_conflicting                          then 'conflicting_evidence'
    when p_attempt >= 2                         then 'recovery'
    when lower(coalesce(p_risk,'')) = 'high'    then 'high_risk'
    when p_kind in ('architecture','migration') then 'architecture'
    when p_kind = 'strategy'                    then 'strategy'
    when p_kind = 'vision'                      then 'vision'
    when p_kind in ('implement','implementation') then 'implementation'
    when p_kind in ('classify','dedupe','tag')  then 'classification'
    when p_kind = 'summarise'                   then 'summarise'
    when p_kind = 'research'                    then 'research'
    else 'analysis' end;

  select * into v_r from command_model_routes where key = v_key;
  if v_r is null then select * into v_r from command_model_routes where key = 'analysis'; end if;

  -- An agent declared 'deep' is never routed below standard. The tier on the
  -- agent row is a floor, not a suggestion: it is how "the Independent Review
  -- Agent must not be cheapened" survives someone editing a route.
  if v_tier = 'deep' and v_r.tier = 'fast' then
    select * into v_r from command_model_routes where key = 'analysis';
  end if;

  return jsonb_build_object(
    'route', v_key, 'model', v_r.model, 'effort', v_r.effort, 'tier', v_r.tier,
    'why', v_r.why,
    'factors', jsonb_build_object('agent', p_agent, 'kind', p_kind, 'risk', p_risk,
                                  'attempt', p_attempt, 'reversibility', p_reversibility,
                                  'conflicting_evidence', p_conflicting,
                                  'agent_tier_floor', v_tier));
end $$;

grant execute on function public.command_route_model(text, text, text, int, text, boolean)
  to authenticated, service_role;

alter table command_pipeline_runs  enable row level security;
alter table command_pipeline_steps enable row level security;
alter table command_agent_jobs     enable row level security;
alter table command_model_decisions enable row level security;
alter table command_model_routes   enable row level security;

drop policy if exists command_pipeline_runs_read on command_pipeline_runs;
create policy command_pipeline_runs_read on command_pipeline_runs for select using (is_founder());
drop policy if exists command_pipeline_steps_read on command_pipeline_steps;
create policy command_pipeline_steps_read on command_pipeline_steps for select using (is_founder());
drop policy if exists command_agent_jobs_read on command_agent_jobs;
create policy command_agent_jobs_read on command_agent_jobs for select using (is_founder());
drop policy if exists command_model_decisions_read on command_model_decisions;
create policy command_model_decisions_read on command_model_decisions for select using (is_founder());
drop policy if exists command_model_routes_read on command_model_routes;
create policy command_model_routes_read on command_model_routes for select using (is_founder());

commit;
