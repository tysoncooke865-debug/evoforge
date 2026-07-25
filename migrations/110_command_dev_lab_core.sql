-- EvoForge 110 — the DEV LAB, in full. Where ideas become evidence.
--
-- 109 built the Prompt and Agent labs and deliberately deferred the rest,
-- because the deferred parts needed something to EXECUTE them and nothing could.
-- That is what this migration fixes, and the fix is one table:
-- command_lab_jobs.
--
-- WHY A JOB QUEUE IS THE WHOLE UNLOCK
--
--   The Command site runs on Vercel. It cannot spawn the Claude CLI, it cannot
--   drive a browser, and it cannot read the product repository. The machine that
--   CAN do all three is the one already running the studio runner, and it is
--   behind a home router with nothing inbound.
--
--   So the browser does not execute anything. It writes a row. A worker on the
--   local machine claims that row on its own poll and does the real work —
--   a real model call with real token counts, a real Chrome with real Web
--   Vitals — and writes the result back. The same shape that already makes the
--   runner start and stop from the Floor with no inbound connection at all.
--
--   Every "generate", "benchmark", "capture", "measure" and "simulate" button in
--   the Dev Lab is therefore a real measurement or it is nothing. There is no
--   third option in which it looks live and is not, because there is no code
--   path that could produce a number without a worker having produced it.
--
-- WHAT IS DELIBERATELY NOT MEASURED
--
--   Battery drain and native-thread FPS need a physical device running the Expo
--   build. Chrome headless cannot produce either, so neither has a column here.
--   An honest absence beats a plausible number: see command_integrations, which
--   records exactly what the Performance Lab can and cannot see.
--
-- FALSIFICATION CHECKLIST (scripts/_falsify110.mjs):
--   1. two workers cannot claim the same job.
--   2. a capture must name what it captured — variant or url, never neither.
--   3. a perf run carries measurements or an error, never neither.
--   4. an arena match cannot be decided without a method and its evidence.
--   5. a prediction with a point estimate must cite at least one real prior;
--      with no priors it is marked insufficient and carries no estimate.
--   6. simulated athletes cannot be laundered into command_evidence.
--   7. two variants of one subject cannot share a version number.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SUBJECTS AND VARIANTS — UI Studio, Component Lab, Feature Playground
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A subject is the thing being varied: a screen, a component, a feature, a flow.
 *
 * `surface` names the REAL file in the product repo it corresponds to. A lab
 * that varies imaginary screens teaches nothing, and the surface is what lets a
 * winning variant become a work order that says where to apply it.
 */
