-- EvoForge 102 — COMMAND: agent capability. Context, skills, routing, memory.
--
-- Phase 3. The audit's cost findings, in one place:
--
--   · every agent receives the work-order prompt and then explores the WHOLE
--     repository, with no compiled context and no retrieval budget
--   · every agent runs the same model regardless of task size
--   · retries re-run from zero with no memory of what the last attempt learned
--   · nothing records what any of it cost, so routing cannot improve
--
-- Each of those is money spent to rediscover something the system already knew.
--
-- WHAT THIS FILE ADDS
--   command_skills          — reusable procedures, versioned in the repo
--   command_context_packets — what was compiled for whom, and what it cost
--   model routing config    — in settings, so it is tunable without a deploy
--   command_relevant_lessons(paths, tags) — failure memory, retrievable BEFORE
--                             work starts rather than after it repeats
--
-- WHY LESSONS ARE RETRIEVED BY PATH. A lesson filed as prose is a diary entry.
-- One keyed to the files it was learned on can be handed to the next agent that
-- touches them, which is the only form in which a mistake costs full price once.
--
-- FALSIFICATION CHECKLIST:
--   1. a lesson tagged with a path is returned for that path and not for others.
--   2. a context packet records its level and estimated tokens.
--   3. routing config is readable and has a default for every risk level.
--   4. founders can SELECT the new tables and INSERT into none.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SKILLS — procedures that live in the repository, not in a giant prompt
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_skills (
  key           text primary key,
  title         text not null,
  purpose       text not null,
  -- The repo-relative file holding the procedure. The DB stores the CONTRACT;
  -- the file stores the steps, so a skill is reviewed like code and diffs like
  -- code rather than drifting inside a prompt string.
  path          text not null,
  applies_to    text[] not null default '{}',   -- path globs this skill serves
  required_inputs text[] not null default '{}',
  outputs       text[] not null default '{}',
  stop_conditions text[] not null default '{}',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

insert into public.command_skills (key,title,purpose,path,applies_to,required_inputs,outputs,stop_conditions) values
  ('investigate-production-error','Investigate a production error',
   'Turn an error signal into a reproducible defect with a named first failing step.',
   'skills/investigate-production-error.md',
   '{client/src/**}','{error signal,affected route}','{reproduction steps,root cause,proposed fix}',
   '{"cannot reproduce after two attempts","the cause is in a protected path"}'),
  ('fix-reproducible-bug','Fix a reproducible bug',
   'Repair a defect that already has reproduction steps, and prove it with a regression test.',
   'skills/fix-reproducible-bug.md',
   '{client/src/**}','{reproduction steps,acceptance criteria}','{patch,regression test}',
   '{"two materially similar repair attempts fail","the fix requires a schema change"}'),
  ('create-supabase-migration','Create a Supabase migration',
   'Author a numbered, reversible migration with a falsification checklist.',
   'skills/create-supabase-migration.md',
   '{migrations/**}','{schema change,risk level}','{migration file,falsification checklist}',
   '{"the change is destructive","no rollback exists"}'),
  ('verify-critical-user-flow','Verify a critical user flow',
   'Drive a real browser through a named journey and report the first failing step.',
   'skills/verify-critical-user-flow.md',
   '{client/src/app/**}','{journey name,environment}','{pass/fail,first failing step,screenshots}',
   '{"the environment is unavailable"}'),
  ('analyse-onboarding-funnel','Analyse the onboarding funnel',
   'Measure the activation ladder from analytics_events and state what is unknown.',
   'skills/analyse-onboarding-funnel.md',
   '{}','{date range}','{funnel figures,missing instrumentation}',
   '{"the required event does not exist — report it as missing, do not estimate"}')
on conflict (key) do update set
  title = excluded.title, purpose = excluded.purpose, path = excluded.path,
  applies_to = excluded.applies_to, required_inputs = excluded.required_inputs,
  outputs = excluded.outputs, stop_conditions = excluded.stop_conditions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONTEXT PACKETS — so the compiler can be judged, not just trusted
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_context_packets (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.command_work_orders(id) on delete cascade,
  task_id       uuid references public.command_tasks(id) on delete cascade,
  agent_key     text,
  -- 1 task+rules · 2 +architecture · 3 +source · 4 +history. Progressive
  -- retrieval: start at the cheapest level that can possibly work and escalate
  -- only on evidence that it could not.
  level         int not null check (level between 1 and 4),
  skill_key     text references public.command_skills(key),
  included      jsonb not null default '{}'::jsonb,   -- what went in
  est_tokens    int,
  lessons_used  int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists command_ctx_wo_idx on public.command_context_packets(work_order_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MODEL ROUTING — configurable, and recorded with its reason
-- ─────────────────────────────────────────────────────────────────────────────
insert into command_settings (key, value) values
  ('model_routing', $json${
    "default":        {"model": "sonnet", "why": "contained change in a known area"},
    "planning":       {"model": "opus",   "why": "decomposition and architecture need the strongest reasoning"},
    "high_risk":      {"model": "opus",   "why": "auth, schema, payments and privacy are unforgiving"},
    "recovery":       {"model": "opus",   "why": "a second attempt after a failure is exactly when cheap models loop"},
    "review":         {"model": "sonnet", "why": "routine review against stated criteria"},
    "docs":           {"model": "haiku",  "why": "summaries and documentation do not need a frontier model"},
    "escalate_after_attempts": 2
  }$json$::jsonb)
on conflict (key) do nothing;

comment on table public.command_context_packets is
  'Every compiled context, with its level and estimated size. Without this the '
  'compiler cannot be evaluated — and an unmeasured optimiser is a belief.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. FAILURE MEMORY — retrievable BEFORE the work, keyed to the files
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_relevant_lessons(
  p_paths text[] default '{}', p_tags text[] default '{}', p_limit int default 6
) returns setof public.command_lessons
language sql stable security definer set search_path = public as $$
  select l.* from command_lessons l
   where (coalesce(array_length(p_paths,1),0) = 0 and coalesce(array_length(p_tags,1),0) = 0)
      or l.paths && p_paths
      or l.tags  && p_tags
   order by
     -- A lesson about THESE files beats a lesson about this topic, which beats
     -- a lesson that merely exists. Failures repeat by location far more often
     -- than by theme.
     (l.paths && p_paths) desc,
     (l.tags  && p_tags)  desc,
     l.created_at desc
   limit greatest(p_limit, 1);
$$;
grant execute on function public.command_relevant_lessons(text[], text[], int) to authenticated;

-- Seed the memory with what THIS session cost to learn. Every one of these was
-- a real failure with a real diagnosis, and every one would otherwise be
-- rediscovered at full price by the next agent to touch the same files.
insert into public.command_lessons (kind,title,detail,tags,paths) values
  ('failure','git commit ran in the main repo, not the agent worktree',
   'git commit is the only git call that passes its message on stdin, so it used run() directly and kept the default cwd. git add -A staged the agent''s work in the worktree while git commit ran in the main checkout, found nothing staged, and failed. No agent commit succeeded for hours. When adding a git call, pass cwd explicitly.',
   '{git,worktree,runner}','{scripts/studio-runner.mjs}'),
  ('failure','git writes refusals to stdout, so stderr-only reporting says nothing',
   'A blocked task read "Commit failed: " with an empty reason because git prints "nothing added to commit" to STDOUT. Always report exit code, stderr AND stdout; when a command printed nothing, say so — silence usually means the process was killed rather than refused.',
   '{git,diagnostics}','{scripts/studio-runner.mjs}'),
  ('failure','a worker name is reused across restarts, so staleness cannot identify orphans',
   'Reclaiming dispatch rows by "the claiming worker is stale" fails: a restarted runner returns as runner@HOST, the same identity holding the orphans, so they look live. Use command_runners.started_at — a claim predating the current incarnation cannot belong to it.',
   '{runner,dispatch,reclaim}','{scripts/studio-runner.mjs,migrations/098_command_reclaim_stale.sql}'),
  ('failure','presence coupled to work made a busy runner look dead',
   'The heartbeat was a side effect of claiming, so a runner inside a 20-minute job never checked in and the floor called it offline — during the only period it was doing anything. Presence must run on its own timer.',
   '{runner,ui,honesty}','{scripts/studio-runner.mjs}'),
  ('failure','querying a jsonb key that does not exist reports a confident wrong number',
   'Pulse asked for props->>''name'' when the activation event''s key is ''step'', and reported the resulting null bucket as a finding: "Activation ladder: null=7". Verify the shape against real rows before trusting any aggregate.',
   '{analytics,evidence}','{scripts/pulse.mjs}'),
  ('decision','Vercel functions must be pinned to syd1',
   'Functions defaulted to iad1 (Washington DC) while Supabase is ap-southeast-2 (Sydney), making every query a trans-Pacific round trip. Pinning cut measured page loads from ~380ms to ~85ms. Region mismatch dominates every application-level optimisation.',
   '{performance,deployment}','{vercel.json}'),
  ('pattern','revalidatePath already refreshes the current route',
   'Four components called router.refresh() straight after a server action that had already called revalidatePath on the route they were on, costing two full server re-renders per click instead of one. Use one or the other.',
   '{performance,nextjs}','{src/app/actions.ts}')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_skills','command_context_packets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;
