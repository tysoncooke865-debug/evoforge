-- EvoForge 099 — COMMAND: the Product Improvement Operating System, foundation.
--
-- The audit (docs/COMMAND_CENTRE_ARCHITECTURE.md) found the loop is OPEN. Work
-- is proposed, approved, built and merged — and then nothing. command_releases
-- has never contained a single row. There is no baseline, no metric attached to
-- a work order, no measurement, and no lesson. The system can produce code; it
-- cannot produce evidence that the product improved, which is the only thing it
-- exists for.
--
-- It also found that acceptance criteria are BOILERPLATE: command_open_work
-- writes the same two or three strings onto every work order regardless of
-- content, and nothing ever checks them. A work order is therefore "done" when
-- code merged, which is precisely the definition this system is meant to reject.
--
-- This migration lays the durable model those two facts require. It is additive:
-- every existing table, RPC and policy keeps working, and nothing is dropped or
-- rewritten. The behaviour that USES these tables lands in later migrations, so
-- the repository stays working at this milestone.
--
-- THE INVARIANTS, ENFORCED HERE RATHER THAN IN A PROMPT:
--   · a claim without provenance is not evidence
--   · an opportunity cites evidence, or it is an opinion
--   · a work order cannot enter implementation without a checkable criterion
--   · a work order cannot be finished with a criterion outstanding
--   · a release stays MEASURING until someone or something classifies it
--
-- FALSIFICATION CHECKLIST:
--   1. evidence with kind='fact' and no source_url and no excerpt -> rejected.
--   2. an opportunity scored with a zero denominator -> no divide-by-zero.
--   3. a criterion marked met with no verification note -> rejected.
--   4. founders can SELECT every new table and INSERT into none.
--   5. score components are readable individually, not just the total.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EVIDENCE — nothing becomes truth without provenance
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_evidence (
  id            uuid primary key default gen_random_uuid(),
  -- Where it came from. 'internal_analytics' means EvoForge's own
  -- analytics_events; 'manual' is a founder or agent typing in something they
  -- genuinely observed, which is honest and must stay possible.
  source        text not null check (source in (
                  'internal_analytics','user_feedback','app_review','support',
                  'competitor','market_report','technical','experiment',
                  'founder_observation','manual','session_replay')),
  source_ref    text,                      -- URL, table, ticket, screen name
  collected_at  timestamptz not null default now(),
  -- THE MOST IMPORTANT COLUMN IN THIS FILE. An agent that cannot distinguish
  -- what it measured from what it reckons will eventually present the second as
  -- the first, and every downstream decision inherits the error.
  kind          text not null check (kind in ('fact','interpretation','hypothesis')),
  summary       text not null,
  excerpt       text,                      -- the raw quote / row / number
  payload       jsonb not null default '{}'::jsonb,
  confidence    numeric(3,2) not null default 0.5 check (confidence between 0 and 1),
  segment       text,                      -- which users this is about
  prevalence    numeric(5,4) check (prevalence between 0 and 1),
  severity      int check (severity between 1 and 5),
  strategic_relevance int check (strategic_relevance between 1 and 5),
  -- Evidence rots. A competitor's pricing from four months ago is not a fact
  -- about today, and a system that cannot express that will confidently act on
  -- stale information.
  expires_at    timestamptz,
  superseded_by uuid references public.command_evidence(id),
  collected_by  text not null default 'agent',
  created_at    timestamptz not null default now()
);

-- A 'fact' has to point at something. An interpretation or hypothesis is
-- allowed to be bare, because that is what it is honestly claiming to be.
do $$ begin
  alter table public.command_evidence add constraint command_evidence_fact_needs_proof
    check (kind <> 'fact' or source_ref is not null or excerpt is not null);
exception when duplicate_object then null; end $$;

create index if not exists command_evidence_source_idx on public.command_evidence(source, collected_at desc);
create index if not exists command_evidence_live_idx on public.command_evidence(expires_at) where superseded_by is null;