create table if not exists public.command_lab_subjects (
  key         text primary key,
  kind        text not null check (kind in ('screen','component','feature','flow')),
  label       text not null,
  purpose     text not null,
  surface     text,
  sort        int  not null default 100,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

/**
 * One version of one subject.
 *
 * `tokens` holds EvoForge's real design tokens (client/src/theme/tokens.js) with
 * whatever this variant overrides. `html` is the body. The renderer composes
 * them into a document served into a null-origin sandbox — so a variant is a
 * thing you can LOOK at, which is the entire point of a UI studio, while still
 * being unable to reach anything.
 *
 * `parent_id` gives lineage, and lineage is what makes the Time Machine real:
 * the history of a screen is a chain of rows with true timestamps, not a
 * reconstruction.
 */
create table if not exists public.command_lab_variants (
  id            uuid primary key default gen_random_uuid(),
  subject_key   text not null references public.command_lab_subjects(key) on delete cascade,
  version       int  not null,
  label         text not null,
  -- hand = a founder or agent wrote it; generated = the AI Design Generator
  -- produced it from a stated goal; imported = lifted from the live product.
  origin        text not null default 'hand' check (origin in ('hand','generated','imported')),
  -- WHY this variant exists. Same rule as prompt versions: a variant with no
  -- stated intent cannot be judged later, only admired.
  reason        text not null,
  author        text not null,
  html          text not null default '',
  css           text not null default '',
  tokens        jsonb not null default '{}'::jsonb,
  -- For generated variants: the objective it was asked to optimise for, and the
  -- model that produced it. Both are needed to read the result honestly.
  goal          text,
  model         text,
  parent_id     uuid references public.command_lab_variants(id) on delete set null,
  -- Set when this variant has been carried into a real experiment.
  experiment_id uuid references public.command_experiments(id) on delete set null,
  archived      boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (subject_key, version)
);

create index if not exists command_lab_variants_idx
  on public.command_lab_variants(subject_key, version desc);
create index if not exists command_lab_variants_time_idx
  on public.command_lab_variants(created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CAPTURES — what a thing actually looked like, at a real moment
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A screenshot taken by real Chrome, stored in the `lab` bucket.
 *
 * Either of a lab variant or of a live URL. The second is what makes the Time
 * Machine more than a diff of our own drafts: capture the deployed app weekly
 * and you can scrub the product's actual evolution, not the evolution of the
 * files we happened to keep.
 */
create table if not exists public.command_lab_captures (
  id           uuid primary key default gen_random_uuid(),
  variant_id   uuid references public.command_lab_variants(id) on delete cascade,
  subject_key  text references public.command_lab_subjects(key) on delete set null,
  url          text,
  label        text not null,
  viewport     text not null default 'phone' check (viewport in ('phone','tablet','desktop')),
  width        int  not null,
  height       int  not null,
  -- Path inside the `lab` storage bucket.
  storage_path text not null,
  bytes        int,
  captured_by  text not null default 'playwright',
  captured_at  timestamptz not null default now()
);

-- A screenshot that names neither a variant nor a URL is a picture of nothing,
-- and nothing is what it would later be cited as evidence of.
do $$ begin
  alter table public.command_lab_captures add constraint command_capture_has_subject
    check (variant_id is not null or url is not null);
exception when duplicate_object then null; end $$;

create index if not exists command_lab_captures_idx
  on public.command_lab_captures(subject_key, captured_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PERFORMANCE LAB — real numbers from a real browser
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * One measurement run.
 *
 * Every column here is something Chrome actually reports: PerformanceObserver
 * for the paint and layout metrics, CDP for heap and CPU, the Resource Timing
 * entries for bytes on the wire, and a requestAnimationFrame sampler for frame
 * rate. Nothing is modelled or estimated.
 *
 * Absent on purpose: battery and native-thread FPS. Headless Chrome cannot see
 * either, and a column would invite an agent to fill it.
 */
create table if not exists public.command_perf_runs (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  url            text not null,
  variant_id     uuid references public.command_lab_variants(id) on delete set null,
  viewport       text not null default 'phone',
  width          int  not null default 390,
  height         int  not null default 844,
  cpu_throttle   numeric(4,1) not null default 1,
  network        text not null default 'none',

  ttfb_ms        int,
  fcp_ms         int,
  lcp_ms         int,
  cls            numeric(6,4),
  tbt_ms         int,
  load_ms        int,
  dom_nodes      int,
  js_heap_bytes  bigint,
  long_tasks     int,
  long_task_ms   int,
  requests       int,
  transfer_bytes bigint,
  script_bytes   bigint,
  style_bytes    bigint,
  image_bytes    bigint,
  fps_mean       numeric(5,2),
  fps_min        numeric(5,2),
  frames         int,
  -- The raw resource table, so a regression can be read down to the request.
  detail         jsonb not null default '{}'::jsonb,
  error          text,
  measured_by    text not null default 'playwright/chromium',
  ran_at         timestamptz not null default now()
);

-- A run that recorded neither a measurement nor a failure is a row that will be
-- averaged into a comparison as if it were a success.
do $$ begin
  alter table public.command_perf_runs add constraint command_perf_measured_or_failed
    check (error is not null or lcp_ms is not null or load_ms is not null);
exception when duplicate_object then null; end $$;

create index if not exists command_perf_runs_idx on public.command_perf_runs(label, ran_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DATA SIMULATOR — synthetic athletes, permanently labelled as such
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * A synthetic athlete.
 *
 * Deterministic: the same seed and archetype always produce the same profile, so
 * a benchmark run against "beginner_male_18" in June is comparable with the same
 * persona in December. A randomly regenerated cohort would silently invalidate
 * every comparison made against it.
 *
 * These exist to exercise onboarding and prompts without a real user. They are
 * not users, they have no opinions, and the trigger below is what stops anyone
 * pretending otherwise.
 */
create table if not exists public.command_personas (
  key         text primary key,
  label       text not null,
  archetype   text not null,
  seed        bigint not null,
  profile     jsonb not null,
  narrative   text,
  -- Not a flag anyone may set to false. It exists so that every consumer of this
  -- table reads the word "synthetic" without having to know where the row came
  -- from.
  synthetic   boolean not null default true check (synthetic),
  created_by  text not null default 'simulator',
  created_at  timestamptz not null default now()
);

/**
 * Simulated evidence must never become real evidence.
 *
 * The pathway this closes is specific and was easy to imagine: an agent runs a
 * cohort through onboarding, sees 8 of 12 synthetic athletes stall, and files
 * "67% of users stall at step 3" as a fact. It would be sourced, it would have
 * an excerpt, it would pass every guard 099 put in place — and it would be about
 * nobody.
 */
create or replace function public.command_refuse_simulated_evidence()
returns trigger language plpgsql as $$
begin
  if new.source_ref like 'persona:%' or new.source_ref like 'sim:%'
     or new.payload ? 'persona_key' or new.payload ? 'simulated'
     or new.collected_by like 'sim%' then
    raise exception
      'command: % is a simulated result, and a simulation is evidence about a prompt, never about an athlete',
      coalesce(new.source_ref, new.collected_by);
  end if;
  return new;
end $$;

drop trigger if exists command_evidence_no_simulation on public.command_evidence;
create trigger command_evidence_no_simulation
  before insert or update on public.command_evidence
  for each row execute function public.command_refuse_simulated_evidence();

-- Bench cases may be driven by a persona. This is the join that lets "run the
-- workout prompt against 12 different athletes" be one command.
alter table public.command_bench_cases
  add column if not exists persona_key text references public.command_personas(key) on delete set null;

-- Which provider produced a benchmark run. Claude is executed through the local
-- CLI; anything else needs a key this project does not hold, and the lab reports
-- that rather than quietly comparing Claude with itself.
alter table public.command_bench_runs
  add column if not exists provider text not null default 'anthropic';
alter table public.command_bench_runs
  add column if not exists judge_note text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE JOB QUEUE — the browser asks, the local machine does
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_lab_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in
                  ('bench','judge','capture','perf','generate','simulate','arena','predict','import')),
  label         text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                  check (status in ('queued','running','done','failed','cancelled')),
  requested_by  text not null default 'founder',
  worker        text,
  progress      int  not null default 0 check (progress between 0 and 100),
  activity      text,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz
);

create index if not exists command_lab_jobs_queue_idx
  on public.command_lab_jobs(status, created_at);

-- Realtime, so the lab updates as work happens rather than on a timer.
do $$ begin
  alter publication supabase_realtime add table public.command_lab_jobs;
exception when duplicate_object then null; when undefined_object then null; end $$;

/** Queue a job. Founder-callable, audited, and it executes nothing itself. */
create or replace function public.command_lab_enqueue(
  p_kind text, p_label text, p_payload jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;

  insert into command_lab_jobs (kind, label, payload, requested_by)
  values (p_kind, p_label, coalesce(p_payload,'{}'::jsonb),
          coalesce((select name from command_founders where user_id = auth.uid()), 'founder'))
  returning id into v_id;

  perform command_log('lab_job_queued', 'settings', v_id, p_kind,
    format('queued %s — %s', p_kind, p_label), jsonb_build_object('payload', p_payload));
  return v_id;
end $$;
revoke all on function public.command_lab_enqueue(text,text,jsonb) from public, anon;
grant execute on function public.command_lab_enqueue(text,text,jsonb) to authenticated;

/**
 * Claim one job, atomically.
 *
 * `for update skip locked` is the whole guard: two workers polling the same
 * second take different rows instead of both taking the oldest one and doing the
 * work twice. The runner learned this lesson on command_dispatch; the lab starts
 * with it.
 */
create or replace function public.command_lab_claim(p_worker text, p_kinds text[] default null)
returns public.command_lab_jobs language plpgsql security definer set search_path = public as $$
declare v_job command_lab_jobs;
begin
  select * into v_job from command_lab_jobs
   where status = 'queued' and (p_kinds is null or kind = any(p_kinds))
   order by created_at
   for update skip locked
   limit 1;
  if v_job.id is null then return null; end if;

  update command_lab_jobs
     set status='running', worker=p_worker, claimed_at=now(), progress=1, activity='claimed'
   where id = v_job.id
   returning * into v_job;
  return v_job;
end $$;

create or replace function public.command_lab_progress(p_job uuid, p_pct int, p_activity text)
returns void language sql security definer set search_path = public as $$
  update command_lab_jobs
     set progress = greatest(progress, least(99, greatest(0, p_pct))), activity = p_activity
   where id = p_job and status = 'running';
$$;

create or replace function public.command_lab_finish(
  p_job uuid, p_ok boolean, p_result jsonb default '{}'::jsonb, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_job command_lab_jobs;
begin
  update command_lab_jobs
     set status = case when p_ok then 'done' else 'failed' end,
         progress = 100, finished_at = now(),
         result = p_result, error = p_error, activity = case when p_ok then 'finished' else 'failed' end
   where id = p_job
   returning * into v_job;

  if v_job.id is not null then
    perform command_log(
      case when p_ok then 'lab_job_done' else 'lab_job_failed' end,
      'settings', v_job.id, v_job.kind,
      format('%s %s — %s', v_job.kind, case when p_ok then 'finished' else 'failed' end, v_job.label),
      coalesce(p_result,'{}'::jsonb), 'agent', coalesce(v_job.worker,'lab-worker'));
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. CHALLENGE ARENA — two ideas fight, and the winner has to have won
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_arena_tournaments (
  id          uuid primary key default gen_random_uuid(),
  ref         text unique not null,
  kind        text not null check (kind in ('prompt','variant')),
  subject     text not null,
  goal        text not null,
  status      text not null default 'open' check (status in ('open','running','complete','abandoned')),
  round       int  not null default 1,
  winner_id   uuid,
  created_by  text not null default 'founder',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create table if not exists public.command_arena_entrants (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.command_arena_tournaments(id) on delete cascade,
  -- A prompt version or a lab variant. Both are uuid primary keys, and the
  -- tournament's `kind` says which table to read.
  entrant_id    uuid not null,
  label         text not null,
  seed          int  not null,
  eliminated_in int,
  unique (tournament_id, entrant_id)
);

create table if not exists public.command_arena_matches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.command_arena_tournaments(id) on delete cascade,
  round         int  not null,
  slot          int  not null,
  a_id          uuid,
  b_id          uuid,
  winner_id     uuid,
  -- HOW it was decided. 'bench' = mean quality over recorded benchmark runs.
  -- 'judge' = a model comparing both outputs against the goal. 'bye' = one
  -- entrant, no contest. A winner with no method is a coin toss with a rosette.
  method        text check (method in ('bench','judge','perf','bye')),
  rationale     text,
  evidence      jsonb,
  decided_at    timestamptz,
  unique (tournament_id, round, slot)
);

-- A decided match must say how, and show its working.
do $$ begin
  alter table public.command_arena_matches add constraint command_arena_decided_with_evidence
    check (winner_id is null or (method is not null and (method = 'bye' or evidence is not null)));
exception when duplicate_object then null; end $$;

/**
 * Open a tournament and seed round 1.
 *
 * Byes are placed at the TOP of the bracket rather than randomly, so a field of
 * five does not hand a random entrant a free pass into a final it never earned.
 */
create or replace function public.command_arena_open(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_ref text; v_ids uuid[]; v_labels text[]; v_n int; v_slot int := 1; i int;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;

  v_ids := array(select (jsonb_array_elements_text(p->'entrants'))::uuid);
  v_n := coalesce(array_length(v_ids,1), 0);
  if v_n < 2 then
    raise exception 'command: a tournament needs at least two entrants, got %', v_n;
  end if;

  select 'ARENA-' || lpad((count(*)+1)::text, 3, '0') into v_ref from command_arena_tournaments;

  insert into command_arena_tournaments (ref, kind, subject, goal, status, created_by)
  values (v_ref, p->>'kind', p->>'subject', p->>'goal', 'running',
          coalesce((select name from command_founders where user_id = auth.uid()), 'founder'))
  returning id into v_id;

  v_labels := array(select jsonb_array_elements_text(coalesce(p->'labels', '[]'::jsonb)));
  for i in 1..v_n loop
    insert into command_arena_entrants (tournament_id, entrant_id, label, seed)
    values (v_id, v_ids[i], coalesce(v_labels[i], 'entrant ' || i), i);
  end loop;

  -- Pair from the outside in: 1 v n, 2 v n-1 … an odd entrant takes a bye.
  i := 1;
  while i < v_n - i + 1 loop
    insert into command_arena_matches (tournament_id, round, slot, a_id, b_id)
    values (v_id, 1, v_slot, v_ids[i], v_ids[v_n - i + 1]);
    v_slot := v_slot + 1; i := i + 1;
  end loop;
  if i = v_n - i + 1 then
    insert into command_arena_matches (tournament_id, round, slot, a_id, b_id, winner_id, method, rationale, decided_at)
    values (v_id, 1, v_slot, v_ids[i], null, v_ids[i], 'bye', 'odd field — no opponent in round 1', now());
  end if;

  perform command_log('arena_opened', 'settings', v_id, v_ref,
    format('%s opened with %s entrants — %s', v_ref, v_n, p->>'goal'), p);

  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'entrants', v_n);
end $$;
revoke all on function public.command_arena_open(jsonb) from public, anon;
grant execute on function public.command_arena_open(jsonb) to authenticated;

/**
 * Record a decision, then advance the bracket if the round is complete.
 *
 * The advance is automatic because a half-advanced bracket is a bracket someone
 * has to remember to finish, and nobody ever does.
 */
create or replace function public.command_arena_decide(
  p_match uuid, p_winner uuid, p_method text, p_rationale text, p_evidence jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare m command_arena_matches; t command_arena_tournaments;
        v_open int; v_winners uuid[]; v_slot int := 1; i int; v_n int;
begin
  select * into m from command_arena_matches where id = p_match;
  if m.id is null then raise exception 'command: no such match'; end if;
  if p_winner is distinct from m.a_id and p_winner is distinct from m.b_id then
    raise exception 'command: the winner must be one of the two entrants';
  end if;

  update command_arena_matches
     set winner_id = p_winner, method = p_method, rationale = p_rationale,
         evidence = p_evidence, decided_at = now()
   where id = p_match;

  update command_arena_entrants set eliminated_in = m.round
   where tournament_id = m.tournament_id
     and entrant_id = case when p_winner = m.a_id then m.b_id else m.a_id end;

  select count(*) into v_open from command_arena_matches
   where tournament_id = m.tournament_id and round = m.round and winner_id is null;
  if v_open > 0 then
    return jsonb_build_object('ok', true, 'round_open', v_open);
  end if;

  select array_agg(winner_id order by slot) into v_winners
    from command_arena_matches where tournament_id = m.tournament_id and round = m.round;
  v_n := coalesce(array_length(v_winners,1), 0);

  select * into t from command_arena_tournaments where id = m.tournament_id;

  if v_n <= 1 then
    update command_arena_tournaments
       set status='complete', winner_id = v_winners[1], decided_at = now(), round = m.round
     where id = m.tournament_id;
    perform command_log('arena_decided', 'settings', t.id, t.ref,
      format('%s decided — winner %s after %s round(s)', t.ref, v_winners[1], m.round),
      jsonb_build_object('winner', v_winners[1], 'rounds', m.round));
    return jsonb_build_object('ok', true, 'complete', true, 'winner', v_winners[1]);
  end if;

  i := 1;
  while i < v_n - i + 1 loop
    insert into command_arena_matches (tournament_id, round, slot, a_id, b_id)
    values (m.tournament_id, m.round + 1, v_slot, v_winners[i], v_winners[v_n - i + 1]);
    v_slot := v_slot + 1; i := i + 1;
  end loop;
  if i = v_n - i + 1 then
    insert into command_arena_matches (tournament_id, round, slot, a_id, b_id, winner_id, method, rationale, decided_at)
    values (m.tournament_id, m.round + 1, v_slot, v_winners[i], null, v_winners[i], 'bye',
            'odd field — no opponent this round', now());
  end if;

  update command_arena_tournaments set round = m.round + 1 where id = m.tournament_id;
  return jsonb_build_object('ok', true, 'advanced_to', m.round + 1);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SIMULATION ENGINE — a prediction that cannot be invented
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * "If we ship this, what is likely to happen?"
 *
 * The honest answer, most of the time, is "we do not have enough history to
 * say", and this table can express exactly that. `insufficient` is not a failure
 * state; it is the correct output when nothing real supports an estimate, and
 * the CHECK below makes it the ONLY available output in that case.
 *
 * `basis` is the working: the ids of the experiments, releases, knowledge
 * entries and evidence rows the estimate came from. A prediction is only as good
 * as what it cites, so it has to cite.
 *
 * `actual_delta` closes the loop. A prediction nobody scores is astrology; once
 * enough are resolved, command_prediction_accuracy() says whether this engine
 * has ever been right, which is the only number that should decide whether
 * anyone listens to it.
 */
create table if not exists public.command_predictions (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique not null,
  subject           text not null,
  question          text not null,
  metric_key        text,
  baseline          numeric,
  expected_delta    numeric,
  ci_low            numeric,
  ci_high           numeric,
  confidence        numeric(3,2) check (confidence is null or confidence between 0 and 1),
  engineering_cost  text check (engineering_cost is null or engineering_cost in ('low','medium','high')),
  risk              text check (risk is null or risk in ('LOW','MEDIUM','HIGH')),
  recommendation    text,
  basis             jsonb not null default '[]'::jsonb,
  prior_count       int  not null default 0,
  insufficient      boolean not null default false,
  insufficient_reason text,
  variant_id        uuid references public.command_lab_variants(id) on delete set null,
  experiment_id     uuid references public.command_experiments(id) on delete set null,
  created_by        text not null default 'simulation-engine',
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  actual_delta      numeric,
  accuracy_note     text
);

-- THE GUARD. Either it cites real priors and may carry an estimate, or it says
-- it cannot and carries none. There is no middle row in which a number appears
-- with nothing behind it.
do $$ begin
  alter table public.command_predictions add constraint command_prediction_earns_its_number
    check (
      (insufficient and expected_delta is null and insufficient_reason is not null)
      or (not insufficient and prior_count > 0 and expected_delta is not null)
    );
exception when duplicate_object then null; end $$;

/**
 * Build a prediction from what is actually known.
 *
 * The priors, in order of weight:
 *   1. completed experiments on the same metric — the only real causal evidence
 *      this system can ever have, because they had a control group;
 *   2. classified releases on the same metric — before/after, confounded, and
 *      weighted down accordingly;
 *   3. knowledge entries tagged to the feature — what was learned last time.
 *
 * With none of those, it returns insufficient. That is not the engine failing;
 * it is the engine refusing to make something up, which is the single most
 * valuable thing it does. The first version of this system would have been asked
 * to predict on an empty history, and a number produced then would have been
 * anchored to for months.
 */
create or replace function public.command_predict(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_metric text := p->>'metric_key';
  v_ref text; v_id uuid;
  -- Scalars rather than records: `select count(*) into rec` names the field
  -- "count", and a typo on a record field is a runtime error rather than a
  -- compile one. These are the numbers the estimate is built from, so they are
  -- spelled out.
  v_exp_n int; v_exp_mean numeric; v_exp_sd numeric;
  v_rel_n int; v_rel_mean numeric; v_know int;
  v_basis jsonb := '[]'::jsonb; v_n int := 0;
  v_delta numeric; v_lo numeric; v_hi numeric; v_conf numeric; v_sd numeric;
  v_risk text; v_reco text; v_baseline numeric;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;

  -- 1. Experiments: real control groups.
  --
  -- command_experiment_results stores one row per ARM, not a delta, so the
  -- effect has to be computed by pairing the treatment arm against its control.
  -- Rows flagged unavailable are excluded rather than read as zero — "we could
  -- not measure it" and "it did not move" are different findings, and conflating
  -- them would drag every estimate toward no-effect.
  with paired as (
    select e.id,
           max(r.value) filter (where r.variant = coalesce(e.variant, 'variant')) as treated,
           max(r.value) filter (where r.variant = coalesce(e.control, 'control')) as control
      from command_experiment_results r
      join command_experiments e on e.id = r.experiment_id
     where r.metric_key = v_metric
       and r.available
       and e.status in ('DECIDED','ROLLED_OUT')
     group by e.id
  )
  select count(*)::int, avg((treated - control) / abs(nullif(control,0))),
         stddev_samp((treated - control) / abs(nullif(control,0)))
    into v_exp_n, v_exp_mean, v_exp_sd
    from paired where treated is not null and control is not null and control <> 0;

  -- 2. Releases: before/after, no control. Counted, weighted less.
  select count(*)::int, avg(
           case when r.baseline_value is not null and r.baseline_value <> 0
                then (r.after_value - r.baseline_value) / abs(r.baseline_value)
                else null end)
    into v_rel_n, v_rel_mean
    from command_releases r
   where r.primary_metric = v_metric and r.outcome is not null and r.after_value is not null;

  -- 3. Knowledge tagged to the feature.
  select count(*)::int into v_know from command_knowledge
   where feature = p->>'subject' or tags && array(select jsonb_array_elements_text(coalesce(p->'tags','[]'::jsonb)));

  v_n := coalesce(v_exp_n,0) + coalesce(v_rel_n,0);

  if v_n = 0 then
    select 'PRED-' || lpad((count(*)+1)::text, 3, '0') into v_ref from command_predictions;
    insert into command_predictions (ref, subject, question, metric_key, basis, prior_count,
                                     insufficient, insufficient_reason, variant_id)
    values (v_ref, p->>'subject', p->>'question', v_metric, '[]'::jsonb, v_know,
            true,
            format('No completed experiment and no classified release has ever measured %s. '
                || 'An estimate now would be a number with nothing behind it. '
                || '%s knowledge entr%s exist on this feature — read those, run the experiment, '
                || 'and this becomes answerable.',
                coalesce(v_metric,'this metric'), v_know, case when v_know = 1 then 'y' else 'ies' end),
            nullif(p->>'variant_id','')::uuid)
    returning id into v_id;

    return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'insufficient', true);
  end if;

  -- Weighted mean: an experiment is worth three confounded before/afters.
  v_delta := (coalesce(v_exp_mean,0) * coalesce(v_exp_n,0) * 3
            + coalesce(v_rel_mean,0) * coalesce(v_rel_n,0))
           / nullif(coalesce(v_exp_n,0) * 3 + coalesce(v_rel_n,0), 0);

  -- Spread. With one prior there is no sample deviation, so the interval is
  -- deliberately wide rather than absent — one data point is a direction, not a
  -- distribution.
  v_sd := coalesce(v_exp_sd, abs(v_delta) * 0.75, 0.05);
  v_lo := v_delta - 1.96 * v_sd;
  v_hi := v_delta + 1.96 * v_sd;

  -- Confidence rises with priors and falls with spread, and is capped at 0.75.
  -- Nothing this system can currently know justifies more.
  v_conf := least(0.75, round(
      (0.25 + 0.09 * least(coalesce(v_exp_n,0), 4) + 0.03 * least(coalesce(v_rel_n,0), 4))
      * (1 - least(0.5, v_sd / nullif(abs(v_delta) + v_sd, 0)))::numeric, 2));

  select after_value into v_baseline from command_releases
   where primary_metric = v_metric and after_value is not null
   order by created_at desc limit 1;

  v_risk := coalesce(p->>'risk', 'LOW');
  v_reco := case
    when v_lo > 0 and v_conf >= 0.5 then 'Proceed to experiment — every prior on this metric moved the same way.'
    when v_hi < 0 then 'Do not build. The priors point the wrong way; test the assumption first.'
    else 'Proceed to experiment, but size it to detect this interval — the priors do not agree on direction.'
  end;

  v_basis := (
    select coalesce(jsonb_agg(distinct jsonb_build_object(
             'kind','experiment','ref',e.ref,'metric',r.metric_key,'status',e.status)), '[]'::jsonb)
      from command_experiment_results r join command_experiments e on e.id = r.experiment_id
     where r.metric_key = v_metric and r.available and e.status in ('DECIDED','ROLLED_OUT')
  ) || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind','release','ref',r.ref,'outcome',r.outcome,
             'baseline',r.baseline_value,'after',r.after_value)), '[]'::jsonb)
      from command_releases r
     where r.primary_metric = v_metric and r.outcome is not null and r.after_value is not null
  );

  select 'PRED-' || lpad((count(*)+1)::text, 3, '0') into v_ref from command_predictions;
  insert into command_predictions (
    ref, subject, question, metric_key, baseline, expected_delta, ci_low, ci_high,
    confidence, engineering_cost, risk, recommendation, basis, prior_count, variant_id)
  values (v_ref, p->>'subject', p->>'question', v_metric, v_baseline,
          round(v_delta,4), round(v_lo,4), round(v_hi,4), v_conf,
          coalesce(p->>'engineering_cost','medium'), v_risk, v_reco, v_basis, v_n,
          nullif(p->>'variant_id','')::uuid)
  returning id into v_id;

  perform command_log('prediction_made', 'settings', v_id, v_ref,
    format('%s — %s expected %s on %s from %s prior(s), confidence %s',
           v_ref, p->>'subject', round(v_delta,4), v_metric, v_n, v_conf), v_basis);

  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'expected_delta', round(v_delta,4),
                            'confidence', v_conf, 'priors', v_n);
