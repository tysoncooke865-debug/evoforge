-- EvoForge 111 — Phase 5 completed, and one uncomfortable fact about the Prompt Lab.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — THE PROMPT LAB IS BENCHMARKING THE WRONG MODEL, AND MUST SAY SO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 109 seeded command_prompts with EvoForge's five AI surfaces and the studio's
-- two agent prompts, and the lab benchmarks all of them through the local Claude
-- CLI — because that is the only model this machine can execute.
--
-- But supabase/functions/_shared runs OPENAI. DEFAULT_MODEL is 'gpt-5.1' and
-- FAST_MODEL is 'gpt-5-mini'. So five of the seven prompts in the lab are
-- production prompts for a model the lab cannot run.
--
-- That does NOT make the benchmark worthless: every version of a prompt is
-- scored on the same model against the same cases, so the RANKING between
-- versions is a real signal about the prompt's own wording. What it cannot do is
-- prove the ranking transfers, or state what the prompt costs in production.
--
-- The failure this prevents is specific and would have been invisible: a
-- scoreboard reading "ai_plan v3 — mean quality 0.84, $0.11/run", promoted, and
-- production unchanged in quality while the real cost is a fiftieth of that
-- number and belongs to a different vendor entirely.
--
-- So: every prompt now records what production actually runs, every promotion
-- checks the evidence against it, and a cross-model promotion is possible but
-- must be argued for in writing and is audited as such.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — PHASE 5, THE REST OF IT
-- ─────────────────────────────────────────────────────────────────────────────
--
--   5.1 evaluation  — an eval suite built from REAL past work orders, not
--                     invented tasks. WO-002 through WO-006 are the corpus.
--   5.2 autonomy    — a level a founder sets, that the DATABASE refuses to let
--                     them set above what the run history justifies.
--   5.3 auto-exec   — LOW-risk work may proceed unattended, and the policy is a
--                     function that returns its own reasoning.
--   5.4 rollout     — a staged ladder that will not advance on an unmeasured or
--                     failing stage.
--
-- FALSIFICATION CHECKLIST (scripts/_falsify111.mjs):
--   1. promoting on evidence from a model production does not run is refused,
--      and allowed only with a written justification that is recorded.
--   2. autonomy cannot be set above what command_suggested_autonomy justifies.
--   3. a HIGH or MEDIUM risk order can never auto-execute, at any autonomy.
--   4. rollout cannot advance while the experiment is paused.
--   5. rollout cannot advance without exposure at the current stage.
--   6. rollout cannot skip a rung.
--   7. eval cases are built from real work orders and cite them.

-- ─────────────────────────────────────────────────────────────────────────────
-- A1. WHAT PRODUCTION ACTUALLY RUNS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_prompts
  add column if not exists production_provider text,
  add column if not exists production_model    text;

comment on column public.command_prompts.production_provider is
  'The provider the SHIPPED surface calls. Read from the code, not assumed: '
  'supabase/functions/_shared calls api.openai.com; the studio runner calls the '
  'Claude CLI. A benchmark run on a different provider ranks wordings, it does '
  'not predict production behaviour.';

update public.command_prompts set production_provider = 'openai', production_model = 'gpt-5-mini'
 where key in ('ai_plan');
update public.command_prompts set production_provider = 'openai', production_model = 'gpt-5.1'
 where key in ('ai_physique','ai_nutrition','ai_plan_scan','evo_scan');
update public.command_prompts set production_provider = 'anthropic', production_model = 'claude-code'
 where key in ('agent_implement','agent_exec_plan');

/**
 * Promote a version to live — now checking WHOSE evidence it is.
 *
 * Builds on 109's version rather than replacing its reasoning: it still refuses
 * without enough scored runs, and still refuses a version that did not beat the
 * incumbent. What is added is the provider check.
 *
 * `p_cross_model_note` is the escape hatch, and it is deliberately a sentence
 * rather than a boolean. "true" records nothing a person could disagree with
 * later; a written argument can be read, quoted back, and found wrong.
 */
