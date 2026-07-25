-- EvoForge 106 — CATALYST, the product optimisation director.
--
-- Catalyst never writes production code, never builds UI, never implements a
-- feature. Its only job is to raise the rate at which EvoForge learns what
-- genuinely improves the product:
--
--   "Turn assumptions into measurable evidence."
--
-- IT IS MEASURED ON WHAT IT PREVENTS. Not experiments created, not reports
-- written, not ideas generated — all three are trivially gameable and all three
-- reward noise. Catalyst succeeds when a six-week feature nobody wanted is
-- replaced by a three-day experiment that says so, and the schema reflects that:
-- command_assumptions.avoided_days is a first-class column.
--
-- THE KNOWLEDGE GRAPH. Every finished experiment becomes permanent, retrievable
-- knowledge keyed to the feature it touched. EvoForge must not repeat a failed
-- experiment without explicitly saying why this time is different — which is
-- enforceable only if the previous result can be found, so command_knowledge is
-- searchable by feature and by tag.
--
-- FALSIFICATION CHECKLIST:
--   1. an assumption cannot be resolved without either an experiment or a reason.
--   2. re-proposing a superseded experiment surfaces the prior result.
--   3. learning ROI ranks a cheap decisive test above an expensive vague one.
--   4. founders read; they do not write.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ASSUMPTIONS — the raw material
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_assumptions (
  id            uuid primary key default gen_random_uuid(),
  statement     text not null,
  -- Where Catalyst found it: a work order's objective, a proposal's
  -- recommendation, a founder remark.
  source_kind   text not null check (source_kind in ('work_order','proposal','opportunity','founder','agent')),
  source_ref    text,
  source_id     uuid,
  detected_at   timestamptz not null default now(),
  -- How confident anyone actually is, 0..1. HIGH certainty makes an assumption
  -- NOT worth testing — that is the point of recording it.
  certainty     numeric(3,2) not null default 0.5 check (certainty between 0 and 1),
  -- What it would cost to be wrong.
  blast_radius  int not null default 3 check (blast_radius between 1 and 5),
  status        text not null default 'OPEN'
                check (status in ('OPEN','EXPERIMENT_PROPOSED','TESTING','RESOLVED','ACCEPTED_UNTESTED','DISMISSED')),
  experiment_id uuid references public.command_experiments(id),
  resolution    text,
  -- Catalyst's headline number: engineering days NOT spent because a cheap
  -- test answered the question first.
  avoided_days  numeric(6,1),
  created_at    timestamptz not null default now()
);

create index if not exists command_assumptions_status_idx on public.command_assumptions(status, detected_at desc);

-- An assumption cannot be closed silently. Either an experiment settled it, or
-- someone accepted it untested and said why — "we shipped it and stopped
-- thinking about it" is not a resolution.
create or replace function public.command_assumption_gate()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('RESOLVED','ACCEPTED_UNTESTED','DISMISSED')
     and new.status is distinct from old.status
     and new.experiment_id is null
     and coalesce(trim(new.resolution),'') = '' then
    raise exception 'command: an assumption cannot be closed without an experiment or a stated reason';
  end if;
  return new;
end $$;

drop trigger if exists command_assumption_gate_trg on public.command_assumptions;
create trigger command_assumption_gate_trg
  before update on public.command_assumptions
  for each row execute function public.command_assumption_gate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE KNOWLEDGE GRAPH — so a failure is never repeated by accident
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_knowledge (
  id            uuid primary key default gen_random_uuid(),
  experiment_id uuid references public.command_experiments(id) on delete set null,
  feature       text,
  hypothesis    text not null,
  result        text not null,
  outcome       text not null check (outcome in ('WIN','LOSS','NEUTRAL','INCONCLUSIVE')),
  winner        text,
  loser         text,
  metrics       jsonb not null default '{}'::jsonb,
  confidence    numeric(3,2),
  lesson        text not null,
  -- What NOT to try again, and what would have to be different to justify it.
  do_not_repeat text,
  tags          text[] not null default '{}',
  related_features text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists command_knowledge_feature_idx on public.command_knowledge(feature);
create index if not exists command_knowledge_tags_idx on public.command_knowledge using gin(tags);

/**
 * What has already been tried here.
 *
 * Called BEFORE proposing an experiment. An experiment that repeats a settled
 * question is the most expensive kind of waste — it costs the run AND the
 * decision it delays — and the only defence is being able to find the previous
 * answer at proposal time rather than after.
 */
create or replace function public.command_prior_knowledge(p_feature text, p_tags text[] default '{}')
returns setof public.command_knowledge
language sql stable security definer set search_path = public as $$
  select * from command_knowledge
   where (p_feature is not null and feature = p_feature)
      or tags && coalesce(p_tags, '{}')
      or p_feature = any(related_features)
   order by created_at desc limit 10;
$$;
grant execute on function public.command_prior_knowledge(text, text[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LEARNING ROI — Catalyst's ranking, components visible
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_experiments
  add column if not exists decision_value numeric(4,2) not null default 3,
  add column if not exists uncertainty    numeric(3,2) not null default 0.5,
  add column if not exists experiment_days numeric(5,1) not null default 3,
  add column if not exists build_days     numeric(6,1) not null default 10,
  add column if not exists days_to_learn  numeric(5,1) not null default 7;

/**
 * Learning per engineering day.
 *
 * Optimises for how much the studio LEARNS, not how much it builds. Testing
 * something everyone is already sure about scores near zero however large the
 * feature — the uncertainty term is doing that deliberately, because certainty
 * is worth nothing to buy.
 */
create or replace function public.command_learning_roi(e public.command_experiments)
returns numeric language sql stable as $$
  select round(
    ( greatest(e.decision_value, 0.01)
    * greatest(e.uncertainty, 0.01)
    * (1 + greatest(e.build_days - e.experiment_days, 0)) )
    /
    ( greatest(e.experiment_days, 0.5) * greatest(e.days_to_learn, 0.5) )
  , 3);
$$;
grant execute on function public.command_learning_roi(public.command_experiments) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE FOUNDER BRIEF — highest-value findings only
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_briefs (
  id            uuid primary key default gen_random_uuid(),
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  sections      jsonb not null default '{}'::jsonb,
  generated_at  timestamptz not null default now()
);

alter table public.command_briefs enable row level security;
drop policy if exists command_briefs_read on public.command_briefs;
create policy command_briefs_read on public.command_briefs for select using (public.is_founder());

-- Register Catalyst alongside the other capabilities.
insert into public.command_agents (key,name,title,kind,mandate,remit,permission,accent,can_block,sort,active)
values ('catalyst','Catalyst','Product Optimisation Director','director',
  'Turns assumptions into measurable evidence. Inspects work orders and proposals for unvalidated claims, proposes the cheapest experiment that could settle each one, ranks every proposal by learning per engineering day, and refuses experiments that cannot be decided. Never writes production code, never builds UI, never implements a feature. Measured on validated improvements and engineering time NOT spent — never on experiments created.',
  array['Assumption detection','Experiment design','Learning ROI','Experiment quality review','Knowledge graph','Founder brief'],
  'recommend','#A78BFA',true,15,true)
on conflict (key) do update set
  mandate = excluded.mandate, remit = excluded.remit, title = excluded.title, active = true;

do $$
declare t text;
begin
  foreach t in array array['command_assumptions','command_knowledge'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
revoke insert, update, delete on public.command_briefs from authenticated, anon;