end $$;
revoke all on function public.command_predict(jsonb) from public, anon;
grant execute on function public.command_predict(jsonb) to authenticated;

/** Score a past prediction against what actually happened. */
create or replace function public.command_resolve_prediction(
  p_id uuid, p_actual numeric, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v command_predictions;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  select * into v from command_predictions where id = p_id;
  if v.id is null then raise exception 'command: no such prediction'; end if;
  if v.insufficient then
    raise exception 'command: % made no estimate, so there is nothing to score', v.ref;
  end if;
  if coalesce(trim(p_note),'') = '' then
    raise exception 'command: say what actually happened — a resolved prediction with no note teaches nothing';
  end if;

  update command_predictions
     set actual_delta = p_actual, accuracy_note = p_note, resolved_at = now()
   where id = p_id;

  perform command_log('prediction_resolved', 'settings', v.id, v.ref,
    format('%s predicted %s, actual %s — %s', v.ref, v.expected_delta, p_actual, p_note),
    jsonb_build_object('predicted', v.expected_delta, 'actual', p_actual));
  return jsonb_build_object('ok', true, 'error', round(abs(p_actual - v.expected_delta), 4));
end $$;
revoke all on function public.command_resolve_prediction(uuid, numeric, text) from public, anon;
grant execute on function public.command_resolve_prediction(uuid, numeric, text) to authenticated;

/** Has this engine ever been right? Derived, so it cannot be talked up. */
create or replace function public.command_prediction_accuracy()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'resolved', count(*),
    'inside_interval', count(*) filter (where actual_delta between ci_low and ci_high),
    'mean_abs_error', round(avg(abs(actual_delta - expected_delta)), 4),
    'direction_right', count(*) filter (where sign(actual_delta) = sign(expected_delta)),
    'unresolved', (select count(*) from command_predictions where resolved_at is null and not insufficient),
    'insufficient', (select count(*) from command_predictions where insufficient))
  from command_predictions where resolved_at is not null;
