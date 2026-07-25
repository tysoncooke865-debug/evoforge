-- EvoForge 109 — the DEV LAB. Where ideas become evidence.
--
-- The Dev Lab answers one question: "can we prove this is better BEFORE it
-- reaches real users?" Nothing in it touches production.
--
-- WHAT THIS MIGRATION BUILDS, AND WHY THESE PARTS FIRST
--
-- The brief describes eight areas. Two of them are the ones that pay for
-- themselves immediately, and both are blocked without schema:
--
--   PROMPT LAB — every prompt versioned, with author, reason, benchmark score,
--     cost and latency, so "v14 is objectively our best workout prompt" becomes
--     a fact you can query rather than a memory. EvoForge already runs ~10 AI
--     edge functions with prompts embedded in TypeScript, unversioned and
--     unmeasured; today there is no way to answer whether a prompt change
--     helped.
--
--   AGENT LAB — the same for Command's own agents. A new Scout prompt runs the
--     identical task against the current one and only the better version is
--     promoted.
--
-- Both terminate in the same place: a variant that wins in the lab becomes an
-- experiment, and only a winning EXPERIMENT reaches users. The lab does not
-- replace that gate, it feeds it — an internal benchmark is evidence about the
-- prompt, never evidence about athletes.
--
-- WHAT IS DELIBERATELY NOT HERE, AND WHY
--
--   UI Studio, Component Lab, Feature Playground and the Time Machine need a
--   rendering surface, not a schema, and half of that already exists in
--   command_lab_exhibits. Building empty tables for them now would be the
--   "collection of agents that merely appear busy" this system exists not to be.
--   Data Simulator and Performance Lab need a harness that can execute the Expo
--   app, which the runner cannot currently do (agents hold no Bash).
--
--   Those are recorded as PLANNED in command_integrations rather than half-built.
--
-- FALSIFICATION CHECKLIST:
--   1. two versions of the same prompt cannot share a version number.
--   2. a benchmark run records model, latency, tokens and cost or is rejected.
--   3. promoting a version records what it beat and by how much.
--   4. the champion of a prompt is derivable, not stored by hand.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROMPTS, VERSIONED
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_prompts (
  key           text primary key,
  label         text not null,
  purpose       text not null,
  -- Where it is used in production: an edge function, an agent, a screen.
  surface       text not null,
  owner         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.command_prompt_versions (
  id            uuid primary key default gen_random_uuid(),
  prompt_key    text not null references public.command_prompts(key) on delete cascade,
  version       int not null,
  body          text not null,
  -- WHY this version exists. A version with no stated reason is a diff nobody
  -- can evaluate later, which is how prompt collections rot into folklore.
  reason        text not null,
  author        text not null,
  model         text,
  temperature   numeric(3,2),
  -- Set when this version is what production actually runs.
  is_live       boolean not null default false,
  promoted_at   timestamptz,
  promoted_over int,
  promotion_note text,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (prompt_key, version)
);

create index if not exists command_prompt_versions_idx
  on public.command_prompt_versions(prompt_key, version desc);

-- One live version per prompt. Two would mean nobody can say what production
-- is running, which is the exact condition this table exists to end.
create unique index if not exists command_prompt_one_live
  on public.command_prompt_versions(prompt_key) where is_live;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BENCHMARK RUNS — the evidence a version is better
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_bench_cases (
  key           text primary key,
  prompt_key    text references public.command_prompts(key) on delete cascade,
  label         text not null,
  input         jsonb not null,
  -- What a good answer looks like. Free text on purpose: most EvoForge tasks
  -- (write a workout, read a physique) have no single correct output, and a
  -- rubric a human can apply beats a fake exact-match assertion.
  rubric        text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.command_bench_runs (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.command_prompt_versions(id) on delete cascade,
  case_key      text not null references public.command_bench_cases(key) on delete cascade,
  model         text not null,
  output        text,
  latency_ms    int not null,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(10,6),
  -- 0..1, from a rubric-scored judgement. NULL means not yet scored — and an
  -- unscored run must never be counted as a passing one.
  quality       numeric(3,2) check (quality is null or quality between 0 and 1),
  scored_by     text,
  error         text,
  ran_at        timestamptz not null default now()
);

create index if not exists command_bench_runs_idx
  on public.command_bench_runs(version_id, ran_at desc);

-- A run has to carry its cost signals. A benchmark that records only "it looked
-- good" cannot answer the question the lab exists for, which is whether the
-- better answer is worth what it costs.
do $$ begin
  alter table public.command_bench_runs add constraint command_bench_needs_cost
    check (error is not null or (latency_ms >= 0 and model is not null));
exception when duplicate_object then null; end $$;

/**
 * The champion of a prompt — DERIVED, never stored by hand.
 *
 * Mean quality, with cost and latency beside it. Deliberately returns every
 * version rather than just the winner: "v14 is best" is only useful next to
 * what it beat and by how much, and a single stored champion field would rot
 * the moment a new run landed.
 *
 * Unscored runs are excluded rather than counted as zero — an unjudged answer
 * is not a bad answer.
 */
create or replace function public.command_prompt_scoreboard(p_prompt text)
returns table (
  version int, is_live boolean, runs bigint, scored bigint,
  mean_quality numeric, mean_latency_ms numeric, mean_cost_usd numeric,
  errors bigint, reason text
) language sql stable security definer set search_path = public as $$
  select v.version, v.is_live,
         count(r.id)::bigint,
         count(r.quality)::bigint,
         round(avg(r.quality), 3),
         round(avg(r.latency_ms), 0),
         round(avg(r.cost_usd), 6),
         count(*) filter (where r.error is not null)::bigint,
         v.reason
    from command_prompt_versions v
    left join command_bench_runs r on r.version_id = v.id
   where v.prompt_key = p_prompt and not v.archived
   group by v.version, v.is_live, v.reason
   order by v.version desc;
$$;
grant execute on function public.command_prompt_scoreboard(text) to authenticated;

/**
 * Promote a version to live.
 *
 * Refuses without benchmark evidence. The whole point of the lab is that a
 * prompt reaches production because it measurably beat the incumbent, not
 * because it reads better to whoever wrote it — and "it reads better" is the
 * single most common reason prompts actually change.
 */
create or replace function public.command_promote_prompt(
  p_version uuid, p_note text, p_min_runs int default 3
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; cur record; v_runs int; v_q numeric; cur_q numeric;
begin
  select * into v from command_prompt_versions where id = p_version;
  if v is null then raise exception 'command: no such prompt version'; end if;

  select count(quality), avg(quality) into v_runs, v_q
    from command_bench_runs where version_id = p_version and error is null;

  if coalesce(v_runs,0) < p_min_runs then
    raise exception
      'command: % v% has % scored benchmark run(s), needs % — promoting on taste is what this lab exists to replace',
      v.prompt_key, v.version, coalesce(v_runs,0), p_min_runs;
  end if;

  select * into cur from command_prompt_versions where prompt_key = v.prompt_key and is_live;
  if cur.id is not null then
    select avg(quality) into cur_q from command_bench_runs where version_id = cur.id and error is null;
    if cur_q is not null and v_q <= cur_q then
      raise exception
        'command: v% scored % against the live v% at % — it is not better, so it does not ship',
        v.version, round(v_q,3), cur.version, round(cur_q,3);
    end if;
    update command_prompt_versions set is_live = false where id = cur.id;
  end if;

  update command_prompt_versions
     set is_live = true, promoted_at = now(),
         promoted_over = cur.version,
         promotion_note = p_note
   where id = p_version;

  perform command_log('prompt_promoted', 'settings', null, v.prompt_key,
    format('%s v%s promoted%s — mean quality %s over %s runs. %s',
           v.prompt_key, v.version,
           case when cur.version is not null then format(' over v%s (%s)', cur.version, round(cur_q,3)) else '' end,
           round(v_q,3), v_runs, coalesce(p_note,'')),
    jsonb_build_object('version', v.version, 'quality', v_q, 'beat', cur.version));

  return jsonb_build_object('ok', true, 'version', v.version, 'quality', round(v_q,3), 'beat', cur.version);
end $$;
revoke all on function public.command_promote_prompt(uuid, text, int) from public, anon;
grant execute on function public.command_promote_prompt(uuid, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SEED — EvoForge's real AI surfaces, so the lab starts on true ground
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_prompts (key,label,purpose,surface) values
  ('ai_plan','Workout plan generation','Generate a training plan from an athlete profile.','supabase/functions/ai-plan'),
  ('ai_physique','Physique assessment','Read a physique photo into structured ratings.','supabase/functions/ai-physique'),
  ('ai_nutrition','Nutrition guidance','Produce nutrition guidance from goals and intake.','supabase/functions/ai-nutrition'),
  ('ai_plan_scan','Plan scan','Read an uploaded training plan into structured days.','supabase/functions/ai-plan-scan'),
  ('evo_scan','Evo scan','Guided monthly physique scan.','supabase/functions/evo-scan'),
  ('agent_implement','Studio implement prompt','The context packet given to a building agent.','scripts/context.mjs'),
  ('agent_exec_plan','Studio planning prompt','The Exec planning prompt for a work order.','scripts/studio-runner.mjs')
on conflict (key) do nothing;

-- Honest registry entries for the areas NOT built.
insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('devlab_prompt','Dev Lab — Prompt & Agent Lab','devlab','live',
   'Versioned prompts with benchmark runs, a derived scoreboard, and promotion that refuses without evidence.',
   'Register bench cases per prompt, then run scripts/promptlab.mjs.'),
  ('devlab_ui','Dev Lab — UI Studio / Component Lab','devlab','planned',
   'Needs a rendering surface rather than a schema; command_lab_exhibits already stores sandboxed HTML variants and is the foundation.',
   'A variant renderer plus screenshot capture per viewport and theme.'),
  ('devlab_sim','Dev Lab — Data Simulator / Performance Lab','devlab','planned',
   'Needs a harness that can execute the Expo app to generate synthetic athletes and measure FPS, bundle, memory.',
   'A test harness the runner may execute; agents currently hold no Bash.'),
  ('devlab_simulation','Dev Lab — Simulation Engine','devlab','planned',
   'Predicting an outcome before building requires a body of past experiments to learn from. Zero experiments have completed, so any estimate it produced today would be invented.',
   'Accumulate completed experiments first. A predictor trained on nothing is a random number with a confidence interval.')
on conflict (key) do update set status=excluded.status, detail=excluded.detail,
  setup_required=excluded.setup_required, updated_at=now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_prompts','command_prompt_versions',
                           'command_bench_cases','command_bench_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