create or replace function public.command_promote_prompt(
  p_version uuid, p_note text, p_min_runs int default 3, p_cross_model_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v record; cur record; pr record;
  v_runs int; v_q numeric; cur_q numeric;
  v_providers text[]; v_cross boolean := false;
begin
  select * into v from command_prompt_versions where id = p_version;
  if v is null then raise exception 'command: no such prompt version'; end if;
  select * into pr from command_prompts where key = v.prompt_key;

  select count(quality), avg(quality) into v_runs, v_q
    from command_bench_runs where version_id = p_version and error is null;

  if coalesce(v_runs,0) < p_min_runs then
    raise exception
      'command: % v% has % scored benchmark run(s), needs % — promoting on taste is what this lab exists to replace',
      v.prompt_key, v.version, coalesce(v_runs,0), p_min_runs;
  end if;

  -- WHOSE evidence is this?
  select array_agg(distinct provider) into v_providers
    from command_bench_runs where version_id = p_version and error is null and quality is not null;

  v_cross := pr.production_provider is not null
         and not (pr.production_provider = any(coalesce(v_providers, '{}')));

  if v_cross and coalesce(trim(p_cross_model_note),'') = '' then
    raise exception
      'command: % runs on %/% in production, but every scored run for v% is from %. '
      'The ranking between versions may still hold; the result does not transfer automatically. '
      'Either benchmark on the production provider, or promote with a written justification.',
      v.prompt_key, pr.production_provider, pr.production_model, v.version,
      array_to_string(coalesce(v_providers,'{unknown}'), ', ');
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
         promotion_note = case
           when v_cross then coalesce(p_note,'') ||
             format(' [CROSS-MODEL: evidence from %s, production runs %s/%s. %s]',
                    array_to_string(coalesce(v_providers,'{unknown}'), ', '),
                    pr.production_provider, pr.production_model, p_cross_model_note)
           else p_note end
   where id = p_version;

  perform command_log('prompt_promoted', 'settings', null, v.prompt_key,
    format('%s v%s promoted%s — mean quality %s over %s runs.%s',
           v.prompt_key, v.version,
           case when cur.version is not null then format(' over v%s (%s)', cur.version, round(cur_q,3)) else '' end,
           round(v_q,3), v_runs,
           case when v_cross then format(' CROSS-MODEL: benchmarked on %s, production runs %s.',
                                          array_to_string(coalesce(v_providers,'{unknown}'), ', '),
                                          pr.production_model)
                else '' end),
    jsonb_build_object('version', v.version, 'quality', v_q, 'beat', cur.version,
                       'cross_model', v_cross, 'evidence_providers', v_providers,
                       'production_model', pr.production_model));

  return jsonb_build_object('ok', true, 'version', v.version, 'quality', round(v_q,3),
                            'beat', cur.version, 'cross_model', v_cross);
end $$;
revoke all on function public.command_promote_prompt(uuid, text, int, text) from public, anon;
grant execute on function public.command_promote_prompt(uuid, text, int, text) to authenticated;

-- DROP THE SUPERSEDED 3-ARGUMENT OVERLOAD.
--
-- Adding a defaulted fourth parameter does not replace the old function, it
-- creates a second one — and then command_promote_prompt(uuid, text, int)
-- matches BOTH, so every existing 3-argument call fails with "function is not
-- unique". The UI calls it with three arguments. Without this line the Prompt
-- Lab's promote button is broken the moment this migration lands, and nothing
-- in the migration itself would have revealed that.
--
-- Found by scripts/_falsify111.mjs, which is the entire argument for writing
-- the falsification before trusting the guard. Same precedent as 095, which
-- dropped the 6-argument heartbeat for the same reason.
drop function if exists public.command_promote_prompt(uuid, text, int);

-- ─────────────────────────────────────────────────────────────────────────────
-- B1. THE EVALUATION SUITE — built from real history, not invented tasks
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Turn completed work orders into benchmark cases for the agent prompts.
 *
 * The corpus is WO-002 onward: real problems, with the real scope a founder
 * wrote and the real acceptance criteria they were judged against. That matters
 * more than it sounds. An evaluation suite of invented tasks measures how an
 * agent handles tasks somebody made up to be measurable, which is a different
 * and much easier job than the one it actually has.
 *
 * The rubric IS the order's acceptance criteria, verbatim. Nothing is
 * paraphrased into something friendlier to score.
 *
 * What this evaluates: the PLAN an agent produces from a work order. Not the
 * diff — replaying a real implementation would need a worktree per case and a
 * build per case, and would still be scored on criteria a model wrote. Planning
 * is the step where the expensive mistakes are made anyway.
 */
create or replace function public.command_build_agent_eval_cases()
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; v_n int := 0; v_key text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;

  for w in
    select * from command_work_orders
     where acceptance_criteria is not null
       and array_length(acceptance_criteria, 1) > 0
       and ref not like 'WO-F1%'          -- falsification fixtures are not history
     order by ref
  loop
    v_key := 'eval_' || lower(replace(w.ref, '-', '_'));

    insert into command_bench_cases (key, prompt_key, label, input, rubric)
    values (
      v_key, 'agent_exec_plan',
      format('%s — %s', w.ref, left(w.title, 60)),
      jsonb_build_object(
        'work_order', w.ref,
        'title', w.title,
        'objectives', to_jsonb(w.objectives),
        'scope', w.scope,
        'risk_level', w.risk_level,
        'protected_areas', to_jsonb(w.protected_areas),
        'non_goals', to_jsonb(w.non_goals)),
      format(
        'This is a real EvoForge work order (%s). The plan must satisfy every acceptance criterion below, '
        || 'name the files or systems it would change, and stay inside the stated scope.%s%s'
        || E'\n\nACCEPTANCE CRITERIA:\n%s'
        || E'\n\nScore 0 if the plan invents evidence, proposes work outside the scope, ignores a criterion, '
        || 'or touches a protected area without saying why it must.',
        w.ref,
        case when w.risk_level is not null then format(' Risk was assessed as %s.', w.risk_level) else '' end,
        case when w.non_goals is not null and array_length(w.non_goals,1) > 0
             then format(' Explicit non-goals: %s.', array_to_string(w.non_goals, '; ')) else '' end,
        (select string_agg('  - ' || value, E'\n') from unnest(w.acceptance_criteria) as value)))
    on conflict (key) do update
      set input = excluded.input, rubric = excluded.rubric, label = excluded.label;

    v_n := v_n + 1;
  end loop;

  perform command_log('eval_suite_built', 'settings', null, 'agent_exec_plan',
    format('%s evaluation case(s) built from real work orders', v_n),
    jsonb_build_object('cases', v_n));

  return jsonb_build_object('ok', true, 'cases', v_n,
    'note', 'Built from real completed work orders. Every rubric is that order''s own acceptance criteria.');
end $$;
revoke all on function public.command_build_agent_eval_cases() from public, anon;
grant execute on function public.command_build_agent_eval_cases() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2. AUTONOMY — a founder sets it; the database decides the ceiling
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Raise or lower an agent's autonomy.
 *
 * Lowering is always allowed and needs no evidence — taking permission away
 * must never be blocked by a metric. Raising is capped by
 * command_suggested_autonomy, which needs ten finished runs before it will
 * suggest anything above zero.
 *
 * The cap is enforced HERE rather than in the UI because the UI is not the
 * access control, and because the specific bad afternoon this prevents is
 * obvious: something goes wrong, someone raises autonomy to get unblocked, and
 * the permission stays raised long after the afternoon ends.
 */
create or replace function public.command_set_autonomy(
  p_agent text, p_level int, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; s jsonb; v_max int;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if p_level < 0 or p_level > 2 then
    raise exception 'command: autonomy is 0, 1 or 2 — there is no level above "LOW and MEDIUM unattended"';
  end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say why. An autonomy change with no stated reason cannot be reviewed later';
  end if;

  select * into a from command_agents where key = p_agent;
  if a is null then raise exception 'command: no such agent %', p_agent; end if;

  s := command_suggested_autonomy(p_agent);
  v_max := coalesce((s->>'level')::int, 0);

  if p_level > a.autonomy_level and p_level > v_max then
    raise exception
      'command: % cannot be raised to %. Its run history justifies at most % — %. '
      'Autonomy is earned from command_agent_stats, not granted.',
      p_agent, p_level, v_max, coalesce(s->>'why', 'no evidence');
  end if;

  update command_agents
     set autonomy_level = p_level,
         autonomy_note = format('%s (set %s: %s)', p_reason, to_char(now(),'YYYY-MM-DD'), s->>'why')
   where key = p_agent;

  perform command_log('autonomy_set', 'agent', null, p_agent,
    format('%s autonomy %s → %s — %s', p_agent, a.autonomy_level, p_level, p_reason),
    jsonb_build_object('from', a.autonomy_level, 'to', p_level, 'evidence', s));

  return jsonb_build_object('ok', true, 'agent', p_agent, 'level', p_level, 'evidence', s);
end $$;
revoke all on function public.command_set_autonomy(text, int, text) from public, anon;
grant execute on function public.command_set_autonomy(text, int, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B3. AUTOMATIC LOW-RISK EXECUTION
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * May this work order proceed without a founder gate?
 *
 * Returns its own reasoning rather than a bare boolean, so the runner can log
 * WHY it waited — "blocked" with no explanation is the single most expensive
 * kind of log line in this system.
 *
 * The rules, and why each one is here:
 *   - the studio must not be halted. The emergency stop stops everything.
 *   - risk must be LOW, inferred from the paths the order actually touches.
 *     MEDIUM and HIGH never auto-execute at any autonomy level. There is no
 *     autonomy value that unlocks a migration or an auth change.
 *   - the assigned agent's autonomy must be at least 1, which it can only reach
 *     through ten finished runs at a sustained success rate.
 *   - the order must carry acceptance criteria. Unattended work with nothing to
 *     check against cannot be verified, so it cannot be unattended.
 *   - architect-authorised orders always stop for a human, whatever the risk
 *     inference says, because that flag exists to mark work a person chose to
 *     supervise.
 */
create or replace function public.command_may_auto_execute(p_work_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  w record; v_risk text; v_agent text; v_level int; v_criteria int; v_halted boolean;
begin
  select * into w from command_work_orders where id = p_work_order;
  if w is null then return jsonb_build_object('ok', false, 'why', 'no such work order'); end if;

  -- command_settings stores scalars as bare jsonb, so the key IS 'halted' and
  -- the value IS `false` — not an object with a halted field.
  select (value #>> '{}')::boolean into v_halted
    from command_settings where key = 'halted';
  if coalesce(v_halted, false) then
    return jsonb_build_object('ok', false, 'why', 'the studio is halted');
  end if;

  if w.architect_authorised then
    return jsonb_build_object('ok', false, 'why',
      'architect-authorised work always stops for a human — that flag exists to mark work someone chose to supervise');
  end if;

  v_risk := coalesce(w.risk_level, command_infer_risk(coalesce(w.protected_areas, '{}')));
  if v_risk is distinct from 'LOW' then
    return jsonb_build_object('ok', false, 'risk', v_risk, 'why',
      format('risk is %s — only LOW work runs unattended, and no autonomy level changes that', v_risk));
  end if;

  select count(*) into v_criteria from command_criteria where work_order_id = w.id;
  if v_criteria = 0 then
    return jsonb_build_object('ok', false, 'why',
      'no acceptance criteria — unattended work with nothing to check against cannot be verified');
  end if;

  v_agent := coalesce(w.assigned_agents[1], 'atlas');
  select autonomy_level into v_level from command_agents where key = v_agent;
  if coalesce(v_level, 0) < 1 then
    return jsonb_build_object('ok', false, 'agent', v_agent, 'autonomy', coalesce(v_level,0), 'why',
      format('%s is at autonomy %s — it has not earned unattended work yet', v_agent, coalesce(v_level,0)));
  end if;

  return jsonb_build_object('ok', true, 'agent', v_agent, 'autonomy', v_level,
    'risk', v_risk, 'criteria', v_criteria,
    'why', format('LOW risk, %s criteria to check, and %s is at autonomy %s', v_criteria, v_agent, v_level));
end $$;
grant execute on function public.command_may_auto_execute(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B4. CONTROLLED ROLLOUT
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * The rollout ladder: 0 → 10 → 25 → 50 → 100.
 *
 * Rungs, not a free number, because "set it to 80" is a decision nobody
 * reviewed and there is no reason to prefer 80 to 50 or 100. Each advance
 * requires that the current rung actually carried traffic — advancing off a
 * stage with zero exposure is advancing on no information, which is the same as
 * shipping to everyone and calling it staged.
 */
create or replace function public.command_advance_rollout(
  p_flag text, p_reason text, p_min_exposure int default 20
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f record; e record; v_next numeric; v_seen int;
  ladder numeric[] := array[0, 10, 25, 50, 100];
  i int;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p_reason),'') = '' then
    raise exception 'command: say what the current stage showed. An unexplained rollout is not staged, it is slow';
  end if;

  select * into f from command_flags where key = p_flag;
  if f is null then raise exception 'command: no such flag %', p_flag; end if;
  if not f.enabled then
    raise exception 'command: % is disabled%. Enable it before advancing anything',
      p_flag, case when f.paused_reason is not null then ' — ' || f.paused_reason else '' end;
  end if;

  select * into e from command_experiments where flag_key = p_flag
   order by created_at desc limit 1;
  if e.id is not null and (e.auto_paused or e.status = 'PAUSED') then
    raise exception 'command: % is paused (%) — a paused experiment does not get more traffic',
      e.ref, coalesce(e.pause_reason, 'paused');
  end if;

  -- Find the next rung above the current percentage.
  v_next := null;
  for i in 1..array_length(ladder,1) loop
    if ladder[i] > f.rollout_pct then v_next := ladder[i]; exit; end if;
  end loop;
  if v_next is null then
    return jsonb_build_object('ok', true, 'rollout', f.rollout_pct, 'note', 'already at 100%');
  end if;

  -- Did the CURRENT stage carry anyone? Skipped when leaving 0, which by
  -- definition has no exposure to show.
  --
  -- Exposure is recorded against the EXPERIMENT, not the flag — command_
  -- experiment_exposures has no flag_key — so a flag with no experiment behind
  -- it has no exposure record to check. That is treated as "cannot verify"
  -- rather than "verified fine": a flag advancing with nobody watching is the
  -- exact thing this gate exists to stop.
  if f.rollout_pct > 0 then
    if e.id is null then
      raise exception
        'command: % has no experiment attached, so there is no exposure to read. '
        'A staged rollout with nothing measuring it is just a slow release',
        p_flag;
    end if;
    select count(distinct subject_id) into v_seen
      from command_experiment_exposures where experiment_id = e.id;
    if coalesce(v_seen,0) < p_min_exposure then
      -- "percent" spelled out rather than a literal % sign: in RAISE, % is the
      -- placeholder and %% is an escaped literal, so a message mixing both is
      -- one edit away from a compile error that only appears at migration time.
      raise exception
        'command: % is at % percent, with % subject(s) exposed and % needed. '
        'Advancing off a stage nobody saw is not a staged rollout',
        p_flag, f.rollout_pct, coalesce(v_seen,0), p_min_exposure;
    end if;
  end if;

  update command_flags set rollout_pct = v_next, updated_at = now() where key = p_flag;
  if e.id is not null then
    update command_experiments set rollout_pct = v_next where id = e.id;
  end if;

  perform command_log('rollout_advanced', 'settings', null, p_flag,
    format('%s %s%% → %s%% — %s', p_flag, f.rollout_pct, v_next, p_reason),
    jsonb_build_object('from', f.rollout_pct, 'to', v_next, 'experiment', e.ref));

  return jsonb_build_object('ok', true, 'from', f.rollout_pct, 'to', v_next, 'experiment', e.ref);
end $$;
revoke all on function public.command_advance_rollout(text, text, int) from public, anon;
grant execute on function public.command_advance_rollout(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B5. THE AGENTS PAGE, IN ONE CALL
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_agent_evaluation(p_since interval default interval '30 days')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'window_days', extract(day from p_since),
    'agents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', a.key, 'name', a.name, 'title', a.title, 'accent', a.accent,
        'permission', a.permission,
        'autonomy_level', a.autonomy_level, 'autonomy_note', a.autonomy_note,
        'suggested', command_suggested_autonomy(a.key),
        'stats', (select to_jsonb(s) from command_agent_stats(p_since) s where s.agent_key = a.key)
      ) order by a.sort, a.key), '[]'::jsonb)
      from command_agents a where a.active),
    'models', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'model', model, 'runs', n, 'successes', ok,
        'success_rate', round(ok::numeric / nullif(n,0), 3),
        'avg_cost_usd', cost, 'avg_minutes', mins) order by n desc), '[]'::jsonb)
      from (
        select model,
               count(*) as n,
               count(*) filter (where outcome = 'success') as ok,
               round(avg(cost_usd), 4) as cost,
               round(avg(extract(epoch from (ended_at - started_at))/60)::numeric, 1) as mins
          from command_runs
         where ended_at is not null and started_at > now() - p_since
         group by model) m),
    -- Total, so a page can say "6 of 41 runs" rather than implying the window
    -- it happens to be showing is everything that ever happened.
    'runs_all_time', (select count(*) from command_runs where ended_at is not null),
    'eval_cases', (select count(*) from command_bench_cases where key like 'eval\_%'),
    'eval_scoreboard', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
                          from command_prompt_scoreboard('agent_exec_plan') s)
  );