$$;
grant execute on function public.command_prediction_accuracy() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. VARIANT WRITES
-- ─────────────────────────────────────────────────────────────────────────────

/** Save a variant. Version is assigned by the database, never by the caller. */
create or replace function public.command_lab_save_variant(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_version int; v_key text := p->>'subject_key'; v_author text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p->>'reason'),'') = '' then
    raise exception 'command: say why this variant exists — an unexplained variant cannot be judged later';
  end if;
  if not exists (select 1 from command_lab_subjects where key = v_key) then
    raise exception 'command: no lab subject %', v_key;
  end if;

  v_author := coalesce(p->>'author', (select name from command_founders where user_id = auth.uid()), 'founder');
  select coalesce(max(version),0) + 1 into v_version from command_lab_variants where subject_key = v_key;

  insert into command_lab_variants (subject_key, version, label, origin, reason, author,
                                    html, css, tokens, goal, model, parent_id)
  values (v_key, v_version, coalesce(p->>'label', 'v' || v_version),
          coalesce(p->>'origin','hand'), p->>'reason', v_author,
          coalesce(p->>'html',''), coalesce(p->>'css',''),
          coalesce(p->'tokens','{}'::jsonb), p->>'goal', p->>'model',
          nullif(p->>'parent_id','')::uuid)
  returning id into v_id;

  perform command_log('lab_variant_saved', 'settings', v_id, v_key,
    format('%s v%s saved by %s — %s', v_key, v_version, v_author, p->>'reason'),
    jsonb_build_object('origin', p->>'origin', 'goal', p->>'goal'));

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
end $$;
revoke all on function public.command_lab_save_variant(jsonb) from public, anon;
grant execute on function public.command_lab_save_variant(jsonb) to authenticated;

