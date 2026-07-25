-- EvoForge 105 — the Experimentation Platform.
--
-- 103 recorded experiment DESIGNS but could not run one: there were no flags,
-- so there was no control group, and every release classification had to carry
-- the sentence "anything that moved could have moved for another reason". 104
-- fixed assignment. This is the platform on top of it.
--
-- THE RULE THAT SHAPES THE SCHEMA
--
--   "Every major product decision should be validated through measurable
--    experiments instead of opinions."
--
-- So a metric here is not a label. It is a NAMED QUERY in command_metric_defs,
-- and an experiment may only reference metrics that can actually be computed.
-- An experiment whose primary metric has no query behind it is unfalsifiable by
-- construction, and this refuses to create one — the same rule that stopped
-- agents inventing analytics, applied to experiments.
--
-- WHAT IS DELIBERATELY NOT HERE
--
--   No statistics. Significance, confidence and required sample are computed in
--   src/lib/experiments.ts where they are unit-tested against known values. A
--   confidence number is the single easiest thing in this system to fabricate
--   convincingly, so it lives where a test can hold it to account rather than
--   inside a query nobody reads.
--
-- FALSIFICATION CHECKLIST:
--   1. an experiment naming an unknown primary metric -> refused.
--   2. RUNNING with no flag -> refused (there would be no assignment).
--   3. a guardrail breach pauses the flag and records why.
--   4. exposure is unique per (experiment, subject) — no double counting.
--   5. a decision cannot be recorded without a rationale.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. METRIC CATALOGUE — a metric is a query, or it does not exist
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_metric_defs (
  key           text primary key,
  label         text not null,
  category      text not null,
  -- 'up' = higher is better, 'down' = lower is better. Getting this wrong
  -- inverts every verdict, so it is required rather than inferred.
  direction     text not null check (direction in ('up','down')),
  unit          text not null default 'count' check (unit in ('count','rate','pct','ms','usd','score')),
  -- $1 = variant subject-id array, $2 = window start. NULL means the metric is
  -- DECLARED but not yet computable — surfaced as unavailable, never as zero.
  sql_template  text,
  source        text not null default 'analytics_events',
  created_at    timestamptz not null default now()
);

insert into public.command_metric_defs (key,label,category,direction,unit,sql_template) values
  ('first_set_logged','Athletes logging a first set','activation','up','count',
   $q$select count(distinct user_id)::numeric v from analytics_events
       where event_name='activation_step' and props->>'step'='first_set_logged'
         and user_id = any($1) and created_at > $2$q$),
  ('train_opened','Athletes opening Train','activation','up','count',
   $q$select count(distinct user_id)::numeric v from analytics_events
       where event_name='activation_step' and props->>'step'='train_opened'
         and user_id = any($1) and created_at > $2$q$),
  ('activation_rate','first_set_logged / home_reached','activation','up','pct',
   $q$select coalesce(round((count(distinct user_id) filter (where props->>'step'='first_set_logged')::numeric)
        / nullif(count(distinct user_id) filter (where props->>'step'='home_reached'),0) * 100,1),0) v
       from analytics_events where event_name='activation_step'
        and user_id = any($1) and created_at > $2$q$),
  ('session_starts','Sessions started','engagement','up','count',
   $q$select count(*)::numeric v from analytics_events
       where event_name='session_start' and user_id = any($1) and created_at > $2$q$),
  ('origin_binding_failed','Origin binding failures','reliability','down','count',
   $q$select count(*)::numeric v from analytics_events
       where event_name='origin_binding_failed' and user_id = any($1) and created_at > $2$q$),
  ('error_events','Error events','reliability','down','count',
   $q$select count(*)::numeric v from analytics_events
       where (event_name like '%error%' or event_name like '%_failed')
         and user_id = any($1) and created_at > $2$q$),
  -- Declared, honestly uncomputable today. The UI shows these as UNAVAILABLE so
  -- an experiment cannot quietly be judged on a metric nobody is collecting.
  ('workout_completed','Workouts completed','activation','up','count',null),
  ('retention_d7','Day-7 return','retention','up','pct',null),
  ('subscription_started','Subscriptions started','revenue','up','count',null),
  ('ai_accepted','AI suggestions accepted','ai','up','pct',null),
  ('ai_latency_ms','AI response time','ai','down','ms',null),
  ('ai_cost_usd','AI cost per request','ai','down','usd',null),
  ('crash_rate','Crash rate','reliability','down','pct',null)
on conflict (key) do update set label=excluded.label, category=excluded.category,
  direction=excluded.direction, unit=excluded.unit, sql_template=excluded.sql_template;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EXPERIMENTS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_experiments
  add column if not exists name           text,
  add column if not exists description    text,
  add column if not exists category       text,
  add column if not exists exp_type       text,
  add column if not exists owner          text,
  add column if not exists priority       int not null default 3,
  add column if not exists feature        text,
  add column if not exists flag_key       text references public.command_flags(key),
  add column if not exists variants       jsonb not null default '[]'::jsonb,
  add column if not exists rollout_pct    numeric(5,2) not null default 0,
  add column if not exists min_sample     int not null default 100,
  add column if not exists risk_level     text not null default 'MEDIUM',
  add column if not exists tags           text[] not null default '{}',
  add column if not exists notes          text,
  add column if not exists opportunity_id uuid references public.command_opportunities(id),
  add column if not exists started_at     timestamptz,
  add column if not exists stopped_at     timestamptz,
  add column if not exists decision       text,
  add column if not exists decision_reason text,
  add column if not exists decided_by     text,
  add column if not exists decided_at     timestamptz,
  add column if not exists auto_paused    boolean not null default false,
  add column if not exists pause_reason   text;