$$;
grant execute on function public.command_agent_evaluation(interval) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- B6. REGISTRY
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('agent_evaluation','Agent evaluation suite','execution','live',
   'Per-agent and per-model success rate, criteria-pass rate, unnecessary-file rate and cost per successful order from command_runs, plus a benchmark suite built from real completed work orders. Autonomy is capped by these numbers in the database.',
   'Ten finished runs per agent before any autonomy above 0 can be granted.'),
  ('auto_execution','Automatic low-risk execution','execution','live',
   'command_may_auto_execute gates unattended work on LOW inferred risk, earned autonomy and the presence of acceptance criteria. MEDIUM and HIGH never qualify.',
   'The runner consults it each cycle; no configuration.'),
  ('controlled_rollout','Staged rollout','release','live',
   'command_advance_rollout walks 0 → 10 → 25 → 50 → 100 and refuses to advance a paused experiment or a stage with no exposure.',
   'The Expo client must record exposure into command_experiment_exposures for the exposure gate to have data.'),
  ('prompt_provider_truth','Prompt Lab provider honesty','devlab','live',
   'Every prompt records the provider production actually calls. Five EvoForge surfaces run OpenAI (gpt-5.1 / gpt-5-mini) and cannot be executed from this machine; promoting them on Claude evidence requires a written justification and is audited as cross-model.',
   'Add OPENAI_API_KEY to .env.local to benchmark those prompts on the model that actually serves them.')
on conflict (key) do update set status=excluded.status, label=excluded.label,
  detail=excluded.detail, setup_required=excluded.setup_required, updated_at=now();