create or replace function public.command_lab_archive_variant(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v command_lab_variants;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  update command_lab_variants set archived = true where id = p_id returning * into v;
  if v.id is null then raise exception 'command: no such variant'; end if;
  perform command_log('lab_variant_archived', 'settings', v.id, v.subject_key,
    format('%s v%s archived — %s', v.subject_key, v.version, coalesce(p_reason,'no reason given')), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.command_lab_archive_variant(uuid, text) from public, anon;
grant execute on function public.command_lab_archive_variant(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. THE TIME MACHINE — one ordered history from every real record
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything that ever changed, on one timeline, with its true timestamp.
 *
 * Nothing here is reconstructed. Each row is a record that was written when the
 * thing happened: a variant saved, a screenshot taken, a prompt promoted, a
 * release classified, an experiment concluded. Scrubbing the timeline is
 * therefore scrubbing history rather than a story told about it.
 */
-- Dropped first: `create or replace` cannot change a function's OUT columns,
-- and this one grew capture_path so the Time Machine can show what a thing
-- actually looked like rather than a sentence describing it.
drop function if exists public.command_lab_timeline(text, int);
create or replace function public.command_lab_timeline(
  p_scope text default 'all', p_limit int default 400
) returns table (
  at timestamptz, stream text, ref text, label text, detail text,
  entity_id uuid, capture_id uuid, capture_path text
) language sql stable security definer set search_path = public as $$
  with rows as (
    -- A variant carries its most recent screenshot, so scrubbing to the moment
    -- a design was saved shows the design rather than a description of it.
    select v.created_at as at, 'variant'::text as stream, v.subject_key as ref,
           v.label || ' v' || v.version as label, v.reason as detail,
           v.id as entity_id,
           (select c.id from command_lab_captures c where c.variant_id = v.id
             order by c.captured_at desc limit 1) as capture_id,
           (select c.storage_path from command_lab_captures c where c.variant_id = v.id
             order by c.captured_at desc limit 1) as capture_path
      from command_lab_variants v where not v.archived

    union all
    select c.captured_at, 'capture', coalesce(c.subject_key, c.url), c.label,
           c.viewport || ' · ' || c.width || '×' || c.height, c.id, c.id, c.storage_path
      from command_lab_captures c

    union all
    select pv.created_at, 'prompt', pv.prompt_key,
           pv.prompt_key || ' v' || pv.version, pv.reason, pv.id, null::uuid, null::text
      from command_prompt_versions pv where not pv.archived

    union all
    select pv.promoted_at, 'promotion', pv.prompt_key,
           pv.prompt_key || ' v' || pv.version || ' went live',
           coalesce(pv.promotion_note, 'promoted'), pv.id, null::uuid, null::text
      from command_prompt_versions pv where pv.promoted_at is not null

    union all
    select r.created_at, 'release', r.ref, r.title,
           coalesce(r.outcome, r.status), r.id, null::uuid, null::text
      from command_releases r

    union all
    select e.created_at, 'experiment', e.ref, e.hypothesis,
           e.status, e.id, null::uuid, null::text
      from command_experiments e

    union all
    select p.ran_at, 'perf', p.label, p.label,
           case when p.error is not null then 'failed: ' || left(p.error, 80)
                else coalesce('LCP ' || p.lcp_ms || 'ms', 'measured') end,
           p.id, null::uuid, null::text
      from command_perf_runs p
  )
  select * from rows
   where at is not null
     and (p_scope = 'all' or stream = p_scope)
   order by at desc
   limit greatest(1, least(2000, p_limit));
$$;
grant execute on function public.command_lab_timeline(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ONE ROUND TRIP FOR THE LAB PAGE
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole Dev Lab in a single call.
 *
 * Sydney is ~85ms away from syd1 and every separate query pays that again. The
 * lab has eleven rooms; eleven round trips would be a second of latency before
 * anything renders. This is deliberately one function returning one document.
 */
create or replace function public.command_lab_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'subjects', (
      select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
               'variants', (select count(*) from command_lab_variants v
                             where v.subject_key = s.key and not v.archived),
               'latest', (select max(v.created_at) from command_lab_variants v
                             where v.subject_key = s.key and not v.archived))
             order by s.sort, s.label), '[]'::jsonb)
        from command_lab_subjects s where not s.archived),
    'prompts', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
               'versions', (select count(*) from command_prompt_versions pv
                             where pv.prompt_key = p.key and not pv.archived),
               'live', (select pv.version from command_prompt_versions pv
                         where pv.prompt_key = p.key and pv.is_live),
               'runs', (select count(*) from command_bench_runs r
                         join command_prompt_versions pv on pv.id = r.version_id
                        where pv.prompt_key = p.key))
             order by p.key), '[]'::jsonb)
        from command_prompts p),
    'personas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]'::jsonb)
                   from command_personas x),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc), '[]'::jsonb)
               from (select * from command_lab_jobs order by created_at desc limit 40) j),
    'perf', (select coalesce(jsonb_agg(to_jsonb(p) order by p.ran_at desc), '[]'::jsonb)
               from (select * from command_perf_runs order by ran_at desc limit 40) p),
    'tournaments', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
                      'entrants', (select count(*) from command_arena_entrants e where e.tournament_id = t.id))
                      order by t.created_at desc), '[]'::jsonb)
                      from command_arena_tournaments t),
    'predictions', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
                      from command_predictions p),
    'accuracy', command_prediction_accuracy(),
    'integrations', (select coalesce(jsonb_agg(to_jsonb(i) order by i.key), '[]'::jsonb)
                       from command_integrations i where i.category = 'devlab'),
    'worker', (select to_jsonb(r) from command_runners r where r.worker like 'lab%'
                order by r.started_at desc limit 1)
  );