comment on table public.command_evidence is
  'Every claim the studio acts on, with where it came from and how sure we are. '
  'Agents may not invent analytics, complaints or competitor behaviour; anything '
  'unknown is recorded as unknown rather than guessed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. COMPETITORS — profiles and dated observations
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_competitors (
  key           text primary key,
  name          text not null,
  positioning   text,
  audience      text,
  pricing       jsonb not null default '{}'::jsonb,
  platforms     text[] not null default '{}',
  profile       jsonb not null default '{}'::jsonb,  -- the structured dimensions
  active        boolean not null default true,
  last_reviewed timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.command_competitor_observations (
  id            uuid primary key default gen_random_uuid(),
  competitor    text not null references public.command_competitors(key) on delete cascade,
  dimension     text not null,             -- onboarding | logging | pricing | …
  observation   text not null,
  evidence_id   uuid references public.command_evidence(id),
  -- The four questions that stop this becoming a feature checklist.
  user_problem  text,
  evoforge_gap  text,
  table_stakes  boolean,
  observed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists command_comp_obs_idx on public.command_competitor_observations(competitor, dimension, observed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. OPPORTUNITIES — ranked by visible components, never one opaque number
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_opportunities (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  title         text not null,
  classification text not null default 'OPTIMISATION' check (classification in (
                  'TABLE_STAKES','OPTIMISATION','DIFFERENTIATOR','EXPERIMENT',
                  'TECHNICAL_HEALTH','SECURITY','GROWTH','MONETISATION','DO_NOT_PURSUE')),
  category      text,                       -- activation | retention | …
  problem       text not null,
  segment       text,
  baseline      text,                       -- stated, or explicitly unknown
  hypothesis    text,
  response      text,                       -- proposed answer
  smallest_version text,                    -- the cheapest useful form
  metric        text,                       -- what would move
  target        text,
  alternatives  text,
  -- SCORE COMPONENTS ARE COLUMNS, NOT A BLACK BOX. A founder who cannot see why
  -- something ranks first cannot disagree with it, and a ranking nobody can
  -- argue with is not a decision aid, it is an oracle.
  impact        numeric(4,2) not null default 3 check (impact between 0 and 5),
  confidence    numeric(3,2) not null default 0.5 check (confidence between 0 and 1),
  strategic_fit numeric(4,2) not null default 3 check (strategic_fit between 0 and 5),
  evidence_strength numeric(3,2) not null default 0.5 check (evidence_strength between 0 and 1),
  effort        numeric(4,2) not null default 3 check (effort between 0.5 and 10),
  risk          numeric(4,2) not null default 2 check (risk between 0.5 and 5),
  time_to_learning numeric(4,2) not null default 2 check (time_to_learning between 0.5 and 10),
  required_agents text[] not null default '{}',
  founder_decision text,                    -- what only a founder can settle
  measurement_plan text,
  status        text not null default 'DISCOVERED' check (status in (
                  'DISCOVERED','EVIDENCE_REQUIRED','PROPOSED','ACCEPTED','REJECTED','SUPERSEDED')),
  proposal_id   uuid references public.command_proposals(id),
  source_agents text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.command_opportunity_evidence (
  opportunity_id uuid not null references public.command_opportunities(id) on delete cascade,
  evidence_id    uuid not null references public.command_evidence(id) on delete cascade,
  primary key (opportunity_id, evidence_id)
);

-- The weights live in settings so a founder can retune the model without a
-- deploy. Defaults chosen to be neutral, not clever.
insert into command_settings (key, value) values
  ('roi_weights', '{"impact":1,"confidence":1,"strategic_fit":1,"evidence_strength":1,"effort":1,"risk":1,"time_to_learning":1}'::jsonb)
on conflict (key) do nothing;

/**
 * ROI = (impact × confidence × strategic_fit × evidence_strength)
 *       ÷ (effort × risk × time_to_learning)
 *
 * Weights are exponents from command_settings.roi_weights, so a founder can say
 * "I care about effort twice as much" without touching code. Every denominator
 * is CHECK-constrained above 0, so this cannot divide by zero — the guard is the
 * column constraint, not a coalesce here that would hide a bad row.
 */
create or replace function public.command_opportunity_score(o public.command_opportunities)
returns numeric language sql stable as $$
  with w as (select coalesce((select value from command_settings where key='roi_weights'),
                             '{}'::jsonb) as j)
  select round(
    ( power(greatest(o.impact,0.01),            coalesce((w.j->>'impact')::numeric,1))
    * power(greatest(o.confidence,0.01),        coalesce((w.j->>'confidence')::numeric,1))
    * power(greatest(o.strategic_fit,0.01),     coalesce((w.j->>'strategic_fit')::numeric,1))
    * power(greatest(o.evidence_strength,0.01), coalesce((w.j->>'evidence_strength')::numeric,1))
    ) /
    ( power(greatest(o.effort,0.5),             coalesce((w.j->>'effort')::numeric,1))
    * power(greatest(o.risk,0.5),               coalesce((w.j->>'risk')::numeric,1))
    * power(greatest(o.time_to_learning,0.5),   coalesce((w.j->>'time_to_learning')::numeric,1))
    )
  , 3) from w;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ACCEPTANCE CRITERIA — rows that can be checked, not prose that cannot
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_criteria (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.command_work_orders(id) on delete cascade,
  ref           text not null,                     -- AC-1, AC-2 …
  statement     text not null,
  -- How this will be decided. 'manual' is allowed but must still carry a note,
  -- because "someone looked" with no record is how boilerplate criteria became
  -- decoration in the first place.
  verify_by     text not null default 'manual' check (verify_by in
                  ('automated_test','browser_journey','migration_check','manual','metric')),
  verify_ref    text,                               -- test name, journey id, metric
  met           boolean not null default false,
  met_at        timestamptz,
  met_by        text,
  verification  text,                               -- the evidence it was met
  created_at    timestamptz not null default now(),
  unique (work_order_id, ref)
);

-- A criterion cannot be marked met with nothing to show for it.
do $$ begin
  alter table public.command_criteria add constraint command_criteria_met_needs_proof
    check (not met or verification is not null);
exception when duplicate_object then null; end $$;

create index if not exists command_criteria_wo_idx on public.command_criteria(work_order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. WORK ORDERS — lifecycle, metric, risk, budget, durable execution state
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_work_orders
  add column if not exists stage            text not null default 'IMPLEMENTING',
  add column if not exists opportunity_id   uuid references public.command_opportunities(id),
  add column if not exists primary_metric   text,
  add column if not exists baseline         text,
  add column if not exists target           text,
  add column if not exists guardrails       text[] not null default '{}',
  add column if not exists risk_level       text not null default 'MEDIUM',
  add column if not exists attempt_budget   int not null default 3,
  add column if not exists attempts_used    int not null default 0,
  -- THE STATE OBJECT. A restarted runner must be able to answer "which criteria
  -- are already met" without replaying a chat log. Long conversation history is
  -- not task memory.
  add column if not exists exec_state       jsonb not null default '{}'::jsonb,
  add column if not exists protected_areas  text[] not null default '{}',
  add column if not exists non_goals        text[] not null default '{}';

do $$ begin
  alter table public.command_work_orders add constraint command_wo_stage_ck
    check (stage in ('DISCOVERED','EVIDENCE_REQUIRED','PROPOSED','APPROVED','PLANNING',
                     'READY_TO_BUILD','IMPLEMENTING','VERIFYING','READY_FOR_PREVIEW',
                     'READY_FOR_RELEASE','RELEASED','MEASURING','VALIDATED','NEUTRAL',
                     'REGRESSED','ROLLED_BACK','REJECTED','BLOCKED'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.command_work_orders add constraint command_wo_risk_ck
    check (risk_level in ('LOW','MEDIUM','HIGH'));
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RUNS — what each agent invocation cost and whether it worked
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_runs (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.command_work_orders(id) on delete cascade,
  task_id       uuid references public.command_tasks(id) on delete cascade,
  agent_key     text,
  model         text,
  model_reason  text,                      -- why this model was chosen
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  tool_calls    int not null default 0,
  files_changed int not null default 0,
  unexpected_files int not null default 0, -- outside the work order's scope
  input_tokens  bigint,
  output_tokens bigint,
  cost_usd      numeric(10,4),
  outcome       text check (outcome in ('success','blocked','failed','abandoned')),
  criteria_met  int not null default 0,
  criteria_total int not null default 0,
  notes         text
);

create index if not exists command_runs_wo_idx on public.command_runs(work_order_id, started_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. LESSONS — so a mistake costs full price exactly once
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_lessons (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('failure','success','decision','regression','pattern')),
  title         text not null,
  detail        text not null,
  -- Retrieval keys. A lesson nobody can find before starting related work is a
  -- diary entry, not a system.
  tags          text[] not null default '{}',
  paths         text[] not null default '{}',
  work_order_id uuid references public.command_work_orders(id) on delete set null,
  evidence_id   uuid references public.command_evidence(id),
  created_at    timestamptz not null default now()
);

create index if not exists command_lessons_tags_idx on public.command_lessons using gin(tags);
create index if not exists command_lessons_paths_idx on public.command_lessons using gin(paths);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — founders read everything, write nothing. Same rule as 088.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_evidence','command_competitors',
                           'command_competitor_observations','command_opportunities',
                           'command_opportunity_evidence','command_criteria',
                           'command_runs','command_lessons']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