do $$ begin
  alter table public.command_experiments add constraint command_exp_type_ck
    check (exp_type is null or exp_type in ('ui','ux','feature','ai_prompt','ai_model',
      'algorithm','navigation','pricing','notification','gamification','performance','backend'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.command_experiments drop constraint command_experiments_status_check;
exception when undefined_object then null; end $$;
do $$ begin
  alter table public.command_experiments add constraint command_exp_status_ck
    check (status in ('DRAFT','REVIEW','APPROVED','RUNNING','PAUSED','ANALYSING',
                      'DECIDED','ROLLED_OUT','REJECTED','ARCHIVED','BLOCKED_NO_FLAGS'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.command_experiments add constraint command_exp_decision_ck
    check (decision is null or decision in ('SHIP','REJECT','ITERATE','INCONCLUSIVE','ROLLBACK'));
exception when duplicate_object then null; end $$;

-- Metrics attached to an experiment, with their role.
create table if not exists public.command_experiment_metrics (
  experiment_id uuid not null references public.command_experiments(id) on delete cascade,
  metric_key    text not null references public.command_metric_defs(key),
  role          text not null check (role in ('primary','secondary','guardrail')),
  -- Guardrails only: the relative move that trips a pause, e.g. 0.20 = 20% worse.
  breach_pct    numeric(5,2),
  primary key (experiment_id, metric_key)
);

-- Who saw what. Unique per subject so a reload cannot inflate exposure —
-- double-counted exposure quietly deflates every rate computed from it.
create table if not exists public.command_experiment_exposures (
  experiment_id uuid not null references public.command_experiments(id) on delete cascade,
  subject_id    text not null,
  variant       text not null,
  first_seen_at timestamptz not null default now(),
  primary key (experiment_id, subject_id)
);
create index if not exists command_exp_exposure_variant_idx
  on public.command_experiment_exposures(experiment_id, variant);

-- Measured results, one row per variant per metric per evaluation.
create table if not exists public.command_experiment_results (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.command_experiments(id) on delete cascade,
  metric_key    text not null,
  variant       text not null,
  subjects      int not null,
  value         numeric,
  computed_at   timestamptz not null default now(),
  -- Null when the metric has no query. UNAVAILABLE is a fact about our
  -- instrumentation; zero would be a claim about user behaviour.
  available     boolean not null default true
);
create index if not exists command_exp_results_idx
  on public.command_experiment_results(experiment_id, computed_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GATES
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_experiment_gate()
returns trigger language plpgsql set search_path = public as $$
declare v_primary int; v_uncomputable int;
begin
  if new.status is not distinct from old.status then return new; end if;

  if new.status = 'RUNNING' then
    if new.flag_key is null then
      raise exception 'command: % cannot run without a feature flag — with no assignment there is no control group and no experiment', new.ref;
    end if;
    select count(*) into v_primary from command_experiment_metrics
     where experiment_id = new.id and role = 'primary';
    if v_primary = 0 then
      raise exception 'command: % has no primary metric — an experiment that cannot be decided is an opinion with a rollout', new.ref;
    end if;
    select count(*) into v_uncomputable
      from command_experiment_metrics m join command_metric_defs d on d.key = m.metric_key
     where m.experiment_id = new.id and m.role = 'primary' and d.sql_template is null;
    if v_uncomputable > 0 then
      raise exception 'command: %s primary metric has no query behind it — it cannot be measured, so it cannot be run', new.ref;
    end if;
  end if;

  if new.status = 'DECIDED' and coalesce(trim(new.decision_reason),'') = '' then
    raise exception 'command: a decision on % needs a stated reason', new.ref;
  end if;

  return new;
end $$;

drop trigger if exists command_experiment_gate_trg on public.command_experiments;
create trigger command_experiment_gate_trg
  before update on public.command_experiments
  for each row execute function public.command_experiment_gate();

/**
 * A guardrail breach pauses the rollout immediately.
 *
 * Not "notifies someone". The whole point of a guardrail is that it acts faster
 * than a human reads a dashboard — by the time a founder notices a crash-rate
 * spike, the exposed cohort has already had the bad experience.
 */
create or replace function public.command_trip_guardrail(
  p_experiment uuid, p_metric text, p_detail text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from command_experiments where id = p_experiment;
  if e is null then raise exception 'command: no such experiment'; end if;

  update command_experiments
     set status = 'PAUSED', auto_paused = true,
         pause_reason = format('Guardrail %s breached: %s', p_metric, p_detail),
         stopped_at = now()
   where id = p_experiment;

  if e.flag_key is not null then
    update command_flags set enabled = false, rollout_pct = 0,
           paused_reason = format('guardrail %s on %s', p_metric, e.ref), updated_at = now()
     where key = e.flag_key;
  end if;

  perform command_log('experiment_guardrail', 'settings', null, e.ref,
    format('%s auto-paused: guardrail %s breached — %s', e.ref, p_metric, p_detail),
    jsonb_build_object('metric', p_metric, 'detail', p_detail));
  return jsonb_build_object('ok', true, 'paused', e.ref);
end $$;
revoke all on function public.command_trip_guardrail(uuid, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_metric_defs','command_experiment_metrics',
                           'command_experiment_exposures','command_experiment_results'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