$$;
grant execute on function public.command_lab_overview() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. SEED — the real EvoForge surfaces
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_lab_subjects (key, kind, label, purpose, surface, sort) values
  ('screen_home','screen','Home','The first screen after sign-in. Where activation is won or lost.','client/src/app/(main)/index.tsx',10),
  ('screen_train','screen','Train / Log','Logging a set — the action 63% of signups never reach.','client/src/app/(main)/log.tsx',20),
  ('screen_champion','screen','Champion','The avatar and its stats.','client/src/app/(main)/avatar.tsx',30),
  ('screen_profile','screen','Profile','Identity, rank and history.','client/src/app/(main)/profile.tsx',40),
  ('screen_onboarding','screen','Onboarding','First run. The funnel every activation number depends on.','client/src/app/onboarding.tsx',50),
  ('flow_nav','flow','Navigation','The tab bar and how a session moves between rooms.','client/src/app/(main)/_layout.tsx',60),
  ('component_workout_card','component','Workout card','The repeated unit of the training surface.','client/src/components',110),
  ('component_button','component','Button','Primary, ghost and danger, with their states.','client/src/components',120),
  ('component_stat_tile','component','Stat tile','How a single number is presented.','client/src/components',130),
  ('component_progress','component','Progress / XP bar','Progression feedback — glow is allowed here by the neon policy.','client/src/components',140)
on conflict (key) do update set label = excluded.label, purpose = excluded.purpose,
  surface = excluded.surface, sort = excluded.sort;

-- The registry now reports what is genuinely wired. Each of these is live
-- because a worker executes it, not because a table exists.
insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('devlab_ui','Dev Lab — UI Studio / Component Lab','devlab','live',
   'Versioned variants over EvoForge''s real design tokens, rendered in a null-origin sandbox, screenshotted by real Chrome and comparable side by side.',
   'None. Variants save from the browser; captures need the lab worker running.'),
  ('devlab_sim','Dev Lab — Data Simulator','devlab','live',
   'Deterministic synthetic athletes from a seed, driven through the real EvoForge domain maths and through live prompts. A trigger refuses any attempt to file a simulated result as user evidence.',
   'None.'),
  ('devlab_perf','Dev Lab — Performance Lab','devlab','live',
   'Real Chromium via Playwright: TTFB, FCP, LCP, CLS, total blocking time, DOM nodes, JS heap, long tasks, request count and transfer bytes by type, plus a sampled frame rate. Battery and native-thread FPS are NOT measurable headless and are not reported.',
   'The lab worker must be running on the machine with Chromium installed.'),
  ('devlab_arena','Dev Lab — Challenge Arena','devlab','live',
   'Single-elimination brackets over prompt versions or UI variants. A match cannot be decided without recording the method and the evidence behind it.',
   'None.'),
  ('devlab_simulation','Dev Lab — Simulation Engine','devlab','live',
   'Estimates from completed experiments, classified releases and tagged knowledge — and returns "insufficient" with the reason when none exist, which is the honest answer today. Every resolved prediction is scored against what actually happened.',
   'None. Accuracy becomes meaningful once experiments complete.'),
  ('devlab_jobs','Dev Lab — execution worker','devlab','live',
   'scripts/lab-worker.mjs claims queued jobs on the local machine and performs the real work: Claude CLI runs with true token counts and cost, and Chromium sessions with true Web Vitals. The site itself executes nothing.',
   'Kept alive by the EvoForge Command Supervisor scheduled task.'),
  -- Written 'absent' on the first pass and corrected once the worker actually
  -- reported its providers: OPENAI_API_KEY is in the machine environment, not
  -- .env.local, so the key was there all along and the registry was wrong about
  -- its own capability. Reading what the worker reports beats assuming.
  ('devlab_multimodel','Dev Lab — providers','devlab','live',
   'Claude runs through the local CLI and reports true billed cost. OpenAI runs through /v1/responses — the same endpoint supabase/functions/_shared/ai.ts uses — so the five product prompts are benchmarked on the model that actually serves them; its API returns tokens but no price, so cost is recorded as unknown rather than guessed. Gemini and Kimi have no key and are reported as unavailable rather than compared.',
   'Add GOOGLE_API_KEY / MOONSHOT_API_KEY to the environment and those providers appear.')
on conflict (key) do update set status=excluded.status, label=excluded.label,
  detail=excluded.detail, setup_required=excluded.setup_required, updated_at=now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. STORAGE — screenshots
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('lab', 'lab', false, 10485760)
on conflict (id) do nothing;

do $$ begin
  drop policy if exists lab_read_founders on storage.objects;
  create policy lab_read_founders on storage.objects
    for select using (bucket_id = 'lab' and public.is_founder());
exception when insufficient_privilege then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. RLS — founders read; every write goes through a definer function
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'command_lab_subjects','command_lab_variants','command_lab_captures',
    'command_perf_runs','command_personas','command_lab_jobs',
    'command_arena_tournaments','command_arena_entrants','command_arena_matches',
    'command_predictions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t||'_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

revoke all on function public.command_lab_claim(text, text[]) from public, anon, authenticated;
revoke all on function public.command_lab_progress(uuid, int, text) from public, anon, authenticated;
revoke all on function public.command_lab_finish(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.command_arena_decide(uuid, uuid, text, text, jsonb) to authenticated;
